# AAOC Discord Bot

Discord operations/training bot for Atlantic Air Operations Command (AAOC).

## Included in this starter

- `/ping` — bot health/latency check
- `/aaoc` — AAOC website link
- `/links` — useful AAOC links
- `/training` — training pipeline quick links
- `/callsign` — quick callsign lookup from the local config
- `/flightnotify` — test an operations flight notification
- HTTP `/health` endpoint for Railway
- HTTP `POST /webhooks/flight` endpoint for AAOC website/smartCARS integration

## GitHub → Railway deployment

1. Create a GitHub repository, for example `aaoc-discord-bot`.
2. Upload/push all files in this folder.
3. In Railway, create a project and choose **Deploy from GitHub repo**.
4. Select the repository.
5. Add the environment variables from `.env.example`.
6. Deploy.

Do **not** commit your real `.env` file or Discord bot token.

## Discord setup

Create an application in the Discord Developer Portal, add a bot, and invite it to the AAOC server.

Required bot permissions for this starter:
- View Channels
- Send Messages
- Embed Links
- Use Application Commands

No moderation/admin permissions are required.

Set:
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`

The bot registers guild slash commands automatically at startup.

## Flight webhook

Your AAOC website can send:

```http
POST /webhooks/flight
Authorization: Bearer <AAOC_WEBHOOK_SECRET>
Content-Type: application/json
```

Example JSON:

```json
{
  "event": "departed",
  "callsign": "AAOC101",
  "pilot": "Example Pilot",
  "aircraft": "F-16C",
  "departure": "KMCF",
  "arrival": "KHST",
  "route": "DCT ... DCT"
}
```

Supported event text can be anything; common values are:
- `filed`
- `departed`
- `airborne`
- `landed`
- `completed`

Set `OPERATIONS_CHANNEL_ID` to the Discord channel that should receive these notifications.

## Editing AAOC links/callsigns

Edit `src/config.js`.

## Local run

```bash
npm install
cp .env.example .env
# fill in .env
npm start
```


## Fleet lookup commands

This bot intentionally has **no mission-planning or mission-generation commands**.

### `/airport <ICAO>`

Example:

```text
/airport KMCF
```

Returns all AAOC airframes assigned to or currently located at that airport, including:
- aircraft type
- tail number
- home base
- current location
- availability/status

### `/aircraft <TYPE>`

Example:

```text
/aircraft F-16C
```

Returns all matching AAOC airframes fleet-wide, including:
- tail number
- current location
- home base
- status

The current starter reads from `data/fleet.json`. That can later be replaced by the live AAOC fleet API so the Discord bot and website use the same inventory.


## Railway production deployment

This repository includes `railway.json` so Railway can read the deployment settings directly from GitHub.

Configured behavior:

- Start command: `npm start`
- Health check: `/health`
- Health timeout: 60 seconds
- Restart policy: `ON_FAILURE`
- Maximum restart attempts: 10
- Uses Railway's injected `PORT` automatically
- `/health` returns HTTP 200 only after the Discord client is connected

### Connect the GitHub repository to Railway

1. Create a Railway project.
2. Add a service and choose **GitHub Repo** as the source.
3. Select `Im561/aaoc-discord-bot`.
4. Use branch `main`.
5. Railway will detect `package.json` and `railway.json`.
6. Open **Variables** and add the secrets/config values below.
7. Deploy.

### Railway variables

Paste these in Railway's Variables / Raw Editor:

```text
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
OPERATIONS_CHANNEL_ID=
TRAINING_CHANNEL_ID=
AAOC_WEBSITE_URL=https://aaocvirtual.com
AAOC_WEBHOOK_SECRET=
NODE_ENV=production
```

Do not create a `PORT` variable unless Railway requires an override. Railway injects `PORT` automatically.

### GitHub auto-deploy

Once the Railway service source is connected to the GitHub repository, commits pushed to the selected deployment branch can automatically trigger a new Railway deployment.
