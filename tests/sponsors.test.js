'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadCampaigns, chooseCampaign, recordAggregate } = require('../sponsors');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osin-sponsors-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('loads only active HTTPS campaigns and strips terminal control characters', t => {
  const file = path.join(temporaryDirectory(t), 'campaigns.json');
  fs.writeFileSync(file, JSON.stringify([
    { id: 'valid', sponsor: 'Sponsor', title: 'Safe\u001b[2J title', description: 'A useful tool', url: 'https://example.com', active: true },
    { id: 'insecure', sponsor: 'Sponsor', title: 'HTTP', description: 'No', url: 'http://example.com', active: true },
    { id: 'inactive', sponsor: 'Sponsor', title: 'Off', description: 'No', url: 'https://example.com', active: false },
  ]));
  const campaigns = loadCampaigns(file);
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].title, 'Safe [2J title');
});

test('selects a stable campaign for each day', () => {
  const campaigns = [{ id: 'a' }, { id: 'b' }];
  assert.equal(chooseCampaign(campaigns, 0).id, 'a');
  assert.equal(chooseCampaign(campaigns, 86_400_000).id, 'b');
  assert.equal(chooseCampaign([], 0), null);
});

test('records aggregate impressions and clicks without per-user data', t => {
  const file = path.join(temporaryDirectory(t), 'metrics.json');
  recordAggregate(file, 'campaign-1', 'impressions');
  recordAggregate(file, 'campaign-1', 'clicks');
  recordAggregate(file, 'campaign-1', 'impressions');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    'campaign-1': { impressions: 2, clicks: 1 },
  });
  assert.throws(() => recordAggregate(file, 'campaign-1', 'user-prompts'), /Unsupported/);
  assert.throws(() => recordAggregate(file, 'invalid campaign id', 'clicks'), /Invalid/);
});
