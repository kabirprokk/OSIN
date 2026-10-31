'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const { createUnifiedDiff } = require('./diff');
const { isSensitivePath, sanitizeChildEnvironment } = require('./security');

const IGNORED = new Set(['.git', '.codex', 'node_modules', '.next', 'dist', 'build', 'coverage', 'vendor']);
const MAX_FILE_BYTES = 300_000;
const MAX_OUTPUT_CHARS = 40_000;

const TOOL_DEFINITIONS = [
  { type: 'function', function: { name: 'create_plan', description: 'Create the task plan before taking any project actions. Include concise checklist steps.', parameters: { type: 'object', properties: { title: { type: 'string' }, tasks: { type: 'array', items: { type: 'string' } } }, required: ['title', 'tasks'], additionalProperties: false } } },
  { type: 'function', function: { name: 'list_files', description: 'List non-ignored project files under a relative directory.', parameters: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a UTF-8 text file from the project. Secret files are blocked.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'search_files', description: 'Search non-ignored project files for a literal string.', parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'write_file', description: 'Create or replace a project file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'run_command', description: 'Run a shell command in the project folder or a relative subfolder. Do not change directories in the command.', parameters: { type: 'object', properties: { command: { type: 'string' }, path: { type: 'string' } }, required: ['command'], additionalProperties: false } } },
  { type: 'function', function: { name: 'update_todo', description: 'Update one plan task status. Use status pending, in_progress, or completed.', parameters: { type: 'object', properties: { index: { type: 'integer' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['index', 'status'], additionalProperties: false } } },
];

function resolveProjectPath(root, relativePath = '.') {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw new Error('Use a relative path inside the selected workspace.');
  const projectRoot = fs.realpathSync(root);
  const target = path.resolve(projectRoot, relativePath);
  const rel = path.relative(projectRoot, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('That path is outside the selected workspace.');
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('Could not resolve workspace path.');
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  const realRel = path.relative(projectRoot, realExisting);
  if (realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) throw new Error('That path resolves outside the selected workspace.');
  return target;
}

function isSecretPath(relativePath) {
  return isSensitivePath(relativePath);
}

function isAgentInternalPath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
  return normalized === '.codex' || normalized.startsWith('.codex/');
}

function walkFiles(root, relativePath = '.') {
  const projectRoot = fs.realpathSync(root);
  const start = resolveProjectPath(projectRoot, relativePath);
  if (!fs.statSync(start).isDirectory()) throw new Error('Expected a folder path.');
  try {
    const from = path.relative(projectRoot, start).split(path.sep).join('/') || '.';
    const indexed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', from], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return [...new Set(indexed.split('\0').filter(Boolean))].filter(relative => {
      if (isSecretPath(relative) || relative.split('/').some(part => IGNORED.has(part))) return false;
      try { return fs.lstatSync(resolveProjectPath(projectRoot, relative)).isFile(); } catch { return false; }
    }).slice(0, 5000);
  } catch {}
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(projectRoot, fullPath).split(path.sep).join('/');
      if (isSecretPath(relative)) continue;
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(relative);
      if (files.length >= 5000) return;
    }
  }
  walk(start);
  return files;
}

function readFile(root, relativePath) {
  if (isSecretPath(relativePath)) throw new Error('OSIN blocks common secret files by default.');
  const file = resolveProjectPath(root, relativePath);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('Read target must be a regular file.');
  if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES}-byte read limit.`);
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) throw new Error('Cannot read a binary file.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('File is not valid UTF-8 text.'); }
}

function searchFiles(root, query, relativePath = '.') {
  if (typeof query !== 'string' || !query) throw new Error('Search query cannot be empty.');
  const matches = [];
  for (const file of walkFiles(root, relativePath)) {
    let content;
    try { content = readFile(root, file); } catch { continue; }
    content.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(query)) matches.push(`${file}:${index + 1}: ${line.slice(0, 500)}`);
    });
    if (matches.length >= 200) break;
  }
  return matches.join('\n') || 'No matches found.';
}

function runCommand(command, { cwd, timeout = 120_000, onOutput = () => {}, platform = process.platform, signal, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof command !== 'string' || !command.trim()) return reject(new Error('Command cannot be empty.'));
    if (signal?.aborted) return reject(new Error('Command cancelled.'));
    const child = spawnProcess(command, [], { cwd, env: sanitizeChildEnvironment(), shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(platform === 'win32' ? { windowsVerbatimArguments: false } : {}) });
    let output = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => {
      child.kill();
      finish(new Error('Command cancelled.'));
    };
    const append = chunk => {
      const text = chunk.toString('utf8');
      output = (output + text).slice(-MAX_OUTPUT_CHARS);
      onOutput(text);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Command timed out after ${timeout} ms.\n${output}`));
    }, timeout);
    child.once('error', error => finish(new Error(`Could not start command: ${error.message}`)));
    child.once('close', code => finish(null, `Exit code: ${code ?? 'unknown'}\n${output || '(no output)'}`));
  });
}

async function executeTool(name, args, context) {
  const { root, authorize, onEvent = () => {}, commandRunner = runCommand, updateTodo = () => {}, signal } = context;
  switch (name) {
    case 'create_plan': {
      if (!Array.isArray(args.tasks) || !args.tasks.length) throw new Error('Plan must include at least one task.');
      const plan = { title: String(args.title || 'Task plan'), tasks: args.tasks.slice(0, 20).map(task => ({ text: String(task).slice(0, 300), status: 'pending' })) };
      onEvent({ type: 'plan', plan });
      return 'Plan created. Start by marking the first task in_progress, then work through the plan.';
    }
    case 'list_files':
      if (!await authorize()) return 'User did not approve workspace access for this session.';
      return walkFiles(root, args.path || '.').join('\n') || 'No project files found.';
    case 'read_file':
      if (!await authorize()) return 'User did not approve workspace access for this session.';
      return readFile(root, args.path);
    case 'search_files':
      if (!await authorize()) return 'User did not approve workspace access for this session.';
      return searchFiles(root, args.query, args.path || '.');
    case 'write_file': {
      if (typeof args.content !== 'string') throw new Error('File content must be text.');
      if (Buffer.byteLength(args.content, 'utf8') > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES}-byte write limit.`);
      if (isSecretPath(args.path)) throw new Error('OSIN blocks writes to common secret files by default.');
      const target = resolveProjectPath(root, args.path);
      if (!await authorize()) return 'User did not approve project changes for this session.';
      let before = '';
      try { before = readFile(root, args.path); } catch {}
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, args.content, 'utf8');
      const relative = path.relative(root, target).split(path.sep).join('/');
      onEvent({ type: 'file_changed', path: relative, diff: createUnifiedDiff(relative, before, args.content) });
      return `Updated ${path.relative(root, target)} (${Buffer.byteLength(args.content, 'utf8')} bytes).`;
    }
    case 'run_command': {
      if (commandTouchesSecretPath(args.command)) throw new Error('OSIN blocked a command that directly references a common secret file. Use the application to handle secrets instead.');
      if (commandEscapesWorkspace(args.command)) throw new Error('OSIN blocked a directory change or explicit outside-workspace path. Select a relative project subfolder using the command path instead.');
      if (!await authorize()) return 'User did not approve commands for this session.';
      const before = gitChanges(root);
      const cwd = resolveProjectPath(root, args.path || '.');
      if (!fs.statSync(cwd).isDirectory()) throw new Error('Command working path must be a workspace folder.');
      onEvent({ type: 'command_start', command: `${args.path ? `${args.path}> ` : ''}${args.command}` });
      const result = await commandRunner(args.command, { cwd, signal, onOutput: text => onEvent({ type: 'command_output', text }) });
      for (const changed of gitChanges(root)) if (!before.has(changed)) onEvent({ type: 'file_changed', path: changed });
      onEvent({ type: 'command_end', result });
      return result;
    }
    case 'update_todo':
      if (!updateTodo(args.index, args.status)) throw new Error('Todo index or status is invalid.');
      return 'Plan updated.';
    default: throw new Error(`Unknown agent tool: ${name}`);
  }
}

function commandTouchesSecretPath(command) {
  return /(?:^|[\s"'`/\\])(?:\.{1,2}[\\/])*?(?:\.env(?:\.[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|credentials?(?:\.[\w.-]+)?|secrets?(?:\.[\w.-]+)?|[\w.-]*(?:credential|secret)[\w.-]*\.(?:json|ya?ml|txt|env)|service-account[^\s"'`]*\.json|[\w.-]+\.(?:pem|p12|pfx|key|token|secret))(?:$|[\s"'`])/i.test(String(command));
}

function commandEscapesWorkspace(command) {
  const text = String(command);
  return /(?:^|[\s"'`=])\.\.(?:[\\/]|$)/.test(text) ||
    /(?:^|[;&|]\s*)(?:cd|chdir|pushd|popd|Set-Location)(?:\s|$)/i.test(text) ||
    /(?:^|[\s"'`=])(?:[A-Z]:[\\/]|\\\\[^\\])/i.test(text);
}

function gitChanges(root) {
  try {
    const output = execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return new Set(output.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).replace(/^"|"$/g, '')).filter(file => !isAgentInternalPath(file)));
  } catch { return new Set(); }
}

function snapshotWorkspace(root) {
  const snapshot = new Map();
  let capturedBytes = 0;
  for (const file of walkFiles(root)) {
    try {
      const fullPath = resolveProjectPath(root, file);
      const stat = fs.statSync(fullPath);
      const entry = { size: stat.size, mtimeMs: stat.mtimeMs };
      if (stat.size <= 100_000 && capturedBytes + stat.size <= 10_000_000) {
        entry.content = readFile(root, file);
        capturedBytes += stat.size;
      }
      snapshot.set(file, entry);
    } catch {}
  }
  return snapshot;
}

function changedSinceSnapshot(before, after) {
  const changed = [];
  for (const [file, current] of after) {
    const previous = before.get(file);
    if (!previous || previous.size !== current.size || previous.mtimeMs !== current.mtimeMs) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) changed.push(file);
  return changed;
}

module.exports = { TOOL_DEFINITIONS, MAX_FILE_BYTES, IGNORED, resolveProjectPath, isSecretPath, isAgentInternalPath, commandTouchesSecretPath, commandEscapesWorkspace, walkFiles, readFile, searchFiles, runCommand, gitChanges, snapshotWorkspace, changedSinceSnapshot, executeTool };
