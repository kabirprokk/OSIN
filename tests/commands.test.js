'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCommandSuggestions } = require('../commands');

test('keeps command suggestions relevant and limits visual clutter', () => {
  const suggestions = getCommandSuggestions('/');
  assert.equal(suggestions.length, 4);
  assert.ok(suggestions.every(([command]) => command.startsWith('/')));
  assert.ok(getCommandSuggestions('/up').some(([command]) => command === '/update'));
  assert.deepEqual(getCommandSuggestions('/not-a-command'), []);
});
