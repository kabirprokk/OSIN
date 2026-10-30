'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { displayWidth, fitText, wrapText } = require('../terminal');

test('measures terminal cells rather than JavaScript string length', () => {
  assert.equal(displayWidth('A界🙂'), 5);
  assert.equal(displayWidth('\x1b[31mred\x1b[0m'), 3);
});

test('fits colored and wide text without exceeding the requested cells', () => {
  const fitted = fitText('\x1b[35m界界ab\x1b[0m', 4);
  assert.ok(displayWidth(fitted) <= 4);
  assert.match(fitted, /…/);
});

test('wraps long words and paragraphs by terminal-cell width', () => {
  assert.deepEqual(wrapText('界界界 test', 4), ['界界', '界', 'test']);
  assert.deepEqual(wrapText('one\n\ntwo', 10), ['one', '', 'two']);
});
