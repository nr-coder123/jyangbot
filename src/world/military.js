'use strict';
/**
 * Armies, formations and battles (Europa Universalis–style; see resolveBattle for the formula).
 *
 * When hostile armies meet, a battle opens with a preparation window (default 24 h, real time). During it, each side
 * picks a formation and a commander, champions (player characters) join, and staff record in-character duels:
 * every duel won gives that side +1 die (max 2); a defeated commander leaves the field and shakes the army.
 * When the window closes the battle is simulated day by day in the region where it is fought (terrain, walls, width).
 * Custom code: armies, factions, formations and regions may define hooks.battleRound (each 3-day phase) and
 * armies may define hooks.armyTick (each turn).
 */
const geo = require('./geo');
const C = require('./common');
const E = require('./economy');
const { num, r2, clamp, newId, UserError } = require('../utils');

const unitType = (state, id) => state.world.unitTypes.find((u) => u.id === id) || null;
const formation = (state, id) => state.world.formations.find((f) => f.id === id) || null;
const army = (state, id) => state.world.armies.find((a) => a.id === id) || null;
const men = (a) => E.armyMen(a);

function composition(state, units) {
  const total = Object.values(units).reduce((s, n) => s + num(n), 0) || 1;
  const share = {};
  for (const [id, n] of Object.entries(units)) { const u = unitType(state, id); if (u) share[u.role] = (share[u.role] || 0) + num(n) / total; }
  return share;
}

/** Rough strength used by the map, the Balance tab and the AI-free "who is stronger" hints. */
function armyStrength(state, a) {
  let s = 0;
  for (const [id, n] of Object.entries(a.units || {})) { const u = unitType(state, id); if (u) s += num(n) * (num(u.attack) + num(u.defense)) / 2; }
  return r2(s * (0.5 + num(a.morale, 70) / 200));
}

function championPower(state, c) {
  if (!c) return 0;
  const mult = state.world.settings.championRealmMult || [];
  const total = num(c.stats?.strength) + num(c.stats?.endurance) + num(c.stats?.mobility);
  return r2(total * num(mult[c.realm], 1) * num(state.world.settings.championScale, 1));
}

function canCommand(state, c, f, member) {
  return !!(c && f && (C.isRepresentative(state, f, c, member) || state.world.armies.some((a) => a.factionId === f.id && a.commanderId === c.id)));
}

// ─────────── recruiting & moving ───────────
function recruitCost(state, regionKey, f, unitId, count) {
  const u = unitType(state, unitId);
  if (!u) throw new UserError('Unknown troop type.');
  const r = state.world.regions[regionKey];
  const mods = C.regionMods(state, regionKey);
  const hundreds = count / 100;
  const nyang = r2(num(u.cost) * hundreds * num(mods.recruitCost, 1));
  // Equipment comes from the local market; whatever the market doesn't have is ordered from the smiths at 2.5× base price.
  const goods = {}; const rush = {}; let goodsCost = 0;
  for (const [g, q] of Object.entries(u.needs || {})) {
    const need = r2(num(q) * hundreds);
    const have = Math.max(0, Math.floor(num(r.stock[g])));
    goods[g] = Math.min(need, have);
    rush[g] = r2(need - goods[g]);
    const base = E.good(state, g)?.basePrice || 0;
    goodsCost += goods[g] * num(r.prices[g], base) + rush[g] * base * 2.5;
  }
  return { nyang, goods, rush, goodsCost: r2(goodsCost), total: r2(nyang + goodsCost) };
}

function recruit(state, f, regionKey, unitId, count, { name, staff = false } = {}) {
  const w = state.world;
  count = Math.floor(num(count));
  if (count < 50) throw new UserError('Recruit at least 50 men.');
  const r = w.regions[geo.marketOf(state, regionKey)];
  regionKey = geo.marketOf(state, regionKey);
  if (!r) throw new UserError('Unknown region.');
  const u = unitType(state, unitId);
  if (!u) throw new UserError('Unknown troop type.');
  if (u.kinds?.length && !u.kinds.includes(f.kind) && !staff) throw new UserError(`Only ${u.kinds.join('/')} factions can raise ${u.name}.`);
  if (!staff && r.controller !== f.id && f.hq !== regionKey) throw new UserError(`${f.name} can only recruit in regions it controls.`);
  // Each market can only raise so many men per turn: a share of its population.
  const raisedThisTurn = num(r.last?.raised?.[w.turn]);
  const cap = Math.max(300, Math.floor(r.population * 40));
  if (!staff && raisedThisTurn + count > cap) throw new UserError(`${geo.label(state, regionKey)} can only raise ${cap - raisedThisTurn} more men this turn.`);
  const cost = recruitCost(state, regionKey, f, unitId, count);
  if (!staff && f.treasury < cost.total) throw new UserError(`Costs ${cost.total} (troops ${cost.nyang} + equipment ${cost.goodsCost}). ${f.name} has ${Math.floor(f.treasury)}.`);
  if (!staff) f.treasury = r2(f.treasury - cost.total);
  for (const [g, q] of Object.entries(cost.goods)) { r.stock[g] = r2(num(r.stock[g]) - q); r.coffers = r2(r.coffers + q * num(r.prices[g])); }
  r.population = r2(Math.max(1, r.population - count / 2000));
  r.last = { ...r.last, raised: { [w.turn]: raisedThisTurn + count } };
  let a = w.armies.find((x) => x.factionId === f.id && x.region === regionKey && x.status === 'garrison' && (!name || x.name === name));
  if (!a) {
    a = { id: newId('ar-'), name: name || `${f.name} — ${geo.label(state, regionKey)} Army`, factionId: f.id, region: regionKey, units: {}, commanderId: '', champions: [], morale: 70, supply: 100, formationId: 'square', status: 'garrison', march: null, createdTurn: w.turn, scriptId: '' };
    w.armies.push(a);
  }
  a.units[unitId] = num(a.units[unitId]) + count;
  C.wlog(state, 'army', `🪖 **${f.name}** raised ${count} ${u.name} in **${geo.label(state, regionKey)}**.`);
  return { army: a, cost };
}

function canEnter(state, a, key) {
  const r = state.world.regions[key];
  if (!r?.controller || r.controller === a.factionId) return 'own';
  if (C.atWar(state, a.factionId, r.controller)) return 'enemy';
  if (C.hasPerk(state, a.factionId, r.controller, 'militaryAccess')) return 'friendly';
  return 'foreign';
}

function marchTo(state, a, to) {
  const rt = geo.route(state, a.region, to);
  if (!rt || rt.hops === 0) throw new UserError('No route (or already there).');
  // Armies may cross anyone's land; without Military Access (or war) they lose supply there (see tickArmies).
  a.march = { path: rt.path, step: 0, progress: 0 };
  a.status = 'marching';
  rt.turns = Math.ceil(rt.hops / Math.max(0.1, slowestSpeed(state, a)));
  C.wlog(state, 'army', `🚩 **${a.name}** marches from ${geo.label(state, a.region)} to **${geo.label(state, to)}** (${rt.hops} stage${rt.hops > 1 ? 's' : ''}, about ${rt.turns} turn${rt.turns > 1 ? 's' : ''}).`);
  return rt;
}

/** March speed (map stages per turn): the slowest troops set the pace; guides and qinggong runners speed it up. */
function slowestSpeed(state, a) {
  let s = 2; let bonus = 0;
  const total = men(a) || 1;
  for (const [id, n] of Object.entries(a.units)) {
    if (num(n) <= 0) continue;
    const u = unitType(state, id);
    s = Math.min(s, num(u?.speed, 1));
    if (num(n) / total >= 0.05) bonus = Math.max(bonus, num(u?.marchBonus));
  }
  const f = formation(state, a.formationId);
  return s * (1 + bonus) * num(f?.speed, 1);
}

// ─────────── each turn ───────────
function tickArmies(state) {
  const w = state.world;
  const notes = [];
  for (const a of w.armies) {
    if (a.status === 'disbanded') continue;
    const f = C.faction(state, a.factionId);
    // Upkeep
    let upkeep = 0;
    for (const [id, n] of Object.entries(a.units)) upkeep += num(unitType(state, id)?.upkeep) * num(n) / 100;
    upkeep = r2(upkeep);
    if (f && f.treasury >= upkeep) { f.treasury = r2(f.treasury - upkeep); if (f.lastIncome) f.lastIncome.armies = r2(num(f.lastIncome.armies) - upkeep); } else {
      a.morale = r2(clamp(a.morale - 10, 0, 100));
      for (const k of Object.keys(a.units)) a.units[k] = Math.floor(a.units[k] * 0.95);
      notes.push(`💸 ${a.name} was not paid: morale falls and men desert.`);
    }
    // Movement
    if (a.status === 'marching' && a.march) {
      a.march.progress += slowestSpeed(state, a);
      while (a.march.progress >= 1 && a.march.step < a.march.path.length - 1) {
        a.march.progress -= 1; a.march.step += 1; a.region = a.march.path[a.march.step];
        if (enemiesIn(state, a, a.region).length) break; // stop to fight
      }
      if (a.march.step >= a.march.path.length - 1) { a.status = 'garrison'; a.march = null; C.wlog(state, 'army', `🏕️ **${a.name}** arrived in **${geo.label(state, a.region)}**.`); }
    }
    // Custom code on the army itself (e.g. a famous banner that keeps morale up).
    if (a.scriptId) {
      const out = C.runHooks(state, [{ scriptId: a.scriptId, type: 'army', name: a.name }], 'armyTick', C.worldCtx(state, { army: { id: a.id, name: a.name, faction: f?.name || '', region: a.region, units: { ...a.units }, morale: a.morale, supply: a.supply, status: a.status }, region: C.regionSummary(state, geo.marketOf(state, a.region)) }), { morale: 0, supply: 0, attrition: 0, notes: [] });
      if (out && typeof out === 'object') {
        a.morale = r2(clamp(a.morale + num(out.morale), 0, 100)); a.supply = r2(clamp(a.supply + num(out.supply), 0, 100));
        if (num(out.attrition)) for (const k of Object.keys(a.units)) a.units[k] = Math.max(0, Math.floor(a.units[k] * (1 - num(out.attrition) / 100)));
        (out.notes || []).forEach((n) => notes.push(`${a.name}: ${n}`));
      }
    }
    // Supply & attrition
    const r = w.regions[a.region];
    const terrain = w.terrains[r?.terrain] || {};
    const mods = C.regionMods(state, a.region);
    const where = canEnter(state, a, a.region);
    let ds = where === 'enemy' ? -8 : where === 'foreign' ? -4 : num(r?.last?.armyFed, 1) >= 0.8 ? 10 : -5;
    ds += num(terrain.supply) + num(mods.supply);
    a.supply = r2(clamp(a.supply + ds, 0, 100));
    if (where === 'enemy' && r) { r.prosperity = r2(Math.max(0, r.prosperity - 0.5)); r.stock.grain = r2(num(r.stock.grain) * 0.97); }
    let attr = num(mods.attrition) + (a.supply < 20 ? 3 : a.supply < 40 ? 1 : 0);
    if (attr > 0) for (const k of Object.keys(a.units)) a.units[k] = Math.floor(a.units[k] * (1 - attr / 100));
    a.morale = r2(clamp(a.morale + (a.supply > 50 ? 2 : -2) + (a.morale < 70 ? 1 : 0), 0, 100));
    for (const k of Object.keys(a.units)) if (a.units[k] <= 0) delete a.units[k];
    if (!men(a)) { a.status = 'disbanded'; notes.push(`🪦 ${a.name} has dissolved.`); }
  }
  w.armies = w.armies.filter((a) => a.status !== 'disbanded' || w.turn - num(a.disbandedTurn, w.turn) < 1);
  w.armies = w.armies.filter((a) => a.status !== 'disbanded');
  // New battles & occupation
  for (const key of new Set(w.armies.map((a) => a.region))) {
    const here = w.armies.filter((a) => a.region === key && !inBattle(state, a.id));
    const byFaction = groupBy(here, (a) => a.factionId);
    const fids = Object.keys(byFaction);
    let fought = false;
    for (let i = 0; i < fids.length && !fought; i++) for (let j = i + 1; j < fids.length && !fought; j++) {
      if (C.atWar(state, fids[i], fids[j])) {
        const r = w.regions[key];
        const def = r?.controller === fids[j] ? fids[j] : fids[i] === r?.controller ? fids[i] : fids[j];
        const att = def === fids[i] ? fids[j] : fids[i];
        openBattle(state, key, byFaction[att].map((a) => a.id), byFaction[def].map((a) => a.id));
        fought = true;
      }
    }
    if (fought) continue;
    // Occupation: an army at war with the controller, unopposed, occupies the region.
    const r = w.regions[key];
    if (!r?.controller) continue;
    const occupier = here.find((a) => a.status === 'garrison' && a.factionId !== r.controller && C.atWar(state, a.factionId, r.controller));
    if (occupier && !here.some((a) => a.factionId === r.controller)) {
      if (r.occupiedBy !== occupier.factionId) { r.occupiedBy = occupier.factionId; r.occupiedSince = w.turn; C.wlog(state, 'war', `🏴 **${C.faction(state, occupier.factionId)?.name}** occupies **${geo.label(state, key)}**.`); (w.announceQueue ||= []).push({ kind: 'war', text: `🏴 **${C.faction(state, occupier.factionId)?.name}** occupies **${geo.label(state, key)}**!`, regions: [key] }); }
      else if (w.turn - r.occupiedSince >= num(w.settings.occupationTurns, 12)) {
        // A long occupation becomes a takeover: automatic if staff allow it, otherwise waiting for their approval.
        const T = require('./territory');
        const asked = w.takeovers.some((t) => t.source === 'conquest' && t.regions.includes(key) && t.to === r.occupiedBy && t.turn >= r.occupiedSince);
        if (w.settings.autoConquest) T.forceTakeover(state, { regions: [key], to: r.occupiedBy, reason: 'Conquered after a long occupation', by: { name: 'war' } });
        else if (!asked) { T.requestTakeover(state, { regions: [key], to: r.occupiedBy, reason: `Occupied for ${w.turn - r.occupiedSince} turns`, source: 'conquest', by: { name: C.faction(state, r.occupiedBy)?.name || '' } }); }
      }
    } else if (r.occupiedBy && !here.some((a) => a.factionId === r.occupiedBy)) { r.occupiedBy = null; C.wlog(state, 'war', `🏳️ **${geo.label(state, key)}** is free of occupation.`); }
  }
  return notes;
}
const groupBy = (list, fn) => list.reduce((m, x) => ((m[fn(x)] ||= []).push(x), m), {});
const enemiesIn = (state, a, key) => state.world.armies.filter((b) => b.region === key && b.factionId !== a.factionId && b.status !== 'disbanded' && C.atWar(state, a.factionId, b.factionId));
const inBattle = (state, armyId) => state.world.battles.some((b) => b.status === 'preparing' && [...b.sides.A.armies, ...b.sides.D.armies].includes(armyId));

// ─────────── battles ───────────
function openBattle(state, regionKey, attackerIds, defenderIds, { hours, by } = {}) {
  const w = state.world;
  const side = (ids) => {
    const first = army(state, ids[0]);
    return { factionId: first?.factionId, armies: ids, formationId: first?.formationId || 'square', champions: [...new Set(ids.flatMap((id) => army(state, id)?.champions || []))].filter((cid) => !isNonCombatant(state, cid)), commanderId: first?.commanderId || '', momentum: 0, moraleShock: 0, commanderFallen: false, ready: false };
  };
  const prep = num(hours, num(w.settings.battlePrepHours, 24));
  const b = { id: newId('bt-'), region: regionKey, sides: { A: side(attackerIds), D: side(defenderIds) }, status: 'preparing', openedTurn: w.turn, openedAt: new Date().toISOString(), resolveAt: new Date(Date.now() + prep * 3600000).toISOString(), duels: [], days: [], phases: [], result: null, by: by || null, messages: [] };
  for (const id of [...attackerIds, ...defenderIds]) { const a = army(state, id); if (a) a.status = 'battle'; }
  w.battles.unshift(b);
  if (w.battles.length > 60) w.battles.length = 60;
  const A = C.faction(state, b.sides.A.factionId); const D = C.faction(state, b.sides.D.factionId);
  const text = `⚔️ **Battle of ${geo.label(state, regionKey)}** — **${A?.name}** attacks **${D?.name}**. The armies deploy; the battle begins <t:${Math.floor(Date.parse(b.resolveAt) / 1000)}:R>. Champions may duel before then.`;
  C.wlog(state, 'war', text);
  (w.announceQueue ||= []).push({ kind: 'battle', text, battleId: b.id, regions: [regionKey] });
  return b;
}
function isNonCombatant(state, cid) {
  const c = typeof cid === 'string' ? state.characters.find((x) => x.id === cid) : cid;
  return !!c && require('./territory').isNonCombatant(state, c);
}

function battle(state, id) { const b = state.world.battles.find((x) => x.id === id); if (!b) throw new UserError('Battle not found.'); return b; }
function sideOf(state, b, factionId) { return b.sides.A.factionId === factionId ? 'A' : b.sides.D.factionId === factionId ? 'D' : null; }

function setPlan(state, b, sideKey, { formationId, commanderId } = {}) {
  if (b.status !== 'preparing') throw new UserError('This battle has already been fought.');
  const s = b.sides[sideKey];
  if (commanderId !== undefined) {
    if (commanderId && isNonCombatant(state, commanderId)) throw new UserError('Representatives lead their faction in politics, not on the battlefield (dashboard → World → Settings → “Representatives may fight”).');
    s.commanderId = commanderId;
  }
  if (formationId) {
    const f = formation(state, formationId); if (!f) throw new UserError('Unknown formation.');
    const why = formationProblem(state, b, sideKey, f); if (why) throw new UserError(why);
    s.formationId = formationId;
  }
  return s;
}
function sideUnits(state, b, sideKey) {
  const units = {};
  for (const id of b.sides[sideKey].armies) { const a = army(state, id); if (a) for (const [k, n] of Object.entries(a.units)) units[k] = num(units[k]) + num(n); }
  return units;
}
function formationProblem(state, b, sideKey, f) {
  const req = f.requires || {};
  const units = sideUnits(state, b, sideKey);
  const total = Object.values(units).reduce((a, n) => a + n, 0);
  if (req.minMen && total < req.minMen) return `${f.name} needs at least ${req.minMen} men.`;
  const comp = composition(state, units);
  for (const [role, share] of Object.entries(req.roles || {})) if (num(comp[role]) < share) return `${f.name} needs at least ${Math.round(share * 100)}% ${role}.`;
  if (req.commanderRealm !== undefined && req.commanderRealm !== null && req.commanderRealm !== '') {
    const cmd = state.characters.find((c) => c.id === b.sides[sideKey].commanderId);
    if (!cmd || num(cmd.realm) < num(req.commanderRealm)) return `${f.name} needs a commander of the ${state.realms?.[req.commanderRealm]?.name || `realm ${req.commanderRealm}`} or higher.`;
  }
  if (req.commanderSect?.length) {
    const cmd = state.characters.find((c) => c.id === b.sides[sideKey].commanderId);
    if (!cmd || !req.commanderSect.includes(cmd.sect)) return `${f.name} needs a commander from ${req.commanderSect.join(' / ')}.`;
  }
  return null;
}

function joinAsChampion(state, b, sideKey, c) {
  if (b.status !== 'preparing') throw new UserError('Too late — the battle has been fought.');
  if (isNonCombatant(state, c)) throw new UserError(`${c.name} is a representative: they lead their faction in politics, not on the battlefield.`);
  for (const k of ['A', 'D']) b.sides[k].champions = b.sides[k].champions.filter((x) => x !== c.id);
  b.sides[sideKey].champions.push(c.id);
  if (!b.sides[sideKey].commanderId) b.sides[sideKey].commanderId = c.id;
}

/** Record an in-character duel. The winner's side gets +1 die (max 2); a beaten commander leaves the field. */
function recordDuel(state, b, winnerId, loserId, note = '', by = '') {
  if (b.status !== 'preparing') throw new UserError('The battle is over.');
  const s = state.world.settings;
  const side = (cid) => (b.sides.A.champions.includes(cid) ? 'A' : b.sides.D.champions.includes(cid) ? 'D' : null);
  const ws = side(winnerId); const ls = side(loserId);
  if (!ws || !ls || ws === ls) throw new UserError('Both duelists must be champions on opposite sides of this battle.');
  b.sides[ws].momentum = r2(Math.min(num(s.maxMomentum, 2), num(b.sides[ws].momentum) + num(s.duelMomentum, 1)));
  let shock = '';
  if (b.sides[ls].commanderId === loserId) { b.sides[ls].moraleShock = num(b.sides[ls].moraleShock) + 15; b.sides[ls].commanderFallen = true; shock = ' Their commander has fallen — the army fights leaderless and shaken!'; }
  b.sides[ls].champions = b.sides[ls].champions.filter((x) => x !== loserId);
  const Wc = state.characters.find((c) => c.id === winnerId); const L = state.characters.find((c) => c.id === loserId);
  b.duels.push({ winner: winnerId, loser: loserId, note: String(note).slice(0, 300), by, at: new Date().toISOString() });
  const text = `🤺 **${Wc?.name}** defeated **${L?.name}** in a duel before the Battle of ${geo.label(state, b.region)}.${shock}`;
  C.wlog(state, 'war', text);
  return text;
}

/**
 * General pips (0–6) from a commander's stats, EU4-style:
 *   fire = Qi ÷ pipStat · shock = Strength ÷ pipStat · maneuver = Mobility ÷ pipStat · siege = Endurance ÷ pipStat
 */
function generalPips(state, c) {
  if (!c) return { fire: 0, shock: 0, maneuver: 0, siege: 0 };
  const per = Math.max(1, num(state.world.settings.pipStat, 30));
  const p = (v) => Math.max(0, Math.min(6, Math.floor(num(v) / per)));
  return { fire: p(c.stats?.qi), shock: p(c.stats?.strength), maneuver: p(c.stats?.mobility), siege: p(c.stats?.endurance) };
}

/**
 * Run the battle, Europa Universalis–style. rng can be passed for tests.
 *
 *   The fight lasts up to `battleDays` days, alternating 3-day FIRE and SHOCK phases. At the start of each phase both
 *   sides roll a die (0–9). Every day, for each troop type u on side X fighting side Y:
 *      dice      = roll + max(0, X general pips − Y general pips)  [fire or shock]
 *                  + terrain penalty (attacker only; cancelled by better maneuver) + champion dice + duel dice
 *      damage_u  = (15 + 5 × max(0, dice + u's offence pips − Y's defence pips)) × front men_u × u's power ÷ 1000
 *                  × formation (fire/shock, vsRole) × counters × cavalry terrain × supply × casualtyScale
 *      Y loses   Σ damage ÷ (Y formation defence × walls if Y defends its own land)   men-equivalents (elite units have power > 1)
 *      Y morale  −= share of Y's strength lost × moraleScale ÷ Y formation morale  (+ 0.3 every day)
 *   Only `width` thousand men per side fight at once (terrain width × formation width). An army at 0 morale routs;
 *   the winner's cavalry then pursues. If both stand after the last day, the side with more morale left wins
 *   (the defender holds a tie).
 */
function resolveBattle(state, b, rng = Math.random) {
  const w = state.world;
  if (b.status !== 'preparing') return b;
  const set = w.settings;
  const days = Math.max(3, num(set.battleDays, 30));
  const r = w.regions[b.region];
  const terrain = w.terrains[r?.terrain] || {};
  const S = {};
  for (const k of ['A', 'D']) {
    const s = b.sides[k];
    const armies = s.armies.map((id) => army(state, id)).filter(Boolean);
    const units = sideUnits(state, b, k);
    const total = Object.values(units).reduce((a, n) => a + n, 0);
    const morale = armies.length ? armies.reduce((a, x) => a + num(x.morale) * men(x), 0) / Math.max(1, armies.reduce((a, x) => a + men(x), 0)) : 50;
    const supply = armies.length ? armies.reduce((a, x) => a + num(x.supply) * men(x), 0) / Math.max(1, total) : 100;
    let f = formation(state, s.formationId) || formation(state, 'square') || w.formations[0];
    if (formationProblem(state, b, k, f)) f = formation(state, 'square') || f;
    const champs = s.champions.map((id) => state.characters.find((c) => c.id === id)).filter((c) => c && c.status === 'active' && !isNonCombatant(state, c));
    const champPower = champs.reduce((a, c) => a + championPower(state, c), 0);
    const cmd = s.commanderFallen ? null : state.characters.find((c) => c.id === s.commanderId) || null;
    // Unit morale multipliers, men-weighted.
    const unitMorale = total ? Object.entries(units).reduce((a, [id, n]) => a + num(unitType(state, id)?.morale, 1) * n, 0) / total : 1;
    const maxMorale = r2(clamp(morale * unitMorale * num(f.morale, 1), 5, 150));
    S[k] = {
      key: k, faction: C.faction(state, s.factionId), units, start: { ...units }, maxMorale, morale: r2(Math.max(1, maxMorale - num(s.moraleShock))),
      supply, formation: f, champions: champs, champPower, champDice: r2(Math.min(num(set.maxChampionDice, 2), champPower / Math.max(1, num(set.championDicePer, 600)))),
      duelDice: num(s.momentum), commander: cmd, pips: generalPips(state, cmd), routed: false, armies,
    };
  }
  const A = S.A; const D = S.D;
  const manA = A.pips.maneuver + num(A.formation.maneuver); const manD = D.pips.maneuver + num(D.formation.maneuver);
  const terrainPenalty = Math.min(0, num(terrain.attackerPenalty) + Math.max(0, manA - manD)) + (terrain.riverCrossing && manA <= manD ? -1 : 0);
  const siegePips = A.pips.siege + Object.entries(A.units).reduce((a, [id, n]) => a + num(unitType(state, id)?.siege) * n, 0) / Math.max(1, Object.values(A.units).reduce((a, n) => a + n, 0)) * 20;
  // Walls only shelter a defender fighting on its own (or its occupied) land.
  const ownWalls = r && D.faction && (r.controller === D.faction.id || r.occupiedBy === D.faction.id);
  const walls = ownWalls ? 1 + Math.max(0, C.wallsOf(state, b.region) - siegePips * 0.5) * num(set.wallStrength, 0.2) : 1;
  const widthFor = (X) => Math.max(1, num(terrain.width, 30) * num(X.formation.width, 1)) * 1000;
  const totalMen = (X) => Object.values(X.units).reduce((a, n) => a + Math.max(0, n), 0);
  // Elite troops count as several men (unit "power"): they hit harder and take more to kill.
  const pw = (id) => Math.max(0.1, num(unitType(state, id)?.power, 1));
  const equiv = (X) => Object.entries(X.units).reduce((a, [id, n]) => a + Math.max(0, n) * pw(id), 0);
  const scale = num(set.casualtyScale, 0.5);
  const moraleScale = num(set.moraleScale, 400);

  // Custom code: armies, factions, formations and the region can adjust each phase.
  const sources = [];
  for (const k of ['A', 'D']) {
    const sideName = k === 'A' ? 'attacker' : 'defender';
    for (const a of S[k].armies) if (a.scriptId) sources.push({ scriptId: a.scriptId, type: 'army', name: a.name, side: sideName });
    if (S[k].faction?.scriptId) sources.push({ scriptId: S[k].faction.scriptId, type: 'faction', name: S[k].faction.name, side: sideName });
    if (S[k].formation?.scriptId) sources.push({ scriptId: S[k].formation.scriptId, type: 'formation', name: S[k].formation.name, side: sideName });
  }
  if (r?.scriptId) sources.push({ scriptId: r.scriptId, type: 'region', name: geo.label(state, b.region), side: 'region' });
  const sideCtx = (X) => ({ faction: X.faction?.name || '', factionId: X.faction?.id || '', formation: X.formation.id, morale: r2(X.morale), maxMorale: X.maxMorale, men: totalMen(X), units: { ...X.units }, commander: X.commander ? { name: X.commander.name, realm: X.commander.realm, pips: X.pips } : null, champions: X.champions.map((c) => c.name) });

  b.days = []; b.phases = [];
  let phaseMods = { A: { dice: 0, damage: 1, morale: 0 }, D: { dice: 0, damage: 1, morale: 0 } };
  let rolls = { A: 0, D: 0 };
  let phase = 'fire';
  let day = 0;
  for (day = 1; day <= days; day++) {
    if ((day - 1) % 3 === 0) {
      phase = Math.floor((day - 1) / 3) % 2 === 0 ? 'fire' : 'shock';
      rolls = { A: Math.floor(rng() * 10), D: Math.floor(rng() * 10) };
      phaseMods = { A: { dice: 0, damage: 1, morale: 0 }, D: { dice: 0, damage: 1, morale: 0 }, notes: [] };
      if (sources.length) {
        let value = { attacker: { dice: 0, damage: 1, morale: 0 }, defender: { dice: 0, damage: 1, morale: 0 }, notes: [] };
        for (const src of sources) {
          const ctx = C.worldCtx(state, { region: C.regionSummary(state, b.region) || { key: b.region, terrain: r?.terrain }, day, phase, rolls: { attacker: rolls.A, defender: rolls.D }, side: src.side, attacker: sideCtx(A), defender: sideCtx(D) });
          const out = C.runHooks(state, [src], 'battleRound', ctx, value);
          if (out && typeof out === 'object') value = { attacker: { dice: 0, damage: 1, morale: 0, ...(out.attacker || {}) }, defender: { dice: 0, damage: 1, morale: 0, ...(out.defender || {}) }, notes: Array.isArray(out.notes) ? out.notes : [] };
        }
        phaseMods = { A: { dice: num(value.attacker.dice), damage: Math.max(0, num(value.attacker.damage, 1)), morale: num(value.attacker.morale) }, D: { dice: num(value.defender.dice), damage: Math.max(0, num(value.defender.damage, 1)), morale: num(value.defender.morale) } };
        A.morale = r2(clamp(A.morale + phaseMods.A.morale, 0, A.maxMorale)); D.morale = r2(clamp(D.morale + phaseMods.D.morale, 0, D.maxMorale));
        phaseMods.notes = value.notes.map(String).slice(0, 5);
      }
      b.phases.push({ day, phase, rolls: { ...rolls }, dice: { A: null, D: null }, notes: phaseMods.notes || [] });
    }
    const dealt = {};
    for (const [X, Y, k] of [[A, D, 'A'], [D, A, 'D']]) {
      const pip = phase === 'fire' ? 'fire' : 'shock';
      const dice = rolls[k] + Math.max(0, X.pips[pip] - Y.pips[pip]) + (k === 'A' ? terrainPenalty : 0) + X.champDice + X.duelDice + phaseMods[k].dice;
      const ph = b.phases[b.phases.length - 1]; if (ph.dice[k] === null) ph.dice[k] = r2(dice);
      const yeq = equiv(Y) || 1;
      const defPip = Object.entries(Y.units).reduce((a, [id, n]) => a + num(unitType(state, id)?.[pip + 'Def']) * n * pw(id), 0) / yeq;
      const compY = composition(state, Y.units);
      const xmen = totalMen(X) || 1;
      const front = Math.min(1, widthFor(X) / xmen);
      let dmg = 0;
      for (const [id, n] of Object.entries(X.units)) {
        const u = unitType(state, id); if (!u || n <= 0) continue;
        const eff = Math.max(0, dice + num(u[pip + 'Off']) - defPip);
        let d = (15 + 5 * eff) * (n * pw(id) * front) / 1000;
        let counter = 0; let vs = 0;
        for (const [role, share] of Object.entries(compY)) { counter += share * num(u.counters?.[role], 1); vs += share * num(X.formation.vsRole?.[role], 1); }
        d *= (counter || 1) * (vs || 1) * num(X.formation[pip], 1);
        if (u.role === 'cavalry' && pip === 'shock') d *= num(terrain.cavalry, 1);
        dmg += d;
      }
      dmg *= scale * (0.6 + 0.4 * clamp(X.supply, 0, 100) / 100) * phaseMods[k].damage;
      let resist = num(Y.formation.defense, 1);
      if (Y === D) resist *= walls;
      dealt[k] = dmg / Math.max(0.2, resist);
    }
    // Casualties are in men-equivalents, spread by share of strength.
    const applyLoss = (Y, cas) => {
      const total = equiv(Y); if (!total) return { men: 0, frac: 0 };
      const toLose = Math.min(total, cas);
      let lost = 0;
      for (const [id, n] of Object.entries(Y.units)) { const l = Math.min(n, Math.round(toLose * (n * pw(id) / total) / pw(id))); Y.units[id] = n - l; lost += l; }
      return { men: lost, frac: toLose / total };
    };
    const lD = applyLoss(D, dealt.A); const lA = applyLoss(A, dealt.D);
    const lostA = lA.men; const lostD = lD.men;
    A.morale = r2(Math.max(0, A.morale - lA.frac * moraleScale / num(A.formation.morale, 1) - 0.3));
    D.morale = r2(Math.max(0, D.morale - lD.frac * moraleScale / num(D.formation.morale, 1) - 0.3));
    b.days.push({ day, phase, lost: { A: lostA, D: lostD }, morale: { A: A.morale, D: D.morale }, men: { A: totalMen(A), D: totalMen(D) } });
    if (A.morale <= 0 || !totalMen(A)) A.routed = true;
    if (D.morale <= 0 || !totalMen(D)) D.routed = true;
    if (A.routed || D.routed) break;
  }
  // Pursuit by the winner's cavalry.
  const pursue = (Win, Lose) => {
    const comp = composition(state, Win.units);
    let p = 0; for (const [id, n] of Object.entries(Win.units)) p += num(unitType(state, id)?.pursuit, 1) * n;
    const tot = totalMen(Win) || 1;
    const frac = clamp(num(comp.cavalry) * 0.4 * (p / tot) * (num(Lose.formation.maneuver) > 0 ? 0.7 : 1), 0, 0.3);
    const lost = Math.round(totalMen(Lose) * frac);
    const lt = totalMen(Lose) || 1;
    for (const id of Object.keys(Lose.units)) Lose.units[id] = Math.max(0, Lose.units[id] - Math.round(lost * Lose.units[id] / lt));
    return lost;
  };
  let winner; let pursuit = 0;
  if (A.routed && !D.routed) { winner = 'D'; pursuit = pursue(D, A); }
  else if (D.routed && !A.routed) { winner = 'A'; pursuit = pursue(A, D); }
  else if (A.routed && D.routed) winner = A.morale / A.maxMorale > D.morale / D.maxMorale ? 'A' : 'D';
  else winner = A.morale / A.maxMorale > D.morale / D.maxMorale + 0.05 ? 'A' : 'D';
  // Write back (losses spread over each side's armies proportionally).
  for (const k of ['A', 'D']) {
    const X = S[k];
    for (const id of b.sides[k].armies) {
      const a = army(state, id); if (!a) continue;
      for (const [u, n] of Object.entries(a.units)) {
        const before = num(X.start[u]); const after = num(X.units[u]);
        a.units[u] = before ? Math.round(n * after / before) : n;
        if (a.units[u] <= 0) delete a.units[u];
      }
      a.morale = r2(clamp(X.morale / Math.max(1, X.maxMorale) * 70 + (k === winner ? 15 : 0), 5, 100));
      a.status = men(a) ? 'garrison' : 'disbanded';
    }
  }
  const loser = winner === 'A' ? 'D' : 'A';
  for (const id of b.sides[loser].armies) {
    const a = army(state, id); if (!a || a.status === 'disbanded') continue;
    const home = geo.neighbors(state, b.region).find((k) => ['own', 'friendly'].includes(canEnter(state, a, k)));
    if (home) { a.region = home; a.march = null; }
  }
  const sum = (u) => Object.values(u).reduce((a, n) => a + n, 0);
  const lostA = sum(A.start) - sum(A.units); const lostD = sum(D.start) - sum(D.units);
  b.status = 'fought';
  b.result = {
    winner, winnerFaction: S[winner].faction?.id, lost: { A: lostA, D: lostD }, pursuit, routed: { A: A.routed, D: D.routed }, days: Math.min(day, days), fought: new Date().toISOString(),
    terrain: r?.terrain || 'plains', terrainPenalty, width: { A: widthFor(A), D: widthFor(D) }, walls: r2(walls),
    pips: { A: A.pips, D: D.pips }, commanders: { A: A.commander?.name || '', D: D.commander?.name || '' }, champDice: { A: A.champDice, D: D.champDice }, duelDice: { A: A.duelDice, D: D.duelDice },
    morale: { A: [A.maxMorale, A.morale], D: [D.maxMorale, D.morale] }, formations: { A: A.formation.id, D: D.formation.id },
  };
  if (r) { r.prosperity = r2(Math.max(0, r.prosperity - 3)); r.security = r2(Math.max(0, r.security - 8)); }
  // The fighting damages the region's buildings.
  if (w.regions[b.region]?.buildings?.length) {
    const dmg = require('./realm').battleDamage(state, b.region, { days: b.result.days, attackerWon: winner === 'A' }, rng);
    b.result.buildings = dmg;
  }
  const text = `⚔️ **Battle of ${geo.label(state, b.region)}** — **${S[winner].faction?.name}** ${winner === 'A' ? 'won the attack' : 'held the field'} after ${b.result.days} day${b.result.days === 1 ? '' : 's'}. Losses: ${A.faction?.name} ${lostA.toLocaleString('en-US')}, ${D.faction?.name} ${lostD.toLocaleString('en-US')}.`;
  C.wlog(state, 'war', text);
  (w.announceQueue ||= []).push({ kind: 'battle-result', text, battleId: b.id, regions: [b.region] });
  return b;
}

/** Resolve every battle whose preparation window has closed. */
function resolveDue(state, now = Date.now()) {
  const out = [];
  for (const b of state.world.battles) if (b.status === 'preparing' && Date.parse(b.resolveAt) <= now) out.push(resolveBattle(state, b));
  return out;
}

/**
 * Quick what-if used by the dashboard: simulate two forces without touching the world.
 * spec: { A: { units, formationId, morale, supply, general: { fire, shock, maneuver, siege }, champions: [power], duelDice }, D: {...}, terrain, fort }
 */
function simulate(state, spec, runs = 200) {
  let winsA = 0; let lossA = 0; let lossD = 0; let dayCount = 0;
  const per = Math.max(1, num(state.world.settings.pipStat, 30));
  const general = (g, k) => ({ id: `__g${k}`, name: k === 'A' ? 'Attacking general' : 'Defending general', status: 'active', realm: 11, stats: { qi: num(g?.fire) * per, strength: num(g?.shock) * per, mobility: num(g?.maneuver) * per, endurance: num(g?.siege) * per } });
  const champs = (list, k) => (list || []).map((p, i) => ({ id: `__c${k}${i}`, name: `Champion ${i + 1}`, status: 'active', realm: 0, stats: { strength: num(p), endurance: 0, mobility: 0 } }));
  const characters = [general(spec.A?.general, 'A'), general(spec.D?.general, 'D'), ...champs(spec.A?.champions, 'A'), ...champs(spec.D?.champions, 'D')];
  let sample = null;
  for (let i = 0; i < runs; i++) {
    const w = {
      ...state.world,
      settings: { ...state.world.settings, championRealmMult: [1], championScale: 1, representativesFight: true },
      regions: { __sim: { key: '__sim', terrain: spec.terrain || 'plains', fort: num(spec.fort), prosperity: 50, security: 50, stock: {}, prices: {}, last: {}, controller: '__D', policies: [] } },
      factions: [{ id: '__A', name: 'Attacker', policies: [], scriptId: '' }, { id: '__D', name: 'Defender', policies: [], scriptId: '' }],
      wars: [], alliances: [], agreements: [], log: [], announceQueue: [], activeEvents: [],
    };
    const mk = (id, fid, s) => ({ id, name: id, factionId: fid, region: '__sim', units: { ...(s.units || {}) }, champions: [], morale: num(s.morale, 70), supply: num(s.supply, 100), formationId: s.formationId || 'square', status: 'garrison', scriptId: '' });
    w.armies = [mk('aA', '__A', spec.A || {}), mk('aD', '__D', spec.D || {})];
    const side = (fid, aid, s, key) => ({ factionId: fid, armies: [aid], formationId: s.formationId || 'square', champions: characters.filter((c) => c.id.startsWith(`__c${key}`)).map((c) => c.id), commanderId: `__g${key}`, momentum: num(s.duelDice), moraleShock: 0 });
    const b = { id: 'sim', region: '__sim', sides: { A: side('__A', 'aA', spec.A || {}, 'A'), D: side('__D', 'aD', spec.D || {}, 'D') }, status: 'preparing', duels: [], days: [], phases: [] };
    w.battles = [b];
    resolveBattle({ ...state, characters, world: w }, b);
    if (b.result.winner === 'A') winsA++;
    lossA += b.result.lost.A; lossD += b.result.lost.D; dayCount += b.result.days;
    if (!sample) sample = { days: b.days, phases: b.phases, result: b.result };
  }
  return { runs, attackerWins: r2(winsA / runs * 100), avgLossA: Math.round(lossA / runs), avgLossD: Math.round(lossD / runs), avgDays: r2(dayCount / runs), sample };
}

module.exports = {
  unitType, formation, army, men, composition, armyStrength, championPower, canCommand,
  recruitCost, recruit, marchTo, canEnter, slowestSpeed, tickArmies, openBattle, battle, sideOf, setPlan, sideUnits, formationProblem,
  joinAsChampion, recordDuel, resolveBattle, resolveDue, simulate, generalPips, isNonCombatant,
};
