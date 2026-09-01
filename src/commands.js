import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";
import { links, callsigns } from "./config.js";
import fs from "node:fs";

const fleetPath = new URL("../data/fleet.json", import.meta.url);

function loadFleet() {
  return JSON.parse(fs.readFileSync(fleetPath, "utf8"));
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function aircraftLabel(a) {
  return `${a.tail} — ${a.type}`;
}

export const commandData = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check AAOC bot status."),

  new SlashCommandBuilder()
    .setName("aaoc")
    .setDescription("Show the AAOC website."),

  new SlashCommandBuilder()
    .setName("links")
    .setDescription("Show useful AAOC flight-operation links."),

  new SlashCommandBuilder()
    .setName("training")
    .setDescription("Show AAOC training pipeline links."),

  new SlashCommandBuilder()
    .setName("callsign")
    .setDescription("Look up an AAOC callsign category.")
    .addStringOption(option =>
      option
        .setName("category")
        .setDescription("Callsign category")
        .setRequired(true)
        .addChoices(
          { name: "Training", value: "training" },
          { name: "Command", value: "command" },
          { name: "Mobility", value: "mobility" },
          { name: "Fighter", value: "fighter" }
        )
    ),

  new SlashCommandBuilder()
    .setName("airport")
    .setDescription("List AAOC airframes at an airport/base.")
    .addStringOption(option =>
      option
        .setName("icao")
        .setDescription("Airport ICAO, e.g. KMCF")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("aircraft")
    .setDescription("List all AAOC aircraft of a type and where they are.")
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription("Aircraft type, e.g. F-16C, HH-60W, C-17A")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("flightnotify")
    .setDescription("Send a test AAOC flight notification.")
    .addStringOption(option =>
      option.setName("callsign").setDescription("Flight callsign").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("aircraft").setDescription("Aircraft type").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("departure").setDescription("Departure ICAO").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("arrival").setDescription("Arrival ICAO").setRequired(true)
    )
].map(command => command.toJSON());

export async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    return interaction.reply({
      content: `AAOC bot online. WebSocket latency: ${interaction.client.ws.ping} ms`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "aaoc") {
    return interaction.reply(links.website);
  }

  if (interaction.commandName === "links") {
    const embed = new EmbedBuilder()
      .setTitle("AAOC Operations Links")
      .addFields(
        { name: "AAOC", value: links.website },
        { name: "VATSIM", value: links.vatsim },
        { name: "SimBrief", value: links.simbrief }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "training") {
    const embed = new EmbedBuilder()
      .setTitle("AAOC Training Pipeline")
      .setDescription(`Training resources: ${links.training}`)
      .addFields(
        { name: "Network", value: links.vatsim, inline: true },
        { name: "Flight Planning", value: links.simbrief, inline: true }
      )
      .setFooter({ text: "AAOC Training Command" });

    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "callsign") {
    const category = interaction.options.getString("category", true);
    const value = callsigns[category] || "Not configured";

    return interaction.reply({
      content: `**${category.toUpperCase()}** callsign prefix: \`${value}\``,
      ephemeral: true
    });
  }

  if (interaction.commandName === "airport") {
    const icao = normalize(interaction.options.getString("icao", true));
    const fleet = loadFleet();

    const matches = fleet.filter(a =>
      normalize(a.current_location) === icao || normalize(a.home_base) === icao
    );

    if (!matches.length) {
      return interaction.reply({
        content: `No AAOC airframes found at **${icao}**.`,
        ephemeral: true
      });
    }

    const lines = matches.map(a =>
      `**${aircraftLabel(a)}**\n` +
      `Status: ${a.status} | Home: ${a.home_base} | Current: ${a.current_location}`
    );

    const embed = new EmbedBuilder()
      .setTitle(`AAOC Airframes — ${icao}`)
      .setDescription(lines.join("\n\n").slice(0, 4000))
      .setFooter({ text: `${matches.length} airframe${matches.length === 1 ? "" : "s"} found` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "aircraft") {
    const requested = normalize(interaction.options.getString("type", true));
    const fleet = loadFleet();

    const matches = fleet.filter(a =>
      normalize(a.type) === requested ||
      normalize(a.type).includes(requested) ||
      requested.includes(normalize(a.type))
    );

    if (!matches.length) {
      return interaction.reply({
        content: `No AAOC aircraft found matching **${requested}**.`,
        ephemeral: true
      });
    }

    const lines = matches.map(a =>
      `**${a.tail}** — ${a.type}\n` +
      `Current: ${a.current_location} | Home: ${a.home_base} | Status: ${a.status}`
    );

    const embed = new EmbedBuilder()
      .setTitle(`AAOC Fleet — ${requested}`)
      .setDescription(lines.join("\n\n").slice(0, 4000))
      .setFooter({ text: `${matches.length} airframe${matches.length === 1 ? "" : "s"} found` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "flightnotify") {
    const channelId = process.env.OPERATIONS_CHANNEL_ID;
    const channel = channelId
      ? await interaction.client.channels.fetch(channelId).catch(() => null)
      : interaction.channel;

    if (!channel?.isTextBased()) {
      return interaction.reply({
        content: "Operations channel is not configured.",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("AAOC Flight Activity")
      .setDescription("Test flight notification")
      .addFields(
        { name: "Callsign", value: interaction.options.getString("callsign", true), inline: true },
        { name: "Aircraft", value: interaction.options.getString("aircraft", true), inline: true },
        { name: "Departure", value: interaction.options.getString("departure", true).toUpperCase(), inline: true },
        { name: "Arrival", value: interaction.options.getString("arrival", true).toUpperCase(), inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    return interaction.reply({
      content: "Test flight notification sent.",
      ephemeral: true
    });
  }
}
