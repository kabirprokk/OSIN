'use strict';

function createUnifiedDiff(filename, before, after) {
  const splitLines = value => String(value ?? '') === '' ? [] : String(value).replace(/\r\n/g, '\n').split('\n');
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  let body = '';
  if ((oldLines.length + 1) * (newLines.length + 1) <= 1_000_000) {
    const rows = oldLines.length + 1;
    const cols = newLines.length + 1;
    const table = Array.from({ length: rows }, () => new Uint32Array(cols));
    for (let i = oldLines.length - 1; i >= 0; i--) {
      for (let j = newLines.length - 1; j >= 0; j--) {
        table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    const changes = [];
    let i = 0; let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) { changes.push(` ${oldLines[i++]}`); j++; }
      else if (j < newLines.length && (i === oldLines.length || table[i][j + 1] >= table[i + 1][j])) changes.push(`+${newLines[j++]}`);
      else changes.push(`-${oldLines[i++]}`);
    }
    body = changes.join('\n');
  } else {
    body = [...oldLines.map(line => `-${line}`), ...newLines.map(line => `+${line}`)].join('\n');
  }
  return `--- a/${filename}\n+++ b/${filename}\n${body}`;
}

module.exports = { createUnifiedDiff };
