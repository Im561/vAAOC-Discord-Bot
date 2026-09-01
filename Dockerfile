FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    YTDLP_POT_SCRIPT=/opt/bgutil/server/build/generate_once.js

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates git \
    && python3 -m pip install --break-system-packages --no-cache-dir -U "yt-dlp[default]" bgutil-ytdlp-pot-provider==1.3.1 \
    && git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm ci --no-audit --no-fund \
    && npx tsc \
    && python3 -m yt_dlp --version \
    && test -f /opt/bgutil/server/build/generate_once.js \
    && rm -rf /var/lib/apt/lists/* /root/.cache/pip

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY railway.json ./railway.json

CMD ["npm", "start"]
