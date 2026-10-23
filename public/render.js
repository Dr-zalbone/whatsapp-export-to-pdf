// Builds a self-contained HTML document that looks like the WhatsApp chat, ready to print as PDF.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SENDER_COLORS = ['#1fa855', '#e5426f', '#7b5cd6', '#d9822b', '#2a8fd6', '#c2410c', '#0f9d8f', '#b4329b', '#5c7cfa', '#8a6d1f'];

const ICON = {
  ticks: '<svg class="ticks" viewBox="0 0 16 11" width="16" height="11"><path d="M11.07.65 10.4.11a.37.37 0 0 0-.52.06L4.6 6.95 2.08 4.6a.37.37 0 0 0-.52.02l-.6.64a.37.37 0 0 0 .02.52l3.3 3.06a.37.37 0 0 0 .54-.04L11.13 1.17a.37.37 0 0 0-.06-.52Z" fill="currentColor"/><path d="m15.07.65-.67-.54a.37.37 0 0 0-.52.06L8.6 6.95l-.86-.8-.86 1.06 1.5 1.39a.37.37 0 0 0 .54-.04L15.13 1.17a.37.37 0 0 0-.06-.52Z" fill="currentColor"/></svg>',
  person: '<svg viewBox="0 0 40 40" width="100%" height="100%"><circle cx="20" cy="20" r="20" fill="#a3aeb5"/><circle cx="20" cy="15" r="7" fill="#e9edef"/><path d="M7 34c2-7 7-10 13-10s11 3 13 10a19.9 19.9 0 0 1-26 0Z" fill="#e9edef"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#fff" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#fff" d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9Z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="#fff" d="M8 5.5v13l11-6.5z"/></svg>',
  ban: '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m5.6 5.6 12.8 12.8" stroke="currentColor" stroke-width="2"/></svg>',
  clip: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16.5 6.5v10.5a4.5 4.5 0 0 1-9 0V5.5a3 3 0 0 1 6 0V16a1.5 1.5 0 0 1-3 0V6.5H9V16a3 3 0 0 0 6 0V5.5a4.5 4.5 0 0 0-9 0V17a6 6 0 0 0 12 0V6.5h-1.5Z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="28" height="28"><path fill="#e53935" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2ZM9 6a3 3 0 0 1 6 0v2H9V6Z"/></svg>',
};

export const CHAT_CSS = `
@page { size: A4; margin: 12mm 10mm 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Noto Sans Hebrew', 'Noto Sans', 'Segoe UI', Arial, 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
  font-size: 10.5pt; color: #111b21; background: #efeae2;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.chat { max-width: 760px; margin: 0 auto; background: #efeae2; }
.head { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #f0f2f5; border-bottom: 1px solid #d1d7db; }
.head .avatar { width: 40px; height: 40px; flex: none; }
.head .title { font-size: 13pt; font-weight: 600; unicode-bidi: plaintext; }
.head .sub { font-size: 8.5pt; color: #667781; margin-top: 2px; unicode-bidi: plaintext; }
.msgs { padding: 8px 22px 20px; }
.day { text-align: center; margin: 14px 0 10px; break-after: avoid; }
.day span, .sys span { display: inline-block; background: #fff; color: #54656f; font-size: 8.5pt; padding: 5px 12px; border-radius: 7px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
.sys { text-align: center; margin: 8px 40px; }
.sys span { background: #ffeecd; color: #54656f; white-space: pre-wrap; unicode-bidi: plaintext; }
.row { display: flex; margin: 2px 0; break-inside: avoid; }
.row.first { margin-top: 10px; }
.row.out { justify-content: flex-end; }
.bubble { position: relative; max-width: 72%; min-width: 70px; background: #fff; border-radius: 8px; padding: 6px 8px 7px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
.out .bubble { background: #d9fdd3; }
.bubble.media { padding: 4px; }
.bubble.sticker { background: none; box-shadow: none; padding: 0; }
.sender { font-size: 9pt; font-weight: 600; margin-bottom: 2px; unicode-bidi: plaintext; text-align: left; }
.media .sender { padding: 2px 4px 0; }
.text { white-space: pre-wrap; unicode-bidi: plaintext; text-align: start; overflow-wrap: anywhere; line-height: 1.38; }
.media .text { padding: 4px 4px 0; }
.text a { color: #027eb5; }
.text code { font-family: Consolas, 'Courier New', monospace; font-size: .95em; }
.spacer { display: inline-block; height: 1px; }
.meta { position: absolute; bottom: 4px; right: 8px; font-size: 7.5pt; color: #667781; white-space: nowrap; display: flex; align-items: center; gap: 3px; direction: ltr; }
.meta.rtl { right: auto; left: 8px; }
.media .meta { bottom: 6px; right: 10px; }
.media .meta.rtl { left: 10px; }
.meta .ticks { color: #53bdeb; }
.meta.overlay { color: #fff; text-shadow: 0 0 3px rgba(0,0,0,.6); }
.meta.overlay .ticks { color: #fff; }
.meta-line { height: 16px; }
.note { color: #667781; font-style: italic; display: inline-flex; align-items: center; gap: 5px; }
.img { display: block; border-radius: 6px; max-width: 100%; }
.single { max-width: 330px; }
.single img { display: block; width: 100%; height: auto; max-height: 420px; object-fit: cover; border-radius: 6px; }
.album { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; width: 300px; }
.album .cell { aspect-ratio: 1; break-inside: avoid; position: relative; }
.album img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; display: block; }
.album .cell .vbadge { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.row.album-row { break-inside: auto; }
.video { position: relative; max-width: 330px; }
.video img { display: block; width: 100%; max-height: 420px; object-fit: cover; border-radius: 6px; }
.video .noframe { width: 280px; height: 160px; background: #2a3942; border-radius: 6px; }
.playbtn { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 50px; height: 50px; border-radius: 50%; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; }
.vdur { position: absolute; left: 8px; bottom: 6px; color: #fff; font-size: 8pt; text-shadow: 0 0 3px rgba(0,0,0,.7); display: flex; align-items: center; gap: 3px; }
.audio { display: flex; align-items: center; gap: 10px; width: 280px; padding: 4px 4px 0; direction: ltr; }
.audio .icon { width: 40px; height: 40px; border-radius: 50%; background: #00a884; display: flex; align-items: center; justify-content: center; flex: none; }
.audio .icon.file { background: #f59e0b; }
.audio .wave { flex: 1; display: flex; align-items: center; gap: 2px; height: 26px; }
.audio .wave i { flex: 1; background: #8696a0; border-radius: 1px; min-height: 2px; }
.out .audio .wave i { background: #7fa98a; }
.audio .dur { font-size: 8pt; color: #667781; width: 30px; text-align: right; }
.fname { font-size: 7.5pt; color: #667781; padding: 3px 6px 0; unicode-bidi: plaintext; text-align: start; overflow-wrap: anywhere; }
.doc { width: 300px; border-radius: 6px; overflow: hidden; background: rgba(0,0,0,.04); }
.out .doc { background: rgba(0,0,0,.05); }
.doc .preview { display: block; width: 100%; height: 150px; object-fit: cover; object-position: top; background: #fff; }
.doc .bar { display: flex; align-items: center; gap: 10px; padding: 9px 10px; }
.doc .ficon { width: 32px; height: 38px; border-radius: 4px; background: #8696a0; color: #fff; font-size: 7pt; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: none; text-transform: uppercase; }
.doc .ficon.pdf { background: #e53935; }
.doc .info { min-width: 0; }
.doc .dname { font-size: 9.5pt; unicode-bidi: plaintext; text-align: start; overflow-wrap: anywhere; }
.doc .dsub { font-size: 8pt; color: #667781; margin-top: 2px; }
.contact { display: flex; align-items: center; gap: 10px; width: 260px; padding: 8px 10px; border-radius: 6px; background: rgba(0,0,0,.04); margin-bottom: 3px; }
.contact .avatar { width: 40px; height: 40px; flex: none; }
.contact .cname { font-weight: 600; unicode-bidi: plaintext; }
.contact .cphone { font-size: 8.5pt; color: #667781; direction: ltr; text-align: left; }
.loc { display: flex; align-items: center; gap: 8px; width: 260px; padding: 8px 10px; border-radius: 6px; background: rgba(0,0,0,.04); }
.loc a { color: #027eb5; font-size: 8.5pt; overflow-wrap: anywhere; }
.sticker img { width: 140px; height: auto; display: block; }
.sticker .meta { position: static; justify-content: flex-end; background: rgba(255,255,255,.8); border-radius: 6px; padding: 1px 5px; width: max-content; margin-left: auto; margin-top: 2px; }
.end { text-align: center; color: #8696a0; font-size: 8pt; padding: 14px 0 4px; }
`;

function fmtDuration(sec) {
  if (sec == null || !isFinite(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// First strong character of the last paragraph decides on which side the timestamp sits.
function lastLineIsRtl(text) {
  const lines = String(text || '').trim().split('\n');
  const last = lines[lines.length - 1];
  const m = last.match(/[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]|[֐-ࣿיִ-﷿ﹰ-﻿]/);
  return !!m && /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(m[0]);
}

// Escape, then apply WhatsApp's *bold* _italic_ ~strike~ ```mono``` markup and linkify URLs.
function formatText(text) {
  let html = esc(text);
  const links = [];
  html = html.replace(/\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])/gi, url => {
    const href = url.startsWith('www.') ? 'http://' + url : url;
    links.push(`<a href="${href}">${url}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  html = html.replace(/\b([\w.+-]+@[\w-]+\.[\w.-]+\w)/g, (m) => {
    links.push(`<a href="mailto:${m}">${m}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  html = html.replace(/```([\s\S]+?)```/g, '<code>$1</code>');
  const B = '(^|[\\s(\\[\'"])', E = '(?=$|[\\s.,!?:;)\\]\'"])';
  html = html.replace(new RegExp(B + '\\*([^*\\n]+?)\\*' + E, 'gm'), '$1<b>$2</b>');
  html = html.replace(new RegExp(B + '_([^_\\n]+?)_' + E, 'gm'), '$1<i>$2</i>');
  html = html.replace(new RegExp(B + '~([^~\\n]+?)~' + E, 'gm'), '$1<s>$2</s>');
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => links[+i]);
}

function buildChat(chat, opts) {
  const { title, me, messages, uses12h } = chat;
  const locale = opts.locale || 'en-GB';
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shortFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: uses12h ? 'numeric' : '2-digit', minute: '2-digit', hour12: !!uses12h });
  const isGroup = chat.senders.length > 2;
  const colorOf = name => SENDER_COLORS[Math.abs([...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) | 0, 7)) % SENDER_COLORS.length];

  const counted = messages.filter(m => !m.system);
  const first = messages[0]?.date, last = messages[messages.length - 1]?.date;
  const sub = [
    isGroup ? `${chat.senders.length} participants` : (me ? `Chat with ${me}` : ''),
    first ? `${shortFmt.format(first)} – ${shortFmt.format(last)}` : '',
    `${counted.length} messages`,
  ].filter(Boolean).join(' · ');

  const meta = (m, { rtl = false, overlay = false } = {}) => {
    const out = m.sender === me;
    return `<div class="meta${rtl ? ' rtl' : ''}${overlay ? ' overlay' : ''}">${m.edited ? 'Edited ' : ''}${esc(timeFmt.format(m.date))}${out ? ICON.ticks : ''}</div>`;
  };
  const metaWidth = m => (m.edited ? 38 : 0) + (uses12h ? 52 : 34) + (m.sender === me ? 20 : 0);
  const textBlock = (m, text) => text
    ? `<div class="text">${formatText(text)}<span class="spacer" style="width:${metaWidth(m) + 6}px"></span></div>`
    : '';

  const out = [];
  let lastDay = '', lastSender = null;

  // Group runs of consecutive images/videos without captions from the same sender into an album.
  const items = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const albumable = x => x && !x.system && x.kind === 'file' && x.media && ['image', 'video'].includes(x.media.type) && x.media.src && !x.text;
    if (albumable(m)) {
      const group = [m];
      while (albumable(messages[i + 1]) && messages[i + 1].sender === m.sender &&
             messages[i + 1].date - group[group.length - 1].date <= 120000 &&
             messages[i + 1].date.toDateString() === m.date.toDateString()) {
        group.push(messages[++i]);
      }
      // A caption on the message right after the album belongs on the album's last item in WhatsApp,
      // but the export keeps it separate, so it simply follows as its own bubble.
      if (group.length >= 2) { items.push({ album: group, ...group[group.length - 1] }); continue; }
      items.push(...group);
      continue;
    }
    items.push(m);
  }

  // Each block remembers its day heading, so a part that starts mid-day can repeat it.
  let dayHtml = '';
  for (const m of items) {
    const dayKey = m.date.toDateString();
    if (dayKey !== lastDay) {
      dayHtml = `<div class="day"><span>${esc(dayFmt.format(m.date))}</span></div>`;
      out.push({ html: dayHtml, dayHtml, isDay: true });
      lastDay = dayKey; lastSender = null;
    }
    if (m.system) {
      const lock = /encrypted|מוצפנות/i.test(m.text) ? ICON.lock + ' ' : '';
      out.push({ html: `<div class="sys"><span>${lock}${esc(m.text)}</span></div>`, dayHtml });
      lastSender = null;
      continue;
    }
    const isOut = m.sender === me;
    const firstOfRun = m.sender !== lastSender;
    lastSender = m.sender;
    const showName = !isOut && firstOfRun && (isGroup || opts.showNames !== false);
    const sender = showName ? `<div class="sender" style="color:${colorOf(m.sender)}">${esc(m.sender)}</div>` : '';
    const rowCls = `row ${isOut ? 'out' : 'in'}${firstOfRun ? ' first' : ''}`;
    out.push({ html: renderMessage(m, { rowCls, sender, meta, textBlock }), dayHtml });
  }

  return {
    title,
    head: `<div class="head"><div class="avatar">${ICON.person}</div><div><div class="title">${esc(title)}</div><div class="sub">${esc(sub)}</div></div></div>`,
    blocks: out,
    end: `<div class="end">Exported WhatsApp chat · generated ${esc(shortFmt.format(new Date()))}</div>`,
  };
}

function htmlPage(title, head, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="fonts/noto-sans-hebrew/400.css">
<link rel="stylesheet" href="fonts/noto-sans-hebrew/700.css">
<link rel="stylesheet" href="fonts/noto-sans/400.css">
<link rel="stylesheet" href="fonts/noto-sans/700.css">
<style>${CHAT_CSS}</style></head>
<body><div class="chat">
${head}
<div class="msgs">
${body}
</div></div></body></html>`;
}

// The whole chat as one page (for the preview and the browser's print dialog).
export function renderChat(chat, opts) {
  const { title, head, blocks, end } = buildChat(chat, opts);
  return htmlPage(title, head, blocks.map(b => b.html).join('\n') + '\n' + end);
}

// The chat split into several pages of roughly `budget` characters each (photos make up most of that),
// so the PDF server only ever holds one part in memory. Parts break at a new day when possible,
// and at any message once a single day grows past twice the budget.
export function renderChatParts(chat, opts, budget = 2_000_000) {
  const { title, head, blocks, end } = buildChat(chat, opts);
  const parts = [];
  let cur = [], size = 0;
  for (const b of blocks) {
    if (cur.length && ((b.isDay && size >= budget) || size + b.html.length > budget * 2)) {
      parts.push(cur);
      cur = b.isDay ? [] : [b.dayHtml];
      size = 0;
    }
    cur.push(b.html);
    size += b.html.length;
  }
  parts.push(cur);
  return parts.map((p, i) => htmlPage(title, i === 0 ? head : '', p.join('\n') + (i === parts.length - 1 ? '\n' + end : '')));
}

function renderMessage(m, { rowCls, sender, meta, textBlock }) {
  const rtl = lastLineIsRtl(m.text);
  const wrap = (inner, cls = '') => `<div class="${rowCls}${m.album ? ' album-row' : ''}"><div class="bubble${cls ? ' ' + cls : ''}">${sender}${inner}</div></div>`;

  if (m.kind === 'deleted') {
    return wrap(`<div class="text"><span class="note">${ICON.ban} ${esc(m.text)}</span><span class="spacer" style="width:60px"></span></div>${meta(m)}`);
  }
  if (m.kind === 'omitted') {
    const note = `<span class="note">${ICON.clip} Media omitted (not included in export)</span>`;
    return wrap(`<div class="text">${note}${m.text ? '\n' + esc(m.text) : ''}<span class="spacer" style="width:60px"></span></div>${meta(m, { rtl })}`);
  }
  if (m.kind === 'location') {
    return wrap(`<div class="loc">${ICON.pin}<div><div>Location</div><a href="${esc(m.url)}">${esc(m.url)}</a></div></div>${textBlock(m, m.text)}<div class="meta-line"></div>${meta(m, { rtl })}`, 'media');
  }
  if (m.kind === 'text') {
    return wrap(`${textBlock(m, m.text)}${meta(m, { rtl })}`);
  }

  // Attachments
  if (m.album) {
    const cells = m.album.map(x => `<div class="cell"><img src="${x.media.thumb || x.media.src}" alt="">${x.media.type === 'video' ? `<div class="vbadge"><div class="playbtn" style="position:static;transform:none">${ICON.play}</div></div>` : ''}</div>`).join('');
    return wrap(`<div class="album">${cells}</div><div class="meta-line"></div>${meta(m)}`, 'media');
  }
  const f = m.media;
  if (!f) {
    return wrap(`<div class="text"><span class="note">${ICON.clip} ${esc(m.file)} (file missing from export)</span>${m.text ? '\n' + formatText(m.text) : ''}<span class="spacer" style="width:60px"></span></div>${meta(m, { rtl })}`);
  }
  const caption = textBlock(m, m.text);
  const tail = caption ? meta(m, { rtl }) : `<div class="meta-line"></div>${meta(m)}`;

  switch (f.type) {
    case 'image':
      return wrap(`<div class="single"><img src="${f.src}" alt=""></div>${caption}${tail}`, 'media');
    case 'sticker':
      return wrap(`<img src="${f.src}" alt="">${m.text ? textBlock(m, m.text) : ''}${meta(m)}`, 'sticker');
    case 'video': {
      const dur = f.duration ? `<div class="vdur">▶ ${fmtDuration(f.duration)}</div>` : '';
      const frame = f.src ? `<img src="${f.src}" alt="">` : '<div class="noframe"></div>';
      return wrap(`<div class="video">${frame}<div class="playbtn">${ICON.play}</div>${dur}</div><div class="fname">${esc(f.name)}</div>${caption}${tail}`, 'media');
    }
    case 'audio': {
      const peaks = f.peaks || Array.from({ length: 40 }, () => 0.35);
      const bars = peaks.map(p => `<i style="height:${Math.round(p * 100)}%"></i>`).join('');
      return wrap(`<div class="audio"><div class="icon${f.voice ? '' : ' file'}">${f.voice ? ICON.mic : ICON.headphones}</div><div class="wave">${bars}</div><div class="dur">${fmtDuration(f.duration)}</div></div><div class="fname">${esc(f.name)}</div>${caption}${tail}`, 'media');
    }
    case 'contact': {
      const cards = (f.contacts || []).map(c => `<div class="contact"><div class="avatar">${ICON.person}</div><div><div class="cname">${esc(c.name)}</div>${c.phones.map(p => `<div class="cphone">${esc(p)}</div>`).join('')}${c.emails.map(e => `<div class="cphone">${esc(e)}</div>`).join('')}</div></div>`).join('');
      return wrap(`${cards}${caption}${tail}`, 'media');
    }
    default: {
      const isPdf = f.type === 'pdf';
      const subParts = [isPdf && f.pages ? `${f.pages} page${f.pages === 1 ? '' : 's'}` : '', (f.ext || 'file').toUpperCase(), fmtSize(f.size)].filter(Boolean);
      const preview = f.src ? `<img class="preview" src="${f.src}" alt="">` : '';
      return wrap(`<div class="doc">${preview}<div class="bar"><div class="ficon${isPdf ? ' pdf' : ''}">${esc((f.ext || 'file').slice(0, 4))}</div><div class="info"><div class="dname">${esc(f.name)}</div><div class="dsub">${esc(subParts.join(' · '))}</div></div></div></div>${caption}${tail}`, 'media');
    }
  }
}
