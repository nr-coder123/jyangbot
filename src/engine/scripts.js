'use strict';
/**
 * Tiny custom-code engine. Scripts are written in the dashboard (Scripts tab) and attached
 * to items (cultivation methods, qi cores, martial arts, pills) or special traits.
 *
 * A script assigns functions to `hooks`:
 *   hooks.effects(ctx, fx)                -> fx        (sheet effects / impurity drawbacks)
 *   hooks.qiGain(ctx, amount)             -> number    (Qi actually received)
 *   hooks.breakthroughChance(ctx, chance) -> number    (Realm Breakthrough %)
 *   hooks.consume(ctx, result)            -> result    (pill consumption)
 *
 * Scripts run in an isolated Node `vm` context with a time limit. Data goes in and out as
 * plain JSON copies, so a script can never directly edit the database.
 * NOTE: `vm` is not a hard security boundary — only give dashboard access to people you trust.
 */
const vm = require('vm');
const { clone } = require('../utils');

const TIMEOUT_MS = 150;
const HOOKS = ['effects', 'qiGain', 'breakthroughChance', 'consume', 'regionTick', 'factionTick', 'treatyTick', 'eventStart', 'diplomacy', 'battleRound', 'armyTick', 'shopPrice'];

/** Name of a character reference. kind: 'art' (martial arts, cultivation, qi core), 'trait' or 'item'. */
function refName(state, ref, kind = 'art') {
  if (!ref) return null;
  const pool = kind === 'trait' ? state.traits : kind === 'item' ? state.items : state.arts || [];
  const found = ref.id && pool.find((p) => p.id === ref.id);
  return found ? found.name : ref.name || null;
}

/** Every script that applies to this character, with where it came from. */
function scriptSources(state, c, extraSources = []) {
  const out = [];
  const seen = new Set();
  const add = (scriptId, type, name) => {
    if (!scriptId) return;
    const script = state.scripts.find((s) => s.id === scriptId);
    if (!script || script.enabled === false) return;
    const key = `${scriptId}|${type}|${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ script, source: { type, name } });
  };
  for (const t of c.traits || []) {
    const tr = t && t.id && state.traits.find((x) => x.id === t.id);
    if (tr) add(tr.scriptId, 'trait', tr.name);
  }
  const fromItem = (ref, type) => {
    const it = ref && ref.id && (state.arts || []).find((i) => i.id === ref.id);
    if (it) add(it.scriptId, type, it.name);
  };
  (c.cultivationMethods || []).forEach((r) => fromItem(r, 'cultivation method'));
  fromItem(c.qiCore, 'qi core');
  const w = (c.weaponId && state.items.find((i) => i.id === c.weaponId && (c.inventory?.[i.id] || 0) > 0)) || state.items.find((i) => i.id === state.settings.defaultWeaponId);
  if (w) add(w.scriptId, 'main weapon', w.name);
  for (const [cat, list] of Object.entries(c.martialArts || {})) (list || []).forEach((r) => fromItem(r, `${cat} martial art`));
  for (const e of extraSources) if (e) add(e.scriptId, e.type, e.name);
  return out;
}

function buildContext(state, c, source, extra) {
  const realm = state.realms[c.realm] || {};
  const next = state.realms[(c.realm || 0) + 1] || null;
  const abs = require('./affinity').absorption(state, c);
  return {
    character: {
      id: c.id,
      name: c.name,
      sect: c.sect,
      gender: c.gender,
      realm: realm.name,
      realmIndex: c.realm,
      stats: clone(c.stats),
      pools: clone(c.pools),
      impurity: c.impurity,
      burstApplied: c.burstApplied,
      bonusQiBars: c.bonusQiBars,
      traits: (c.traits || []).map((t) => refName(state, t, 'trait')).filter(Boolean),
      cultivationMethods: (c.cultivationMethods || []).map((r) => refName(state, r)).filter(Boolean),
      qiCore: refName(state, c.qiCore),
      martialArts: Object.fromEntries(Object.entries(c.martialArts || {}).map(([k, v]) => [k, (v || []).map((r) => refName(state, r)).filter(Boolean)])),
      title: c.title || '',
      weapon: (() => {
        const w = (c.weaponId && state.items.find((i) => i.id === c.weaponId && (c.inventory?.[i.id] || 0) > 0)) || state.items.find((i) => i.id === state.settings.defaultWeaponId);
        return w ? { name: w.name, grade: w.weapon?.grade || 'Default', bonuses: clone(w.bonuses || {}) } : null;
      })(),
      nyang: c.nyang,
      absorption: { rate: abs.base, bonus: abs.general, byElement: abs.byElement, impurityReduction: abs.impurityReduction },
      statTotal: (Number(c.stats.strength) || 0) + (Number(c.stats.endurance) || 0) + (Number(c.stats.mobility) || 0),
      breakthroughBonus: c.breakthroughBonus || 0,
      inventory: Object.entries(c.inventory || {}).map(([id, qty]) => ({ name: state.items.find((i) => i.id === id)?.name || id, qty })).filter((x) => x.qty > 0),
    },
    realm: clone(realm),
    nextRealm: next ? clone(next) : null,
    world: worldInfo(state, c),
    source,
    thresholds: clone(state.settings.impurity),
    extra: clone(extra || {}),
  };
}

/** Where and when the character is: season, region, its ruler and events (empty object if the world is off). */
function worldInfo(state, c) {
  if (!state.world?.settings?.enabled) return {};
  try {
    const C = require('../world/common');
    const E = require('../world/economy');
    const geo = require('../world/geo');
    const loc = geo.marketOf(state, E.locationOf(state, c));
    const r = state.world.regions[loc] || {};
    const f = C.factionOfChar(state, c);
    const cal = C.calendar(state);
    return {
      turn: cal.turn, season: cal.season, seasonName: cal.seasonName, year: cal.year,
      region: { key: loc, name: geo.label(state, loc), terrain: r.terrain, prosperity: r.prosperity, controller: r.controller || null, ownLand: !!(f && r.controller === f.id) },
      events: state.world.activeEvents.filter((e) => e.regions.includes(loc)).map((e) => e.eventId),
      faction: f ? { id: f.id, name: f.name } : null,
      travelling: E.isTravelling(c),
    };
  } catch {
    return {};
  }
}

/** Run one hook of one script. Returns { has, value }. Throws on script errors. */
function runHook(script, hook, ctx, arg) {
  const sandbox = { ctx: clone(ctx), __arg: clone(arg), __hook: hook, __out: undefined, __has: false };
  vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const code = `"use strict";\nconst hooks = Object.create(null);\n${script.code || ''}\n;if (typeof hooks[__hook] === "function") { __has = true; const __r = hooks[__hook](ctx, __arg); __out = (__r === undefined ? __arg : __r); }`;
  vm.runInContext(code, sandbox, { timeout: TIMEOUT_MS, filename: `${script.name || script.id}.js` });
  if (!sandbox.__has) return { has: false, value: arg };
  return { has: true, value: JSON.parse(JSON.stringify(sandbox.__out ?? null)) };
}

/** Pass `initial` through the hook of every script on the character, in order. */
function runChain(state, c, hook, initial, { extraSources = [], extra = {} } = {}) {
  let value = initial;
  const errors = [];
  for (const { script, source } of scriptSources(state, c, extraSources)) {
    try {
      const r = runHook(script, hook, buildContext(state, c, source, extra), value);
      if (r.has && r.value !== null && r.value !== undefined) value = r.value;
    } catch (err) {
      errors.push(`${script.name}: ${err.message}`);
    }
  }
  return { value, errors };
}

/** Syntax check without running hooks. Returns null or an error message. */
function checkSyntax(code) {
  try {
    new vm.Script(`"use strict";\nconst hooks = {};\n${code}`, { filename: 'script.js' });
    return null;
  } catch (e) {
    return e.message;
  }
}

module.exports = { HOOKS, scriptSources, buildContext, runHook, runChain, checkSyntax, refName };
