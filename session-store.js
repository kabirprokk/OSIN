'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function projectSessionFile(configDirectory, workspace) {
  const realWorkspace = fs.realpathSync(workspace);
  const id = crypto.createHash('sha256').update(realWorkspace.toLowerCase()).digest('hex');
  return path.join(configDirectory, 'sessions', `${id}.json`);
}

function loadProjectSessions(configDirectory, workspace) {
  const file = projectSessionFile(configDirectory, workspace);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.sessions)) return [];
    return data.sessions.filter(session => session && typeof session.title === 'string' && Array.isArray(session.messages))
      .slice(-50).map(session => ({
        title: session.title.slice(0, 120),
        messages: session.messages.filter(message => message && ['system', 'user', 'assistant', 'error', 'notice', 'tool', 'activity'].includes(message.role) && typeof message.content === 'string')
          .map(({ role, content, display }) => ({ role, content: content.slice(0, 350_000), ...(typeof display === 'string' ? { display: display.slice(0, 20_000) } : {}) })).slice(-300),
        plan: session.plan && Array.isArray(session.plan.tasks) ? session.plan : null,
        changedFiles: Array.isArray(session.changedFiles) ? session.changedFiles.slice(0, 500) : [],
        fileDiffs: session.fileDiffs && typeof session.fileDiffs === 'object' ? Object.fromEntries(Object.entries(session.fileDiffs).slice(0, 500)) : {},
        outputs: Array.isArray(session.outputs) ? session.outputs.slice(-100) : [],
        activity: Array.isArray(session.activity) ? session.activity.slice(-200) : [],
        usage: session.usage || { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }));
  } catch { return []; }
}

function saveProjectSessions(configDirectory, workspace, sessions) {
  const file = projectSessionFile(configDirectory, workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const serialized = JSON.stringify({ version: 1, workspace: fs.realpathSync(workspace), savedAt: new Date().toISOString(), sessions: sessions.slice(-50) });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx', ...(process.platform === 'win32' ? {} : { mode: 0o600 }) });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

module.exports = { projectSessionFile, loadProjectSessions, saveProjectSessions };
