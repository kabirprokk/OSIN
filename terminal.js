'use strict';

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function codePointWidth(char) {
  const code = char.codePointAt(0);
  if (code === 0 || code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (/\p{Mark}/u.test(char) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) return 0;
  return code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) ? 2 : 1;
}

function displayWidth(value) {
  return [...String(value).replace(ANSI, '')].reduce((total, char) => total + codePointWidth(char), 0);
}

function fitText(value, maxWidth) {
  const text = String(value);
  const width = Math.max(0, Math.floor(maxWidth));
  const plain = text.replace(ANSI, '');
  if (displayWidth(plain) <= width) return text + ' '.repeat(width - displayWidth(plain));
  if (!width) return '';
  const prefix = (text.match(/^(?:\x1b\[[0-?]*[ -/]*[@-~])+/) || [''])[0];
  const available = Math.max(0, width - 1);
  let output = '';
  let used = 0;
  for (const char of plain) {
    const charWidth = codePointWidth(char);
    if (used + charWidth > available) break;
    output += char;
    used += charWidth;
  }
  // Restore only the foreground so fitting colored text doesn't reset a
  // terminal background established by the caller.
  const suffix = prefix ? '\x1b[39m' : '';
  return prefix + output + '…' + suffix + ' '.repeat(width - used - 1);
}

function wrapText(value, maxWidth) {
  const width = Math.max(1, Math.floor(maxWidth));
  const result = [];
  for (const paragraph of String(value).split('\n')) {
    if (!paragraph) { result.push(''); continue; }
    let line = '';
    let used = 0;
    for (const word of paragraph.split(/\s+/)) {
      const wordWidth = displayWidth(word);
      if (line && used + 1 + wordWidth <= width) {
        line += ` ${word}`;
        used += 1 + wordWidth;
        continue;
      }
      if (line) { result.push(line); line = ''; used = 0; }
      if (wordWidth <= width) { line = word; used = wordWidth; continue; }
      let chunk = '';
      let chunkWidth = 0;
      for (const char of word) {
        const charWidth = codePointWidth(char);
        if (chunk && chunkWidth + charWidth > width) {
          result.push(chunk); chunk = ''; chunkWidth = 0;
        }
        chunk += char; chunkWidth += charWidth;
      }
      line = chunk; used = chunkWidth;
    }
    if (line) result.push(line);
  }
  return result;
}

module.exports = { displayWidth, fitText, wrapText };
