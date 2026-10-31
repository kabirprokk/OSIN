'use strict';

function protocolFor(baseUrl) {
  let hostname = '';
  try { hostname = new URL(baseUrl).hostname.toLowerCase(); } catch {}
  return hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com') ? 'anthropic' : 'openai';
}

function createRequest({ baseUrl, apiKey, model, messages, tools, toolChoice = 'auto', temperature = 0.2, stream = true }) {
  const protocol = protocolFor(baseUrl);
  const root = String(baseUrl || '').replace(/\/+$/, '');
  if (protocol === 'anthropic') {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
    return {
      url: `${root}/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model,
        max_tokens: 8192,
        ...(system ? { system } : {}),
        messages: anthropicMessages(messages),
        tools: tools.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })),
        tool_choice: typeof toolChoice === 'object' ? { type: 'tool', name: toolChoice.function.name } : { type: 'auto' },
        temperature,
        stream,
      },
    };
  }
  return {
    url: `${root}/chat/completions`,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: { model, messages, tools, tool_choice: toolChoice, temperature, stream },
  };
}

function anthropicMessages(messages) {
  const result = [];
  let toolResults = [];
  const flush = () => {
    if (!toolResults.length) return;
    result.push({ role: 'user', content: toolResults });
    toolResults = [];
  };
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      toolResults.push({ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content });
      continue;
    }
    flush();
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const content = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.tool_calls) {
        let input = {};
        try { input = JSON.parse(call.function.arguments || '{}'); } catch {}
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
      }
      result.push({ role: 'assistant', content });
      continue;
    }
    result.push({ role: message.role, content: message.content || '' });
  }
  flush();
  return result;
}

function parseAnthropicMessage(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const text = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
  const tool_calls = blocks.filter(block => block.type === 'tool_use' && typeof block.name === 'string').map(block => ({
    id: block.id,
    type: 'function',
    function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
  }));
  return { role: 'assistant', content: text, ...(tool_calls.length ? { tool_calls } : {}) };
}

async function readAnthropicStream(response, onText = () => {}) {
  if (!response.body?.getReader || /application\/json/i.test(response.headers?.get?.('content-type') || '')) {
    const message = parseAnthropicMessage(await response.json());
    if (message.content) onText(message.content);
    return message;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const blocks = [];
  let buffer = '';
  let gotMessage = false;
  const consume = event => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    if (payload.type === 'content_block_start') {
      const index = payload.index;
      blocks[index] = payload.content_block?.type === 'tool_use'
        ? { type: 'tool_use', id: payload.content_block.id, name: payload.content_block.name, arguments: '' }
        : { type: 'text', text: payload.content_block?.text || '' };
      if (blocks[index].type === 'text' && blocks[index].text) onText(blocks[index].text);
      gotMessage = true;
    }
    if (payload.type !== 'content_block_delta') return;
    const block = blocks[payload.index];
    if (payload.delta?.type === 'text_delta' && block?.type === 'text') {
      block.text += payload.delta.text;
      onText(payload.delta.text);
      gotMessage = true;
    }
    if (payload.delta?.type === 'input_json_delta' && block?.type === 'tool_use') {
      block.arguments += payload.delta.partial_json || '';
      gotMessage = true;
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    events.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!gotMessage) throw new Error('Provider returned an empty stream.');
  return parseAnthropicMessage({ content: blocks.map(block => block?.type === 'tool_use'
    ? { type: 'tool_use', id: block.id, name: block.name, input: parseJson(block.arguments) }
    : block && { type: 'text', text: block.text }).filter(Boolean) });
}

function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

module.exports = { protocolFor, createRequest, anthropicMessages, parseAnthropicMessage, readAnthropicStream };
