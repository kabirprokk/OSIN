'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const packageInfo = require('../package.json');
const { listCodexModels, runCodex, parseCodexPlan, parseCodexIntent, runCodexCodingTask } = require('../codex');

test('advertises the installed OSIN version to the Codex app-server', async () => {
  const sent = [];
  let stdout;
  const spawnProcess = (_command, _args, options) => {
    const child = new EventEmitter();
    stdout = new EventEmitter();
    stdout.setEncoding = () => {};
    child.stdout = stdout;
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.stdin = {
      write(line) {
        const message = JSON.parse(line);
        sent.push(message);
        queueMicrotask(() => stdout.emit('data', `${JSON.stringify(message.id === 1
          ? { id: 1, result: {} }
          : { id: 2, result: { data: [{ id: 'gpt-test' }] } })}\n`));
      },
    };
    child.kill = () => {};
    return child;
  };

  await listCodexModels({ spawnProcess });
  assert.equal(sent[0].params.clientInfo.version, packageInfo.version);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = { end: (value) => { child.input = value; } };
  child.kill = () => { child.killed = true; };
  return child;
}

test('runs Codex with piped prompt and returns stdout on success', async () => {
  const child = fakeChild();
  let options;
  let command;
  let args;
  const result = runCodex(['exec', '-'], {
    input: 'hello',
    spawnProcess: (spawnCommand, spawnArgs, spawnOptions) => { command = spawnCommand; args = spawnArgs; options = spawnOptions; return child; },
  });
  child.stdout.emit('data', ' answer ');
  child.emit('close', 0);
  assert.equal(await result, 'answer');
  assert.equal(child.input, 'hello');
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(command, process.execPath);
  assert.match(args[0], /@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
  assert.deepEqual(args.slice(1), ['exec', '-']);
  assert.equal(options.shell, undefined);
});

test('runs the bundled Codex JavaScript entrypoint without a Windows shell', async () => {
  const child = fakeChild();
  const result = runCodex(['login', 'status'], {
    platform: 'win32',
    spawnProcess: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.match(args[0], /@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
      assert.equal(options.shell, undefined);
      return child;
    },
  });
  child.stdout.emit('data', 'logged in');
  child.emit('close', 0);
  assert.equal(await result, 'logged in');
});

test('rejects immediately when a Codex process exceeds its timeout', async () => {
  const child = fakeChild();
  const result = runCodex([], { timeout: 10, spawnProcess: () => child });
  await assert.rejects(result, /timed out/);
  assert.equal(child.killed, true);
});

test('rejects immediately when a Codex request is aborted', async () => {
  const child = fakeChild();
  const controller = new AbortController();
  const result = runCodex([], { signal: controller.signal, spawnProcess: () => child });
  controller.abort();
  await assert.rejects(result, /cancelled/);
  assert.equal(child.killed, true);
});

test('Codex coding mode plans first, then uses workspace-write only after session approval', async () => {
  const calls = [];
  const events = [];
  const result = await runCodexCodingTask({
    prompt: 'Fix the test', model: 'model-x', root: 'C:/project',
    authorize: async () => true,
    loginCheck: async () => {},
    run: async (args, options) => {
      calls.push({ args, options });
      if (calls.length === 1) return '{"intent":"coding","answer":""}';
      if (calls.length === 2) return '1. Inspect\n2. Test';
      options.onStdout(Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Fixed it.' }})}\n`));
      return 'codex output';
    },
    onEvent: event => events.push(event),
  });
  assert.deepEqual(parseCodexPlan('1. Inspect\n- Verify'), { title: 'Implementation plan', tasks: [{ text: 'Inspect', status: 'pending' }, { text: 'Verify', status: 'pending' }] });
  assert.ok(calls[0].args.includes('read-only'));
  assert.ok(calls[1].args.includes('read-only'));
  assert.ok(calls[2].args.includes('workspace-write'));
  assert.ok(calls[2].args.includes('never'));
  assert.equal(calls[2].options.cwd, 'C:/project');
  assert.equal(result.answer, 'Fixed it.');
  assert.ok(events.some(event => event.type === 'plan'));
});

test('Codex answers greetings before requesting approval or creating a plan', async () => {
  const calls = [];
  const events = [];
  const result = await runCodexCodingTask({
    prompt: 'hi', model: 'model-x', root: 'C:/project',
    authorize: async () => { throw new Error('Chat should not request workspace access'); },
    loginCheck: async () => {},
    run: async (args, options) => {
      calls.push({ args, options });
      assert.ok(args.includes('read-only'));
      assert.match(options.input, /Classify it as "conversation"/);
      return '{"intent":"conversation","answer":"Hi! How can I help?"}';
    },
    onEvent: event => events.push(event),
  });
  assert.equal(calls.length, 1);
  assert.equal(result.answer, 'Hi! How can I help?');
  assert.equal(result.plan, null);
  assert.ok(events.some(event => event.type === 'complete' && event.plan === null));
  assert.deepEqual(parseCodexIntent('{"intent":"coding","answer":""}'), { intent: 'coding', answer: '' });
});

test('Codex coding mode makes no agent calls when workspace access is denied', async () => {
  const calls = [];
  await assert.rejects(runCodexCodingTask({
    prompt: 'task', model: 'm', root: '.', authorize: async () => false,
    loginCheck: async () => {}, run: async (args, options) => { calls.push(args); return '{"intent":"coding","answer":""}'; },
  }), /not approved/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('read-only'));
});
