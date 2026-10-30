'use strict';

const fs = require('fs');
const path = require('path');

function getConfigDirectory(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || require('os').homedir();
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return paths.join(env.APPDATA || paths.join(home, 'AppData', 'Roaming'), 'OSIN');
  return paths.join(env.XDG_CONFIG_HOME || paths.join(home, '.config'), 'osin');
}

function loadEnvFile(file, env = process.env) {
  let contents;
  try { contents = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
  catch { return false; }
  for (const line of contents.split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!entry || env[entry[1]]) continue;
    let value = entry[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[entry[1]] = value;
  }
  return true;
}

module.exports = { getConfigDirectory, loadEnvFile };
