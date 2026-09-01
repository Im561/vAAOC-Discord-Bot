import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder
} from "discord.js";
import { commandData, handleCommand } from "./commands.js";
import { initializeMusic } from "./music.js";

function env(name) {
  return String(process.env[name] || "").trim();
}

const DISCORD_TOKEN = env("DISCORD_TOKEN");
const DISCORD_GUILD_ID = env("DISCORD_GUILD_ID");
const CONFIGURED_CLIENT_ID = env("DISCORD_CLIENT_ID");

const missing = [];
if (!DISCORD_TOKEN) missing.push("DISCORD_TOKEN");
if (!DISCORD_GUILD_ID) missing.push("DISCORD_GUILD_ID");

if (missing.length) {
  console.error(`FATAL: Missing required Railway variables: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

let commandRegistrationOk = false;
let commandRegistrationError = null;
let musicReady = false;
let musicError = null;

async function registerCommands() {
  const applicationId = client.application?.id || client.user?.id;
  if (!applicationId) throw new Error("Could not determine Discord application ID.");

  if (CONFIGURED_CLIENT_ID && CONFIGURED_CLIENT_ID !== applicationId) {
    console.warn(
      `WARNING: DISCORD_CLIENT_ID (${CONFIGURED_CLIENT_ID}) does not match the logged-in bot application (${applicationId}). ` +
      "Using the logged-in bot application ID automatically."
    );
  }

  console.log(`Checking AAOC guild ${DISCORD_GUILD_ID}...`);
  const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
  console.log(`AAOC guild found: ${guild.name} (${guild.id})`);

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  console.log(`Registering ${commandData.length} guild slash commands...`);
  const registered = await rest.put(
    Routes.applicationGuildCommands(applicationId, DISCORD_GUILD_ID),
    { body: commandData }
  );

  commandRegistrationOk = true;
  commandRegistrationError = null;
  console.log(`SUCCESS: Registered ${Array.isArray(registered) ? registered.length : commandData.length} AAOC slash commands in ${guild.name}.`);
  console.log("Commands include fleet lookups plus /play /pause /resume /skip /stop /queue /leave");
}

client.once("ready", async () => {
  console.log("============================================================");
  console.log(`Discord connected as ${client.user.tag}`);
  console.log(`Bot user/application ID: ${client.user.id}`);
  console.log(`Target guild ID: ${DISCORD_GUILD_ID}`);
  console.log(`Guilds visible to bot: ${client.guilds.cache.size}`);
  console.log("============================================================");

  client.user.setActivity("AAOC Fleet & Music");

  try {
    await initializeMusic(client);
    musicReady = true;
    musicError = null;
    console.log("SUCCESS: AAOC voice/music system ready.");
  } catch (error) {
    musicReady = false;
    musicError = error?.message || String(error);
    console.error("FAILED TO INITIALIZE MUSIC PLAYER:", error);
  }

  try {
    await registerCommands();
  } catch (error) {
    commandRegistrationOk = false;
    commandRegistrationError = error?.message || String(error);
    console.error("FAILED TO REGISTER SLASH COMMANDS:");
    console.error(error);
    console.error("Check DISCORD_GUILD_ID, the bot's server membership, and Discord application installation permissions.");
  }
});

client.on("interactionCreate", async interaction => {
  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(`Command error (${interaction.commandName || "unknown"}):`, error);

    const response = {
      content: "AAOC bot encountered an error handling that command.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

client.on("error", error => {
  console.error("Discord client error:", error);
});

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.status(200).send("AAOC Discord Bot service online");
});

app.get("/health", (_req, res) => {
  const discordReady = client.isReady();

  res.status(discordReady ? 200 : 503).json({
    ok: discordReady,
    discordReady,
    commandsRegistered: commandRegistrationOk,
    commandRegistrationError,
    musicReady,
    musicError,
    botUser: client.user?.tag || null,
    botApplicationId: client.application?.id || client.user?.id || null,
    targetGuildId: DISCORD_GUILD_ID,
    guildCount: client.guilds.cache.size,
    uptimeSeconds: Math.floor(process.uptime()),
    platform: process.env.RAILWAY_ENVIRONMENT_NAME ? "railway" : "local"
  });
});

app.post("/webhooks/flight", async (req, res) => {
  const expected = env("AAOC_WEBHOOK_SECRET");
  const auth = req.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!expected || supplied !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    event = "updated",
    callsign = "Unknown",
    pilot = "Unknown",
    aircraft = "Unknown",
    departure = "----",
    arrival = "----",
    route = "Not provided"
  } = req.body || {};

  const channelId = env("OPERATIONS_CHANNEL_ID");
  if (!channelId) {
    return res.status(500).json({ error: "OPERATIONS_CHANNEL_ID not configured" });
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return res.status(500).json({ error: "Operations channel unavailable" });
  }

  const embed = new EmbedBuilder()
    .setTitle(`AAOC Flight ${String(event).toUpperCase()}`)
    .addFields(
      { name: "Callsign", value: String(callsign), inline: true },
      { name: "Pilot", value: String(pilot), inline: true },
      { name: "Aircraft", value: String(aircraft), inline: true },
      { name: "Departure", value: String(departure).toUpperCase(), inline: true },
      { name: "Arrival", value: String(arrival).toUpperCase(), inline: true },
      { name: "Route", value: String(route).slice(0, 1024) || "Not provided" }
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  return res.status(200).json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`HTTP server listening on port ${port}`);
  console.log("Logging into Discord...");
});

client.login(DISCORD_TOKEN).catch(error => {
  console.error("FATAL: Discord login failed. Check DISCORD_TOKEN in Railway.");
  console.error(error);
  process.exit(1);
});
