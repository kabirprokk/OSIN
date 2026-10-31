'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectSessionFile, loadProjectSessions, saveProjectSessions } = require('../session-store');

test('saves and reloads chats independently per canonical workspace', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-store-'));
  const config = path.join(root, 'config');
  const first = path.join(root, 'one');
  const second = path.join(root, 'two');
  fs.mkdirSync(first); fs.mkdirSync(second);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessions = [{ title: 'Feature work', messages: [{ role: 'user', content: 'make it work' }], plan: { title: 'Plan', tasks: [] }, changedFiles: ['a.js'], usage: { requests: 1 } }];
  saveProjectSessions(config, first, sessions);
  assert.notEqual(projectSessionFile(config, first), projectSessionFile(config, second));
  assert.equal(loadProjectSessions(config, first)[0].title, 'Feature work');
  assert.deepEqual(loadProjectSessions(config, second), []);
});

test('ignores corrupt session data and bounds restored message history', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-store-corrupt-'));
  const workspace = path.join(root, 'project');
  const config = path.join(root, 'config');
  fs.mkdirSync(workspace);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = projectSessionFile(config, workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(loadProjectSessions(config, workspace), []);
});
