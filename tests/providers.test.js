'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listModels } = require('../providers');

test('lists and sorts model IDs from an OpenAI-compatible provider', async () => {
  let request;
  const result = await listModels({
    baseUrl: 'https://api.example.test/v1/', apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ data: [{ id: 'zeta' }, { id: 'alpha' }] }) };
    },
  });
  assert.deepEqual(result, ['alpha', 'zeta']);
  assert.equal(request.url, 'https://api.example.test/v1/models');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
});

test('accepts data and models response shapes and removes duplicate IDs', async () => {
  const result = await listModels({ baseUrl: 'https://example.test/v1', apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: 'models/gamma' }, { id: 'beta' }, { id: 'beta' }] }) }) });
  assert.deepEqual(result, ['beta', 'gamma']);
});

test('lists Anthropic models with native API authentication headers', async () => {
  let request;
  const result = await listModels({
    baseUrl: 'https://api.anthropic.com/v1', apiKey: 'anthropic-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ data: [{ id: 'claude-sonnet-4' }, { id: 'claude-haiku-4' }] }) };
    },
  });
  assert.deepEqual(result, ['claude-haiku-4', 'claude-sonnet-4']);
  assert.equal(request.url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.equal(request.options.headers['x-api-key'], 'anthropic-secret');
  assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.options.headers.Authorization, undefined);
});

test('reports missing credentials and provider HTTP errors safely', async () => {
  await assert.rejects(listModels({ baseUrl: 'https://example.test/v1', apiKey: '' }), /API key/);
  await assert.rejects(listModels({ baseUrl: 'https://example.test/v1', apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'secret-bearing body' }) }), /HTTP 403/);
});
