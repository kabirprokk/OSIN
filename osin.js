#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { startTui } = require('./tui');
const { getConfigDirectory, loadEnvFile } = require('./config');
const { selectWorkspace, configureProvider, createVisualSetupIO } = require('./setup');

const ESC = '\x1b[';
const dot = String.fromCharCode(0x25CF);
const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const logoPath = path.join(__dirname, 'logo-dots.json');
const packageInfo = require('./package.json');

function loadConfigurationEnvironment(env = process.env) {
  const configDir = getConfigDirectory({ env });
  loadEnvFile(path.join(configDir, '.env'), env);
  // Keep the repository-local and previous OSIEN config locations working
  // during development and for existing Windows users.
  loadEnvFile(path.join(__dirname, '.env'), env);
  if (process.platform === 'win32') loadEnvFile(path.join(env.USERPROFILE || '', 'OSIEN', '.env'), env);
  return configDir;
}

function initializeConfig(configDir = getConfigDirectory()) {
  fs.mkdirSync(configDir, { recursive: true });
  const envFile = path.join(configDir, '.env');
  if (fs.existsSync(envFile)) {
    console.log(`OSIN config already exists: ${envFile}`);
    return;
  }
  const template = [
    '# Any provider with an OpenAI-compatible Chat Completions API.',
    'OSIN_API_KEY=',
    'OSIN_BASE_URL=https://api.openai.com/v1',
    'OSIN_MODEL=gpt-4o-mini',
    '# Optional: set a compatible provider model-list endpoint at /models.',
    '# Optional: set an HTTPS support or donation page.',
    'OSIN_SUPPORT_URL=',
    '',
  ].join('\n');
  const writeOptions = { encoding: 'utf8', flag: 'wx' };
  if (process.platform !== 'win32') writeOptions.mode = 0o600;
  fs.writeFileSync(envFile, template, writeOptions);
  const sampleCampaigns = path.join(__dirname, 'sponsors.example.json');
  const userCampaigns = path.join(configDir, 'sponsors.json');
  if (!fs.existsSync(userCampaigns) && fs.existsSync(sampleCampaigns)) {
    fs.copyFileSync(sampleCampaigns, userCampaigns, fs.constants.COPYFILE_EXCL);
  }
  console.log(`Created OSIN config: ${envFile}`);
  console.log('Run `osin` to connect a provider with the guided setup. No manual config editing is needed.');
}

function showHelp() {
  console.log(`OSIN ${packageInfo.version} — AI coding assistant for your terminal

Usage:
  osin           Start the interactive terminal workspace
  osin init      Create your per-user configuration files
  osin --help    Show this help
  osin --version Show the installed version

Configuration:
  Windows: %APPDATA%\\OSIN\\.env
  macOS/Linux: $XDG_CONFIG_HOME/osin/.env (default: ~/.config/osin/.env)

Run osin and follow the guided provider and workspace setup. OSIN checks npm for
new releases in the background; type /update inside the workspace to install
an available release. Set OSIN_DISABLE_UPDATE_CHECK=1 to opt out of checks.
`);
}

async function showLogo() {
  let rows;
  try { rows = JSON.parse(fs.readFileSync(logoPath, 'utf8')); }
  catch { return; }
  const render = phase => {
    const pulse = 0.63 + 0.37 * (0.5 - 0.5 * Math.cos(phase));
    let frame = '';
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const color = rows[y][x];
        if (!color) { frame += '  '; continue; }
        const lift = pulse * 0.25;
        const rgb = color.map(channel => Math.min(255, Math.round(channel * (1 - lift) + 145 * lift)));
        frame += useColor ? `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${dot}${ESC}0m ` : `${dot} `;
      }
      frame += '\n';
    }
    process.stdout.write(frame);
  };
  if (!process.stdout.isTTY || !useColor || process.env.TERM === 'dumb') {
    for (const row of rows) console.log(row.map(color => color ? dot : ' ').join(' '));
    return;
  }
  const frames = 14;
  process.stdout.write(`${ESC}?25l`);
  try {
    render(0);
    for (let i = 1; i <= frames; i++) {
      await new Promise(resolve => setTimeout(resolve, 75));
      process.stdout.write(`${ESC}${rows.length}A`);
      render((i / frames) * Math.PI * 2);
    }
  } finally { process.stdout.write(`${ESC}?25h`); }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) return showHelp();
  if (argv.includes('--version') || argv.includes('-v')) return console.log(packageInfo.version);
  if (argv[0] === 'init') return initializeConfig();
  if (argv.length) {
    console.error(`Unknown command: ${argv[0]}\nRun osin --help for usage.`);
    process.exitCode = 2;
    return;
  }

  const configDir = loadConfigurationEnvironment();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('OSIN needs an interactive terminal. Open Windows Terminal or PowerShell and run `osin` again.');
    process.exitCode = 1;
    return;
  }
  await showLogo();
  const configuredApiKey = process.env.OSIN_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
  if (!configuredApiKey && process.env.OSIN_BACKEND !== 'codex') {
    const setupIO = createVisualSetupIO();
    try { await configureProvider({ configDirectory: configDir, io: setupIO, log: message => setupIO.log(message) }); }
    catch (error) { console.error(`Provider setup failed: ${error.message}`); process.exitCode = 1; return; }
    loadEnvFile(path.join(configDir, '.env'));
  }
  let workspace;
  try { workspace = await selectWorkspace({ io: createVisualSetupIO() }); }
  catch (error) { console.error(`Workspace selection failed: ${error.message}`); process.exitCode = 1; return; }
  const userSponsors = path.join(configDir, 'sponsors.json');
  const configuration = {
    model: process.env.OSIN_MODEL || process.env.OPENAI_MODEL || process.env.GROQ_MODEL || 'gpt-4o-mini',
    codexModel: process.env.OSIN_CODEX_MODEL || '',
    apiKey: process.env.OSIN_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '',
    baseUrl: process.env.OSIN_BASE_URL || process.env.OPENAI_BASE_URL || process.env.GROQ_BASE_URL || 'https://api.openai.com/v1',
    supportUrl: process.env.OSIN_SUPPORT_URL || '',
    backend: process.env.OSIN_BACKEND || (process.env.OSIN_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY ? 'api' : 'codex'),
    workspace,
    configDir,
    sponsorsFile: fs.existsSync(userSponsors) ? userSponsors : path.join(__dirname, 'sponsors.json'),
    metricsFile: path.join(configDir, 'metrics.json'),
  };
  startTui(configuration);
}

if (require.main === module) main().catch(error => {
  console.error(`OSIN failed to start: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { main, loadConfigurationEnvironment, initializeConfig, showHelp };
