// Serves the web app and turns the chat page built in the browser into a PDF with headless Chrome.
import express from 'express';
import puppeteer from 'puppeteer';
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
app.use('/fonts', express.static(modules('@fontsource')));

let browserPromise;
function getBrowser() {
  browserPromise ??= puppeteer.launch({
    headless: 'shell',
    args: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  }).catch(err => { browserPromise = null; throw err; });
  return browserPromise;
}

app.post('/api/pdf', express.text({ type: 'text/html', limit: '1gb' }), async (req, res) => {
  const html = req.body;
  if (typeof html !== 'string' || !html.includes('class="chat"')) return res.status(400).send('Expected the generated chat page.');

  const origin = `http://127.0.0.1:${PORT}`;
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    // The page is only data: images, inline CSS and our bundled fonts; block everything else.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', r => {
      const url = r.url();
      if (url.startsWith('data:') || url.startsWith(origin + '/fonts/') || url === 'about:blank') r.continue();
      else r.abort();
    });
    const withBase = html.replace(/<head>/i, `<head><base href="${origin}/">`);
    await page.setContent(withBase, { waitUntil: 'load', timeout: 0 });
    await page.evaluateHandle('document.fonts.ready').catch(() => {});
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="width:100%;text-align:center;font-size:8px;color:#8696a0;font-family:Arial,sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      timeout: 0,
    });
    res.set('Content-Type', 'application/pdf').send(Buffer.from(pdf));
  } catch (err) {
    console.error(err);
    res.status(500).send('PDF generation failed: ' + err.message);
  } finally {
    page?.close().catch(() => {});
  }
});

app.listen(PORT, HOST, () => console.log(`WhatsApp Chat to PDF running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
