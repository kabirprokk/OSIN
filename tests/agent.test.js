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

test('forces a plan before tools and completes an agent tool-call loop', async () => {
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
  assert.equal(calls[0].tool_choice.function.name, 'create_plan');
  assert.equal(calls[1].messages.at(-1).role, 'tool');
  assert.equal(result.answer, 'Done.');
  assert.deepEqual(result.plan.tasks.map(task => task.status), ['pending', 'pending']);
  assert.ok(events.some(event => event.type === 'plan'));
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
