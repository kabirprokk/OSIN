'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const packageInfo = require('../package.json');
const { listCodexModels } = require('../codex');

test('advertises the installed OSIN version to the Codex app-server', async () => {
  const sent = [];
  let stdout;
  const spawnProcess = (_command, _args, options) => {
    const child = new EventEmitter();
    stdout = new EventEmitter();
    stdout.setEncoding = () => {};
    child.stdout = stdout;
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.stdin = {
      write(line) {
        const message = JSON.parse(line);
        sent.push(message);
        queueMicrotask(() => stdout.emit('data', `${JSON.stringify(message.id === 1
          ? { id: 1, result: {} }
          : { id: 2, result: { data: [{ id: 'gpt-test' }] } })}\n`));
      },
    };
    child.kill = () => {};
    return child;
  };

  await listCodexModels({ spawnProcess });
  assert.equal(sent[0].params.clientInfo.version, packageInfo.version);
});
