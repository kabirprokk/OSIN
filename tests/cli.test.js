'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'osin.js');

test('supports non-interactive help and version commands', () => {
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), require('../package.json').version);
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /osin init/);
  assert.match(help.stdout, /APPDATA/);
});

test('osin init creates per-user config and does not overwrite it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-cli-init-'));
  const appData = path.join(directory, 'roaming');
  const configFile = path.join(appData, 'OSIN', '.env');
  try {
    const first = spawnSync(process.execPath, [cli, 'init'], {
      encoding: 'utf8', env: { ...process.env, APPDATA: appData },
    });
    assert.equal(first.status, 0, first.stderr);
    assert.ok(fs.existsSync(configFile));
    assert.match(fs.readFileSync(configFile, 'utf8'), /OSIN_API_KEY=/);
    fs.writeFileSync(configFile, 'OSIN_API_KEY=keep-me\n');
    const second = spawnSync(process.execPath, [cli, 'init'], {
      encoding: 'utf8', env: { ...process.env, APPDATA: appData },
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(configFile, 'utf8'), 'OSIN_API_KEY=keep-me\n');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('interactive workspace launch fails clearly instead of waiting for input in a pipe', () => {
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8', input: '', env: { ...process.env, OSIN_DISABLE_UPDATE_CHECK: '1' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/i);
});
