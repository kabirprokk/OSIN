'use strict';

const { spawn } = require('child_process');
const { sanitizeChildEnvironment } = require('./security');
const packageName = require('./package.json').name;
const registryUrl = `https://registry.npmjs.org/${packageName.replace('/', '%2f')}/latest`;

function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== installed[i]) return next[i] > installed[i];
  }
  return false;
}

async function checkForUpdate(currentVersion, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch.');
  let response;
  try {
    response = await fetchImpl(registryUrl, {
      method: 'GET',
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new Error(`Could not check npm for updates: ${error.message}`);
  }
  if (!response.ok) throw new Error(`npm update check failed (HTTP ${response.status}).`);
  let metadata;
  try { metadata = await response.json(); }
  catch { throw new Error('npm returned invalid update metadata.'); }
  if (!parseVersion(metadata?.version)) throw new Error('npm returned an invalid stable version.');
  return { latest: metadata.version, updateAvailable: isNewerVersion(metadata.version, currentVersion) };
}

function runNpmInstall(version) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(command, ['install', '--global', `${packageName}@${version}`], {
      shell: process.platform === 'win32',
      windowsHide: true,
      env: sanitizeChildEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.once('error', error => reject(new Error(`Could not start npm: ${error.message}`)));
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code ?? 'unknown'}.${stderr.trim() ? ` ${stderr.trim()}` : ''}`));
    });
  });
}

async function installUpdate(version, install = runNpmInstall) {
  if (!parseVersion(version)) throw new Error('Refusing to install an invalid version string.');
  await install(version);
}

module.exports = { isNewerVersion, checkForUpdate, installUpdate };
