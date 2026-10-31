'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');
const { readStream, runAgent, testAgentModel } = require('../agent');

function jsonResponse(message) {
  return { ok: true, json: async () => ({ choices: [{ message }] }) };
}

test('reassembles streamed text and tool calls across split server-sent events', async () => {
  const events = [
    'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_","arguments":"{\\\"path\\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"\\\"a.js\\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const body = new ReadableStream({
    pull(controller) {
      if (events.length) controller.enqueue(new TextEncoder().encode(events.shift()));
      else controller.close();
    },
  });
  let streamed = '';
  const message = await readStream({ body }, text => { streamed += text; });
  assert.equal(streamed, 'hello ');
  assert.equal(message.tool_calls[0].function.name, 'read_file');
  assert.equal(JSON.parse(message.tool_calls[0].function.arguments).path, 'a.js');
});

test('lets the model understand intent, then plans before project tools', async () => {
  const calls = [];
  const events = [];
  const replies = [
    jsonResponse({ role: 'assistant', tool_calls: [{ id: 'plan1', type: 'function', function: { name: 'create_plan', arguments: JSON.stringify({ title: 'Fix it', tasks: ['Inspect', 'Test'] }) } }] }),
    jsonResponse({ role: 'assistant', tool_calls: [{ id: 'read1', type: 'function', function: { name: 'read_file', arguments: '{"path":"index.js"}' } }] }),
    jsonResponse({ role: 'assistant', content: 'Done.' }),
  ];
  const result = await runAgent({
    messages: [{ role: 'user', content: 'Fix it' }], baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'tool-model', root: process.cwd(),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return replies.shift();
    },
    toolExecutor: async (name, args) => `${name}:${args.path || args.title}`,
    onEvent: event => events.push(event),
  });
  assert.equal(calls[0].tool_choice, 'auto');
  assert.equal(calls[1].messages.at(-1).role, 'tool');
  assert.equal(result.answer, 'Done.');
  assert.deepEqual(result.plan.tasks.map(task => task.status), ['pending', 'pending']);
  assert.ok(events.some(event => event.type === 'plan'));
});

test('answers a greeting directly without creating a plan or using tools', async () => {
  let callCount = 0;
  const result = await runAgent({
    messages: [{ role: 'user', content: 'hi' }], baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'chat-model',
    fetchImpl: async (_url, options) => {
      callCount++;
      const body = JSON.parse(options.body);
      assert.equal(body.tool_choice, 'auto');
      assert.match(body.messages[0].content, /greetings.*respond naturally and directly/is);
      return jsonResponse({ role: 'assistant', content: 'Hi! How can I help you today?' });
    },
    toolExecutor: async () => { throw new Error('A greeting must not invoke tools'); },
  });
  assert.equal(callCount, 1);
  assert.equal(result.answer, 'Hi! How can I help you today?');
  assert.equal(result.plan, null);
});

test('reports provider errors and stops at its tool-round safety limit', async () => {
  await assert.rejects(runAgent({ messages: [], apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'm', fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'bad key' }) }), /HTTP 401/);
  const replies = [
    jsonResponse({ role: 'assistant', tool_calls: [{ id: 'p', function: { name: 'create_plan', arguments: '{"title":"t","tasks":["a"]}' } }] }),
    jsonResponse({ role: 'assistant', tool_calls: [{ id: 'r', function: { name: 'read_file', arguments: '{"path":"a"}' } }] }),
  ];
  await assert.rejects(runAgent({
    messages: [], apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'm', maxRounds: 1,
    fetchImpl: async () => replies.shift(), toolExecutor: async () => 'ok',
  }), /safety limit/);
});

test('model check verifies function calling instead of merely checking HTTP success', async () => {
  const accepted = await testAgentModel({
    baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'works',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.tool_choice.function.name, 'create_plan');
      return jsonResponse({ role: 'assistant', tool_calls: [{ id: 'p', function: { name: 'create_plan', arguments: '{}' } }] });
    },
  });
  assert.equal(accepted, true);
  await assert.rejects(testAgentModel({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'chat-only', fetchImpl: async () => jsonResponse({ role: 'assistant', content: 'I can chat' }) }), /tool\/function-calling support/);
});

test('Anthropic agent keeps native auth and completes plan/tool-result round trips', async () => {
  const calls = [];
  const replies = [
    { content: [{ type: 'tool_use', id: 'plan-1', name: 'create_plan', input: { title: 'Inspect', tasks: ['Read'] } }] },
    { content: [{ type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: 'README.md' } }] },
    { content: [{ type: 'text', text: 'Finished.' }] },
  ];
  const result = await runAgent({
    messages: [{ role: 'user', content: 'Inspect this project' }],
    baseUrl: 'https://api.anthropic.com/v1', apiKey: 'anthropic-key', model: 'claude-sonnet-4', root: process.cwd(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => replies.shift() };
    },
    toolExecutor: async name => `${name} result`,
  });
  assert.equal(result.answer, 'Finished.');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'], 'anthropic-key');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].body.messages.at(-2).role, 'assistant');
  assert.equal(calls[1].body.messages.at(-2).content[0].type, 'tool_use');
  assert.deepEqual(calls[1].body.messages.at(-1).content, [{ type: 'tool_result', tool_use_id: 'plan-1', content: 'create_plan result' }]);
  assert.deepEqual(calls[2].body.messages.at(-1).content, [{ type: 'tool_result', tool_use_id: 'read-1', content: 'read_file result' }]);
});

test('Anthropic model check uses native Messages API forced tool choice', async () => {
  const accepted = await testAgentModel({
    baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k', model: 'claude-sonnet-4',
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.deepEqual(body.tool_choice, { type: 'tool', name: 'create_plan' });
      assert.equal(body.stream, false);
      return { ok: true, json: async () => ({ content: [{ type: 'tool_use', id: 'p', name: 'create_plan', input: { title: 'Ready', tasks: [] } }] }) };
    },
  });
  assert.equal(accepted, true);
});
