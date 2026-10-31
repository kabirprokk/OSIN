'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { getTerminalDimensions, getWorkspaceLayout } = require('../tui');
const { createVisualSetupIO } = require('../setup');

test('reads fresh terminal dimensions and safely falls back when unavailable', () => {
  assert.deepEqual(getTerminalDimensions({ columns: 90, rows: 30, getWindowSize: () => [210, 55] }), { columns: 210, rows: 55 });
  assert.deepEqual(getTerminalDimensions({ columns: 0, rows: 0 }, { columns: 100, rows: 25 }), { columns: 100, rows: 25 });
});

test('balances chat, plan, and sponsor panels on wide terminals', () => {
  const wide = getWorkspaceLayout(248);
  assert.equal(wide.splitSponsor, true);
  assert.equal(wide.sponsorW, 34);
  assert.ok(wide.chatW > 112);
  assert.equal(wide.sideW + wide.chatW + wide.planW + wide.sponsorW + 3, 248);
  const regular = getWorkspaceLayout(130);
  assert.equal(regular.splitSponsor, false);
  assert.equal(regular.sideW + regular.chatW + regular.planW + 2, 130);
  assert.equal(getWorkspaceLayout(80).compact, true);
});

test('guided setup renders one small visual step and returns typed answers', async () => {
  let rendered = '';
  const input = new EventEmitter();
  const rawModes = [];
  input.isTTY = true;
  input.setRawMode = enabled => rawModes.push(enabled);
  input.setEncoding = () => {};
  input.resume = () => {};
  input.pause = () => {};
  const io = createVisualSetupIO({
    input,
    output: { columns: 80, rows: 24, write: text => { rendered += text; } },
  });
  io.log('OpenAI — browser sign-in');
  const answer = io.question('Choose your sign-in method');
  assert.match(rendered, /O S I N/);
  assert.match(rendered, /YOUR AI CODING WORKSPACE/);
  assert.match(rendered, /SETUP · one step at a time/);
  assert.match(rendered, /OSIN SETUP/);
  assert.match(rendered, /Choose your sign-in method/);
  assert.match(rendered, /OpenAI — browser sign-in/);
  input.emit('data', '1\r');
  assert.equal(await answer, '1');
  io.close();
  assert.deepEqual(rawModes, [true, false]);
  assert.match(rendered, /\x1b\[\?1049l/);
});
