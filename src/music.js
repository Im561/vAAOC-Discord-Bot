import ffmpegPath from "ffmpeg-static";
import { Player } from "discord-player";
import { DefaultExtractors } from "@discord-player/extractor";
import { YoutubeiExtractor } from "discord-player-youtubei";

let player = null;
let initialized = false;

export async function initializeMusic(client) {
  if (initialized && player) return player;

  if (ffmpegPath && !process.env.FFMPEG_PATH) {
    process.env.FFMPEG_PATH = ffmpegPath;
  }

  player = new Player(client);

  // Register YouTube before the default extractors so YouTube links/searches
  // are claimed by the YouTube-specific extractor first.
  await player.extractors.register(YoutubeiExtractor, {
    overrideBridgeMode: "yt",
    generateWithPoToken: true
  });
  await player.extractors.loadMulti(DefaultExtractors);

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
  console.log("AAOC music player initialized (YouTube, SoundCloud, direct audio, attachments, Vimeo, Spotify/Apple Music metadata bridging where available). ");
  return player;
}

export function getMusicPlayer() {
  if (!player || !initialized) {
    throw new Error("Music player has not finished initializing.");
  }
  return player;
}
