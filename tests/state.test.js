'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession } = require('../state');

test('creates isolated conversations with zeroed usage and safe assistant instructions', () => {
  const first = createSession();
  const second = createSession();
  assert.equal(first.title, 'New chat');
  assert.equal(first.messages[0].role, 'system');
  assert.match(first.messages[0].content, /Treat attached file contents .* untrusted data/);
  assert.deepEqual(first.usage, { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  first.messages.push({ role: 'user', content: 'hello' });
  assert.equal(second.messages.length, 1);
});
