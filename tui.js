// Dependency-free, mouse-enabled OSIN terminal workspace.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { loadCampaigns, chooseCampaign, recordAggregate } = require('./sponsors');
const { getConfigDirectory } = require('./config');
const { listModels } = require('./providers');
const { runAgent, testAgentModel } = require('./agent');
const { loadProjectSessions, saveProjectSessions } = require('./session-store');
const { gitChanges, readFile: readProjectFile, isSecretPath, resolveProjectPath, snapshotWorkspace, changedSinceSnapshot } = require('./agent-tools');
const { createUnifiedDiff } = require('./diff');
const { configureProvider, writeUserConfig, createVisualSetupIO } = require('./setup');
const { checkForUpdate, installUpdate } = require('./updater');
const { askCodex, checkLogin, isUnsupportedCodexModelError, listCodexModels, runCodexCodingTask, spawnCodex } = require('./codex');
const packageInfo = require('./package.json');
const { displayWidth, fitText, wrapText } = require('./terminal');
const { COMMANDS, getCommandSuggestions } = require('./commands');
const { createSession } = require('./state');
const {
  createPasteAttachment,
  formatPrompt,
  readTextAttachment,
  totalAttachmentBytes,
  trimRequestHistory,
  MAX_TOTAL_ATTACHMENT_BYTES,
} = require('./composer');

const ESC = '\x1b[';
const EL = String.fromCharCode(0x2500);
const V = String.fromCharCode(0x2502);
const TL = String.fromCharCode(0x250c);
const TR = String.fromCharCode(0x2510);
const BL = String.fromCharCode(0x2514);
const BR = String.fromCharCode(0x2518);
const DOT = String.fromCharCode(0x25cf);
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const colors = {
  // Reset only the foreground: SGR 0 would also drop the OSIN background,
  // leaving differently colored strips after individual UI labels.
  reset: '\x1b[39m', purple: '\x1b[38;2;174;146;218m', muted: '\x1b[38;2;132;134;142m',
  text: '\x1b[38;2;218;218;222m', cyan: '\x1b[38;2;180;180;186m', green: '\x1b[38;2;180;170;192m',
  bg: '\x1b[48;2;8;8;10m', panel: '\x1b[48;2;14;14;17m', border: '\x1b[38;2;54;54;60m',
};
const paint = (value, color) => `${color}${value}${colors.reset}`;
function getTerminalDimensions(stream, fallback = { columns: 100, rows: 30 }) {
  let columns = 0;
  let rows = 0;
  try {
    const size = stream.getWindowSize?.();
    if (Array.isArray(size)) [columns, rows] = size;
  } catch {}
  columns ||= stream.columns;
  rows ||= stream.rows;
  return {
    columns: Number.isFinite(columns) && columns > 0 ? columns : fallback.columns,
    rows: Number.isFinite(rows) && rows > 0 ? rows : fallback.rows,
  };
}
function getWorkspaceLayout(width) {
  const w = Math.max(1, Math.floor(width));
  const compact = w < 88;
  if (compact) return { compact, sideW: 0, chatW: w, planW: 0, sponsorW: 0, splitSponsor: false };
  const sideW = Math.max(19, Math.min(23, Math.floor(w * 0.2)));
  const planW = Math.max(24, Math.min(36, Math.floor(w * 0.16)));
  const withoutSponsor = w - sideW - planW - 2;
  const extra = withoutSponsor - 113;
  const splitSponsor = extra >= 30;
  const sponsorW = splitSponsor ? Math.min(extra, 34) : 0;
  const chatW = splitSponsor ? w - sideW - planW - sponsorW - 3 : withoutSponsor;
  return { compact, sideW, chatW: Math.max(24, chatW), planW, sponsorW, splitSponsor };
}
function validHttpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null; }
  catch { return null; }
}

function startTui({ model, apiKey, baseUrl, sponsorsFile, metricsFile, openUrl, supportUrl, codexModel, backend, workspace = process.cwd(), configDir = getConfigDirectory() }) {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY || !input.setRawMode) {
    console.error('OSIN workspace needs an interactive terminal. Try Windows Terminal or the VS Code terminal.');
    process.exitCode = 1;
    return;
  }

  const restoredSessions = loadProjectSessions(configDir, workspace);
  const state = {
    model,
    view: 'chat',
    focus: 'composer',
    text: '',
    caret: 0,
    busy: false,
    scroll: 0,
    started: false,
    sessions: restoredSessions.length ? restoredSessions.map(session => ({ ...createSession(), ...session, attachments: [] })) : [createSession()],
    active: Math.max(0, restoredSessions.length - 1),
    sponsor: chooseCampaign(loadCampaigns(sponsorsFile || path.join(__dirname, 'sponsors.json'))),
    sponsorVisible: true,
    supportUrl: validHttpsUrl(supportUrl),
    metricsPath: metricsFile || path.join(getConfigDirectory(), 'metrics.json'),
    closed: false,
    buffer: '',
    pasteBuffer: '',
    pasting: false,
    pasteOverflow: false,
    notice: '',
    backend: backend || (apiKey ? 'api' : 'codex'),
    codexModel: codexModel || '',
    modelPicker: null,
    pendingApproval: null,
    approvalStatus: null,
    taskController: null,
    streamingText: '',
    diffText: '',
    outputScroll: 0,
    unsupportedModels: new Set(),
  };
  const width = () => getTerminalDimensions(output).columns;
  const height = () => getTerminalDimensions(output).rows;
  let resizeTimer;
  const move = (x, y) => `${ESC}${y};${x}H`;
  const clearLine = `${ESC}2K`;
  const visibleWidth = displayWidth;
  const fit = fitText;
  const activeSession = () => state.sessions[state.active];
  function persistSessions() {
    try { saveProjectSessions(configDir, workspace, state.sessions); }
    catch (error) { state.notice = `Could not save project sessions: ${error.message}`; }
  }
  function recordActivity(content) {
    activeSession().messages.push({ role: 'activity', content: String(content).slice(0, 2000) });
    persistSessions();
  }

  function draw() {
    if (state.closed) return;
    const w = width();
    const h = height();
    const { compact, sideW, chatW, planW: adW, sponsorW, splitSponsor } = getWorkspaceLayout(w);
    const chatX = sideW ? sideW + 2 : 1;
    const adX = sideW ? sideW + chatW + 3 : 0;
    const sponsorX = splitSponsor ? adX + adW + 1 : 0;
    const chatTop = 3;
    const inputY = Math.max(4, h - 8);
    const frameBottom = Math.min(h, inputY + 4);
    const lines = [];
    const put = (x, y, value) => {
      if (y < 1 || y > h || x < 1 || x > w) return;
      const remaining = w - x + 1;
      const clipped = visibleWidth(value) > remaining ? fit(value, remaining) : value;
      lines.push(move(x, y) + clipped);
    };
    // Repaint the full frame so resized columns and shorter content cannot
    // leave stale borders or blocks at the bottom of the terminal.
    // Synchronized output makes the in-place repaint appear as one frame
    // instead of flashing through its intermediate writes in Windows Terminal.
    output.write(`${ESC}?2026h${ESC}?25l${ESC}?1000h${ESC}?1006h${colors.bg}${ESC}2J${ESC}H`);
    state.started = true;

    // Brand and compact global status.
    put(1, 1, paint(' OSIN ', colors.purple) + paint(fit(`${path.basename(workspace)} · ${state.backend === 'codex' ? state.codexModel || 'ChatGPT' : state.model}`, Math.max(8, w - 10)), colors.muted));
    put(1, 2, paint(EL.repeat(Math.max(1, w)), colors.border));

    if (!compact) {
      for (let y = 3; y <= frameBottom; y++) put(1, y, ' '.repeat(sideW));
      // Sidebar navigation: click coordinates and keyboard shortcuts share actions.
      for (let y = 3; y <= frameBottom; y++) put(sideW + 1, y, paint(V, colors.border));
      put(2, 4, paint('＋ New chat', colors.cyan));
      put(2, 6, paint(state.view === 'settings' ? '› Settings' : '  Settings', state.view === 'settings' ? colors.purple : colors.text));
      put(2, 8, paint('CHATS', colors.muted));
      const recent = state.sessions.slice(-Math.max(1, h - 11)).reverse();
      recent.forEach((session, i) => {
        const index = state.sessions.length - 1 - i;
        const label = (index === state.active ? '› ' : '  ') + (session.title || 'New chat');
        put(2, 10 + i, paint(fit(label, sideW - 2), index === state.active ? colors.text : colors.muted));
      });
      put(2, h - 1, paint('Esc  exit', colors.muted));
    }

    // Chat workspace.
    const centerWidth = compact ? w : chatW;
    for (let y = chatTop; y < inputY; y++) put(chatX, y, ' '.repeat(centerWidth));
    if (!compact) {
      for (let y = 3; y <= frameBottom; y++) put(adX, y, ' '.repeat(adW));
      if (splitSponsor) for (let y = 3; y <= frameBottom; y++) put(sponsorX, y, ' '.repeat(sponsorW));
    }
    put(chatX, 3, paint(state.view === 'settings' ? 'SETTINGS' : (state.sessions[state.active].title || 'NEW CHAT').toUpperCase(), colors.cyan));
    if (state.view === 'diff') {
      put(chatX, 5, paint('CHANGES  ·  /output for command logs', colors.cyan));
      const diffLines = state.diffText.split(/\r?\n/);
      const visibleLines = Math.max(1, inputY - 8);
      const from = Math.max(0, diffLines.length - visibleLines - state.outputScroll);
      diffLines.slice(from, Math.max(from, diffLines.length - state.outputScroll)).forEach((line, index) => {
        const color = line.startsWith('+') ? colors.green : line.startsWith('-') ? colors.purple : colors.text;
        put(chatX + 1, 6 + index, paint(fit(line, centerWidth - 2), color));
      });
    } else if (state.view === 'output') {
      put(chatX, 5, paint('COMMAND OUTPUT  ·  Ctrl+O to return', colors.cyan));
      const outputs = activeSession().outputs || [];
      const joined = outputs.join('').split(/\r?\n/);
      const visibleLines = Math.max(1, inputY - 8);
      const from = Math.max(0, joined.length - visibleLines - state.outputScroll);
      joined.slice(from, Math.max(from, joined.length - state.outputScroll)).forEach((line, index) => {
        put(chatX + 1, 6 + index, fit(line, centerWidth - 2));
      });
    } else if (state.view === 'settings') {
      put(chatX, 5, paint('Model', colors.muted));
      put(chatX, 6, state.editingModel ? paint('› ' + fit(state.text, centerWidth - 5), colors.text) : paint('› ' + state.model, colors.text));
      put(chatX, 8, paint('Click the model row or press M to change it.', colors.muted));
      put(chatX, 9, paint('Press Enter to save · Escape to return.', colors.muted));
    } else {
      const commandQuery = state.view === 'chat' && /^\/[^\s]*$/.test(state.text) ? state.text.toLowerCase() : null;
      if (state.modelPicker) {
        put(chatX + (compact ? 1 : 2), chatTop + 2, paint(state.modelPicker.loading ? 'LOADING MODELS…' : 'CHOOSE A MODEL', colors.cyan));
        if (!state.modelPicker.loading) {
          const maxRows = Math.max(1, inputY - chatTop - 5);
          const start = Math.max(0, Math.min(state.modelPicker.selected - Math.floor(maxRows / 2), state.modelPicker.models.length - maxRows));
          state.modelPicker.models.slice(start, start + maxRows).forEach((name, i) => {
            const selected = start + i === state.modelPicker.selected;
            put(chatX + (compact ? 1 : 2), chatTop + 3 + i, paint(fit(`${selected ? '›' : ' '} ${name}`, centerWidth - (compact ? 3 : 4)), selected ? colors.purple : colors.text));
          });
          put(chatX + (compact ? 1 : 2), inputY - 2, paint('↑/↓ choose · Enter select · Esc cancel', colors.muted));
        }
      } else if (commandQuery !== null) {
        const matches = getCommandSuggestions(commandQuery);
        const visibleCommands = matches.length ? matches : [];
        put(chatX + (compact ? 1 : 2), chatTop + 2, paint(commandQuery === '/' ? 'AVAILABLE COMMANDS' : 'MATCHING COMMANDS', colors.cyan));
        const commandRows = Math.max(0, inputY - chatTop - 5);
        visibleCommands.slice(0, Math.min(4, commandRows)).forEach(([command, description], i) => {
          const x = chatX + (compact ? 1 : 2);
          put(x, chatTop + 3 + i, paint(fit(command, 19), colors.purple) + paint(fit(` ${description}`, Math.max(1, centerWidth - 24)), colors.muted));
        });
        if (!matches.length) put(chatX + (compact ? 1 : 2), chatTop + 3, paint('No matching commands', colors.muted));
        else if (commandQuery === '/' && commandRows > 4) put(chatX + (compact ? 1 : 2), chatTop + 7, paint('More commands: /help', colors.muted));
      } else {
      const messages = activeSession().messages.filter(m => m.role !== 'system' && m.role !== 'tool' && !(m.tool_calls && !m.content));
      const contentWidth = Math.max(12, centerWidth - 4);
      const rendered = [];
      for (const message of messages) {
        rendered.push({ text: message.role === 'user' ? 'YOU' : message.role === 'error' ? 'OSIN · ERROR' : message.role === 'activity' ? 'AGENT ACTIVITY' : 'OSIN', role: message.role, heading: true });
        for (const text of wrapText(message.display || message.content, contentWidth)) rendered.push({ text, role: message.role });
        rendered.push({ text: '', role: message.role });
      }
      if (!rendered.length) rendered.push({ text: 'What are we building?', role: 'empty' }, { text: 'Ask a question or describe a coding task.', role: 'hint' });
      if (state.busy) {
        rendered.push({ text: 'OSIN', role: 'assistant', heading: true });
        for (const text of wrapText(state.streamingText || 'Planning and working…', contentWidth)) rendered.push({ text, role: 'hint' });
      }
      const available = Math.max(1, inputY - chatTop - 3);
      const visible = rendered.slice(Math.max(0, rendered.length - available - state.scroll), rendered.length - state.scroll);
      visible.forEach((line, i) => {
        const color = line.heading ? (line.role === 'user' ? colors.cyan : colors.purple) : line.role === 'hint' || line.role === 'empty' ? colors.muted : colors.text;
        put(chatX + (compact ? 1 : 2), chatTop + 2 + i, fit(paint(line.text, color), centerWidth - (compact ? 3 : 4)));
      });
      }
    }

    if (!compact && state.view === 'chat') {
      for (let y = 3; y <= frameBottom; y++) put(adX, y, paint(V, colors.border));
      if (splitSponsor) for (let y = 3; y <= frameBottom; y++) put(sponsorX, y, paint(V, colors.border));
      const plan = activeSession().plan;
      put(adX + 2, 4, paint(plan?.title ? fit(plan.title.toUpperCase(), adW - 4) : 'PLAN / TODOS', colors.purple));
      if (plan?.tasks?.length) {
        plan.tasks.slice(0, 7).forEach((task, i) => {
          const marker = task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '›' : '·';
          put(adX + 2, 5 + i, paint(fit(`${marker} ${task.text}`, adW - 4), task.status === 'completed' ? colors.muted : colors.text));
        });
      } else put(adX + 2, 5, paint('Describe a task to plan it.', colors.muted));
      const filesY = Math.min(14, 6 + Math.min(7, plan?.tasks?.length || 1));
      put(adX + 2, filesY, paint('CHANGED FILES', colors.cyan));
      const changedFiles = (activeSession().changedFiles || []).filter(file => !isSecretPath(file));
      changedFiles.slice(0, Math.max(1, 17 - filesY)).forEach((file, i) => put(adX + 2, filesY + 1 + i, paint(fit(file, adW - 4), colors.text)));
      if (!changedFiles.length) put(adX + 2, filesY + 1, paint('None yet', colors.muted));
      if (state.sponsorVisible) {
        if (splitSponsor) {
          const cardWidth = sponsorW - 4;
          const heading = state.sponsor ? 'SPONSORED' : 'SPONSOR OSIN';
          put(sponsorX + 2, 4, paint(fit(heading, cardWidth), colors.muted));
          put(sponsorX + 2, 6, paint(fit(state.sponsor?.sponsor || 'Reach OSIN users', cardWidth), colors.purple));
          const title = state.sponsor?.title || 'Promote your product to developers';
          put(sponsorX + 2, 7, paint(fit(title, cardWidth), colors.text));
          const description = state.sponsor?.description || 'Interested in a sponsored placement? Learn more about OSIN.';
          wrapText(description, cardWidth).slice(0, 4).forEach((line, i) => put(sponsorX + 2, 8 + i, paint(line, colors.muted)));
          put(sponsorX + 2, 13, paint(fit('Click to learn more', cardWidth), colors.cyan));
        } else {
          const sponsorY = Math.max(18, Math.min(h - 10, inputY - 7));
          for (let x = adX + 1; x < adX + adW; x += 1) put(x, sponsorY - 1, paint(EL, colors.border));
          const cardWidth = adW - 4;
          put(adX + 2, sponsorY, paint(fit(state.sponsor ? 'SPONSORED' : 'SPONSOR OSIN', cardWidth), colors.muted));
          put(adX + 2, sponsorY + 1, paint(fit(state.sponsor?.sponsor || 'Reach OSIN users', cardWidth), colors.purple));
          put(adX + 2, sponsorY + 2, paint(fit(state.sponsor?.title || 'Promote to developers', cardWidth), colors.text));
          put(adX + 2, sponsorY + 3, paint('Click to learn more', colors.cyan));
        }
      }
    }
    if (compact && state.view === 'chat' && state.sponsorVisible) {
      put(1, 4, paint(fit(state.sponsor ? `SPONSORED · ${state.sponsor.sponsor}: ${state.sponsor.title} · click to learn more` : 'SPONSOR OSIN · Promote your product to developers · click to learn more', w), colors.muted));
    }
    if (state.pendingApproval) {
      put(chatX + 2, chatTop + 4, paint('OSIN SESSION ACCESS', colors.purple));
      wrapText(state.pendingApproval.description, Math.max(12, centerWidth - 8)).slice(0, 3)
        .forEach((line, index) => put(chatX + 2, chatTop + 5 + index, paint(line, colors.text)));
      put(chatX + 2, chatTop + 9, paint('[y] approve session · [n] deny', colors.purple));
    }

    // Multiline composer is anchored at the bottom of the chat column.
    const composerWidth = compact ? w - 2 : chatW;
    const activeFiles = state.sessions[state.active].attachments;
    const fileHint = activeFiles.length
      ? `${activeFiles.length} file(s) attached · ${Math.ceil(totalAttachmentBytes(activeFiles) / 1024)} KiB`
      : 'Paste large text to attach it · /attach <path> adds a file';
    const statusText = state.notice || fileHint;
    put(chatX, inputY - 1, paint(fit(statusText, composerWidth), state.notice ? colors.green : colors.muted));
    put(chatX, inputY, paint(EL.repeat(Math.max(1, composerWidth)), colors.border));
    const prefix = paint('› ', colors.purple);
    const availableInput = Math.max(1, composerWidth - 5);
    const contentLines = state.text.split('\n');
    const firstVisibleLine = Math.max(0, contentLines.length - 3);
    const visibleLines = contentLines.slice(firstVisibleLine);
    for (let i = 0; i < 3; i++) {
      const line = visibleLines[i] || '';
      const caret = i === 0 && !state.text ? paint('Type a message…', colors.muted) : line;
      const promptPrefix = i === 0 ? prefix : '  ';
      put(chatX, inputY + 1 + i, promptPrefix + fit(caret, availableInput) + (i === 0 ? paint('  ↵', colors.muted) : ''));
    }
    put(chatX, inputY + 4, paint(EL.repeat(Math.max(1, composerWidth)), colors.border));
    if (h > inputY + 5) put(1, inputY + 5, paint(' Ctrl+N new · Ctrl+S settings · Ctrl+O output · Ctrl+L redraw · Enter send · Esc stop/back', colors.muted));
    const beforeCaret = state.text.slice(0, state.caret).split('\n');
    const caretLine = beforeCaret.length - 1;
    const shownCaretLine = Math.max(firstVisibleLine, Math.min(caretLine, firstVisibleLine + 2));
    const caretColumn = beforeCaret[beforeCaret.length - 1].length;
    const caretViewStart = Math.max(0, caretColumn - availableInput + 1);
    const caretX = chatX + 2 + Math.max(0, caretColumn - caretViewStart);
    output.write(lines.join(''));
    const caretY = Math.max(1, Math.min(h, inputY + 1 + shownCaretLine - firstVisibleLine));
    output.write(move(Math.max(1, Math.min(w, caretX)), caretY) + `${ESC}?25h${ESC}?2026l`);
  }

  function newChat() {
    state.sessions.push(createSession());
    state.active = state.sessions.length - 1;
    state.view = 'chat';
    state.text = '';
    state.scroll = 0;
    persistSessions();
    draw();
  }

  function requestSessionApproval() {
    if (state.approvalStatus !== null) return Promise.resolve(state.approvalStatus);
    return new Promise(resolve => {
      state.pendingApproval = {
        description: `Allow OSIN to inspect this workspace, edit files, and run shell/Git commands:\n${workspace}\n\nApproval applies to this OSIN session.${state.backend === 'api' ? ' Common secret paths are filtered from OSIN file tools.' : ' Codex manages file access inside its own workspace sandbox.'}`,
        resolve: approved => {
          state.approvalStatus = approved;
          state.pendingApproval = null;
          state.notice = approved ? 'Workspace access approved for this session.' : 'Workspace access denied for this session.';
          draw();
          resolve(approved);
        },
      };
      draw();
    });
  }

  async function showDiff() {
    const session = activeSession();
    const files = [...new Set(session.changedFiles || [])].filter(file => !isSecretPath(file));
    if (!files.length) {
      state.diffText = 'No changed project files to show.';
      state.view = 'diff';
      draw();
      return;
    }
    const runGit = args => new Promise(resolve => execFile('git', args, { cwd: workspace, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
    let { error, stdout } = await runGit(['diff', '--no-ext-diff', '--no-color', 'HEAD', '--', ...files]);
      if (error) {
      const unstaged = await runGit(['diff', '--no-ext-diff', '--no-color', '--', ...files]);
      const staged = await runGit(['diff', '--cached', '--no-ext-diff', '--no-color', '--', ...files]);
      stdout = [unstaged.stdout, staged.stdout].filter(Boolean).join('\n');
    }
    let text = stdout || '';
    if (!text && Object.keys(session.fileDiffs || {}).length) text = Object.values(session.fileDiffs).join('\n\n');
    const untracked = await runGit(['ls-files', '--others', '--exclude-standard', '--', ...files]);
    for (const file of (untracked.stdout || '').split(/\r?\n/).filter(Boolean)) {
      try {
        const content = readProjectFile(workspace, file);
        text += `${text ? '\n\n' : ''}--- /dev/null\n+++ b/${file}\n${content.split(/\r?\n/).map(line => `+${line}`).join('\n')}`;
      } catch {}
    }
    state.diffText = text || (error ? `Git diff unavailable: ${error.message}` : 'No textual diff available.');
    state.view = 'diff';
    state.outputScroll = 0;
    draw();
  }

  function handleClick(x, y) {
    if (state.busy) return;
    const w = width();
    const layout = getWorkspaceLayout(w);
    if (layout.compact) {
      if (state.sponsorVisible && state.view === 'chat' && y === 4) { openSponsor(); return; }
      return;
    }
    if (state.modelPicker && !state.modelPicker.loading) {
      const firstRow = 6;
      const maxRows = Math.max(1, Math.max(11, height() - 6) - 8);
      const start = Math.max(0, Math.min(state.modelPicker.selected - Math.floor(maxRows / 2), state.modelPicker.models.length - maxRows));
      const row = y - firstRow;
      const sideW = layout.sideW;
      if (x >= sideW + 2 && row >= 0 && row < maxRows && start + row < state.modelPicker.models.length) {
        selectModel(state.modelPicker.models[start + row]);
      }
      return;
    }
    if (x <= 24 && y === 4) { newChat(); return; }
    if (x <= 24 && y === 6) { state.view = 'settings'; state.editingModel = false; draw(); return; }
    if (x <= 24 && y >= 10 && y < 10 + state.sessions.length) {
      const index = state.sessions.length - 1 - (y - 10);
      if (index >= 0) { state.active = index; state.view = 'chat'; draw(); }
      return;
    }
    if (state.sponsorVisible && state.view === 'chat') {
      const planX = layout.sideW + layout.chatW + 3;
      if (layout.splitSponsor && x >= planX + layout.planW + 1 && y >= 4 && y <= 14) {
        openSponsor();
        return;
      }
      const rows = height();
      const sponsorY = Math.max(18, Math.min(rows - 10, Math.max(11, rows - 8) - 7));
      if (!layout.splitSponsor && x >= planX && y >= sponsorY && y <= sponsorY + 3) {
        openSponsor();
        return;
      }
    }
    if (state.view === 'settings' && y === 6) { state.editingModel = true; state.text = state.model; state.caret = state.text.length; draw(); return; }
    state.focus = 'composer';
    draw();
  }

  async function submit() {
    const text = state.text.trim();
    if (text === '/exit' || text === '/quit') { state.text = ''; state.caret = 0; shutdown(); return; }
    if ((!text && !state.sessions[state.active].attachments.length) || state.busy) return;
    state.text = '';
    state.caret = 0;
    state.notice = '';
    if (text === '/clear') {
      const session = state.sessions[state.active];
      session.messages = session.messages.slice(0, 1);
      session.attachments = [];
      session.title = 'New chat';
      session.plan = null;
      session.changedFiles = [];
      session.fileDiffs = {};
      session.outputs = [];
      session.usage = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      persistSessions();
      draw(); return;
    }
    if (text === '/new') { newChat(); return; }
    if (text === '/settings') { state.view = 'settings'; draw(); return; }
    if (text === '/help') {
      addNotice('Commands: /new, /clear, /undo, /attach <path>, /files, /plan, /diff, /output, /detach N, /copy, /usage, /model, /models, /update, /settings, /setup, /signin, /api, /test-model, /support, /help, /exit. Ctrl+N new chat; Ctrl+O command output.');
      draw(); return;
    }
    if (text === '/plan') {
      const plan = activeSession().plan;
      addNotice(plan?.tasks?.length ? `${plan.title}\n${plan.tasks.map((task, i) => `${i + 1}. [${task.status}] ${task.text}`).join('\n')}` : 'No plan yet. Describe a coding task to create one.');
      draw(); return;
    }
    if (text === '/output') { state.view = 'output'; draw(); return; }
    if (text === '/diff') { await showDiff(); return; }
    if (text === '/model') { showModels(); return; }
    if (text === '/models') {
      state.busy = true;
      state.notice = 'Loading models from your configured provider…';
      draw();
      try {
        const models = await listModels({ baseUrl, apiKey });
        addNotice(`Models available to this API key (${models.length}):\n${models.map(id => `${id}${id === state.model ? '  ← active' : ''}`).join('\n')}\nUse /model to browse and select a model.`);
      } catch (error) { addNotice(`Could not list models: ${error.message}`); }
      state.busy = false;
      state.notice = '';
      draw(); return;
    }
    if (text === '/update') {
      state.busy = true;
      state.notice = 'Checking npm for a newer OSIN release…';
      draw();
      try {
        const update = await checkForUpdate(packageInfo.version);
        if (!update.updateAvailable) {
          addNotice(`OSIN ${packageInfo.version} is already the latest release.`);
        } else {
          state.notice = `Installing OSIN ${update.latest}…`;
          draw();
          await installUpdate(update.latest);
          addNotice(`Updated OSIN to ${update.latest}. Exit and restart OSIN to use the new version.`);
        }
      } catch (error) { addNotice(`Update failed: ${error.message}`); }
      state.busy = false;
      state.notice = '';
      draw(); return;
    }
    if (text.startsWith('/model ')) { selectModel(text.slice(7).trim()); return; }
    if (text === '/signin') { signInWithCodex(); return; }
    if (text === '/setup') { reconfigureProvider(); return; }
    if (text === '/api') {
      state.backend = 'api';
      if (apiKey) {
        try { writeUserConfig(configDir, { OSIN_BACKEND: 'api' }); }
        catch (error) { state.notice = `Using API for this session; could not save provider choice: ${error.message}`; }
      }
      if (!state.notice) state.notice = apiKey ? 'Using configured API-key provider.' : 'No API provider is configured. Run /setup.';
      draw(); return;
    }
    if (text === '/test-model') { testCurrentModel(); return; }
    if (text === '/support') { openSupport(); return; }
    if (text === '/usage') {
      const usage = state.sessions[state.active].usage;
      addNotice(`This chat · ${usage.requests} request(s) · ${usage.promptTokens.toLocaleString()} input tokens · ${usage.completionTokens.toLocaleString()} output tokens · ${usage.totalTokens.toLocaleString()} total. Provider-reported usage only; this is not a dollar balance.`);
      draw(); return;
    }
    if (text === '/files') {
      const files = state.sessions[state.active].attachments;
      addNotice(files.length ? files.map((file, i) => `${i + 1}. ${file.name} (${file.bytes} bytes)`).join('\n') : 'No files attached. Use /attach "path to file".');
      draw(); return;
    }
    if (text.startsWith('/attach ')) {
      const session = state.sessions[state.active];
      try {
        if (session.attachments.length >= 8) throw new Error('You can attach up to 8 files per message.');
        const requested = text.slice(8).trim().replace(/^['"]|['"]$/g, '');
        const absolute = path.isAbsolute(requested) ? requested : path.resolve(workspace, requested);
        const relative = path.relative(workspace, absolute);
        const file = readTextAttachment(resolveProjectPath(workspace, relative));
        if (totalAttachmentBytes(session.attachments) + file.bytes > MAX_TOTAL_ATTACHMENT_BYTES) {
          throw new Error(`Attachments together cannot exceed ${MAX_TOTAL_ATTACHMENT_BYTES} bytes.`);
        }
        session.attachments.push(file);
        state.notice = `Attached ${file.name} (${file.bytes} bytes).`;
      } catch (error) { state.notice = error.message; }
      draw(); return;
    }
    if (text === '/detach' || text.startsWith('/detach ')) {
      const files = state.sessions[state.active].attachments;
      const index = text === '/detach' ? files.length - 1 : Number(text.slice(8)) - 1;
      if (Number.isInteger(index) && index >= 0 && index < files.length) {
        const [removed] = files.splice(index, 1);
        state.notice = `Detached ${removed.name}.`;
      } else state.notice = 'Usage: /detach N (see /files).';
      draw(); return;
    }
    if (text === '/undo') {
      const messages = state.sessions[state.active].messages;
      const lastUser = messages.map(message => message.role).lastIndexOf('user');
      if (lastUser >= 0) messages.splice(lastUser);
      persistSessions();
      state.notice = lastUser >= 0 ? 'Removed the last user turn.' : 'Nothing to undo.';
      draw(); return;
    }
    if (text === '/copy') { copyLastAnswer(); return; }
    if (text.startsWith('/')) { state.notice = `Unknown command: ${text.split(/\s/, 1)[0]}. Type /help to see available commands.`; draw(); return; }

    const session = state.sessions[state.active];
    state.view = 'chat';
    const attachments = session.attachments.splice(0);
    const prompt = formatPrompt(text, attachments);
    const display = [text, ...attachments.map(file => `[Attached: ${file.name}]`)].filter(Boolean).join('\n');
    session.messages.push({ role: 'user', content: prompt, display: display || '[Attached files]' });
    if (session.title === 'New chat') session.title = (text || attachments[0]?.name || 'New chat').slice(0, 24);
    state.busy = true;
    draw();
    const workspaceSnapshot = snapshotWorkspace(workspace);
    if (state.backend === 'api' && !apiKey) {
      session.messages.push({ role: 'error', content: 'No API key configured. Type /setup or restart OSIN to connect a provider.' });
      state.busy = false; draw(); return;
    }
    try {
      const request = trimRequestHistory(session.messages);
      if (request.dropped) state.notice = `Older context trimmed to fit the model window (${request.dropped} message(s)).`;
      if (state.backend === 'codex') {
        try {
          const beforeChanges = gitChanges(workspace);
          state.taskController = new AbortController();
          const result = await runCodexCodingTask({
            prompt: text,
            model: await ensureCodexModel(),
            root: workspace,
            authorize: requestSessionApproval,
            signal: state.taskController.signal,
            onEvent: event => {
              if (event.type === 'text') state.streamingText += event.text;
              else if (event.type === 'tool_start') recordActivity(`OSIN ${event.name.replaceAll('_', ' ')}${event.args?.path ? `: ${event.args.path}` : ''}`);
              else if (event.type === 'plan' || event.type === 'plan_update') { session.plan = event.plan; persistSessions(); }
              else if (event.type === 'file_changed') {
                if (!session.changedFiles.includes(event.path)) session.changedFiles.push(event.path);
                if (event.diff) session.fileDiffs[event.path] = event.diff;
                persistSessions();
              }
              else if (event.type === 'command_start') recordActivity(`Running: ${event.command}`);
              else if (event.type === 'command_output') session.outputs.push(event.text);
              else if (event.type === 'command_end') { session.outputs.push(`\n${event.result}\n`); recordActivity(event.result.split('\n')[0]); }
              draw();
            },
          });
          for (const changed of gitChanges(workspace)) if (!isSecretPath(changed) && !beforeChanges.has(changed) && !session.changedFiles.includes(changed)) session.changedFiles.push(changed);
          session.usage.requests++;
          session.messages.push({ role: 'assistant', content: result.answer || '(no response)' });
        } catch (error) {
          if (isUnsupportedCodexModelError(error.message)) state.unsupportedModels.add(state.codexModel);
          throw error;
        }
      } else {
        state.taskController = new AbortController();
        state.streamingText = '';
        const agentMessages = request.messages.filter(message => ['user', 'assistant'].includes(message.role)).map(({ role, content }) => ({ role, content }));
        const result = await runAgent({
          messages: agentMessages,
          baseUrl,
          apiKey,
          model: state.model,
          root: workspace,
          signal: state.taskController.signal,
          authorize: requestSessionApproval,
          onEvent: event => {
            if (event.type === 'text') state.streamingText += event.text;
            else if (event.type === 'tool_start') recordActivity(`OSIN ${event.name.replaceAll('_', ' ')}${event.args?.path ? `: ${event.args.path}` : ''}`);
            else if (event.type === 'plan') { session.plan = event.plan; persistSessions(); }
            else if (event.type === 'plan_update') { session.plan = event.plan; persistSessions(); }
            else if (event.type === 'file_changed') {
              if (!session.changedFiles.includes(event.path)) session.changedFiles.push(event.path);
              if (event.diff) session.fileDiffs[event.path] = event.diff;
              persistSessions();
            }
            else if (event.type === 'command_start') { recordActivity(`Running: ${event.command}`); }
            else if (event.type === 'command_output') {
              session.outputs.push(event.text);
              if (session.outputs.join('').length > 300_000) session.outputs = [session.outputs.join('').slice(-300_000)];
            } else if (event.type === 'command_end') {
              session.outputs.push(`\n${event.result}\n`);
              recordActivity(event.result.split('\n')[0]);
            }
            draw();
          },
        });
        session.usage.requests++;
        session.messages.push({ role: 'assistant', content: result.answer });
      }
    } catch (error) {
      session.messages.push({ role: 'error', content: error.message });
    }
    const afterSnapshot = snapshotWorkspace(workspace);
    for (const file of changedSinceSnapshot(workspaceSnapshot, afterSnapshot)) {
      if (isSecretPath(file)) continue;
      if (!session.changedFiles.includes(file)) session.changedFiles.push(file);
      const previous = workspaceSnapshot.get(file);
      const current = afterSnapshot.get(file);
      if ((previous?.content ?? '') !== (current?.content ?? '') && (previous?.content !== undefined || current?.content !== undefined)) {
        session.fileDiffs[file] = createUnifiedDiff(file, previous?.content || '', current?.content || '');
      }
    }
    for (const file of gitChanges(workspace)) if (!isSecretPath(file) && !session.changedFiles.includes(file)) session.changedFiles.push(file);
    if (session.changedFiles.length) await showDiff();
    state.taskController = null;
    state.streamingText = '';
    persistSessions();
    state.busy = false;
    draw();
  }

  async function selectModel(name) {
    if (!name) return;
    if (state.backend === 'api') {
      state.notice = `Checking tool support for ${name}…`;
      draw();
      try { await testAgentModel({ baseUrl, apiKey, model: name }); }
      catch (error) {
        if (/tool\/function.calling|tool call/i.test(error.message)) state.unsupportedModels.add(name);
        state.notice = `Model not selected: ${error.message}`;
        draw();
        return;
      }
    }
    if (state.backend === 'codex') state.codexModel = name;
    else state.model = name;
    try { writeUserConfig(configDir, state.backend === 'codex' ? { OSIN_CODEX_MODEL: name } : { OSIN_MODEL: name }); }
    catch (error) { state.notice = `Model selected for this session; could not save it: ${error.message}`; }
    state.modelPicker = null;
    state.notice = `Model selected: ${name}`;
    draw();
  }

  async function ensureCodexModel() {
    if (state.codexModel) return state.codexModel;
    await checkLogin();
    const models = (await listCodexModels()).filter(name => !state.unsupportedModels.has(name));
    if (!models.length) throw new Error('Codex returned no available models.');
    state.codexModel = models[0];
    return state.codexModel;
  }

  async function showModels() {
    if (state.backend === 'api' && !apiKey) { state.notice = 'Run /setup to connect a provider, or use /signin.'; draw(); return; }
    state.modelPicker = { loading: true, models: [], selected: 0 };
    draw();
    try {
      let models;
      if (state.backend === 'codex') {
        await checkLogin();
        models = (await listCodexModels()).filter(name => !state.unsupportedModels.has(name));
        if (!models.length) throw new Error('Codex returned no usable models.');
        if (!models.includes(state.codexModel)) state.codexModel = models[0];
      } else {
        models = (await listModels({ baseUrl, apiKey })).filter(name => !state.unsupportedModels.has(name));
        if (!models.includes(state.model) && !state.unsupportedModels.has(state.model)) models.unshift(state.model);
      }
      const selected = state.backend === 'codex' ? state.codexModel : state.model;
      state.modelPicker = { loading: false, models, selected: Math.max(0, models.indexOf(selected)) };
    } catch (error) {
      state.modelPicker = null;
      state.notice = `Could not load models: ${error.message}`;
    }
    draw();
  }

  async function signInWithCodex() {
    try {
      await checkLogin();
      state.backend = 'codex';
      writeUserConfig(configDir, { OSIN_BACKEND: 'codex' });
      state.notice = 'Already signed in with your ChatGPT account. Type /model to browse models.';
      draw(); return;
    } catch {}
    input.pause(); input.setRawMode(false);
    output.write(`${ESC}?2026l${ESC}?2004l${ESC}?1006l${ESC}?1000l${ESC}?25h${ESC}?1049l`);
    let restored = false;
    const restore = () => {
      if (restored) return false;
      restored = true;
      input.setRawMode(true); input.resume(); output.write(`${ESC}?1049h${ESC}?1000h${ESC}?1006h${ESC}?2004h`);
      return true;
    };
    let child;
    try { child = spawnCodex(['login'], { stdio: 'inherit' }); }
    catch (error) { state.notice = `OpenAI sign-in unavailable: ${error.message}`; draw(); return; }
    child.once('error', error => { if (restore()) { state.notice = `Could not start browser sign-in: ${error.message}`; draw(); } });
    child.once('close', async code => {
      if (!restore()) return;
      try {
        await checkLogin(); state.backend = 'codex'; writeUserConfig(configDir, { OSIN_BACKEND: 'codex' });
        state.notice = 'Signed in with your ChatGPT account. Type /model to browse models.';
      } catch (error) { state.notice = code === 0 ? error.message : `Browser sign-in ended with status ${code}.`; }
      draw();
    });
  }

  async function testCurrentModel() {
    state.notice = `Testing ${state.backend === 'codex' ? state.codexModel : state.model}…`;
    draw();
    try {
      if (state.backend === 'codex') {
        try { await askCodex([{ role: 'user', content: 'Reply with exactly OK.' }], await ensureCodexModel()); }
        catch (error) {
          if (isUnsupportedCodexModelError(error.message)) state.unsupportedModels.add(state.codexModel);
          throw error;
        }
      }
      else {
        if (!apiKey) throw new Error('No API key configured.');
        try { await testAgentModel({ baseUrl, apiKey, model: state.model }); }
        catch (error) {
          if (/tool\/function.calling|tool call/i.test(error.message)) state.unsupportedModels.add(state.model);
          throw error;
        }
      }
      state.notice = 'Model test passed.';
    } catch (error) { state.notice = `Model test failed: ${error.message}`; }
    draw();
  }

  function addNotice(content) {
    state.sessions[state.active].messages.push({ role: 'notice', content });
    persistSessions();
  }

  async function reconfigureProvider() {
    input.removeListener('data', consume);
    input.pause();
    input.setRawMode(false);
    output.write(`${ESC}?2026l${ESC}?2004l${ESC}?1006l${ESC}?1000l${ESC}?25h${ESC}?1049l`);
    try {
      const setupIO = createVisualSetupIO();
      const provider = await configureProvider({ configDirectory: configDir, io: setupIO, log: message => setupIO.log(message) });
      state.backend = provider.backend;
      if (provider.backend === 'api') {
        apiKey = provider.apiKey;
        baseUrl = provider.baseUrl;
        state.model = provider.model;
      }
      state.notice = `Connected to ${provider.backend === 'codex' ? 'ChatGPT / Codex' : 'your API provider'}.`;
    } catch (error) { state.notice = `Provider setup failed: ${error.message}`; }
    input.setRawMode(true);
    input.resume();
    input.on('data', consume);
    output.write(`${ESC}?1049h${ESC}?1000h${ESC}?1006h${ESC}?2004h`);
    state.view = 'chat';
    draw();
  }

  function openSupport() {
    if (!state.supportUrl) {
      state.notice = 'Set OSIN_SUPPORT_URL to your HTTPS donation page to enable support.';
      draw(); return;
    }
    if (openUrl) openUrl(state.supportUrl);
    else openExternalUrl(state.supportUrl);
    state.notice = 'Opened OSIN support page.';
    draw();
  }

  function openSponsor() {
    const target = state.sponsor?.url || state.supportUrl || 'https://osin.is-an.org/';
    if (state.sponsor) {
      try { recordAggregate(state.metricsPath, state.sponsor.id, 'clicks'); } catch {}
    }
    state.sponsorVisible = false;
    if (openUrl) openUrl(target);
    else openExternalUrl(target);
    if (!state.sponsor) state.notice = 'Thanks for supporting OSIN.';
    draw();
  }

  function copyLastAnswer() {
    const messages = state.sessions[state.active].messages;
    const answer = [...messages].reverse().find(message => message.role === 'assistant')?.content;
    if (!answer) { state.notice = 'No assistant response to copy yet.'; draw(); return; }
    const command = process.platform === 'win32' ? 'clip.exe' : process.platform === 'darwin' ? 'pbcopy' : 'xclip';
    const args = process.platform === 'linux' ? ['-selection', 'clipboard'] : [];
    try {
      const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      child.once('error', () => { state.notice = 'Clipboard tool unavailable. Use your terminal copy shortcut.'; draw(); });
      child.stdin.end(answer, 'utf8');
      state.notice = 'Copied the last OSIN response.';
    } catch { state.notice = 'Clipboard tool unavailable. Use your terminal copy shortcut.'; }
    draw();
  }

  function finishPaste() {
    if (state.pasteOverflow) {
      state.notice = 'Pasted block exceeded 128 KiB. Save it as UTF-8 and use /attach "path".';
      state.pasteOverflow = false;
      state.pasteBuffer = '';
      draw(); return;
    }
    const pasted = state.pasteBuffer.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    state.pasteBuffer = '';
    if (state.view === 'settings' && state.editingModel) {
      state.text = state.text.slice(0, state.caret) + pasted + state.text.slice(state.caret);
      state.caret += pasted.length;
      draw(); return;
    }
    const attachments = state.sessions[state.active].attachments;
    const result = createPasteAttachment(pasted, attachments);
    if (result.error) state.notice = result.error;
    else if (result.attachment) {
      attachments.push(result.attachment);
      state.text = '';
      state.caret = 0;
      state.notice = `Large paste attached as ${result.attachment.name}.`;
    } else {
      state.text = state.text.slice(0, state.caret) + result.text + state.text.slice(state.caret);
      state.caret += result.text.length;
      state.notice = 'Pasted text into the composer.';
    }
    draw();
  }

  function consume(data) {
    state.buffer += data.toString('utf8');
    while (state.buffer) {
      if (state.pasting) {
        const end = state.buffer.indexOf(PASTE_END);
        if (end >= 0) {
          const chunk = state.buffer.slice(0, end);
          state.buffer = state.buffer.slice(end + PASTE_END.length);
          if (!state.pasteOverflow) {
            state.pasteBytes += Buffer.byteLength(chunk, 'utf8');
            if (state.pasteBytes > 128 * 1024) { state.pasteOverflow = true; state.pasteBuffer = ''; }
            else state.pasteBuffer += chunk;
          }
          state.pasting = false;
          state.pasteBytes = 0;
          finishPaste();
          continue;
        }
        const keep = PASTE_END.length - 1;
        if (state.buffer.length > keep) {
          const chunk = state.buffer.slice(0, -keep);
          state.buffer = state.buffer.slice(-keep);
          if (!state.pasteOverflow) {
            state.pasteBytes += Buffer.byteLength(chunk, 'utf8');
            if (state.pasteBytes > 128 * 1024) { state.pasteOverflow = true; state.pasteBuffer = ''; }
            else state.pasteBuffer += chunk;
          }
        }
        return;
      }
      if (state.buffer.startsWith(PASTE_START)) {
        state.buffer = state.buffer.slice(PASTE_START.length);
        state.pasting = true;
        state.pasteBuffer = '';
        state.pasteBytes = 0;
        state.pasteOverflow = false;
        continue;
      }
      if (state.buffer.length < PASTE_START.length && PASTE_START.startsWith(state.buffer)) return;
      const mouse = state.buffer.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (mouse) {
        state.buffer = state.buffer.slice(mouse[0].length);
        if (mouse[4] === 'M' && (Number(mouse[1]) & 3) === 0) handleClick(Number(mouse[2]), Number(mouse[3]));
        continue;
      }
      if (state.buffer.startsWith('\x1b[<')) return;
      if (state.buffer.startsWith('\x1b[')) {
        if (state.buffer.length < 3) return;
        const seq = state.buffer.slice(0, 3);
        state.buffer = state.buffer.slice(3);
        if ((state.view === 'output' || state.view === 'diff') && seq === '\x1b[A') state.outputScroll = Math.min(1000, state.outputScroll + 1);
        else if ((state.view === 'output' || state.view === 'diff') && seq === '\x1b[B') state.outputScroll = Math.max(0, state.outputScroll - 1);
        else if (state.modelPicker && seq === '\x1b[A') state.modelPicker.selected = Math.max(0, state.modelPicker.selected - 1);
        else if (state.modelPicker && seq === '\x1b[B') state.modelPicker.selected = Math.min(state.modelPicker.models.length - 1, state.modelPicker.selected + 1);
        else if (seq === '\x1b[D') state.caret = Math.max(0, state.caret - 1);
        else if (seq === '\x1b[C') state.caret = Math.min(state.text.length, state.caret + 1);
        if (!state.modelPicker && seq === '\x1b[A') state.scroll = Math.min(30, state.scroll + 1);
        if (!state.modelPicker && seq === '\x1b[B') state.scroll = Math.max(0, state.scroll - 1);
        draw(); continue;
      }
      const code = state.buffer.codePointAt(0);
      const char = String.fromCodePoint(code);
      state.buffer = state.buffer.slice(char.length);
      if (char === '\x03') { shutdown(); return; }
      if (char === '\x0c') { draw(); continue; }
      if (char === '\x1b') {
        if (state.modelPicker) { state.modelPicker = null; draw(); continue; }
        if (state.pendingApproval) {
          state.pendingApproval.resolve(false);
          if (state.taskController) state.taskController.abort();
          continue;
        }
        if (state.busy && state.taskController) {
          state.taskController.abort();
          state.notice = 'Stopping the current task…';
          draw(); continue;
        }
        if (state.view === 'output' || state.view === 'diff') { state.view = 'chat'; draw(); continue; }
        if (state.view === 'settings') {
          state.view = 'chat'; state.editingModel = false; state.text = ''; state.caret = 0; draw();
          continue;
        }
        shutdown(); return;
      }
      if (char === '\x0e') { if (!state.busy) newChat(); continue; }
      if (char === '\x0f') { state.view = state.view === 'output' ? 'chat' : 'output'; draw(); continue; }
      if (char === '\x13' || char === '\x00') { state.view = 'settings'; state.editingModel = false; draw(); continue; }
      if (char === '\r' || char === '\n') {
        if (state.pendingApproval) {
          const resolve = state.pendingApproval.resolve;
          resolve(false);
        } else if (state.modelPicker && !state.modelPicker.loading) {
          selectModel(state.modelPicker.models[state.modelPicker.selected]);
        } else if (state.view === 'settings' && state.editingModel) {
          const nextModel = state.text.trim(); state.text = ''; state.caret = 0; state.editingModel = false; state.view = 'chat';
          if (nextModel) selectModel(nextModel); else draw();
        } else if (state.view === 'chat') submit();
        continue;
      }
      if (char === '\x7f' || char === '\b') {
        if (state.caret > 0) { state.text = state.text.slice(0, state.caret - 1) + state.text.slice(state.caret); state.caret--; }
        draw(); continue;
      }
      if (char === '\t') { state.focus = state.focus === 'composer' ? 'sidebar' : 'composer'; draw(); continue; }
      if (state.pendingApproval && (char.toLowerCase() === 'y' || char.toLowerCase() === 'n')) {
        const resolve = state.pendingApproval.resolve;
        resolve(char.toLowerCase() === 'y');
        continue;
      }
      if (char >= ' ' && char !== '\x7f') {
        if (state.view === 'settings' && !state.editingModel) {
          if (char.toLowerCase() === 'm') { state.editingModel = true; state.text = state.model; state.caret = state.text.length; }
        } else {
          state.text = state.text.slice(0, state.caret) + char + state.text.slice(state.caret); state.caret += char.length;
        }
        draw();
      }
    }
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.closed) return;
      draw();
    }, 75);
  }
  function openExternalUrl(url) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    execFile(command, args, { windowsHide: true }, () => {});
  }
  function shutdown() {
    if (state.closed) return;
    if (state.taskController) state.taskController.abort();
    if (state.pendingApproval) state.pendingApproval.resolve(false);
    state.closed = true;
    clearTimeout(resizeTimer);
    input.removeListener('data', consume);
    input.pause();
    output.removeListener('resize', onResize);
    input.setRawMode(false);
    output.write(`${ESC}?2026l${ESC}?2004l${ESC}?1006l${ESC}?1000l${ESC}?25h\x1b[0m${ESC}2J${ESC}H${ESC}?1049l`);
    console.log('OSIN closed.');
  }

  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  input.on('data', consume);
  output.on('resize', onResize);
  process.once('exit', () => {
    if (!state.closed) output.write(`${ESC}?2026l${ESC}?2004l${ESC}?1006l${ESC}?1000l${ESC}?25h`);
  });
  output.write(`${ESC}?1049h${ESC}?1000h${ESC}?1006h${ESC}?2004h`);
  if (state.sponsor) {
    try { recordAggregate(state.metricsPath, state.sponsor.id, 'impressions'); } catch {}
  }
  draw();
  if (process.env.OSIN_DISABLE_UPDATE_CHECK !== '1') {
    checkForUpdate(packageInfo.version).then(update => {
      if (!state.closed && update.updateAvailable) {
        state.notice = `OSIN ${update.latest} is available — type /update to install it.`;
        draw();
      }
    }).catch(() => {});
  }
}

module.exports = { startTui, getTerminalDimensions, getWorkspaceLayout, COMMANDS };
