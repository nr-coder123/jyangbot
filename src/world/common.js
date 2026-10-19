'use strict';
/** Shared helpers for the world engine: calendar, factions, relations, effect blocks and custom-code hooks. */
const geo = require('./geo');
const W = require('./defaults');
const scripts = require('../engine/scripts');
const { clone, num, r2, norm } = require('../utils');

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

// ─────────── wars, alliances, agreements ───────────
// There are no relation numbers: how factions feel about each other is role-played. The bot only knows
// who is at war, who shares an alliance and which agreements exist.
const allianceOf = (state, fid) => (fid ? (state.world.alliances || []).find((a) => a.members.includes(fid)) || null : null);
const sameAlliance = (state, a, b) => !!(a && b && a !== b && allianceOf(state, a) && allianceOf(state, a) === allianceOf(state, b));
const warsOf = (state, fid) => (state.world.wars || []).filter((x) => x.attackers.includes(fid) || x.defenders.includes(fid));
function warBetween(state, a, b) {
  if (!a || !b || a === b) return null;
  return (state.world.wars || []).find((x) => (x.attackers.includes(a) && x.defenders.includes(b)) || (x.attackers.includes(b) && x.defenders.includes(a))) || null;
}
const atWar = (state, a, b) => !!warBetween(state, a, b);
/** Has either side closed its markets to the other? */
const embargo = (state, a, b) => { const A = faction(state, a); const B = faction(state, b); return !!(A && B && (A.embargoes?.includes(b) || B.embargoes?.includes(a))); };
const agreementsBetween = (state, a, b) => (state.world.agreements || []).filter((t) => t.parties.includes(a) && t.parties.includes(b));
/** Does a perk (militaryAccess, freeTrade, nonAggression, defensive, callToArms) hold between a and b? */
function hasPerk(state, a, b, perk) {
  if (!a || !b || a === b) return false;
  if (sameAlliance(state, a, b) && allianceOf(state, a).terms?.[perk]) return true;
  return agreementsBetween(state, a, b).some((t) => t.perks?.[perk]);
}
/** self / war / allied / agreement / neutral */
function stance(state, a, b) {
  if (!a || !b) return 'neutral';
  if (a === b) return 'self';
  if (atWar(state, a, b)) return 'war';
  if (sameAlliance(state, a, b)) return 'allied';
  if (agreementsBetween(state, a, b).length) return 'agreement';
  return 'neutral';
}
const STANCE_LABEL = { self: 'Same faction', war: 'At war', allied: 'Allied', agreement: 'Has an agreement', neutral: 'Neutral' };

// ─────────── effect blocks ───────────
const ADD_KEYS = ['prosperity', 'security', 'population', 'caravanRisk', 'tariff', 'coffers', 'supply', 'attrition', 'treasury', 'fortGrowth', 'noGuildCaravans'];
const MUL_KEYS = ['income', 'tax', 'recruitCost', 'manpower'];
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
    security: r.security, fort: r.fort, coffers: r.coffers, taxRate: r.taxRate, buildings: (r.buildings || []).filter((b) => b.status === 'ready').map((b) => b.typeId),
    controller: f ? { id: f.id, name: f.name, kind: f.kind } : null,
    stock: clone(r.stock || {}), prices: clone(r.prices || {}), production: clone(r.production || {}),
    events: state.world.activeEvents.filter((e) => e.regions.includes(key)).map((e) => e.eventId),
    decrees: activeDecrees(state, key).map((d) => d.name),
  };
}
function factionSummary(state, f) {
  if (!f) return null;
  return { id: f.id, name: f.name, kind: f.kind, alignment: f.alignment, sect: f.sect, treasury: f.treasury, hq: f.hq, members: members(state, f).length, regions: controlled(state, f.id).map((r) => r.key), decrees: require('./decrees').active(state, f).map((d) => d.name), alliance: allianceOf(state, f.id)?.name || '', wars: warsOf(state, f.id).map((x) => x.name) };
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

/** Names of the decrees in force in a region (its ruler's). */
function activeDecrees(state, key) {
  return require('./decrees').decreesIn(state, key);
}

/** Everything that modifies a region this turn: events, decrees, treaties, scripts. */
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
  // Decrees of the ruler (staff-made effects of what the faction does in role-play).
  const DC = require('./decrees');
  for (const d of DC.decreesIn(state, key)) {
    applyEffects(m, DC.effectsOf(d), 1, `${d.emoji} ${d.name}`);
    if (d.scriptId) sources.push({ scriptId: d.scriptId, type: 'decree', name: d.name });
  }
  if (f) {
    for (const t of (w.agreements || []).filter((t) => t.parties.includes(f.id))) {
      if (t.effects && Object.keys(t.effects).length) applyEffects(m, t.effects, 1, `${t.name}`);
      if (t.scriptId) sources.push({ scriptId: t.scriptId, type: 'agreement', name: t.name });
    }
    const al = allianceOf(state, f.id);
    if (al) {
      if (al.effects && Object.keys(al.effects).length) applyEffects(m, al.effects, 1, al.name);
      if (al.scriptId) sources.push({ scriptId: al.scriptId, type: 'alliance', name: al.name });
    }
    sources.push({ scriptId: f.scriptId, type: 'faction', name: f.name });
  }
  // Buildings: damaged ones (under half strength) work at half effect; unfinished ones do nothing.
  for (const b of r.buildings || []) {
    if (b.status !== 'ready') continue;
    const def = (w.buildingTypes || []).find((x) => x.id === b.typeId);
    if (!def) continue;
    applyEffects(m, def.effects, b.hp < 50 ? 0.5 : 1, `${def.name}${b.hp < 50 ? ' (damaged)' : ''}`);
    if (def.scriptId) sources.push({ scriptId: def.scriptId, type: 'building', name: def.name });
  }
  if (r.occupiedBy) applyEffects(m, { prosperity: -0.6, security: -1, tax: 0.6 }, 1, 'Occupied');
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

/** Walls of a region in battle: its base walls (fort, 0–10) plus finished City Walls (+1 per level; below half strength they don't count). */
function wallsOf(state, key) {
  const r = state.world.regions[key];
  if (!r) return 0;
  let f = num(r.fort);
  for (const b of r.buildings || []) if (b.status === 'ready' && b.hp >= 50) f += num((state.world.buildingTypes || []).find((x) => x.id === b.typeId)?.fort) * num(b.level, 1);
  return f;
}

function wlog(state, kind, text, extra = {}) {
  const w = state.world;
  w.log.unshift({ at: new Date().toISOString(), turn: w.turn, kind, text, ...extra });
  if (w.log.length > 400) w.log.length = 400;
}

module.exports = {
  calendar, faction, factionOfSect, factionOfChar, members, isRepresentative, controlled,
  allianceOf, sameAlliance, warsOf, warBetween, atWar, embargo, agreementsBetween, hasPerk, stance, STANCE_LABEL, wallsOf,
  emptyMods, applyEffects, mulFor, addFor, policyStrength, regionMods, activeDecrees, regionSummary, factionSummary, worldCtx, runHooks, wlog,
  ADD_KEYS, MUL_KEYS, MAP_KEYS,
};
