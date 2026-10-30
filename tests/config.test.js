'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfigDirectory, loadEnvFile } = require('../config');

test('uses APPDATA for the Windows per-user configuration directory', () => {
  assert.equal(getConfigDirectory({ platform: 'win32', env: { APPDATA: 'C:/Users/test/AppData/Roaming' }, home: 'C:/Users/test' }), require('node:path').win32.join('C:/Users/test/AppData/Roaming', 'OSIN'));
});

test('uses XDG_CONFIG_HOME on Unix and defaults to ~/.config', () => {
  assert.equal(getConfigDirectory({ platform: 'linux', env: { XDG_CONFIG_HOME: '/tmp/config' }, home: '/home/test' }), '/tmp/config/osin');
  assert.equal(getConfigDirectory({ platform: 'darwin', env: {}, home: '/Users/test' }), '/Users/test/.config/osin');
});

test('loads dotenv entries without overriding values already in the environment', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-config-'));
  const file = path.join(directory, '.env');
  fs.writeFileSync(file, '# comment\nGROQ_API_KEY="example-key"\nOSIN_MODEL=custom-model\nINVALID LINE\n');
  const env = { OSIN_MODEL: 'already-set' };
  try {
    loadEnvFile(file, env);
    assert.equal(env.GROQ_API_KEY, 'example-key');
    assert.equal(env.OSIN_MODEL, 'already-set');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
