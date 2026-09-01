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

const required = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID"
];

const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID
    ),
    { body: commandData }
  );

  console.log(`Registered ${commandData.length} AAOC slash commands.`);
}

client.once("ready", async () => {
  console.log(`Discord connected as ${client.user.tag}`);
  client.user.setActivity("AAOC Operations");

  try {
    await registerCommands();
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(error);

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

await client.login(process.env.DISCORD_TOKEN);

// Railway / integration web server
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.status(200).send("AAOC Discord Bot online");
});

app.get("/health", (_req, res) => {
  const discordReady = client.isReady();

  res.status(discordReady ? 200 : 503).json({
    ok: discordReady,
    discordReady,
    botUser: client.user?.tag || null,
    uptimeSeconds: Math.floor(process.uptime()),
    platform: process.env.RAILWAY_ENVIRONMENT_NAME ? "railway" : "local"
  });
});

app.post("/webhooks/flight", async (req, res) => {
  const expected = process.env.AAOC_WEBHOOK_SECRET;
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

  const channelId = process.env.OPERATIONS_CHANNEL_ID;
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
});
