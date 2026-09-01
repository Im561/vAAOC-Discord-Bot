import ffmpegPath from "ffmpeg-static";
import { Player } from "discord-player";
import { DefaultExtractors } from "@discord-player/extractor";
import { YouTubeDlpExtractor } from "discord-player-youtubedlp";

let player = null;
let initialized = false;

export async function initializeMusic(client) {
  if (initialized && player) return player;

  if (ffmpegPath && !process.env.FFMPEG_PATH) {
    process.env.FFMPEG_PATH = ffmpegPath;
  }

  player = new Player(client);

  await player.extractors.loadMulti(DefaultExtractors);
  await player.extractors.register(YouTubeDlpExtractor, {});

  player.events.on("playerError", (queue, error) => {
    console.error(`Music player error in guild ${queue?.guild?.id || "unknown"}:`, error);
  });

  player.events.on("error", (queue, error) => {
    console.error(`Music queue error in guild ${queue?.guild?.id || "unknown"}:`, error);
  });

  player.events.on("playerStart", (queue, track) => {
    console.log(`Music started in ${queue?.guild?.name || queue?.guild?.id || "unknown"}: ${track?.title || "Unknown track"}`);
  });

  initialized = true;
  console.log("AAOC music player initialized (Discord Player + YouTube/SoundCloud/raw audio support).");
  return player;
}

export function getMusicPlayer() {
  if (!player || !initialized) {
    throw new Error("Music player has not finished initializing.");
  }
  return player;
}
