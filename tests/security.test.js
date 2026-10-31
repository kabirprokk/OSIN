'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeChildEnvironment } = require('../security');

test('does not pass API keys, tokens, passwords, or private credentials to child processes', () => {
  const safe = sanitizeChildEnvironment({
    PATH: 'path', OSIN_MODEL: 'model', OPENAI_API_KEY: 'api-secret', GITHUB_TOKEN: 'gh-token',
    AWS_SECRET_ACCESS_KEY: 'aws-secret', NPM_CONFIG_PASSWORD: 'npm-password',
  });
  assert.deepEqual(safe, { PATH: 'path', OSIN_MODEL: 'model' });
});
