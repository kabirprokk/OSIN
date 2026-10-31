'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeEnvValue, writeUserConfig, validateProviderUrl, selectWorkspace, configureProvider, loginCodex, PROVIDERS } = require('../setup');
const { EventEmitter } = require('node:events');
const { loadEnvFile } = require('../config');

test('configuration writer safely quotes keys and preserves unrelated user settings', t => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-setup-'));
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  fs.writeFileSync(path.join(config, '.env'), '# user note\nOSIN_SUPPORT_URL=https://example.test\nOSIN_MODEL=old\n');
  writeUserConfig(config, { OSIN_API_KEY: 'key with "quote" and \\ slash', OSIN_MODEL: 'new' });
  const text = fs.readFileSync(path.join(config, '.env'), 'utf8');
  assert.match(text, /OSIN_SUPPORT_URL/);
  assert.doesNotMatch(text, /OSIN_MODEL=old/);
  assert.throws(() => safeEnvValue('bad\nvalue'), /line breaks/);
  const env = {};
  loadEnvFile(path.join(config, '.env'), env);
  assert.equal(env.OSIN_API_KEY, 'key with "quote" and \\ slash');
});

test('workspace picker uses the entered directory and rejects missing paths', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-workspace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'project');
  fs.mkdirSync(sibling);
  let closed = false;
  const io = { question: async () => 'project', close: () => { closed = true; } };
  assert.equal(await selectWorkspace({ io, cwd: root }), fs.realpathSync(sibling));
  assert.equal(closed, true);
  await assert.rejects(selectWorkspace({ io: { question: async () => 'missing' }, cwd: root }), /does not exist/);
});

test('provider wizard includes presets and a custom compatible endpoint', () => {
  assert.deepEqual(PROVIDERS.map(provider => provider.name), ['OpenAI', 'OpenRouter', 'Groq', 'Together AI', 'Custom OpenAI-compatible provider']);
  assert.equal(validateProviderUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.throws(() => validateProviderUrl('http://api.example.test/v1'), /HTTPS/);
  assert.throws(() => validateProviderUrl('https://user:pass@example.test/v1'), /credentials/);
});

test('provider wizard tests tool calling before it saves API credentials', async t => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-provider-'));
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  const answers = ['2', '1', '', 'secret-key', '1'];
  const io = { question: async () => answers.shift(), close() {} };
  const result = await configureProvider({
    configDirectory: config, io,
    modelLister: async () => ['tool-model'],
    testModel: async options => { assert.equal(options.model, 'tool-model'); },
    log: () => {},
  });
  assert.equal(result.backend, 'api');
  const env = {};
  loadEnvFile(path.join(config, '.env'), env);
  assert.equal(env.OSIN_API_KEY, 'secret-key');
  assert.equal(env.OSIN_MODEL, 'tool-model');
});

test('provider wizard never saves credentials if the model lacks tool calling', async t => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-provider-bad-'));
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  const answers = ['2', '1', '', 'secret-key', 'chat-model', 'other-model', 'last-model'];
  const io = { question: async () => answers.shift(), close() {} };
  await assert.rejects(configureProvider({
    configDirectory: config, io,
    modelLister: async () => [],
    testModel: async () => { throw new Error('no tool call'); },
    log: () => {},
  }), /tool-capable model/);
  assert.equal(fs.existsSync(path.join(config, '.env')), false);
});

test('selecting OpenAI ChatGPT account sign-in runs the bundled browser auth flow', async t => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-codex-present-'));
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  let loginCalled = false;
  const result = await configureProvider({
    configDirectory: config,
    io: { question: async () => '1', close() {} },
    codexAvailable: true,
    login: async () => { loginCalled = true; },
    log: () => {},
  });
  assert.equal(loginCalled, true);
  assert.equal(result.backend, 'codex');
});

test('browser sign-in launches OSIN-bundled Codex without shell or global CLI lookup', async () => {
  const child = new EventEmitter();
  let launched;
  const pending = loginCodex({
    spawnProcess: (command, args, options) => {
      launched = { command, args, options };
      return child;
    },
  });
  child.emit('close', 0);
  await pending;
  assert.equal(launched.command, process.execPath);
  assert.match(launched.args[0], /@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
  assert.deepEqual(launched.args.slice(1), ['login']);
  assert.equal(launched.options.shell, undefined);
  assert.equal(launched.options.stdio, 'inherit');
});
