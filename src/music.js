import ffmpegPath from "ffmpeg-static";
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
    if (ffmpegPath && !process.env.FFMPEG_PATH) {
      process.env.FFMPEG_PATH = ffmpegPath;
    }

    const nextPlayer = new Player(client);

    // Load the stable/default sources first. This guarantees the whole bot can
    // still start even if YouTube changes and its community extractor breaks.
    await withTimeout(
      nextPlayer.extractors.loadMulti(DefaultExtractors),
      15000,
      "Default music extractor initialization"
    );

    // YouTube is intentionally loaded dynamically so an incompatible package
    // cannot crash the Discord bot at module-import/startup time.
    try {
      const { YoutubeiExtractor } = await withTimeout(
        import("discord-player-youtubei"),
        15000,
        "YouTube extractor import"
      );

      if (!YoutubeiExtractor) {
        throw new Error("discord-player-youtubei did not export YoutubeiExtractor.");
      }

      await withTimeout(
        nextPlayer.extractors.register(YoutubeiExtractor, {
          overrideBridgeMode: "yt"
        }),
        15000,
        "YouTube extractor registration"
      );

      youtubeReady = true;
      youtubeError = null;
      console.log("SUCCESS: AAOC YouTube extractor ready.");
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
