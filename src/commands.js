import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";
import { links, callsigns } from "./config.js";
import { getFleet, getAirport, matchesAircraftType } from "./phpvms.js";

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function statusLabel(item) {
  return item.active ? "Active" : "Inactive";
}

function chunkLines(lines, maxChars = 3600) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildFleetEmbeds(title, lines, footer, description = null) {
  const chunks = chunkLines(lines);
  return chunks.slice(0, 10).map((chunk, index) => {
    const embed = new EmbedBuilder()
      .setTitle(chunks.length > 1 ? `${title} (${index + 1}/${Math.min(chunks.length, 10)})` : title)
      .setDescription(`${description && index === 0 ? `${description}\n\n` : ""}${chunk}`)
      .setFooter({ text: footer })
      .setTimestamp();
    return embed;
  });
}

async function replyApiError(interaction, error) {
  console.error("AAOC phpVMS fleet lookup failed:", error);
  const message = String(error?.message || error || "Unknown phpVMS error");
  const content = `AAOC fleet lookup failed: ${message}`.slice(0, 1900);

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content, embeds: [] });
  }
  return interaction.reply({ content, ephemeral: true });
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
    .setDescription("List AAOC airframes currently at an airport/base.")
    .addStringOption(option =>
      option
        .setName("icao")
        .setDescription("Airport ICAO, e.g. KMCF")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("aircraft")
    .setDescription("List all AAOC aircraft of a type and their current locations.")
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
    await interaction.deferReply();

    try {
      const [snapshot, airport] = await Promise.all([
        getFleet(),
        getAirport(icao).catch(() => null)
      ]);

      const matches = snapshot.aircraft.filter(item => item.airportId === icao);
      const airportName = airport?.name ? ` — ${airport.name}` : "";

      if (!matches.length) {
        return interaction.editReply({
          content: `No AAOC airframes are currently listed at **${icao}${airportName}** in phpVMS.`
        });
      }

      const lines = matches.map(item =>
        `**${item.displayType}** — \`${item.displayTail}\` • ${statusLabel(item)}`
      );

      const embeds = buildFleetEmbeds(
        `AAOC Airframes — ${icao}`,
        lines,
        `${matches.length} airframe${matches.length === 1 ? "" : "s"} • Live phpVMS fleet`,
        airport?.name || null
      );

      return interaction.editReply({ embeds, content: "" });
    } catch (error) {
      return replyApiError(interaction, error);
    }
  }

  if (interaction.commandName === "aircraft") {
    const requested = interaction.options.getString("type", true);
    await interaction.deferReply();

    try {
      const snapshot = await getFleet();
      const matches = snapshot.aircraft.filter(item => matchesAircraftType(item, requested));

      if (!matches.length) {
        return interaction.editReply({
          content: `No AAOC aircraft in phpVMS match **${requested}**.`
        });
      }

      const lines = matches.map(item => {
        const location = item.airportId || "UNKNOWN";
        return `**${location}** — \`${item.displayTail}\` • ${item.displayType} • ${statusLabel(item)}`;
      });

      const embeds = buildFleetEmbeds(
        `AAOC Fleet — ${requested.toUpperCase()}`,
        lines,
        `${matches.length} airframe${matches.length === 1 ? "" : "s"} • Live phpVMS fleet`
      );

      return interaction.editReply({ embeds, content: "" });
    } catch (error) {
      return replyApiError(interaction, error);
    }
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
