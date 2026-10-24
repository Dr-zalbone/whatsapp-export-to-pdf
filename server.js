// Serves the web app and turns the chat page built in the browser into a PDF with headless Chrome.
import express from 'express';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const modules = p => path.join(root, 'node_modules', p);

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/vendor/jszip', express.static(modules('jszip/dist')));
app.use('/vendor/pdfjs', express.static(modules('pdfjs-dist/build')));
app.use('/vendor/pdf-lib', express.static(modules('pdf-lib/dist')));
app.use('/fonts', express.static(modules('@fontsource')));

// The printed page is loaded from a string, so it has no origin and Chrome blocks web fonts fetched
// from any URL (they are CORS requests). Instead, each fontsource stylesheet the page links to is
// inlined with its woff2 files as data: URLs.
const fontCss = new Map();
function inlineFontCss(file) {
  if (!fontCss.has(file)) {
    const cssPath = path.join(modules('@fontsource'), file);
    const css = fs.readFileSync(cssPath, 'utf8').replace(
      /url\(\.\/files\/([\w.-]+\.woff2)\) format\('woff2'\)(, url\([^)]*\) format\('woff'\))?/g,
      (_, name) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(path.dirname(cssPath), 'files', name)).toString('base64')}) format('woff2')`);
    fontCss.set(file, css);
  }
  return fontCss.get(file);
}
function inlineFonts(html) {
  return html.replace(/<link rel="stylesheet" href="fonts\/([\w-]+\/[\w-]+\.css)">/g, (_, file) => {
    try { return `<style>${inlineFontCss(file)}</style>`; } catch { return ''; }
  });
}

// Small hosts (Render free: 512 MB) cannot hold two renders at once, so PDFs are made one at a time
// in a fresh Chrome that is closed afterwards, returning its memory between jobs.
let queue = Promise.resolve();
function withBrowser(job) {
  const run = queue.then(async () => {
    const browser = await puppeteer.launch({
      // A system Chrome/Chromium (set by the Dockerfile) runs in new headless mode; locally we use Puppeteer's headless shell.
      headless: process.env.PUPPETEER_EXECUTABLE_PATH ? true : 'shell',
      args: process.platform === 'linux'
        ? ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote', '--disable-gpu', '--disable-extensions']
        : [],
    });
    try { return await job(browser); }
    finally { await browser.close().catch(() => {}); }
  });
  queue = run.catch(() => {});
  return run;
}

app.post('/api/pdf', express.text({ type: 'text/html', limit: '200mb' }), async (req, res) => {
  const html = req.body;
  if (typeof html !== 'string' || !html.includes('class="chat"')) return res.status(400).send('Expected the generated chat page.');

  try {
    const pdf = await withBrowser(async browser => {
      const page = await browser.newPage();
      // The page is only data: images and fonts plus inline CSS; block everything else.
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', r => {
        const url = r.url();
        if (url.startsWith('data:') || url === 'about:blank') r.continue();
        else r.abort();
      });
      await page.setContent(inlineFonts(html), { waitUntil: 'load', timeout: 0 });
      await page.evaluate('document.fonts.ready.then(() => document.fonts.status)').catch(() => {});
      return page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        // No footer here: the browser numbers the pages after joining all parts.
        timeout: 0,
      });
    });
    res.set('Content-Type', 'application/pdf').send(Buffer.from(pdf));
  } catch (err) {
    console.error(err);
    res.status(500).send('PDF generation failed: ' + err.message);
  }
});

app.listen(PORT, HOST, () => console.log(`WhatsApp Chat to PDF running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
