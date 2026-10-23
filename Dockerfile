FROM node:24-bookworm-slim

# Shared libraries for headless Chrome, plus fonts so emoji and non-Latin text render in the PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 libx11-6 libxcb1 libxext6 libexpat1 libdbus-1-3 \
      fonts-noto-color-emoji fonts-noto-core fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 10000
CMD ["node", "server.js"]
