FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
    && python3 -m pip install --break-system-packages --no-cache-dir -U "yt-dlp[default]" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY railway.json ./railway.json

CMD ["npm", "start"]
