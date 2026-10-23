// Parses the _chat.txt / "WhatsApp Chat with X.txt" file from a WhatsApp export.
// Supports Android ("13/11/2023, 08:01 - Name: text") and iOS ("[13/11/2023, 08:01:23] Name: text")
// layouts, 12/24h clocks, day-first / month-first / year-first dates, and multi-line messages.

// Bidi / formatting marks that WhatsApp sprinkles around timestamps and attachment tags.
const MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;

const HEADER = new RegExp(
  '^\\[?' +
  '(\\d{1,4})([./-])(\\d{1,2})\\2(\\d{2,4})' +          // date
  ',?\\s+' +
  '(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?' +            // time
  '(?:\\s*([AaPp])\\.?\\s*[Mm]\\.?)?' +                  // optional AM/PM
  '\\]?' +
  '(?:\\s*[-–]\\s+|\\s+)' +                          // " - " (Android) or " " (iOS)
  '(.*)$'
);

const ENCRYPTED = /end-to-end encrypted|מוצפנות מקצה לקצה/i;

export function parseChat(rawText) {
  const text = rawText.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  // First pass: split into raw entries (header + continuation lines).
  const entries = [];
  for (const line of lines) {
    const clean = line.replace(MARKS, '');
    const m = clean.match(HEADER);
    if (m) {
      entries.push({ a: +m[1], b: +m[3], c: m[4], aLen: m[1].length, h: +m[5], min: +m[6], s: +(m[7] || 0), ampm: m[8], body: m[9] });
    } else if (entries.length) {
      entries[entries.length - 1].body += '\n' + line.replace(/^[‎‏]+/, '');
    }
  }
  if (!entries.length) throw new Error('This does not look like a WhatsApp chat export (no timestamps found).');

  // Decide date order from the whole file: any first field > 12 means day-first, etc.
  let order = 'DMY';
  if (entries[0].aLen === 4) order = 'YMD';
  else if (entries.some(e => e.b > 12) && !entries.some(e => e.a > 12)) order = 'MDY';
  const uses12h = entries.some(e => e.ampm);

  const messages = [];
  for (const e of entries) {
    let y, mo, d;
    if (order === 'YMD') { y = e.a; mo = e.b; d = +e.c; }
    else if (order === 'MDY') { mo = e.a; d = e.b; y = +e.c; }
    else { d = e.a; mo = e.b; y = +e.c; }
    if (y < 100) y += 2000;
    let h = e.h;
    if (e.ampm) {
      const pm = /p/i.test(e.ampm);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    const date = new Date(y, mo - 1, d, h, e.min, e.s);

    const body = e.body.replace(/\s+$/, '');
    let sender = null, content = body;
    const sm = body.match(/^([^:\n]{1,80}?): ([\s\S]*)$/) || body.match(/^([^:\n]{1,80}?):$/);
    if (sm) { sender = sm[1].replace(MARKS, '').trim(); content = sm[2] ?? ''; }

    // iOS attributes the encryption notice to the chat name, so treat it as a system line too.
    const system = !sender || (ENCRYPTED.test(content) && !content.includes('\n'));
    messages.push({ date, sender: system ? null : sender, text: system ? body.replace(MARKS, '') : content, system });
  }

  const senders = [...new Set(messages.filter(m => !m.system).map(m => m.sender))];
  return { messages, senders, uses12h };
}

// "WhatsApp Chat with Bob.txt", "WhatsApp Chat - Bob.zip", "צ'אט WhatsApp עם Bob.txt", ...
export function chatNameFromFilename(name) {
  if (!name) return null;
  let base = name.split(/[\\/]/).pop().replace(/\.(txt|zip)$/i, '').trim();
  if (/^_?chat$/i.test(base)) return null;
  base = base
    .replace(/^WhatsApp\s+Chat\s*(with|-|–|:)?\s*/i, '')
    .replace(/^(צ['׳]אט|שיחת)\s+(WhatsApp|וואטסאפ)\s+עם\s+/i, '')
    .replace(/^(Chat|Conversa|Discussion|Unterhaltung)\s+(de\s+WhatsApp|WhatsApp)?\s*(with|com|con|avec|mit)?\s*/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .trim();
  return base || null;
}

// Classify a message body: attachments, omitted media, deleted / edited markers.
const DELETED = /^(You deleted this message|This message was deleted|מחקת את ההודעה הזו|ההודעה הזו נמחקה|הודעה זו נמחקה|Esta mensagem foi apagada|Se eliminó este mensaje|Este mensaje fue eliminado|Ce message a été supprimé|Diese Nachricht wurde gelöscht)\.?$/i;
const EDITED = /\s*<(This message was edited|ההודעה נערכה|Mensagem editada|Se editó este mensaje|Ce message a été modifié|Diese Nachricht wurde bearbeitet)>\s*$/i;
const OMITTED = /^<?\s*(Media omitted|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted|Contact card omitted|המדיה לא נכללה|מדיה הושמטה|הושמט[^>]*|[^<>]{0,30}omitted|Mídia oculta|Multimedia omitido|<?Médias omis)\s*>?$/i;
const IOS_ATTACH = /<[^<>:]{1,30}:\s*([^<>]+?\.[A-Za-z0-9]{1,6})>/;
const ANDROID_ATTACH = /^(.+?\.[A-Za-z0-9]{1,6})\s+\([^()]{1,40}\)$/;

export function classify(msg, fileExists) {
  let text = msg.text;
  let edited = false;
  if (EDITED.test(text)) { edited = true; text = text.replace(EDITED, ''); }
  const plain = text.replace(MARKS, '').trim();

  if (DELETED.test(plain)) return { kind: 'deleted', text: plain, edited };

  const lines = text.split('\n');
  const first = lines[0].replace(MARKS, '').trim();
  const rest = lines.slice(1).join('\n').trim();

  if (OMITTED.test(first)) return { kind: 'omitted', text: rest, edited };

  // iOS: "<attached: 00000012-PHOTO-....jpg>" anywhere in the body, caption is the remainder.
  const ios = plain.match(IOS_ATTACH);
  if (ios) {
    const file = ios[1].trim();
    const caption = plain.replace(ios[0], '').trim();
    return { kind: 'file', file, exists: fileExists(file), text: caption, edited };
  }
  // Android: "IMG-20231113-WA0000.jpg (file attached)" on the first line, caption on following lines.
  const and = first.match(ANDROID_ATTACH);
  if (and && (fileExists(and[1]) || /^(IMG|VID|AUD|PTT|STK|DOC|PHOTO|VIDEO|AUDIO)-/i.test(and[1]))) {
    // Documents repeat their file name on the next line; that is not a real caption.
    const caption = rest.replace(MARKS, '').trim() === and[1] ? '' : rest;
    return { kind: 'file', file: and[1], exists: fileExists(and[1]), text: caption, edited };
  }
  if (fileExists(first)) return { kind: 'file', file: first, exists: true, text: rest, edited };

  const loc = plain.match(/^(?:location|מיקום):\s*(https?:\/\/\S+)/i);
  if (loc) return { kind: 'location', url: loc[1], text: plain.replace(loc[0], '').trim(), edited };

  return { kind: 'text', text, edited };
}
