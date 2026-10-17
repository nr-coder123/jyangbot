'use strict';
/**
 * Balance formulas for staff (World → Balance) and sect recommendations for new players.
 *
 * ① Power Index (PI) — each faction's share of the server's total power, from four pillars:
 *      Military    = Σ army strength (men × average of attack & defence × morale) + Σ champion power of members
 *      Economy     = Σ controlled regions (population × prosperity ÷ 100) + treasury ÷ 50 + workshop profits × 10
 *      Politics    = influence + 20 per treaty + Σ positive relations ÷ 5 + reputation
 *      Cultivation = Σ members (stat total × realm multiplier)
 *    PI = 0.35·Military share + 0.30·Economy share + 0.20·Politics share + 0.15·Cultivation share   (weights editable)
 * ② Balance — fair share = 1 ÷ number of factions.  Each faction's gap = PI − fair share.
 *      HHI (Herfindahl) = Σ PI²: equal to the fair share when perfectly balanced; above 0.25 one faction dominates.
 *      Dominance = top PI ÷ median PI.
 * ③ Recruitment Need (RN, 0–100) — 60 × power deficit + 40 × member deficit, where
 *      power deficit  = max(0, fair − PI) ÷ fair,   member deficit = max(0, average members − members) ÷ average members.
 *    The three playable factions with the highest RN are recommended to new players.
 */
const C = require('./common');
const M = require('./military');
const { num, r2 } = require('../utils');
const { PLAYABLE_KINDS } = require('./state');

function pillars(state, f) {
  const w = state.world;
  const mem = C.members(state, f);
  const armies = w.armies.filter((a) => a.factionId === f.id && a.status !== 'disbanded');
  const military = armies.reduce((s, a) => s + M.armyStrength(state, a), 0) + mem.reduce((s, c) => s + M.championPower(state, c), 0);
  const regions = C.controlled(state, f.id);
  let wsProfit = 0;
  for (const r of Object.values(w.regions)) for (const ws of r.workshops || []) if (ws.owner.type === 'faction' && ws.owner.id === f.id) wsProfit += Math.max(0, num(ws.lastProfit));
  const economy = regions.reduce((s, r) => s + num(r.population) * num(r.prosperity) / 100, 0) + num(f.treasury) / 50 + wsProfit * 10;
  const treaties = w.treaties.filter((t) => t.parties.includes(f.id)).length;
  let goodRel = 0;
  for (const [k, rel] of Object.entries(w.relations)) if (k.split('|').includes(f.id) && rel.value > 0) goodRel += rel.value;
  const politics = num(f.influence) + treaties * 20 + goodRel / 5 + num(f.reputation, 50);
  const mult = w.settings.championRealmMult || [];
  const cultivation = mem.reduce((s, c) => s + (num(c.stats?.strength) + num(c.stats?.endurance) + num(c.stats?.mobility)) * num(mult[c.realm], 1), 0);
  return { military: r2(military), economy: r2(economy), politics: r2(politics), cultivation: r2(cultivation), members: mem.length, regions: regions.length, armies: armies.length, men: armies.reduce((s, a) => s + M.men(a), 0) };
}

function report(state, { includeNpc } = {}) {
  const w = state.world;
  const inc = includeNpc ?? !!w.settings.includeNpcInBalance;
  const list = w.factions.filter((f) => f.active && (inc || !f.npc));
  const rows = list.map((f) => ({ f, p: pillars(state, f) }));
  const totals = {};
  for (const k of ['military', 'economy', 'politics', 'cultivation']) totals[k] = rows.reduce((s, x) => s + x.p[k], 0);
  const wts = w.settings.powerWeights || { military: 0.35, economy: 0.3, politics: 0.2, cultivation: 0.15 };
  // A pillar nobody has yet (e.g. no armies) is left out, so the Power Index always adds up to 100%.
  const wsum = Object.keys(totals).reduce((a, k) => a + (totals[k] > 0 ? num(wts[k]) : 0), 0) || 1;
  for (const k of Object.keys(totals)) if (!totals[k]) totals[k] = 1;
  for (const x of rows) {
    x.share = {};
    for (const k of Object.keys(totals)) x.share[k] = x.p[k] / totals[k];
    x.pi = Object.keys(totals).reduce((s, k) => s + num(wts[k]) * x.share[k], 0) / wsum;
  }
  const n = rows.length || 1;
  const fair = 1 / n;
  const hhi = rows.reduce((s, x) => s + x.pi * x.pi, 0);
  const sorted = [...rows].sort((a, b) => b.pi - a.pi);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].pi : 0;
  const dominance = median > 0 ? sorted[0].pi / median : 0;
  const playable = rows.filter((x) => PLAYABLE_KINDS.includes(x.f.kind) && !x.f.npc);
  const avgMembers = playable.length ? playable.reduce((s, x) => s + x.p.members, 0) / playable.length : 0;
  for (const x of rows) {
    const powerDef = Math.max(0, fair - x.pi) / fair;
    const memberDef = avgMembers > 0 ? Math.max(0, avgMembers - x.p.members) / avgMembers : 0;
    x.need = r2(60 * powerDef + 40 * memberDef);
    x.gap = r2((x.pi - fair) * 100);
  }
  const sect = (x) => state.sects.find((s) => s.name === x.f.sect);
  const recommend = playable.filter((x) => sect(x) ? sect(x).playable !== false : true).sort((a, b) => b.need - a.need).slice(0, 3);
  return {
    rows: sorted.map((x) => ({ id: x.f.id, name: x.f.name, color: x.f.color, icon: x.f.icon, kind: x.f.kind, npc: x.f.npc, pillars: x.p, share: Object.fromEntries(Object.entries(x.share).map(([k, v]) => [k, r2(v * 100)])), pi: r2(x.pi * 100), gap: x.gap, need: x.need })),
    fair: r2(fair * 100), hhi: r2(hhi), hhiFair: r2(fair), dominance: r2(dominance),
    verdict: hhi > 0.25 ? 'One faction dominates' : hhi > fair * 1.6 ? 'Uneven — a few factions lead' : 'Balanced',
    recommend: recommend.map((x) => ({ id: x.f.id, name: x.f.name, sect: x.f.sect, need: x.need, icon: x.f.icon })),
    weights: wts,
  };
}

module.exports = { pillars, report };
