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
- **On the server** (`server.js`): the finished page is printed to an A4 PDF with headless Chrome (Puppeteer). JavaScript and all network access are disabled for that page except the bundled fonts. Nothing is stored.
- "Print / Save as PDF" uses the browser's own print dialog as a fallback.

Hebrew and other right-to-left text is laid out per paragraph (`unicode-bidi: plaintext`), so Hebrew, English and numbers mixed in one message keep the right order, and the timestamp sits at the end of the last line like in WhatsApp. Noto Sans Hebrew is bundled so output looks the same on any server.

## Deploying on Linux

Install an emoji font so emoji render in the PDF, e.g. `apt-get install fonts-noto-color-emoji`, plus the usual Chrome dependencies Puppeteer lists.
