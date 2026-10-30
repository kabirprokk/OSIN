// Dependency-free, mouse-enabled OSIN terminal workspace.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { loadCampaigns, chooseCampaign, recordAggregate } = require('./sponsors');
const { getConfigDirectory } = require('./config');
const { listModels } = require('./providers');
const { checkForUpdate, installUpdate } = require('./updater');
const { askCodex, checkLogin, isUnsupportedModelError, isUnsupportedCodexModelError, listCodexModels } = require('./codex');
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
  reset: '\x1b[0m', purple: '\x1b[38;2;183;139;255m', muted: '\x1b[38;2;120;132;158m',
  text: '\x1b[38;2;224;229;240m', cyan: '\x1b[38;2;110;190;255m', green: '\x1b[38;2;107;226;177m',
  bg: '\x1b[48;2;8;13;25m', panel: '\x1b[48;2;13;22;39m', border: '\x1b[38;2;43;61;90m',
};
const paint = (value, color) => `${color}${value}${colors.reset}`;
function validHttpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null; }
  catch { return null; }
}

function startTui({ model, apiKey, baseUrl, sponsorsFile, metricsFile, openUrl, supportUrl, codexModel }) {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY || !input.setRawMode) {
    console.error('OSIN workspace needs an interactive terminal. Try Windows Terminal or the VS Code terminal.');
    process.exitCode = 1;
    return;
  }

  const state = {
    model,
    view: 'chat',
    focus: 'composer',
    text: '',
    caret: 0,
    busy: false,
    scroll: 0,
    started: false,
    sessions: [createSession()],
    active: 0,
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
    backend: apiKey ? 'api' : 'codex',
    codexModel: codexModel || 'gpt-6-luna',
    modelPicker: null,
    unsupportedModels: new Set(),
    lastSize: null,
  };
  const width = () => output.columns || 100;
  const height = () => output.rows || 30;
  const move = (x, y) => `${ESC}${y};${x}H`;
  const clearLine = `${ESC}2K`;
  const visibleWidth = displayWidth;
  const fit = fitText;

  function draw() {
    if (state.closed) return;
    const w = width();
    const h = height();
    const compact = w < 88;
    const sideW = compact ? 0 : Math.max(19, Math.min(23, Math.floor(w * 0.2)));
    const adW = compact ? 0 : Math.max(24, Math.min(30, Math.floor(w * 0.25)));
    const chatW = Math.max(24, w - sideW - adW - (compact ? 0 : 2));
    const chatX = sideW ? sideW + 2 : 1;
    const adX = sideW ? sideW + chatW + 3 : 0;
    const chatTop = 3;
    const inputY = Math.max(chatTop + 8, h - 6);
    const lines = [];
    const put = (x, y, value) => {
      if (y < 1 || y > h || x < 1 || x > w) return;
      const remaining = w - x + 1;
      const clipped = visibleWidth(value) > remaining ? fit(value, remaining) : value;
      lines.push(move(x, y) + clipped);
    };
    // Clear only when dimensions change; clearing on every keystroke flashes
    // the whole terminal. Normal draws overwrite the existing layout in place.
    const sizeChanged = !state.lastSize || state.lastSize.width !== w || state.lastSize.height !== h;
    state.lastSize = { width: w, height: h };
    // Synchronized output makes the in-place repaint appear as one frame
    // instead of flashing through its intermediate writes in Windows Terminal.
    output.write(`${ESC}?2026h${ESC}?25l${ESC}?1000h${ESC}?1006h${colors.bg}${sizeChanged ? `${ESC}2J${ESC}H` : ''}`);
    state.started = true;

    // Brand and compact global status.
    put(1, 1, paint(' OSIN ', colors.purple) + paint(fit(state.backend === 'codex' ? state.codexModel : state.model, Math.max(8, w - 10)), colors.muted));
    put(1, 2, paint(EL.repeat(Math.max(1, w)), colors.border));

    if (!compact) {
      for (let y = 3; y <= h; y++) put(1, y, ' '.repeat(sideW));
      // Sidebar navigation: click coordinates and keyboard shortcuts share actions.
      for (let y = 3; y <= h; y++) put(sideW + 1, y, paint(V, colors.border));
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
    if (!compact) for (let y = 3; y < inputY; y++) put(adX, y, ' '.repeat(adW));
    put(chatX, 3, paint(state.view === 'settings' ? 'SETTINGS' : (state.sessions[state.active].title || 'NEW CHAT').toUpperCase(), colors.cyan));
    if (state.view === 'settings') {
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
      const messages = state.sessions[state.active].messages.filter(m => m.role !== 'system');
      const contentWidth = Math.max(12, centerWidth - 4);
      const rendered = [];
      for (const message of messages) {
        rendered.push({ text: message.role === 'user' ? 'YOU' : message.role === 'error' ? 'OSIN · ERROR' : 'OSIN', role: message.role, heading: true });
        for (const text of wrapText(message.display || message.content, contentWidth)) rendered.push({ text, role: message.role });
        rendered.push({ text: '', role: message.role });
      }
      if (!rendered.length) rendered.push({ text: 'What are we building?', role: 'empty' }, { text: 'Ask a question or describe a coding task.', role: 'hint' });
      if (state.busy) rendered.push({ text: 'OSIN', role: 'assistant', heading: true }, { text: 'Thinking…', role: 'hint' });
      const available = Math.max(1, inputY - chatTop - 3);
      const visible = rendered.slice(Math.max(0, rendered.length - available - state.scroll), rendered.length - state.scroll);
      visible.forEach((line, i) => {
        const color = line.heading ? (line.role === 'user' ? colors.cyan : colors.purple) : line.role === 'hint' || line.role === 'empty' ? colors.muted : colors.text;
        put(chatX + (compact ? 1 : 2), chatTop + 2 + i, fit(paint(line.text, color), centerWidth - (compact ? 3 : 4)));
      });
      }
    }

    if (!compact && state.view === 'chat' && state.sponsor && state.sponsorVisible) {
      // One quiet, clearly labeled sponsor card; no popups or rotating promotions.
      for (let y = 3; y <= h - 5; y++) put(adX, y, paint(V, colors.border));
      put(adX + 2, 4, paint('SPONSORED', colors.muted));
      put(adX + 2, 6, paint(fit(state.sponsor.sponsor, adW - 4), colors.purple));
      put(adX + 2, 7, paint(fit(state.sponsor.title, adW - 4), colors.text));
      const description = wrapText(state.sponsor.description, adW - 4);
      description.slice(0, 3).forEach((line, i) => put(adX + 2, 8 + i, paint(line, colors.muted)));
      put(adX + 2, 12, paint('Click to learn more', colors.cyan));
    }
    if (compact && state.view === 'chat' && state.sponsor && state.sponsorVisible) {
      put(1, 4, paint(fit(`SPONSORED · ${state.sponsor.sponsor}: ${state.sponsor.title} · click to learn more`, w), colors.muted));
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
    if (h > inputY + 4) put(1, h, paint(' Ctrl+N new chat · Ctrl+S settings · Enter send · Esc back/exit', colors.muted));
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
    draw();
  }

  function handleClick(x, y) {
    const w = width();
    if (w < 88) {
      if (state.sponsor && state.sponsorVisible && state.view === 'chat' && y === 4) { openSponsor(); return; }
      return;
    }
    if (state.modelPicker && !state.modelPicker.loading) {
      const firstRow = 6;
      const maxRows = Math.max(1, Math.max(11, height() - 6) - 8);
      const start = Math.max(0, Math.min(state.modelPicker.selected - Math.floor(maxRows / 2), state.modelPicker.models.length - maxRows));
      const row = y - firstRow;
      const sideW = Math.max(19, Math.min(23, Math.floor(w * 0.2)));
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
    if (state.sponsor && state.sponsorVisible && x >= adXForWidth(w) && y >= 4 && y <= 13) {
      openSponsor();
      return;
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
      draw(); return;
    }
    if (text === '/new') { newChat(); return; }
    if (text === '/settings') { state.view = 'settings'; draw(); return; }
    if (text === '/help') {
      addNotice('Commands: /new, /clear, /undo, /attach <path>, /files, /detach N, /copy, /usage, /model, /models, /update, /settings, /signin, /api, /test-model, /support, /help, /exit. Ctrl+N creates a chat; Ctrl+S opens settings.');
      draw(); return;
    }
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
    if (text.startsWith('/model ')) { state.model = text.slice(7).trim() || state.model; draw(); return; }
    if (text === '/signin') { signInWithCodex(); return; }
    if (text === '/api') { state.backend = 'api'; state.notice = apiKey ? 'Using configured API-key provider.' : 'No API key configured; set OSIN_API_KEY.'; draw(); return; }
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
        const file = readTextAttachment(text.slice(8));
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
      state.notice = lastUser >= 0 ? 'Removed the last user turn.' : 'Nothing to undo.';
      draw(); return;
    }
    if (text === '/copy') { copyLastAnswer(); return; }
    if (text.startsWith('/')) { state.notice = `Unknown command: ${text.split(/\s/, 1)[0]}. Type /help to see available commands.`; draw(); return; }

    const session = state.sessions[state.active];
    state.sponsorVisible = false;
    const attachments = session.attachments.splice(0);
    const prompt = formatPrompt(text, attachments);
    const display = [text, ...attachments.map(file => `[Attached: ${file.name}]`)].filter(Boolean).join('\n');
    session.messages.push({ role: 'user', content: prompt, display: display || '[Attached files]' });
    if (session.title === 'New chat') session.title = (text || attachments[0]?.name || 'New chat').slice(0, 24);
    state.busy = true;
    draw();
    if (state.backend === 'api' && !apiKey) {
      session.messages.push({ role: 'error', content: 'No API key configured. Add OSIN_API_KEY to your OSIN .env file.' });
      state.busy = false; draw(); return;
    }
    try {
      const request = trimRequestHistory(session.messages);
      if (request.dropped) state.notice = `Older context trimmed to fit the model window (${request.dropped} message(s)).`;
      if (state.backend === 'codex') {
        try {
          const answer = await askCodex(request.messages, state.codexModel);
          session.usage.requests++;
          session.messages.push({ role: 'assistant', content: answer || '(no response)' });
        } catch (error) {
          if (isUnsupportedCodexModelError(error.message)) state.unsupportedModels.add(state.codexModel);
          throw error;
        }
      } else {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: state.model, messages: request.messages, temperature: 0.7 }),
        });
        if (!response.ok) {
          const message = (await response.text()).slice(0, 500);
          if (isUnsupportedModelError(response.status, message)) state.unsupportedModels.add(state.model);
          throw new Error(`HTTP ${response.status}: ${message}`);
        }
        const data = await response.json();
        const usage = data?.usage || {};
        const sessionUsage = session.usage;
        sessionUsage.requests++;
        sessionUsage.promptTokens += Number(usage.prompt_tokens) || 0;
        sessionUsage.completionTokens += Number(usage.completion_tokens) || 0;
        sessionUsage.totalTokens += Number(usage.total_tokens) || 0;
        session.messages.push({ role: 'assistant', content: data?.choices?.[0]?.message?.content || '(no response)' });
      }
    } catch (error) {
      session.messages.push({ role: 'error', content: error.message });
    }
    state.busy = false;
    draw();
  }

  function selectModel(name) {
    if (state.backend === 'codex') state.codexModel = name;
    else state.model = name;
    state.modelPicker = null;
    state.notice = `Model selected: ${name}`;
    draw();
  }

  async function showModels() {
    if (state.backend === 'api' && !apiKey) { state.notice = 'Add OSIN_API_KEY to list provider models, or use /signin.'; draw(); return; }
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
      state.notice = 'Already signed in with ChatGPT through Codex. Type /model to browse models.';
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
    const child = spawn('codex', ['login', '--device-auth'], { stdio: 'inherit', windowsHide: true });
    child.once('error', error => { if (restore()) { state.notice = `Could not start Codex sign-in: ${error.message}`; draw(); } });
    child.once('close', async code => {
      if (!restore()) return;
      try {
        await checkLogin(); state.backend = 'codex';
        state.notice = 'Signed in with ChatGPT through Codex. Type /model to browse models.';
      } catch (error) { state.notice = code === 0 ? error.message : `Codex sign-in ended with status ${code}.`; }
      draw();
    });
  }

  async function testCurrentModel() {
    state.notice = `Testing ${state.backend === 'codex' ? state.codexModel : state.model}…`;
    draw();
    try {
      if (state.backend === 'codex') {
        try { await askCodex([{ role: 'user', content: 'Reply with exactly OK.' }], state.codexModel); }
        catch (error) {
          if (isUnsupportedCodexModelError(error.message)) state.unsupportedModels.add(state.codexModel);
          throw error;
        }
      }
      else {
        if (!apiKey) throw new Error('No API key configured.');
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: state.model, messages: [{ role: 'user', content: 'Reply with exactly OK.' }], max_tokens: 8 }),
        });
        if (!response.ok) {
          const body = (await response.text()).slice(0, 500);
          if (isUnsupportedModelError(response.status, body)) state.unsupportedModels.add(state.model);
          throw new Error(`HTTP ${response.status}: ${body}`);
        }
      }
      state.notice = 'Model test passed.';
    } catch (error) { state.notice = `Model test failed: ${error.message}`; }
    draw();
  }

  function addNotice(content) {
    state.sessions[state.active].messages.push({ role: 'notice', content });
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
    try { recordAggregate(state.metricsPath, state.sponsor.id, 'clicks'); } catch {}
    state.sponsorVisible = false;
    if (openUrl) openUrl(state.sponsor.url);
    else openExternalUrl(state.sponsor.url);
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
        if (state.modelPicker && seq === '\x1b[A') state.modelPicker.selected = Math.max(0, state.modelPicker.selected - 1);
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
      if (char === '\x1b') {
        if (state.modelPicker) { state.modelPicker = null; draw(); continue; }
        if (state.view === 'settings') {
          state.view = 'chat'; state.editingModel = false; state.text = ''; state.caret = 0; draw();
          continue;
        }
        shutdown(); return;
      }
      if (char === '\x0e') { newChat(); continue; }
      if (char === '\x13' || char === '\x00') { state.view = 'settings'; state.editingModel = false; draw(); continue; }
      if (char === '\r' || char === '\n') {
        if (state.modelPicker && !state.modelPicker.loading) {
          selectModel(state.modelPicker.models[state.modelPicker.selected]);
        } else if (state.view === 'settings' && state.editingModel) {
          state.model = state.text.trim() || state.model; state.text = ''; state.caret = 0; state.editingModel = false; draw();
        } else if (state.view === 'chat') submit();
        continue;
      }
      if (char === '\x7f' || char === '\b') {
        if (state.caret > 0) { state.text = state.text.slice(0, state.caret - 1) + state.text.slice(state.caret); state.caret--; }
        draw(); continue;
      }
      if (char === '\t') { state.focus = state.focus === 'composer' ? 'sidebar' : 'composer'; draw(); continue; }
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

  function onResize() { draw(); }
  function openExternalUrl(url) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    execFile(command, args, { windowsHide: true }, () => {});
  }
  function shutdown() {
    if (state.closed) return;
    state.closed = true;
    input.removeListener('data', consume);
    input.pause();
    output.removeListener('resize', onResize);
    input.setRawMode(false);
    output.write(`${ESC}?2026l${ESC}?2004l${ESC}?1006l${ESC}?1000l${ESC}?25h${ESC}2J${ESC}H${ESC}?1049l`);
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

function adXForWidth(w) {
  const sideW = Math.max(19, Math.min(23, Math.floor(w * 0.2)));
  const adW = Math.max(24, Math.min(30, Math.floor(w * 0.25)));
  const chatW = Math.max(24, w - sideW - adW - 2);
  return sideW + chatW + 3;
}

module.exports = { startTui, COMMANDS };
