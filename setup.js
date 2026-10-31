'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { listModels } = require('./providers');
const { spawnCodex } = require('./codex');
const { fitText } = require('./terminal');

const PROVIDERS = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { name: 'Together AI', url: 'https://api.together.xyz/v1' },
  { name: 'Custom OpenAI-compatible provider', url: '' },
];

function createVisualSetupIO({ input = process.stdin, output = process.stdout } = {}) {
  const notes = [];
  let step = 0;
  let currentPrompt = '';
  let closed = false;
  let answer = '';
  let pending = null;
  const onData = chunk => {
    if (!pending) return;
    for (const char of String(chunk)) {
      if (char === '\x03') {
        const reject = pending.reject;
        pending = null;
        close();
        reject(new Error('Setup cancelled.'));
        return;
      }
      if (char === '\r' || char === '\n') {
        const resolve = pending.resolve;
        const result = answer;
        pending = null;
        render();
        answer = '';
        resolve(result);
        return;
      }
      if (char === '\x7f' || char === '\b') {
        answer = [...answer].slice(0, -1).join('');
        continue;
      }
      if (char >= ' ' && char !== '\x7f' && char !== '\x1b') answer += char;
    }
    render();
  };
  output.write('\x1b[?1049h\x1b[?25h');
  if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(true);
  input.setEncoding?.('utf8');
  input.on('data', onData);
  input.resume?.();
  const render = () => {
    const width = Math.max(32, output.columns || 80);
    const height = Math.max(12, output.rows || 24);
    const lines = [
      '\x1b[38;2;174;146;218m  O S I N  \x1b[0m',
      '\x1b[38;2;218;218;222m  YOUR AI CODING WORKSPACE \x1b[0m',
      '\x1b[38;2;132;134;142m  SETUP · one step at a time \x1b[0m',
      '\x1b[38;2;54;54;60m' + '─'.repeat(Math.max(1, width - 2)) + '\x1b[0m',
      '',
      ...(height > 14 ? notes.slice(-(height - 14)) : []).map(line => fitText(line, width - 4)),
      '',
      `OSIN SETUP  ·  STEP ${String(step).padStart(2, '0')}`,
      fitText(currentPrompt, width - 4),
      '',
      '\x1b[38;2;132;134;142mEnter a choice, path, or value · Ctrl+C to cancel\x1b[0m',
      '',
      `› ${fitText(answer, width - 6)}`,
    ];
    output.write(`\x1b[2J\x1b[H${lines.slice(0, height - 1).join('\r\n')}`);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    input.removeListener('data', onData);
    input.pause?.();
    if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(false);
    output.write('\x1b[?25h\x1b[?1049l');
  };
  return {
    question(prompt) {
      if (closed) return Promise.reject(new Error('Setup screen is closed.'));
      currentPrompt = String(prompt);
      step++;
      answer = '';
      render();
      return new Promise((resolve, reject) => { pending = { resolve, reject }; });
    },
    log(message) {
      notes.push(String(message));
      if (notes.length > 100) notes.shift();
    },
    beforeExternal: close,
    close,
  };
}

function safeEnvValue(value) {
  const text = String(value ?? '');
  if (/[\r\n\0]/.test(text)) throw new Error('Configuration values cannot contain line breaks.');
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function writeUserConfig(configDirectory, values) {
  fs.mkdirSync(configDirectory, { recursive: true });
  const file = path.join(configDirectory, '.env');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = existing.split(/\r?\n/).filter(line => !/^(?:OSIN_API_KEY|OSIN_BASE_URL|OSIN_MODEL|OSIN_CODEX_MODEL|OSIN_BACKEND)=/.test(line.trim()));
  for (const [key, value] of Object.entries(values)) {
    if (!['OSIN_API_KEY', 'OSIN_BASE_URL', 'OSIN_MODEL', 'OSIN_CODEX_MODEL', 'OSIN_BACKEND'].includes(key)) throw new Error(`Unsupported config key: ${key}`);
    lines.push(`${key}=${safeEnvValue(value)}`);
  }
  const content = `${lines.filter(Boolean).join('\n')}\n`;
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'w', ...(process.platform === 'win32' ? {} : { mode: 0o600 }) });
  fs.renameSync(temporary, file);
  return file;
}

function validateProviderUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid provider URL.'); }
  if (url.username || url.password) throw new Error('Put credentials in the API key field, not in the provider URL.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Provider URL must use HTTPS. Localhost HTTP endpoints are allowed for local models.');
  }
  return url.toString().replace(/\/$/, '');
}

async function selectWorkspace({ io, cwd = process.cwd() }) {
  const starting = path.resolve(cwd);
  try {
    const answer = (await io.question(`Workspace folder [${starting}]: `)).trim();
    const folder = path.resolve(starting, answer || starting);
    let stat;
    try { stat = fs.statSync(folder); }
    catch { throw new Error(`Workspace folder does not exist: ${folder}`); }
    if (!stat.isDirectory()) throw new Error(`Workspace path is not a folder: ${folder}`);
    return fs.realpathSync(folder);
  } finally { io.close?.(); }
}

function loginCodex({ spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnCodex(['login'], { stdio: 'inherit' }, spawnProcess); }
    catch (error) { reject(error); return; }
    child.once('error', error => reject(new Error(`Could not start OpenAI browser sign-in: ${error.message}`)));
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Codex sign-in exited with status ${code}.`)));
  });
}

function hasCodexCli() {
  try {
    require.resolve('@openai/codex/bin/codex.js');
    return true;
  } catch { return false; }
}

async function configureProvider({ configDirectory, io = readline.createInterface({ input: process.stdin, output: process.stdout }), env = process.env, login = loginCodex, codexAvailable = hasCodexCli(), modelLister = listModels, testModel = require('./agent').testAgentModel, log = console.log }) {
  try {
    let useCodex = false;
    if (codexAvailable) {
      const choice = (await io.question('Connect an AI provider: [1] OpenAI — sign in with your ChatGPT account (opens browser)  [2] API key/provider  [1]: ')).trim() || '1';
      if (choice !== '1' && choice !== '2') throw new Error('Choose 1 or 2.');
      useCodex = choice === '1';
    } else {
      log('OSIN’s built-in OpenAI sign-in component is unavailable. You can still connect using an API key/provider.');
    }
    if (useCodex) {
      await io.beforeExternal?.();
      await login();
      writeUserConfig(configDirectory, { OSIN_BACKEND: 'codex' });
      return { backend: 'codex' };
    }
    log('Choose API-key provider (ChatGPT account sign-in is the first option above):');
    PROVIDERS.forEach((provider, index) => log(`  ${index + 1}. ${provider.name}`));
    const selected = Number((await io.question('Provider [1]: ')).trim() || 1);
    if (!Number.isInteger(selected) || selected < 1 || selected > PROVIDERS.length) throw new Error('Choose one of the listed providers.');
    const preset = PROVIDERS[selected - 1];
    const baseUrl = (await io.question(`API base URL [${preset.url || 'https://.../v1'}]: `)).trim() || preset.url;
    const safeBaseUrl = validateProviderUrl(baseUrl);
    const apiKey = (await io.question('API key (saved to your OSIN user config): ')).trim();
    if (!apiKey) throw new Error('API key cannot be empty.');
    const config = { baseUrl, apiKey };
    let models = [];
    try { models = await modelLister({ baseUrl: safeBaseUrl, apiKey }); }
    catch (error) { log(`Could not load models yet: ${error.message}`); }
    let model;
    if (models.length) {
      log('Models with tool calling are required. Showing up to 8; you can also enter a model ID.');
      models.slice(0, 8).forEach((name, index) => log(`  ${index + 1}. ${name}`));
      const selection = (await io.question(`Model number or ID [1]: `)).trim() || '1';
      model = /^\d+$/.test(selection) ? models[Number(selection) - 1] : selection;
      if (!model) throw new Error('Select a listed model or enter a model ID.');
    } else {
      model = (await io.question('Model ID (must support tool/function calling): ')).trim();
      if (!model) throw new Error('Model ID cannot be empty.');
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await testModel({ baseUrl: safeBaseUrl, apiKey, model });
        break;
      } catch (error) {
        log(`That model cannot run OSIN agent tools: ${error.message}`);
        if (attempt === 2) throw new Error('Provider setup stopped because no tool-capable model was verified.');
        const replacement = (await io.question('Enter another model ID or list number: ')).trim();
        if (!replacement) throw new Error('Choose a model with tool/function-calling support.');
        model = /^\d+$/.test(replacement) ? models[Number(replacement) - 1] : replacement;
        if (!model) throw new Error('Choose a valid model ID.');
      }
    }
    writeUserConfig(configDirectory, { OSIN_BACKEND: 'api', OSIN_API_KEY: apiKey, OSIN_BASE_URL: safeBaseUrl, OSIN_MODEL: model });
    return { backend: 'api', apiKey, baseUrl: safeBaseUrl, model };
  } finally {
    if (io !== process.stdin && typeof io.close === 'function') io.close();
  }
}

module.exports = { PROVIDERS, createVisualSetupIO, safeEnvValue, writeUserConfig, validateProviderUrl, selectWorkspace, loginCodex, hasCodexCli, configureProvider };
