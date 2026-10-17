'use strict';
/** Shared helpers for the world engine: calendar, factions, relations, effect blocks and custom-code hooks. */
const geo = require('./geo');
const W = require('./defaults');
const scripts = require('../engine/scripts');
const { clone, num, r2, norm } = require('../utils');
const { pairKey } = require('./state');

// ─────────── calendar ───────────
function calendar(state, turn = state.world.turn) {
  const s = state.world.settings;
  const tps = Math.max(1, num(s.turnsPerSeason, 28));
  const season = Math.floor(turn / tps) % 4;
  const year = num(s.startYear, 428) + Math.floor(turn / (tps * 4));
  const day = (turn % tps) + 1;
  return { turn, season, seasonName: W.SEASONS[season], emoji: W.SEASON_EMOJI[season], year, day, text: `${W.SEASON_EMOJI[season]} ${W.SEASONS[season]}, day ${day} · Year ${year}${s.eraName ? ` of the ${s.eraName}` : ''}` };
}

// ─────────── factions ───────────
const faction = (state, id) => (id ? state.world.factions.find((f) => f.id === id) || null : null);
const factionOfSect = (state, sectName) => (sectName ? state.world.factions.find((f) => f.sect && norm(f.sect) === norm(sectName)) || null : null);
const factionOfChar = (state, c) => (c ? factionOfSect(state, c.sect) : null);
const members = (state, f) => (f && f.sect ? state.characters.filter((c) => c.status === 'active' && norm(c.sect) === norm(f.sect)) : []);
const isRepresentative = (state, f, c, member) => {
  if (!f || !c) return false;
  if (f.leaderCharId === c.id || f.representatives.includes(c.id)) return true;
  const roles = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
  const repRoles = [f.repRoleId, ...(state.world.settings.representativeRoleIds || [])].filter(Boolean);
  return norm(c.sect) === norm(f.sect) && repRoles.some((r) => roles.includes(r));
};
const controlled = (state, fid) => Object.values(state.world.regions).filter((r) => r.controller === fid && (r.population !== undefined));

// ─────────── relations ───────────
function relation(state, a, b) {
  if (!a || !b || a === b) return { value: 100, war: false, since: 0 };
  const k = pairKey(a, b);
  if (!state.world.relations[k]) state.world.relations[k] = { value: 0, war: false, since: 0 };
  return state.world.relations[k];
}
function addRelation(state, a, b, delta) {
  if (!a || !b || a === b) return;
  const r = relation(state, a, b);
  r.value = r2(Math.max(-100, Math.min(100, r.value + num(delta))));
}
const treatiesBetween = (state, a, b, type) => state.world.treaties.filter((t) => t.parties.includes(a) && t.parties.includes(b) && (!type || t.type === type));
const hasTreaty = (state, a, b, type) => treatiesBetween(state, a, b, type).length > 0;

/** neutral / cordial / friendly / allied / rival / hostile / war */
function stance(state, a, b) {
  if (!a || !b) return 'neutral';
  if (a === b) return 'self';
  const r = relation(state, a, b);
  if (r.war) return 'war';
  if (hasTreaty(state, a, b, 'alliance') || hasTreaty(state, a, b, 'defensive')) return 'allied';
  if (r.value >= 50) return 'friendly';
  if (r.value >= 15) return 'cordial';
  if (r.value <= -50) return 'hostile';
  if (r.value <= num(state.world.settings.rivalBelow, -30)) return 'rival';
  return 'neutral';
}
const STANCE_LABEL = { self: 'Same faction', war: '⚔️ At war', allied: '⚜️ Allied', friendly: '💚 Friendly', cordial: '🙂 Cordial', neutral: '😐 Neutral', rival: '😠 Rival', hostile: '💢 Hostile' };

// ─────────── effect blocks ───────────
const ADD_KEYS = ['prosperity', 'security', 'unrest', 'corruption', 'population', 'caravanRisk', 'tariff', 'coffers', 'supply', 'attrition', 'treasury', 'influence', 'relation', 'fortGrowth', 'noGuildCaravans'];
const MUL_KEYS = ['income', 'tax', 'recruitCost'];
const MAP_KEYS = ['production', 'demand', 'price', 'stockLoss'];

function emptyMods() {
  const m = { sources: [] };
  for (const k of ADD_KEYS) m[k] = 0;
  for (const k of MUL_KEYS) m[k] = 1;
  for (const k of MAP_KEYS) m[k] = {};
  return m;
}
/** Merge an effect block into mods, scaled by `strength` (0–1, used for policy fatigue). */
function applyEffects(m, eff, strength = 1, label = '') {
  if (!eff) return m;
  for (const k of ADD_KEYS) if (eff[k]) m[k] = r2(m[k] + num(eff[k]) * strength);
  for (const k of MUL_KEYS) if (eff[k] !== undefined && eff[k] !== null && eff[k] !== '') m[k] *= 1 + (num(eff[k], 1) - 1) * strength;
  for (const k of MAP_KEYS) {
    for (const [g, v] of Object.entries(eff[k] || {})) {
      if (k === 'stockLoss') m[k][g] = (m[k][g] || 0) + num(v) * strength;
      else m[k][g] = (m[k][g] ?? 1) * (1 + (num(v, 1) - 1) * strength);
    }
  }
  if (label) m.sources.push(label);
  return m;
}
/** Multiplier from a map like { grain: 0.5, food: 0.8, '*': 0.9 } for one good. */
function mulFor(map, good, dflt = 1) {
  if (!map) return dflt;
  let v = 1; let any = false;
  for (const k of [good.id, good.category, '*']) if (map[k] !== undefined) { v *= map[k]; any = true; }
  return any ? v : dflt;
}
function addFor(map, good) {
  if (!map) return 0;
  return [good.id, good.category, '*'].reduce((a, k) => a + num(map[k]), 0);
}

/** How strong a policy still is after `turns` turns (fatigue). */
function policyStrength(p, turns) {
  if (!p.fatigue) return 1;
  const over = turns - num(p.grace, 10);
  return over <= 0 ? 1 : Math.max(num(p.floor, 0.4), 1 - num(p.fatigue) * over);
}

// ─────────── custom code ───────────
function regionSummary(state, key) {
  const r = state.world.regions[key];
  if (!r) return null;
  const f = faction(state, r.controller);
  return {
    key, name: geo.label(state, key), province: geo.provinceOf(key), special: !!r.special, terrain: r.terrain, population: r.population, prosperity: r.prosperity,
    security: r.security, unrest: r.unrest, corruption: r.corruption, fort: r.fort, coffers: r.coffers, taxRate: r.taxRate,
    controller: f ? { id: f.id, name: f.name, kind: f.kind } : null,
    stock: clone(r.stock || {}), prices: clone(r.prices || {}), production: clone(r.production || {}),
    events: state.world.activeEvents.filter((e) => e.regions.includes(key)).map((e) => e.eventId),
    policies: activePolicyIds(state, key),
  };
}
function factionSummary(state, f) {
  if (!f) return null;
  return { id: f.id, name: f.name, kind: f.kind, alignment: f.alignment, sect: f.sect, treasury: f.treasury, influence: f.influence, reputation: f.reputation, hq: f.hq, members: members(state, f).length, regions: controlled(state, f.id).map((r) => r.key), policies: f.policies.map((p) => p.policyId) };
}
function worldCtx(state, extra = {}) {
  return { world: { ...calendar(state) }, ...extra };
}
/** Run `hook` of every script in `sources` ({ scriptId, type, name }), passing `value` through. */
function runHooks(state, sources, hook, ctx, value) {
  const errors = [];
  for (const s of sources) {
    if (!s || !s.scriptId) continue;
    const script = state.scripts.find((x) => x.id === s.scriptId);
    if (!script || script.enabled === false) continue;
    try {
      const r = scripts.runHook(script, hook, { ...ctx, source: { type: s.type, name: s.name } }, value);
      if (r.has && r.value !== null && r.value !== undefined) value = r.value;
    } catch (e) {
      errors.push(`${script.name}: ${e.message}`);
    }
  }
  if (errors.length) state.world.scriptErrors = [...errors, ...(state.world.scriptErrors || [])].slice(0, 30);
  return value;
}

function activePolicyIds(state, key) {
  const r = state.world.regions[key];
  if (!r) return [];
  const out = (r.policies || []).map((p) => p.policyId);
  const f = faction(state, r.controller);
  if (f) for (const p of f.policies) if (!p.region) out.push(p.policyId);
  return [...new Set(out)];
}

/** Everything that modifies a region this turn: events, policies, treaties, scripts. */
function regionMods(state, key) {
  const w = state.world;
  const r = w.regions[key];
  const m = emptyMods();
  if (!r) return m;
  const sources = [];
  for (const ae of w.activeEvents) {
    if (!ae.regions.includes(key)) continue;
    const ev = w.events.find((e) => e.id === ae.eventId) || ae.custom;
    if (!ev) continue;
    applyEffects(m, ev.effects, 1, `${ev.emoji || ''} ${ev.name}`);
    sources.push({ scriptId: ev.scriptId, type: 'event', name: ev.name });
  }
  const f = faction(state, r.controller);
  const pol = [];
  for (const p of r.policies || []) pol.push(p);
  if (f) for (const p of f.policies) if (!p.region) pol.push({ ...p, factionId: f.id });
  for (const p of pol) {
    const def = w.policies.find((x) => x.id === p.policyId);
    if (!def || def.enabled === false) continue;
    const strength = policyStrength(def, w.turn - num(p.since));
    const eff = { ...def.effects };
    // Treasury/influence from faction-wide policies are counted once per faction (see factions.js), not per region.
    delete eff.treasury; delete eff.influence; delete eff.relation;
    applyEffects(m, eff, strength, `${def.emoji} ${def.name}${strength < 1 ? ` (${Math.round(strength * 100)}%)` : ''}`);
    sources.push({ scriptId: def.scriptId, type: 'policy', name: def.name });
  }
  if (f) {
    for (const t of w.treaties.filter((t) => t.parties.includes(f.id))) {
      if (t.effects && Object.keys(t.effects).length) applyEffects(m, t.effects, 1, `${t.name}`);
      if (t.scriptId) sources.push({ scriptId: t.scriptId, type: 'treaty', name: t.name });
    }
    sources.push({ scriptId: f.scriptId, type: 'faction', name: f.name });
  }
  if (r.occupiedBy) applyEffects(m, { prosperity: -0.6, unrest: 1, security: -1, tax: 0.6 }, 1, '🏴 Occupied');
  sources.push({ scriptId: r.scriptId, type: 'region', name: geo.label(state, key) });
  if (sources.some((s) => s.scriptId)) {
    const ctx = worldCtx(state, { region: regionSummary(state, key), faction: factionSummary(state, f) });
    const before = clone(m);
    const out = runHooks(state, sources, 'regionTick', ctx, before);
    if (out && typeof out === 'object') {
      for (const k of ADD_KEYS) if (out[k] !== undefined) m[k] = num(out[k]);
      for (const k of MUL_KEYS) if (out[k] !== undefined) m[k] = num(out[k], 1);
      for (const k of MAP_KEYS) if (out[k] && typeof out[k] === 'object') m[k] = out[k];
      if (Array.isArray(out.sources)) m.sources = out.sources.map(String).slice(0, 30);
      if (Array.isArray(out.notes)) m.notes = out.notes.map(String).slice(0, 10);
    }
  }
  return m;
}

function wlog(state, kind, text, extra = {}) {
  const w = state.world;
  w.log.unshift({ at: new Date().toISOString(), turn: w.turn, kind, text, ...extra });
  if (w.log.length > 400) w.log.length = 400;
}

module.exports = {
  calendar, faction, factionOfSect, factionOfChar, members, isRepresentative, controlled,
  relation, addRelation, treatiesBetween, hasTreaty, stance, STANCE_LABEL,
  emptyMods, applyEffects, mulFor, addFor, policyStrength, regionMods, activePolicyIds, regionSummary, factionSummary, worldCtx, runHooks, wlog,
  ADD_KEYS, MUL_KEYS, MAP_KEYS,
};
