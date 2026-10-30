'use strict';

function modelId(model) {
  const id = model?.id || model?.name;
  return typeof id === 'string' ? id.replace(/^models\//, '') : '';
}

async function listModels({ baseUrl, apiKey, fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error('No API key configured. Set OSIN_API_KEY in your OSIN .env file.');
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch. Use Node.js 18 or newer.');
  const endpoint = `${String(baseUrl || '').replace(/\/+$/, '')}/models`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`Could not reach the configured provider: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Provider model list request failed (HTTP ${response.status}). Check the base URL, API key, and provider permissions.`);
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('Provider returned invalid JSON for its model list.'); }
  const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : null;
  if (!entries) throw new Error('Provider model list response must contain a data[] or models[] array.');
  const models = [...new Set(entries.map(modelId).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!models.length) throw new Error('The provider returned no model IDs for this API key.');
  return models;
}

module.exports = { listModels };
