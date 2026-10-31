'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveProjectPath, walkFiles, readFile, searchFiles, executeTool, commandTouchesSecretPath, commandEscapesWorkspace, snapshotWorkspace, changedSinceSnapshot, runCommand, isAgentInternalPath } = require('../agent-tools');

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-agent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.js'), 'needle here\n');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=hidden');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'ignored');
  fs.mkdirSync(path.join(root, '.codex', 'sandbox'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'sandbox', 'session.log'), 'internal codex output');
  return root;
}

test('agent paths are restricted to the selected project, including symlink escapes', t => {
  const root = project(t);
  assert.throws(() => resolveProjectPath(root, '../outside.txt'), /outside/i);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  try {
    fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
    assert.throws(() => resolveProjectPath(root, 'escape/secret.txt'), /outside/i);
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
  }
});

test('project listing and search skip secrets, symlinks, dependency folders, and Codex internals', t => {
  const root = project(t);
  const files = walkFiles(root);
  assert.deepEqual(files, ['index.js']);
  assert.match(searchFiles(root, 'needle'), /index.js:1/);
  assert.equal(searchFiles(root, 'TOKEN'), 'No matches found.');
  assert.throws(() => readFile(root, '.env'), /secret/i);
});

test('filters Codex runtime artifacts without hiding ordinary project files', () => {
  assert.equal(isAgentInternalPath('.codex/sandbox/session.log'), true);
  assert.equal(isAgentInternalPath('.\\.codex\\tmp\\run.bat'), true);
  assert.equal(isAgentInternalPath('src/codex.js'), false);
});

test('write tool requires a session authorization and writes only inside workspace', async t => {
  const root = project(t);
  let prompts = 0;
  const denied = await executeTool('write_file', { path: 'new.txt', content: 'data' }, {
    root, authorize: async () => { prompts++; return false; },
  });
  assert.match(denied, /did not approve/i);
  assert.equal(fs.existsSync(path.join(root, 'new.txt')), false);
  assert.equal(prompts, 1);
  const changed = [];
  await executeTool('write_file', { path: 'sub/new.txt', content: 'data' }, {
    root, authorize: async () => true, onEvent: event => changed.push(event),
  });
  assert.equal(fs.readFileSync(path.join(root, 'sub', 'new.txt'), 'utf8'), 'data');
  assert.deepEqual(changed, [{ type: 'file_changed', path: 'sub/new.txt', diff: '--- a/sub/new.txt\n+++ b/sub/new.txt\n+data' }]);
  await assert.rejects(executeTool('write_file', { path: '../escape.txt', content: 'x' }, { root, authorize: async () => true }), /outside/i);
});

test('command tool cannot run without session authorization', async t => {
  const root = project(t);
  let called = false;
  await executeTool('run_command', { command: 'dangerous' }, {
    root, authorize: async () => false,
    commandRunner: async () => { called = true; },
  });
  assert.equal(called, false);
});

test('workspace reads also wait for the one-time session approval', async t => {
  const root = project(t);
  let approvals = 0;
  const result = await executeTool('read_file', { path: 'index.js' }, { root, authorize: async () => { approvals++; return false; } });
  assert.match(result, /did not approve workspace access/i);
  assert.equal(approvals, 1);
});

test('blocks direct shell references to common secret files and secret writes', async t => {
  const root = project(t);
  assert.equal(commandTouchesSecretPath('Get-Content .env'), true);
  assert.equal(commandTouchesSecretPath('cat .\\secrets.json'), true);
  assert.equal(commandTouchesSecretPath('npm test'), false);
  await assert.rejects(executeTool('write_file', { path: '.env', content: 'TOKEN=x' }, { root, authorize: async () => true }), /blocks writes/i);
  await assert.rejects(executeTool('run_command', { command: 'type .env' }, { root, authorize: async () => true }), /blocked a command/i);
});

test('rejects obvious command directory escapes and supports a relative working folder', async t => {
  const root = project(t);
  fs.mkdirSync(path.join(root, 'src'));
  assert.equal(commandEscapesWorkspace('cd ..'), true);
  assert.equal(commandEscapesWorkspace('npm test'), false);
  let options;
  await executeTool('run_command', { command: 'npm test', path: 'src' }, {
    root, authorize: async () => true,
    commandRunner: async (_command, settings) => { options = settings; return 'ok'; },
  });
  assert.equal(options.cwd, fs.realpathSync(path.join(root, 'src')));
  await assert.rejects(executeTool('run_command', { command: 'npm test', path: '../outside' }, { root, authorize: async () => true }), /outside/i);
  await assert.rejects(executeTool('run_command', { command: 'cd ..' }, { root, authorize: async () => true }), /blocked/i);
});

test('todo tool updates a valid task and rejects invalid indexes', async () => {
  let update;
  const result = await executeTool('update_todo', { index: 1, status: 'completed' }, {
    root: process.cwd(), updateTodo: (index, status) => { update = [index, status]; return true; },
  });
  assert.equal(result, 'Plan updated.');
  assert.deepEqual(update, [1, 'completed']);
  await assert.rejects(executeTool('update_todo', { index: -1, status: 'completed' }, { root: process.cwd(), updateTodo: () => false }), /invalid/i);
});

test('workspace snapshots find changed, created, and deleted files without Git', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'keep.txt'), 'before');
  fs.writeFileSync(path.join(root, 'delete.txt'), 'bye');
  const before = snapshotWorkspace(root);
  fs.writeFileSync(path.join(root, 'keep.txt'), 'after');
  fs.writeFileSync(path.join(root, 'new.txt'), 'new');
  fs.unlinkSync(path.join(root, 'delete.txt'));
  const changed = changedSinceSnapshot(before, snapshotWorkspace(root));
  assert.deepEqual(new Set(changed), new Set(['keep.txt', 'new.txt', 'delete.txt']));
});

test('shell command cancellation kills the process and settles immediately', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  const controller = new AbortController();
  const pending = runCommand('long-running', { signal: controller.signal, spawnProcess: () => child, timeout: 1000 });
  controller.abort();
  await assert.rejects(pending, /cancelled/i);
  assert.equal(child.killed, true);
});

test('runs a real command in the selected workspace and returns its exit status/output', async t => {
  const root = project(t);
  const result = await runCommand(`node -e "process.stdout.write('OSIN_COMMAND_OK')"`, { cwd: root, timeout: 10_000 });
  assert.match(result, /Exit code: 0/);
  assert.match(result, /OSIN_COMMAND_OK/);
});

test('shell commands do not inherit OSIN or provider credentials', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let childEnvironment;
  const pending = runCommand('safe', {
    spawnProcess: (_command, _args, options) => { childEnvironment = options.env; return child; },
  });
  child.emit('close', 0);
  await pending;
  assert.equal('OPENAI_API_KEY' in childEnvironment, false);
  assert.equal('GITHUB_TOKEN' in childEnvironment, false);
  assert.ok(Object.values(childEnvironment).every(value => typeof value === 'string'));
});
