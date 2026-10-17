'use strict';
/** Random and forced world events (low fantasy: weather, harvests, plagues, bandits, politics). */
const geo = require('./geo');
const C = require('./common');
const { num, r2, newId, clamp, weightedPick, UserError } = require('../utils');

const NORTH_Y = 430; // map y above which a region counts as "north" (≈ 37°N)

function regionsForScope(state, ev, key) {
  const w = state.world;
  switch (ev.scope) {
    case 'global': return geo.marketKeys(state);
    case 'province': {
      const p = geo.provinceOf(key);
      return geo.marketKeys(state).filter((k) => geo.provinceOf(k) === p);
    }
    case 'neighbors': return [key];
    case 'faction': {
      const fid = w.regions[key]?.controller;
      return fid ? geo.marketKeys(state).filter((k) => w.regions[k].controller === fid) : [key];
    }
    default: return [key];
  }
}

/** Can this event start in this region now? Returns false or a weight multiplier. */
function eligible(state, ev, key) {
  const w = state.world;
  const r = w.regions[key];
  const c = ev.conditions || {};
  if (!r || ev.enabled === false) return false;
  const cal = C.calendar(state);
  if (c.seasons?.length && !c.seasons.includes(cal.season)) return false;
  if (c.terrains?.length && !c.terrains.includes(r.terrain)) return false;
  if (c.north && (geo.get(key)?.c?.[1] ?? 999) > NORTH_Y) return false;
  if (c.minProsperity !== undefined && r.prosperity < c.minProsperity) return false;
  if (c.maxProsperity !== undefined && r.prosperity > c.maxProsperity) return false;
  if (c.maxSecurity !== undefined && r.security > c.maxSecurity) return false;
  if (c.minPopulation !== undefined && r.population < c.minPopulation) return false;
  if (c.requiresProduction && !(num(r.production[c.requiresProduction]) > 0)) return false;
  if (c.shortage) {
    const t = num(r.targets?.[c.shortage]); const s = num(r.stock?.[c.shortage]);
    if (!(t > 0 && s < t * 0.25)) return false;
  }
  if (c.controllerKinds?.length && !c.controllerKinds.includes(C.faction(state, r.controller)?.kind)) return false;
  if (w.activeEvents.some((a) => a.eventId === ev.id && a.regions.includes(key))) return false;
  if (num(w.cooldowns[`${ev.id}|${key}`]) > w.turn) return false;
  return 1;
}

function rollDuration(ev) {
  const [a, b] = Array.isArray(ev.duration) ? ev.duration : [ev.duration || 4, ev.duration || 4];
  return Math.max(1, Math.round(num(a) + Math.random() * (num(b) - num(a))));
}

/** Apply an onStart block to a region. */
function applyOnce(state, key, once) {
  const r = state.world.regions[key];
  if (!r || !once) return;
  for (const [g, v] of Object.entries(once.stock || {})) {
    for (const good of state.world.goods.filter((x) => x.id === g || x.category === g || g === '*')) r.stock[good.id] = r2(Math.max(0, num(r.stock[good.id]) * (1 + num(v))));
  }
  if (once.population) r.population = r2(Math.max(1, r.population * (1 + num(once.population) / 100)));
  for (const k of ['prosperity', 'security']) if (once[k]) r[k] = r2(clamp(r[k] + num(once[k]), 0, 100));
  if (once.coffers) r.coffers = r2(Math.max(0, Math.abs(num(once.coffers)) < 1 ? r.coffers * (1 + num(once.coffers)) : r.coffers + num(once.coffers)));
  if (once.treasury) { const f = C.faction(state, r.controller); if (f) f.treasury = r2(f.treasury + num(once.treasury)); }
}

/**
 * Start an event. opts: { forced, by, duration, regions (explicit list), announce = true }
 * Returns the active event, or null if a script cancelled it.
 */
function startEvent(state, eventId, key, opts = {}) {
  const w = state.world;
  const ev = w.events.find((e) => e.id === eventId);
  if (!ev) throw new UserError(`Unknown event "${eventId}".`);
  if (!w.regions[key]) throw new UserError('Unknown region.');
  let regions = opts.regions?.length ? opts.regions : regionsForScope(state, ev, key);
  if (ev.scope === 'neighbors' && !opts.regions?.length) regions = [key];
  let ae = { id: newId('ev-'), eventId: ev.id, regions, origin: key, startTurn: w.turn, endTurn: w.turn + (num(opts.duration) || rollDuration(ev)), forced: !!opts.forced, by: opts.by || null, spreadCount: 0, vars: {} };
  if (ev.scriptId) {
    const out = C.runHooks(state, [{ scriptId: ev.scriptId, type: 'event', name: ev.name }], 'eventStart', C.worldCtx(state, { region: C.regionSummary(state, key), event: { id: ev.id, name: ev.name } }), { ...ae, cancel: false });
    if (out && out.cancel) return null;
    if (out && typeof out === 'object') {
      if (Array.isArray(out.regions)) ae.regions = out.regions.filter((k) => w.regions[k]);
      if (out.endTurn) ae.endTurn = num(out.endTurn, ae.endTurn);
      if (out.vars && typeof out.vars === 'object') ae.vars = out.vars;
    }
  }
  for (const k of ae.regions) applyOnce(state, k, ev.onStart);
  w.activeEvents.push(ae);
  for (const k of ae.regions) w.cooldowns[`${ev.id}|${k}`] = ae.endTurn + num(ev.cooldown, 40);
  const names = ae.regions.map((k) => geo.label(state, k));
  ae.text = String(ev.announcement || `${ev.emoji} **${ev.name}** in **{region}**.`)
    .replace(/\{region\}/g, names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', '))
    .replace(/\{province\}/g, geo.label(state, geo.provinceOf(key)))
    .replace(/\{turns\}/g, String(ae.endTurn - ae.startTurn))
    .replace(/\{controller\}/g, C.faction(state, w.regions[key].controller)?.name || 'no one');
  C.wlog(state, 'event', ae.text, { eventId: ev.id, regions: ae.regions, forced: ae.forced });
  if (opts.announce !== false) (w.announceQueue ||= []).push({ kind: 'event', text: ae.text, regions: ae.regions, emoji: ev.emoji, name: ev.name, description: ev.description, endTurn: ae.endTurn });
  // Refugees go to the neighbours of the origin.
  for (const ch of ev.chain || []) if (ch.eventId) w.pendingChains.push({ eventId: ch.eventId, from: key, chance: num(ch.chance, 1), atTurn: ae.startTurn + Math.max(1, num(ch.delay, 1)) });
  return ae;
}

function endEvent(state, id, reason = 'ended') {
  const w = state.world;
  const ae = w.activeEvents.find((e) => e.id === id);
  if (!ae) return null;
  w.activeEvents = w.activeEvents.filter((e) => e.id !== id);
  const ev = w.events.find((e) => e.id === ae.eventId);
  C.wlog(state, 'event', `${ev?.emoji || '•'} ${ev?.name || ae.eventId} ${reason} in ${ae.regions.map((k) => geo.label(state, k)).join(', ')}.`);
  return ae;
}

/** One turn of events: end old ones, spread, chain, roll new ones. Returns started events. */
function tickEvents(state) {
  const w = state.world;
  const s = w.settings;
  const started = [];
  for (const ae of [...w.activeEvents]) if (ae.endTurn <= w.turn) endEvent(state, ae.id);
  // Spreading (epidemics, locusts)
  for (const ae of w.activeEvents) {
    const ev = w.events.find((e) => e.id === ae.eventId);
    if (!ev?.spread || ae.spreadCount >= num(ev.spread.maxRegions, 3)) continue;
    if (Math.random() > num(ev.spread.chance, 0.2)) continue;
    const near = [...new Set(ae.regions.flatMap((k) => geo.neighbors(state, k)))].filter((k) => !ae.regions.includes(k) && eligible(state, ev, k));
    if (!near.length) continue;
    const k = near[Math.floor(Math.random() * near.length)];
    ae.regions.push(k); ae.spreadCount++;
    const evOn = ev.onStart; applyOnce(state, k, evOn);
    const text = `${ev.emoji} The **${ev.name}** spreads to **${geo.label(state, k)}**.`;
    C.wlog(state, 'event', text);
    (w.announceQueue ||= []).push({ kind: 'event', text, regions: [k], emoji: ev.emoji, name: ev.name });
  }
  // Chains (drought → famine, flood → refugees…)
  const due = w.pendingChains.filter((p) => p.atTurn <= w.turn);
  w.pendingChains = w.pendingChains.filter((p) => p.atTurn > w.turn);
  for (const p of due) {
    if (Math.random() > p.chance) continue;
    const ev = w.events.find((e) => e.id === p.eventId);
    if (!ev || ev.enabled === false) continue;
    if (ev.scope === 'neighbors') {
      const targets = geo.neighbors(state, p.from).filter((k) => w.regions[k] && !w.activeEvents.some((a) => a.eventId === ev.id && a.regions.includes(k)));
      if (targets.length) { const ae = startEvent(state, ev.id, targets[0], { regions: targets.slice(0, 3) }); if (ae) started.push(ae); }
      continue;
    }
    // Chained events skip their own random conditions except cooldowns, but famine still needs a real shortage.
    if (ev.conditions?.shortage && !eligible(state, ev, p.from)) continue;
    if (w.activeEvents.some((a) => a.eventId === ev.id && a.regions.includes(p.from))) continue;
    const ae = startEvent(state, ev.id, p.from); if (ae) started.push(ae);
  }
  // Random new events
  const rate = num(s.eventRate, 1);
  if (rate > 0) {
    const candidates = [];
    for (const key of geo.marketKeys(state)) {
      for (const ev of w.events) {
        const ok = eligible(state, ev, key);
        if (!ok) continue;
        // ~1 event per 700 region-turns per weight point (about one new event a turn across the map), × the event rate.
        const chance = num(ev.weight, 1) * rate / 700 * ok;
        if (Math.random() < chance) candidates.push({ ev, key });
      }
    }
    const max = num(s.maxNewEventsPerTurn, 2);
    candidates.sort(() => Math.random() - 0.5);
    for (const { ev, key } of candidates.slice(0, max)) {
      if (!eligible(state, ev, key)) continue;
      const ae = startEvent(state, ev.id, key); if (ae) started.push(ae);
    }
  }
  return started;
}

module.exports = { eligible, startEvent, endEvent, tickEvents, regionsForScope, applyOnce };
