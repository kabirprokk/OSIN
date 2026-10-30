'use strict';

const fs = require('fs');
const { URL } = require('url');

function loadCampaigns(file) {
  try {
    const records = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(records)) return [];
    const now = Date.now();
    const active = records.filter(campaign => {
      if (!campaign || campaign.active !== true || typeof campaign.id !== 'string' ||
          !/^[a-zA-Z0-9._-]{1,80}$/.test(campaign.id) ||
          !campaign.sponsor || !campaign.title || !campaign.description || !campaign.url ||
          typeof campaign.title !== 'string' || typeof campaign.description !== 'string') return false;
      try {
        const target = new URL(campaign.url);
        if (target.protocol !== 'https:') return false;
      } catch { return false; }
      const start = campaign.startsAt ? Date.parse(campaign.startsAt) : -Infinity;
      const end = campaign.endsAt ? Date.parse(campaign.endsAt) : Infinity;
      return Number.isFinite(start) || start === -Infinity
        ? (Number.isFinite(end) || end === Infinity) && start <= now && now < end
        : false;
    });
    const clean = text => text.replace(/[\u0000-\u001f\u007f\u001b]/g, ' ').replace(/\s+/g, ' ').trim();
    return active.map(campaign => ({
      ...campaign,
      sponsor: clean(String(campaign.sponsor)),
      title: clean(campaign.title),
      description: clean(campaign.description),
    }));
  } catch {
    return [];
  }
}

function chooseCampaign(campaigns, at = Date.now()) {
  if (!campaigns.length) return null;
  const day = Math.floor(at / 86_400_000);
  return campaigns[((day % campaigns.length) + campaigns.length) % campaigns.length];
}

function recordAggregate(file, campaignId, event) {
  if (!['impressions', 'clicks'].includes(event)) throw new Error('Unsupported sponsor metric');
  if (typeof campaignId !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(campaignId)) {
    throw new Error('Invalid sponsor campaign ID');
  }
  let totals = Object.create(null);
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) totals = existing;
  } catch {}
  if (!Object.prototype.hasOwnProperty.call(totals, campaignId)) totals[campaignId] = { impressions: 0, clicks: 0 };
  totals[campaignId][event] = (Number(totals[campaignId][event]) || 0) + 1;
  fs.writeFileSync(file, JSON.stringify(totals, null, 2) + '\n', 'utf8');
}

module.exports = { loadCampaigns, chooseCampaign, recordAggregate };
