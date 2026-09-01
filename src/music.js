import { spawn, execFileSync } from "node:child_process";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel
} from "@discordjs/voice";

const sessions = new Map();
let discordClient = null;
let runtimeStatus = {
  initialized: false,
  youtubeReady: false,
  youtubeError: null,
  ffmpegVersion: null,
  ytdlpVersion: null
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function commandOutput(command, args = []) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000
  }).trim();
}

function runCapture(command, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
      if (stdout.length > 4_000_000) stdout = stdout.slice(-4_000_000);
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });

    child.once("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${command} exited with code ${code}: ${stderr.trim().slice(-1500) || "no error output"}`));
    });
  });
}

function normalizeTarget(query) {
  const value = String(query || "").trim();
  if (!value) throw new Error("No song or URL was provided.");
  if (/^https?:\/\//i.test(value)) return value;
  return `ytsearch1:${value}`;
}

async function resolveTrack(query, requestedBy) {
  const target = normalizeTarget(query);
  const { stdout } = await runCapture("yt-dlp", [
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout", "12",
    target
  ], 25000);

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("yt-dlp returned invalid track metadata.");
  }

  const webpageUrl = String(data.webpage_url || data.original_url || data.url || "").trim();
  if (!webpageUrl) throw new Error("Could not resolve a playable URL for that track.");

  return {
    title: String(data.title || "Unknown track").slice(0, 180),
    url: webpageUrl,
    duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
    uploader: String(data.uploader || data.channel || "").slice(0, 100),
    requestedBy: requestedBy || null
  };
}

function cleanupProcess(session) {
  if (!session?.process) return;
  try {
    if (!session.process.killed) session.process.kill("SIGKILL");
  } catch {}
  session.process = null;
}

async function createSession(guild, voiceChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });

  connection.on("error", error => {
    console.error(`AAOC voice connection error (${guild.id}):`, error);
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20000);

  // Let the initial Discord DAVE/MLS key transition finish before audio starts.
  await sleep(1800);

  const audioPlayer = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause
    }
  });

  const session = {
    guildId: guild.id,
    voiceChannelId: voiceChannel.id,
    connection,
    audioPlayer,
    subscription: connection.subscribe(audioPlayer),
    current: null,
    queue: [],
    process: null,
    starting: false,
    stopped: false
  };

  audioPlayer.on("error", error => {
    console.error(`AAOC audio player error (${guild.id}):`, error);
    cleanupProcess(session);
    session.current = null;
    void startNext(session);
  });

  audioPlayer.on(AudioPlayerStatus.Playing, () => {
    if (session.current) {
      console.log(`AAOC audio playing (${guild.id}): ${session.current.title}`);
    }
  });

  audioPlayer.on(AudioPlayerStatus.Idle, () => {
    if (session.stopped) return;
    cleanupProcess(session);
    session.current = null;
    void startNext(session);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000)
      ]);
    } catch {
      destroySession(guild.id);
    }
  });

  sessions.set(guild.id, session);
  return session;
}

async function getOrCreateSession(guild, voiceChannel) {
  let session = sessions.get(guild.id);
  if (session) {
    if (session.voiceChannelId !== voiceChannel.id) {
      throw new Error("The bot is already connected to a different voice channel.");
    }
    return session;
  }
  return createSession(guild, voiceChannel);
}

async function startNext(session) {
  if (!session || session.starting || session.current || session.stopped) return;
  const next = session.queue.shift();
  if (!next) return;

  session.starting = true;
  session.current = next;

  try {
    const child = spawn("yt-dlp", [
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout", "12",
      "-f", "bestaudio/best",
      "-o", "-",
      next.url
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    session.process = child;
    let stderr = "";

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
      if (stderr.length > 100_000) stderr = stderr.slice(-100_000);
    });

    child.once("error", error => {
      console.error(`yt-dlp stream process error (${session.guildId}):`, error);
    });

    child.once("close", code => {
      if (code && code !== 0 && session.current === next) {
        console.error(`yt-dlp stream exited (${session.guildId}) code ${code}: ${stderr.slice(-1500)}`);
      }
    });

    const resource = createAudioResource(child.stdout, {
      inputType: StreamType.Arbitrary,
      metadata: next,
      inlineVolume: false
    });

    session.audioPlayer.play(resource);
    await entersState(session.audioPlayer, AudioPlayerStatus.Playing, 25000);
  } catch (error) {
    console.error(`Failed to start AAOC track (${session.guildId}):`, error);
    cleanupProcess(session);
    session.current = null;
    session.starting = false;
    if (session.queue.length) void startNext(session);
    throw error;
  } finally {
    session.starting = false;
  }
}

export async function initializeMusic(client) {
  discordClient = client;

  try {
    const ytdlpVersion = commandOutput("yt-dlp", ["--version"]);
    const ffmpegLine = commandOutput("ffmpeg", ["-version"]).split(/\r?\n/)[0] || "ffmpeg available";
    runtimeStatus = {
      initialized: true,
      youtubeReady: true,
      youtubeError: null,
      ffmpegVersion: ffmpegLine,
      ytdlpVersion
    };
    console.log(`SUCCESS: yt-dlp ${ytdlpVersion} available.`);
    console.log(`SUCCESS: ${ffmpegLine}`);
    console.log("SUCCESS: AAOC direct Discord voice music system ready.");
  } catch (error) {
    runtimeStatus = {
      initialized: false,
      youtubeReady: false,
      youtubeError: error?.message || String(error),
      ffmpegVersion: null,
      ytdlpVersion: null
    };
    throw error;
  }

  return discordClient;
}

export async function playMusic({ guild, voiceChannel, query, requestedBy }) {
  if (!guild || !voiceChannel) throw new Error("A guild and voice channel are required.");
  const track = await resolveTrack(query, requestedBy);
  const session = await getOrCreateSession(guild, voiceChannel);
  const wasIdle = !session.current && session.queue.length === 0;
  session.stopped = false;
  session.queue.push(track);

  if (wasIdle) {
    await startNext(session);
  }

  return { track, playingNow: wasIdle };
}

export function getQueueStatus(guildId) {
  const session = sessions.get(guildId);
  if (!session) return null;
  return {
    voiceChannelId: session.voiceChannelId,
    current: session.current,
    upcoming: [...session.queue]
  };
}

export function pauseMusic(guildId) {
  const session = sessions.get(guildId);
  if (!session?.current) return null;
  session.audioPlayer.pause(true);
  return session.current;
}

export function resumeMusic(guildId) {
  const session = sessions.get(guildId);
  if (!session?.current) return null;
  session.audioPlayer.unpause();
  return session.current;
}

export function skipMusic(guildId) {
  const session = sessions.get(guildId);
  if (!session?.current) return null;
  const skipped = session.current;
  cleanupProcess(session);
  session.audioPlayer.stop(true);
  return skipped;
}

export function stopMusic(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.queue.length = 0;
  session.stopped = true;
  cleanupProcess(session);
  session.audioPlayer.stop(true);
  session.current = null;
  session.stopped = false;
  return true;
}

export function destroySession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.stopped = true;
  session.queue.length = 0;
  cleanupProcess(session);
  try { session.audioPlayer.stop(true); } catch {}
  try { session.subscription?.unsubscribe(); } catch {}
  try { session.connection.destroy(); } catch {}
  sessions.delete(guildId);
  return true;
}

export function getMusicStatus() {
  return {
    ...runtimeStatus,
    activeSessions: sessions.size
  };
}
