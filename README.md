# WhatsApp Chat to PDF

Upload a WhatsApp chat export (the ZIP from **Export chat › Include media**) and download a PDF that looks like the chat.

## Run

```
npm install
npm start
```

Then open http://localhost:3000. Set `PORT` / `HOST` (e.g. `HOST=0.0.0.0`) to change where it listens.

## How it works

- **In the browser** (`public/`): the ZIP is unpacked with JSZip, the chat `.txt` is parsed (`parser.js`), and each attached file is turned into something printable (`media.js`): photos are downscaled, videos get a frame + duration, voice notes get a real waveform + duration, PDFs get a first-page preview + page count, `.vcf` files become contact cards. `render.js` builds a WhatsApp-style HTML page, shown as a live preview.
- **On the server** (`server.js`): the chat is sent in parts of about 2 MB (split at day boundaries), and each part is printed to A4 by a fresh headless Chrome (Puppeteer), one at a time. Server memory therefore stays the same however large the chat is. JavaScript and all network access are disabled for those pages except the bundled fonts. Nothing is stored.
- **Back in the browser**: the parts are joined into one PDF with pdf-lib, and page numbers are added.
- "Print / Save as PDF" uses the browser's own print dialog as a fallback.

Hebrew and other right-to-left text is laid out per paragraph (`unicode-bidi: plaintext`), so Hebrew, English and numbers mixed in one message keep the right order, and the timestamp sits at the end of the last line like in WhatsApp. Noto Sans Hebrew is bundled so output looks the same on any server.

## Deploying on Render

The `Dockerfile` installs Chrome's libraries and fonts; `render.yaml` describes a free Docker web service.

1. Push this folder to a GitHub repository (private is fine).
2. In Render: **New › Blueprint**, pick the repository, and apply. (Or **New › Web Service**, pick the repo, runtime Docker, instance type Free.)
3. When it is live, open the service › **Settings › Custom Domains**, add `pdf.yourdomain.com`, and create the `CNAME` record Render shows at your DNS provider. HTTPS is issued automatically.

The free instance has 512 MB of RAM and sleeps after 15 minutes without traffic (the next visit takes about a minute to wake).

## Deploying elsewhere on Linux

Use the `Dockerfile`, or install the same packages it lists (Chrome libraries and `fonts-noto-color-emoji`) and run with `HOST=0.0.0.0`.
