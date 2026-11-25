import { parseChat, chatNameFromFilename, classify } from './parser.js';
import { processMedia } from './media.js';
import { renderChat, renderChatParts } from './render.js';
import { buildPackage } from './package.js';

const $ = sel => document.querySelector(sel);
const state = { chat: null, html: '', fileBase: 'whatsapp-chat', previewMode: 'pdf' };

const drop = $('#drop'), input = $('#file');
drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
input.addEventListener('change', () => input.files[0] && handleFile(input.files[0]));
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]));

$('#me').addEventListener('change', rerender);
$('#locale').addEventListener('change', rerender);
$('#title').addEventListener('input', debounce(rerender, 300));
$('#package').addEventListener('click', downloadPackage);
$('#download').addEventListener('click', downloadPdf);
$('#print').addEventListener('click', printPdfLayout);
document.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', () => setPreviewMode(b.dataset.preview)));
$('#reset').addEventListener('click', () => location.reload());

function setStatus(text, progress = null) {
  $('#status').hidden = false;
  $('#status-text').textContent = text;
  const bar = $('#status-bar');
  bar.hidden = progress == null;
  if (progress != null) bar.value = progress;
}

function showError(msg) {
  $('#status').hidden = true;
  const el = $('#error');
  el.textContent = msg;
  el.hidden = false;
}

const baseName = p => p.split('/').pop();

async function handleFile(file) {
  $('#error').hidden = true;
  drop.classList.add('busy');
  try {
    let txtName, txtContent, files = new Map(), originals;
    if (/\.txt$/i.test(file.name)) {
      txtName = file.name;
      txtContent = await file.text();
      originals = [{ path: file.name, read: async () => new Uint8Array(await file.arrayBuffer()) }];
    } else {
      setStatus('Opening ZIP…');
      if (!window.JSZip) throw new Error('ZIP library failed to load.');
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name));
      for (const e of entries) files.set(baseName(e.name).toLowerCase(), e);
      originals = entries.map(e => ({ path: e.name, read: () => e.async('uint8array') }));
      const txts = entries.filter(e => /\.txt$/i.test(e.name));
      if (!txts.length) throw new Error('No chat .txt file found in this ZIP. Export the chat from WhatsApp (⋮ › More › Export chat › Include media) and upload the ZIP it creates.');
      // Prefer the WhatsApp chat file over any .txt that was shared inside the chat.
      txts.sort((a, b) => score(b.name) - score(a.name));
      txtName = txts[0].name;
      txtContent = await txts[0].async('string');
    }

    setStatus('Reading messages…');
    const parsed = parseChat(txtContent);
    const exists = name => files.has(baseName(name.trim()).toLowerCase());
    let no = 0;
    for (const m of parsed.messages) {
      if (m.system) continue;
      Object.assign(m, classify(m, exists));
      m.no = ++no;   // message number, as cited in court (#1, #2, …)
    }

    const referenced = [...new Set(parsed.messages.filter(m => m.kind === 'file' && m.exists).map(m => m.file))];
    // name in the chat -> { name, path inside the export, processed media, blob URL for the site's viewer preview }
    const refs = new Map();
    let done = 0;
    setStatus(`Processing media (0 / ${referenced.length})…`, 0);
    await runPool(referenced, 4, async name => {
      const entry = files.get(baseName(name).toLowerCase());
      const blob = await entry.async('blob');
      const media = await processMedia(baseName(entry.name), blob);
      refs.set(name, { name, path: entry.name, media, url: URL.createObjectURL(blob) });
      done++;
      setStatus(`Processing media (${done} / ${referenced.length})…`, done / referenced.length);
    });
    for (const m of parsed.messages) if (m.kind === 'file' && m.exists) m.media = refs.get(m.file).media;
    Object.assign(state, { refs, originals, sourceFile: file, txtName });

    const chatName = chatNameFromFilename(txtName) || chatNameFromFilename(file.name);
    const me = guessMe(parsed, chatName);
    state.chat = { ...parsed, chatName };
    state.fileBase = (chatName || 'whatsapp-chat').replace(/[\\/:*?"<>|]+/g, '_');

    // Fill the options panel.
    const sel = $('#me');
    sel.innerHTML = '';
    for (const s of parsed.senders) sel.add(new Option(s, s, false, s === me));
    sel.add(new Option('(none – show everyone on the left)', ''));
    $('#title').value = defaultTitle(parsed.senders, chatName, me);

    const counts = parsed.messages.reduce((c, m) => (c[m.kind || 'system'] = (c[m.kind || 'system'] || 0) + 1, c), {});
    const missing = parsed.messages.filter(m => m.kind === 'file' && !m.exists).length;
    $('#summary').textContent = [
      `${parsed.messages.length} messages`,
      `${parsed.senders.length} participant${parsed.senders.length === 1 ? '' : 's'}`,
      `${referenced.length} media files`,
      counts.omitted ? `${counts.omitted} omitted` : '',
      missing ? `${missing} missing from ZIP` : '',
    ].filter(Boolean).join(' · ');

    rerender();
    $('#status').hidden = true;
    $('#upload').hidden = true;
    $('#result').hidden = false;
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  } finally {
    drop.classList.remove('busy');
    input.value = '';
  }
}

function score(name) {
  const b = baseName(name);
  return (/whatsapp|^_chat\.txt$|chat|צ'אט|שיחה/i.test(b) ? 10 : 0) - name.split('/').length;
}

function guessMe(parsed, chatName) {
  const mine = parsed.messages.find(m => !m.system && /^(You deleted this message|מחקת את ההודעה הזו)/.test(m.text));
  if (mine) return mine.sender;
  if (parsed.senders.length === 2 && chatName && parsed.senders.includes(chatName)) {
    return parsed.senders.find(s => s !== chatName);
  }
  return parsed.senders.find(s => s !== chatName) || parsed.senders[0] || '';
}

function defaultTitle(senders, chatName, me) {
  if (senders.length <= 2) return senders.find(s => s !== me) || chatName || 'WhatsApp chat';
  return chatName || 'WhatsApp group';
}

function rerender() {
  if (!state.chat) return;
  const chat = { ...state.chat, me: $('#me').value, title: $('#title').value.trim() || 'WhatsApp chat' };
  state.renderArgs = [chat, { locale: $('#locale').value }];
  state.html = renderChat(...state.renderArgs);
  showPreview();
}

// The preview shows either the PDF layout or the interactive viewer (media playing from blob: URLs).
function showPreview() {
  const [chat, opts] = state.renderArgs;
  $('#preview').srcdoc = state.previewMode === 'viewer'
    ? renderChat(chat, { ...opts, viewer: true, fileUrl: name => state.refs.get(name)?.url ?? '' })
    : state.html;
}

function setPreviewMode(mode) {
  state.previewMode = mode;
  document.querySelectorAll('[data-preview]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preview === mode)));
  if (state.chat) showPreview();
}

function printPdfLayout() {
  const frame = $('#preview');
  if (state.previewMode === 'pdf') return frame.contentWindow.print();
  frame.addEventListener('load', () => frame.contentWindow.print(), { once: true });
  setPreviewMode('pdf');
}

// Prints one part on the server, retrying while a restarting server answers 502/503 or drops the connection.
async function printPart(html, onRetry) {
  for (let attempt = 1; ; attempt++) {
    if (attempt > 1) onRetry();
    let res;
    try {
      res = await fetch('api/pdf', { method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html });
    } catch (err) {
      if (attempt >= 3) throw err;
    }
    if (res?.ok) return res.arrayBuffer();
    if (res && ![502, 503, 504].includes(res.status)) {
      const text = /text\/plain/.test(res.headers.get('content-type') || '') ? await res.text() : '';
      throw new Error(text || `Server error ${res.status}`);
    }
    if (attempt >= 3) throw new Error(`Server error ${res ? res.status : 'no response'}`);
    await new Promise(r => setTimeout(r, 15000));
  }
}

// Progress under the Download button: a bar (indeterminate when value is null) and a status line with elapsed time.
function pdfProgress(started) {
  const box = $('#pdf-progress'), bar = box.querySelector('progress'), line = box.querySelector('.ptext');
  let text = '';
  const paint = () => {
    const s = Math.round((Date.now() - started) / 1000);
    line.textContent = `${text} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const timer = setInterval(paint, 1000);
  box.hidden = false;
  return {
    set(newText, value) {
      text = newText;
      if (value == null) bar.removeAttribute('value'); else bar.value = value;
      paint();
    },
    done() { clearInterval(timer); box.hidden = true; },
  };
}

// The server prints the chat in parts to keep its memory use flat; the parts are joined and numbered here.
async function createPdf(progress) {
  const parts = renderChatParts(...state.renderArgs);
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const merged = await PDFDocument.create();
  for (let i = 0; i < parts.length; i++) {
    const step = `Printing part ${i + 1} of ${parts.length}`;
    progress.set(step + '…', parts.length > 1 ? i / parts.length : null);
    const pdf = await printPart(parts[i], () => progress.set(`${step}: server is restarting, retrying…`, parts.length > 1 ? i / parts.length : null));
    const part = await PDFDocument.load(pdf);
    for (const page of await merged.copyPages(part, part.getPageIndices())) merged.addPage(page);
  }
  progress.set('Joining pages…', 1);
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const pages = merged.getPages();
  pages.forEach((page, i) => {
    const text = `${i + 1} / ${pages.length}`;
    const size = 7;
    page.drawText(text, { x: (page.getWidth() - font.widthOfTextAtSize(text, size)) / 2, y: 16, size, font, color: rgb(0.53, 0.59, 0.63) });
  });
  merged.setTitle(state.renderArgs[0].title);
  return merged.save();
}

function saveFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// Runs one download job with the buttons locked and the progress bar showing.
async function runJob(btn, busyLabel, job) {
  const buttons = [$('#package'), $('#download')];
  buttons.forEach(b => { b.disabled = true; });
  const label = btn.textContent;
  btn.textContent = busyLabel;
  $('#error').hidden = true;
  const progress = pdfProgress(Date.now());
  try {
    await job(progress);
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  } finally {
    progress.done();
    buttons.forEach(b => { b.disabled = false; });
    btn.textContent = label;
  }
}

function downloadPdf() {
  return runJob($('#download'), 'Creating PDF…', async progress => {
    let pdf;
    try { pdf = await createPdf(progress); }
    catch (err) { throw new Error(`Could not create the PDF on the server (${err.message}). You can still use "Print / Save as PDF".`); }
    saveFile(new Blob([pdf], { type: 'application/pdf' }), `WhatsApp – ${state.fileBase}.pdf`);
  });
}

function downloadPackage() {
  return runJob($('#package'), 'Creating package…', async progress => {
    let pdf;
    try { pdf = await createPdf(progress); }
    catch (err) { throw new Error(`Could not create the PDF on the server (${err.message}), so the package was not made. Try again in a minute.`); }
    const [chat, opts] = state.renderArgs;
    const zip = await buildPackage({
      sourceFile: state.sourceFile, originals: state.originals, referenced: state.refs,
      chat, opts, pdf, txtName: state.txtName,
      progress: (text, value) => progress.set(text, value),
    });
    saveFile(zip, `WhatsApp – ${state.fileBase} – evidence package.zip`);
  });
}

async function runPool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
