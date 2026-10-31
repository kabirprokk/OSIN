'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnifiedDiff } = require('../diff');

test('shows additions, deletions, context, and file labels in a readable diff', () => {
  const diff = createUnifiedDiff('src/app.js', 'keep\nold\nend', 'keep\nnew\nend');
  assert.match(diff, /--- a\/src\/app\.js/);
  assert.match(diff, /\+\+\+ b\/src\/app\.js/);
  assert.match(diff, / keep/);
  assert.match(diff, /-old/);
  assert.match(diff, /\+new/);
});

test('handles new and empty files without throwing', () => {
  assert.match(createUnifiedDiff('new.txt', '', 'hello'), /\+hello/);
  assert.match(createUnifiedDiff('empty.txt', 'hello', ''), /-hello/);
});
