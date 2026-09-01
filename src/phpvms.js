const DEFAULT_BASE_URL = "https://aaocvirtual.com";
const DEFAULT_CACHE_TTL = 120;

let cache = null;
let cacheFetchedAt = 0;

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function normalize(value) {
  return clean(value).toUpperCase();
}

function baseUrl() {
  return clean(process.env.PHPVMS_BASE_URL || process.env.AAOC_WEBSITE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function apiKey() {
  return clean(process.env.PHPVMS_API_KEY || process.env.AAOC_API_KEY);
}

function cacheTtlMs() {
  const seconds = Number(process.env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL);
  return (Number.isFinite(seconds) && seconds >= 15 ? seconds : DEFAULT_CACHE_TTL) * 1000;
}

async function requestJson(path, params = {}) {
  const key = apiKey();
  if (!key) {
    throw new Error("PHPVMS_API_KEY is not configured in Railway.");
  }

  const url = new URL(path, `${baseUrl()}/`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      headers: {
        "X-API-Key": key,
        "Accept": "application/json",
        "User-Agent": "vAAOC-Discord-Bot/2.0"
      },
      signal: controller.signal
    });

    const text = await response.text();

    if (response.status === 401) {
      throw new Error("AAOC phpVMS rejected PHPVMS_API_KEY (HTTP 401).");
    }
    if (response.status === 403) {
      throw new Error("AAOC phpVMS API key does not have permission for this endpoint (HTTP 403).");
    }
    if (response.status === 404) {
      throw new Error(`AAOC phpVMS endpoint not found: ${url.pathname} (HTTP 404).`);
    }
    if (!response.ok) {
      throw new Error(`AAOC phpVMS request failed (HTTP ${response.status}): ${text.replace(/\s+/g, " ").slice(0, 250)}`);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("AAOC phpVMS returned non-JSON data. Check PHPVMS_BASE_URL and API configuration.");
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("AAOC phpVMS returned an unexpected response.");
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("AAOC phpVMS API request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getAllPages(path) {
  const items = [];
  let page = 1;
  const perPage = 100;

  for (let guard = 0; guard < 500; guard += 1) {
    const payload = await requestJson(path, { page, per_page: perPage });
    const data = payload.data;

    if (Array.isArray(data)) {
      items.push(...data.filter(item => item && typeof item === "object"));
    } else if (data && typeof data === "object") {
      items.push(data);
    }

    const meta = payload.meta;
    if (!meta || typeof meta !== "object") break;

    const currentPage = Number(meta.current_page || page);
    const lastPage = Number(meta.last_page || currentPage);
    if (!Number.isFinite(currentPage) || !Number.isFinite(lastPage) || currentPage >= lastPage) break;

    page = currentPage + 1;
  }

  return items;
}

function flattenFleet(subfleets) {
  const aircraft = [];

  for (const subfleet of subfleets) {
    const subfleetType = normalize(subfleet.type);
    const subfleetName = clean(subfleet.name);
    const list = Array.isArray(subfleet.aircraft) ? subfleet.aircraft : [];

    for (const record of list) {
      if (!record || typeof record !== "object") continue;

      const registration = clean(record.registration);
      const tailNumber = clean(record.tail_number);
      const name = clean(record.name);
      const icao = normalize(record.icao || subfleetType);
      const airportId = normalize(record.airport_id);

      aircraft.push({
        id: clean(record.id),
        registration,
        tailNumber,
        name,
        icao,
        typeName: subfleetName,
        airportId,
        active: record.active !== false && record.active !== 0,
        updatedAt: clean(record.updated_at),
        displayTail: registration || tailNumber || name || clean(record.id) || "Unknown",
        displayType: icao || subfleetName || "Unknown"
      });
    }
  }

  aircraft.sort((a, b) =>
    (a.airportId || "ZZZZ").localeCompare(b.airportId || "ZZZZ") ||
    a.displayType.localeCompare(b.displayType) ||
    a.displayTail.localeCompare(b.displayTail)
  );

  return aircraft;
}

export async function getFleet({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cacheFetchedAt < cacheTtlMs()) {
    return cache;
  }

  const subfleets = await getAllPages("/api/fleet");
  const aircraft = flattenFleet(subfleets);

  cache = {
    aircraft,
    subfleetCount: subfleets.length,
    fetchedAt: new Date()
  };
  cacheFetchedAt = Date.now();

  console.log(`AAOC phpVMS fleet loaded: ${aircraft.length} aircraft across ${subfleets.length} subfleets.`);
  return cache;
}

export async function getAirport(icao) {
  const normalized = normalize(icao);
  try {
    const payload = await requestJson(`/api/airports/${encodeURIComponent(normalized)}`);
    return payload?.data && typeof payload.data === "object" ? payload.data : null;
  } catch (error) {
    if (String(error.message || error).includes("HTTP 404")) return null;
    throw error;
  }
}

export function matchesAircraftType(item, query) {
  const needle = normalize(query).replace(/[\s_-]/g, "");
  const values = [item.icao, item.typeName]
    .map(value => normalize(value).replace(/[\s_-]/g, ""))
    .filter(Boolean);

  return values.some(value => value === needle || value.includes(needle) || needle.includes(value));
}
