// Turns files from the export ZIP into small, printable representations (data URLs + metadata).
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const EXT = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif'],
  video: ['mp4', '3gp', 'mov', 'm4v', 'webm', 'mkv', 'avi'],
  audio: ['opus', 'ogg', 'oga', 'm4a', 'mp3', 'aac', 'amr', 'wav', 'flac', 'weba'],
  contact: ['vcf'],
  pdf: ['pdf'],
};

export function extOf(name) {
  const m = name.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export function mediaType(name) {
  const ext = extOf(name);
  const base = name.split('/').pop();
  if (ext === 'webp' && /^STK-|sticker/i.test(base)) return 'sticker';
  for (const [type, exts] of Object.entries(EXT)) if (exts.includes(ext)) return type;
  return 'document';
}

export function isVoiceNote(name) {
  return /^PTT-|AUDIO-.*\.opus$|\.opus$/i.test(name.split('/').pop());
}

export async function processMedia(name, blob) {
  const type = mediaType(name);
  const info = { type, name, size: blob.size, ext: extOf(name) };
  try {
    if (type === 'image') Object.assign(info, await processImage(blob, 1100, 'image/jpeg'));
    else if (type === 'sticker') Object.assign(info, await processImage(blob, 300, 'image/png'));
    else if (type === 'video') Object.assign(info, await processVideo(blob));
    else if (type === 'audio') Object.assign(info, await processAudio(blob), { voice: isVoiceNote(name) });
    else if (type === 'pdf') Object.assign(info, await processPdf(blob));
    else if (type === 'contact') info.contacts = parseVcf(await blob.text());
  } catch (err) {
    console.warn('Could not process', name, err);
    if (type === 'image' || type === 'sticker') info.type = 'document';
    info.error = String(err && err.message || err);
  }
  return info;
}

async function processImage(blob, maxDim, mime) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { src: canvas.toDataURL(mime, 0.82), w, h };
}

function withTimeout(promise, ms, what) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);
}

async function processVideo(blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  try {
    await withTimeout(new Promise((res, rej) => {
      video.onloadeddata = res;
      video.onerror = () => rej(new Error('video cannot be decoded by this browser'));
    }), 15000, 'video load');
    const duration = isFinite(video.duration) ? video.duration : null;
    const target = duration ? Math.min(1, duration / 3) : 0;
    if (target > 0) {
      await withTimeout(new Promise(res => { video.onseeked = res; video.currentTime = target; }), 8000, 'video seek');
    }
    const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
    if (!w || !h) return { duration };
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return { src: canvas.toDataURL('image/jpeg', 0.8), w, h, duration };
  } finally {
    video.removeAttribute('src'); video.load();
    URL.revokeObjectURL(url);
  }
}

let audioCtx;
async function processAudio(blob) {
  const BARS = 40;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const buf = await audioCtx.decodeAudioData(await blob.arrayBuffer());
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const peaks = [];
    for (let i = 0; i < BARS; i++) {
      let sum = 0;
      const start = i * step, end = Math.min(data.length, start + step);
      for (let j = start; j < end; j++) sum += data[j] * data[j];
      peaks.push(Math.sqrt(sum / Math.max(1, end - start)));
    }
    const max = Math.max(...peaks, 1e-6);
    return { duration: buf.duration, peaks: peaks.map(p => Math.max(0.08, p / max)) };
  } catch {
    // Fall back to the media element, which can at least read the duration of most formats.
    const url = URL.createObjectURL(blob);
    try {
      const audio = new Audio();
      audio.preload = 'metadata'; audio.src = url;
      await withTimeout(new Promise((res, rej) => { audio.onloadedmetadata = res; audio.onerror = rej; }), 8000, 'audio');
      return { duration: isFinite(audio.duration) ? audio.duration : null };
    } catch {
      return { duration: null };
    } finally { URL.revokeObjectURL(url); }
  }
}

async function processPdf(blob) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const pages = doc.numPages;
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 700 / vp1.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { pages, src: canvas.toDataURL('image/jpeg', 0.8), w: canvas.width, h: canvas.height };
  } finally { doc.destroy(); }
}

export function parseVcf(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  return cards.map(card => {
    const lines = card.split(/\r?\n/);
    const get = key => lines.filter(l => new RegExp('^(item\\d+\\.)?' + key + '[;:]', 'i').test(l))
      .map(l => decodeVcfValue(l));
    const name = get('FN')[0] || (get('N')[0] || '').split(';').filter(Boolean).reverse().join(' ') || 'Contact';
    return { name, phones: get('TEL'), emails: get('EMAIL') };
  });
}

function decodeVcfValue(line) {
  const idx = line.indexOf(':');
  const params = line.slice(0, idx);
  let value = line.slice(idx + 1);
  if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) {
    const bytes = [];
    value.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})|([^=])/gi, (_, hex, ch) => {
      if (hex) bytes.push(parseInt(hex, 16));
      else bytes.push(...new TextEncoder().encode(ch));
    });
    value = new TextDecoder().decode(new Uint8Array(bytes));
  }
  return value.replace(/\\([,;\\])/g, '$1').trim();
}
