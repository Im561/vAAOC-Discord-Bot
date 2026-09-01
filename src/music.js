import { Player } from "discord-player";
import { DefaultExtractors } from "@discord-player/extractor";

let player = null;
let initialized = false;
let initPromise = null;
let youtubeReady = false;
let youtubeError = null;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms.`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function initializeMusic(client) {
  if (initialized && player) return player;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const nextPlayer = new Player(client);

    await withTimeout(
      nextPlayer.extractors.loadMulti(DefaultExtractors),
      15000,
      "Default music extractor initialization"
    );

    // Load YouTube dynamically so a broken third-party extractor can never
    // crash the whole Discord bot before it logs in or answers commands.
    try {
      const { YouTubeDlpExtractor } = await withTimeout(
        import("discord-player-youtubedlp"),
        15000,
        "YouTube yt-dlp extractor import"
      );

      if (!YouTubeDlpExtractor) {
        throw new Error("discord-player-youtubedlp did not export YouTubeDlpExtractor.");
      }

      await withTimeout(
        nextPlayer.extractors.register(YouTubeDlpExtractor, {
          searchLimit: 3,
          relatedLimit: 5,
          enableProtocols: true,
          searchTimeoutMs: 6000,
          videoTimeoutMs: 7000,
          playlistTimeoutMs: 25000,
          ytdlpTimeoutMs: 25000,
          infoCacheTtlMs: 120000,
          debug: process.env.DP_DEBUG === "1"
        }),
        15000,
        "YouTube yt-dlp extractor registration"
      );

      youtubeReady = true;
      youtubeError = null;
      console.log("SUCCESS: AAOC YouTube yt-dlp extractor ready.");
    } catch (error) {
      youtubeReady = false;
      youtubeError = error?.message || String(error);
      console.error("WARNING: YouTube extractor unavailable; other music sources remain enabled:", error);
    }

    nextPlayer.events.on("playerError", (queue, error) => {
      console.error(`Music player error in guild ${queue?.guild?.id || "unknown"}:`, error);
    });

    nextPlayer.events.on("error", (queue, error) => {
      console.error(`Music queue error in guild ${queue?.guild?.id || "unknown"}:`, error);
    });

    nextPlayer.events.on("playerStart", (queue, track) => {
      console.log(`Music started in ${queue?.guild?.name || queue?.guild?.id || "unknown"}: ${track?.title || "Unknown track"}`);
    });

    player = nextPlayer;
    initialized = true;
    console.log("SUCCESS: AAOC music player initialized.");
    return player;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    initialized = false;
    player = null;
    throw error;
  }
}

export async function ensureMusicPlayer(client) {
  if (initialized && player) return player;
  return initializeMusic(client);
}

export function getMusicPlayer() {
  if (!player || !initialized) {
    throw new Error("Music player has not finished initializing.");
  }
  return player;
}

export function getMusicStatus() {
  return {
    initialized,
    youtubeReady,
    youtubeError
  };
}
