FROM node:24-bookworm-slim

# Debian's Chromium brings its own shared libraries. The chat's text fonts are embedded by server.js;
# these system fonts only cover emoji and scripts the bundled fonts lack.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates chromium \
      fonts-noto-color-emoji fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./
# Skip install scripts: they would download Puppeteer's own Chrome, which the system Chromium replaces.
RUN npm ci --omit=dev --ignore-scripts
COPY . .

EXPOSE 10000
CMD ["node", "server.js"]
