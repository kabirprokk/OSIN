'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { protocolFor, createRequest, anthropicMessages, parseAnthropicMessage, readAnthropicStream } = require('../provider-protocol');

test('routes Anthropic hosts to the native Messages API and converts tool schemas', () => {
  const request = createRequest({
    baseUrl: 'https://api.anthropic.com/v1/',
    apiKey: 'secret',
    model: 'claude-sonnet-4',
    messages: [{ role: 'system', content: 'OSIN system' }, { role: 'user', content: 'Fix this' }],
    tools: [{ function: { name: 'create_plan', description: 'Plan', parameters: { type: 'object' } } }],
    toolChoice: { type: 'function', function: { name: 'create_plan' } },
  });
  assert.equal(protocolFor('https://api.anthropic.com/v1'), 'anthropic');
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(request.headers, { 'content-type': 'application/json', 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' });
  assert.equal(request.body.system, 'OSIN system');
  assert.deepEqual(request.body.messages, [{ role: 'user', content: 'Fix this' }]);
  assert.deepEqual(request.body.tools, [{ name: 'create_plan', description: 'Plan', input_schema: { type: 'object' } }]);
  assert.deepEqual(request.body.tool_choice, { type: 'tool', name: 'create_plan' });
});

test('converts assistant tool calls and their results into Anthropic conversation blocks', () => {
  assert.deepEqual(anthropicMessages([
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'Fix this' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'contents' },
    { role: 'assistant', content: 'Done.' },
  ]), [
    { role: 'user', content: 'Fix this' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.js' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'contents' }] },
    { role: 'assistant', content: 'Done.' },
  ]);
});

test('converts Anthropic tool-use responses into OSIN tool calls', () => {
  assert.deepEqual(parseAnthropicMessage({ content: [
    { type: 'text', text: 'Plan first.' },
    { type: 'tool_use', id: 'tool-1', name: 'create_plan', input: { title: 'Fix', tasks: ['Test'] } },
  ] }), {
    role: 'assistant',
    content: 'Plan first.',
    tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'create_plan', arguments: '{"title":"Fix","tasks":["Test"]}' } }],
  });
});

test('reads Anthropic text and partial tool-call JSON from SSE events', async () => {
  const events = [
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Hello"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"read_file","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\\"path\\\":\\\"a.js\\\"}"}}\n\n',
  ];
  const bytes = new TextEncoder().encode(events.join(''));
  let read = false;
  const text = [];
  const message = await readAnthropicStream({
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: bytes }) }) },
  }, value => text.push(value));
  assert.equal(message.content, 'Hello there');
  assert.equal(message.tool_calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { path: 'a.js' });
  assert.deepEqual(text, ['Hello', ' there']);
});
