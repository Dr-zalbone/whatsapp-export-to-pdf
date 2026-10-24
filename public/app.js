import { parseChat, chatNameFromFilename, classify } from './parser.js';
import { processMedia } from './media.js';
import { renderChat, renderChatParts } from './render.js';

const $ = sel => document.querySelector(sel);
const state = { chat: null, html: '', fileBase: 'whatsapp-chat' };

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
$('#download').addEventListener('click', downloadPdf);
$('#print').addEventListener('click', () => $('#preview').contentWindow.print());
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
    let txtName, txtContent, files = new Map();
    if (/\.txt$/i.test(file.name)) {
      txtName = file.name;
      txtContent = await file.text();
    } else {
      setStatus('Opening ZIP…');
      if (!window.JSZip) throw new Error('ZIP library failed to load.');
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name));
      for (const e of entries) files.set(baseName(e.name).toLowerCase(), e);
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
    for (const m of parsed.messages) if (!m.system) Object.assign(m, classify(m, exists));

    const referenced = [...new Set(parsed.messages.filter(m => m.kind === 'file' && m.exists).map(m => m.file))];
    const media = new Map();
    let done = 0;
    setStatus(`Processing media (0 / ${referenced.length})…`, 0);
    await runPool(referenced, 4, async name => {
      const entry = files.get(baseName(name).toLowerCase());
      const blob = await entry.async('blob');
      media.set(name, await processMedia(baseName(entry.name), blob));
      done++;
      setStatus(`Processing media (${done} / ${referenced.length})…`, done / referenced.length);
    });
    for (const m of parsed.messages) if (m.kind === 'file' && m.exists) m.media = media.get(m.file);

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
  $('#preview').srcdoc = state.html;
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

async function downloadPdf() {
  const btn = $('#download');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Creating PDF…';
  $('#error').hidden = true;
  const progress = pdfProgress(Date.now());
  try {
    // The server prints the chat in parts to keep its memory use flat; the parts are joined here.
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
    const blob = new Blob([await merged.save()], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `WhatsApp – ${state.fileBase}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (err) {
    showError(`Could not create the PDF on the server (${err.message}). You can still use "Print / Save as PDF".`);
  } finally {
    progress.done();
    btn.disabled = false;
    btn.textContent = label;
  }
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
