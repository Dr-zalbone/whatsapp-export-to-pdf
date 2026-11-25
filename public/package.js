// Builds the evidence package (a ZIP) in the browser:
//   chat.pdf       the printable exhibit
//   viewer.html    offline viewer in which audio and video play
//   original/      every file of the WhatsApp export, byte-identical
//   playable/      MP3 copies of audio in formats courts do not list (WhatsApp voice notes are .opus)
//   manifest.txt   what the package holds, how it was made, and SHA-256 of every file
import { Mp3Encoder } from './vendor/lamejs/lamejs.js';
import { renderChat } from './render.js';
import { extOf } from './media.js';

export const TOOL_VERSION = '1.1.0';

// Formats listed in the Israeli Courts Administrator notice on digital media evidence (16 Dec 2020).
const COURT_AUDIO = ['wma', 'mp3', 'mp2', 'mpa', 'wav', 'm4a', 'aac', 'adt', 'adts', 'cda'];
const COURT_VIDEO = ['wmv', 'wm', 'avi', 'mpeg', 'mpg', 'm1v', 'mov', 'mp4', 'm4v', 'mp4v', '3g2', '3gp2', '3gp', '3gpp', 'm2ts', 'mkv'];

// A path inside the package as a relative URL, each segment percent-encoded (names are often Hebrew).
const urlPath = p => p.split('/').map(encodeURIComponent).join('/');

/**
 * @param {object} a
 * @param {File} a.sourceFile         the uploaded export
 * @param {{path: string, read: () => Promise<Uint8Array>}[]} a.originals  every file of the export
 * @param {Map<string, {path: string, media: object}>} a.referenced  chat file name -> its export path and processed media
 * @param {object} a.chat, a.opts      render arguments (as for the PDF)
 * @param {Uint8Array} a.pdf           the merged chat PDF
 * @param {string} a.txtName           the chat .txt inside the export
 * @param {(text: string, value: number|null) => void} a.progress
 */
export async function buildPackage({ sourceFile, originals, referenced, chat, opts, pdf, txtName, progress }) {
  const files = [];   // { path, data, note }
  const add = (path, data, note = '') => files.push({ path, data, note });

  // 1. Originals, unchanged.
  for (let i = 0; i < originals.length; i++) {
    progress(`Copying original files (${i + 1} / ${originals.length})…`, i / originals.length);
    add('original/' + originals[i].path, await originals[i].read(), 'original');
  }

  // 2. MP3 copies of audio the courts' list does not include.
  const toConvert = [...referenced.values()].filter(r => r.media?.type === 'audio' && !COURT_AUDIO.includes(extOf(r.path)));
  const playable = new Map();   // chat file name -> package path of the MP3
  const conversions = [], unconverted = [];
  for (let i = 0; i < toConvert.length; i++) {
    const r = toConvert[i];
    progress(`Converting audio to MP3 (${i + 1} / ${toConvert.length})…`, i / toConvert.length);
    const src = files.find(f => f.path === 'original/' + r.path);
    try {
      const { mp3, desc } = await encodeMp3(src.data, r.media.voice);
      const path = 'playable/' + r.path.split('/').pop().replace(/\.[^.]+$/, '') + '.mp3';
      add(path, mp3, `MP3 copy of original/${r.path}`);
      playable.set(r.name, path);
      conversions.push(`${path}  <-  original/${r.path}  (${desc})`);
    } catch (err) {
      unconverted.push(`original/${r.path}  (could not convert: ${err.message || err})`);
    }
  }
  for (const r of referenced.values()) {
    if (r.media?.type === 'video' && !COURT_VIDEO.includes(extOf(r.path))) unconverted.push(`original/${r.path}  (video format not on the courts' list)`);
  }

  // 3. The viewer, with fonts embedded so it looks the same offline.
  progress('Building the offline viewer…', null);
  const viewerHtml = await inlineFonts(renderChat(chat, {
    ...opts,
    viewer: true,
    fileUrl: name => urlPath('original/' + (referenced.get(name)?.path ?? name)),
    playableUrl: name => playable.has(name) ? urlPath(playable.get(name)) : null,
  }));
  add('viewer.html', new TextEncoder().encode(viewerHtml), 'offline viewer');
  add('chat.pdf', pdf, 'printable exhibit');

  // 4. Checksums and manifest.
  progress('Calculating SHA-256 checksums…', null);
  for (const f of files) f.sha256 = await sha256(f.data);
  const sourceHash = await sha256(new Uint8Array(await sourceFile.arrayBuffer()));
  const manifest = buildManifest({ sourceFile, sourceHash, txtName, chat, files, conversions, unconverted, referenced });
  add('manifest.txt', new TextEncoder().encode(manifest), 'manifest');

  // 5. ZIP. Media are already compressed, so only text is deflated.
  const zip = new JSZip();
  const textual = /\.(txt|html|vcf|json|csv)$/i;
  for (const f of files) zip.file(f.path, f.data, { compression: textual.test(f.path) ? 'DEFLATE' : 'STORE', date: new Date() });
  return zip.generateAsync({ type: 'blob', streamFiles: true }, meta => progress('Writing the ZIP…', meta.percent / 100));
}

function buildManifest({ sourceFile, sourceHash, txtName, chat, files, conversions, unconverted, referenced }) {
  const now = new Date();
  const offsetMin = -now.getTimezoneOffset();
  const offset = `UTC${offsetMin >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMin) % 60).padStart(2, '0')}`;
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const msgs = chat.messages.filter(m => !m.system);
  const fmtDay = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const missing = chat.messages.filter(m => m.kind === 'file' && !m.exists).map(m => `#${m.no}  ${m.file}`);
  const omitted = chat.messages.filter(m => m.kind === 'omitted').map(m => `#${m.no}`);

  const lines = [
    'WHATSAPP CHAT EVIDENCE PACKAGE',
    '==============================',
    '',
    `Generated:        ${local} (${offset})  /  ${now.toISOString()}`,
    `Generator:        WhatsApp Chat to PDF ${TOOL_VERSION} (${location.origin})`,
    `Source export:    ${sourceFile.name}`,
    `                  ${sourceFile.size} bytes, SHA-256 ${sourceHash}`,
    `Chat file:        original/${txtName}`,
    `Chat title:       ${chat.title}`,
    `Exporting party:  ${chat.me || '(not set)'}  (shown on the right, in green)`,
    `Participants:     ${chat.senders.join(', ')}`,
    `Messages:         ${msgs.length}, numbered #1-#${msgs.length} in chat.pdf and viewer.html`,
    `Date range:       ${chat.messages.length ? `${fmtDay(chat.messages[0].date)} - ${fmtDay(chat.messages[chat.messages.length - 1].date)}` : '-'}`,
    `Media files:      ${referenced.size} referenced in the chat and included`,
    `Missing media:    ${missing.length ? missing.join('; ') : 'none'}  (referenced in the chat but not in the export)`,
    `Omitted media:    ${omitted.length ? omitted.join(', ') : 'none'}  (WhatsApp exported the chat without these files)`,
    '',
    'Times are exactly as written in the export: the local time of the exporting phone.',
    'The export does not record a time zone.',
    '',
    'CONTENTS',
    '--------',
    'chat.pdf      Printable rendering of the chat in WhatsApp layout.',
    'viewer.html   The same chat for any web browser, offline; audio and video play in place.',
    '              Extract the whole ZIP first, then open viewer.html.',
    'original/     Every file of the WhatsApp export, unchanged (byte-identical).',
    'playable/     Copies converted to MP3, for audio whose original format is not on the',
    '              courts\' list of accepted formats. The originals remain the evidence.',
    'manifest.txt  This file.',
    '',
    'CONVERTED COPIES',
    '----------------',
    ...(conversions.length ? conversions : ['none']),
    '',
    'NOT CONVERTED',
    '-------------',
    ...(unconverted.length ? unconverted : ['none']),
    '',
    'SHA-256 CHECKSUMS',
    '-----------------',
    'Verify with:  sha256sum -c   (Linux/macOS: shasum -a 256 -c), run in the extracted folder,',
    'after copying the lines below into a file.',
    '',
    ...files.map(f => `${f.sha256}  ${f.path}`),
    '',
  ];
  return lines.join('\r\n');
}

const pad = n => String(n).padStart(2, '0');

async function sha256(data) {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Decodes any audio the browser can read and encodes it as MP3 with lamejs.
// Voice notes become 24 kHz mono 64 kbps (clear speech, small files); other audio 44.1 kHz at 128 kbps.
async function encodeMp3(bytes, voice) {
  const rate = voice ? 24000 : 44100;
  const ctx = new OfflineAudioContext(1, 1, rate);
  const buf = await ctx.decodeAudioData(bytes.slice().buffer);
  const channels = voice ? 1 : Math.min(2, buf.numberOfChannels);
  const kbps = voice ? 64 : 128;
  const toInt16 = f32 => {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) out[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
    return out;
  };
  let left, right;
  if (channels === 1) {
    // Mix all channels down to mono.
    const mix = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) mix[i] += d[i] / buf.numberOfChannels;
    }
    left = toInt16(mix);
  } else {
    left = toInt16(buf.getChannelData(0));
    right = toInt16(buf.getChannelData(1));
  }
  const enc = new Mp3Encoder(channels, rate, kbps);
  const chunks = [];
  const BLOCK = 1152 * 20;
  for (let i = 0; i < left.length; i += BLOCK) {
    const out = channels === 1
      ? enc.encodeBuffer(left.subarray(i, i + BLOCK))
      : enc.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK));
    if (out.length) chunks.push(new Uint8Array(out));
    if (i % (BLOCK * 50) === 0) await new Promise(r => setTimeout(r));   // keep the page responsive
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));
  const mp3 = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { mp3.set(c, o); o += c.length; }
  return { mp3, desc: `MP3, ${rate / 1000} kHz ${channels === 1 ? 'mono' : 'stereo'}, ${kbps} kbps` };
}

// Replaces the fontsource stylesheet links with inline @font-face rules whose woff2 files are data: URLs,
// so viewer.html renders with the same fonts on a machine without internet.
async function inlineFonts(html) {
  const links = [...html.matchAll(/<link rel="stylesheet" href="(fonts\/[\w-]+\/[\w-]+\.css)">/g)];
  for (const [tag, href] of links) {
    let css = await (await fetch(href)).text();
    const base = href.replace(/[^/]+$/, '');
    const urls = [...new Set([...css.matchAll(/url\(\.\/files\/([\w.-]+\.woff2)\)/g)].map(m => m[1]))];
    for (const name of urls) {
      const data = await blobToDataUrl(await (await fetch(base + 'files/' + name)).blob(), 'font/woff2');
      css = css.split(`url(./files/${name})`).join(`url(${data})`);
    }
    // Drop the .woff fallbacks: every browser that can run the viewer reads woff2.
    css = css.replace(/, url\(\.\/files\/[\w.-]+\.woff\) format\('woff'\)/g, '');
    html = html.replace(tag, `<style>${css}</style>`);
  }
  return html;
}

function blobToDataUrl(blob, type) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.replace(/^data:[^;]*;/, `data:${type};`));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
