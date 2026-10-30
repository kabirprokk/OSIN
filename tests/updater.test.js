'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewerVersion, checkForUpdate, installUpdate } = require('../updater');

test('compares stable semantic versions numerically', () => {
  assert.equal(isNewerVersion('1.0.10', '1.0.9'), true);
  assert.equal(isNewerVersion('1.0.1', '1.0.1'), false);
  assert.equal(isNewerVersion('1.0.0', '1.0.1'), false);
  assert.equal(isNewerVersion('1.2.0', '1.1.99'), true);
});

test('checks the public npm latest tag without sending user data', async () => {
  let request;
  const result = await checkForUpdate('1.0.1', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ version: '1.0.2' }) };
  });
  assert.equal(result.latest, '1.0.2');
  assert.equal(result.updateAvailable, true);
  assert.match(request.url, /registry\.npmjs\.org/);
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.body, undefined);
});

test('handles current releases and unavailable registry data safely', async () => {
  const current = await checkForUpdate('1.0.2', async () => ({ ok: true, json: async () => ({ version: '1.0.2' }) }));
  assert.equal(current.updateAvailable, false);
  await assert.rejects(checkForUpdate('1.0.2', async () => ({ ok: false, status: 503 })), /HTTP 503/);
});

test('installs only validated versions through the npm installer', async () => {
  let requestedVersion;
  await installUpdate('1.0.3', async version => { requestedVersion = version; });
  assert.equal(requestedVersion, '1.0.3');
  await assert.rejects(installUpdate('1.0.3; whoami', async () => {}), /invalid version/i);
});
