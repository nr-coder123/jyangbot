'use strict';
/**
 * Armies, formations, tactics and battles.
 *
 * When hostile armies meet, a battle opens with a preparation window (default 24 h, real time).
 * During it, commanders pick a formation and a tactic for each round, champions (player characters)
 * join, and staff record the outcome of in-character duels: every duel won adds momentum to that side,
 * a defeated commander shakes their army's morale. When the window closes the battle is simulated.
 *
 * Each round, for each side:
 *   attack  = Σ men × unit attack × counters × terrain × formation × tactic × morale × supply × (1 + momentum) + champions
 *   defence = Σ men × unit defence × terrain × formation × tactic × fortifications
 *   the enemy loses  min(35%, 10% × attack ÷ their defence)  of its men, and 1.6 morale per 1% lost.
 * An army whose morale falls below 25 routs; cavalry pursue routed or retreating enemies.
 * If nobody routs after the last round, the side with clearly higher morale (by 5+) wins; otherwise the defender holds.
 */
const geo = require('./geo');
const C = require('./common');
const E = require('./economy');
const { num, r2, clamp, newId, UserError } = require('../utils');

const unitType = (state, id) => state.world.unitTypes.find((u) => u.id === id) || null;
const formation = (state, id) => state.world.formations.find((f) => f.id === id) || null;
const tactic = (state, id) => state.world.tactics.find((t) => t.id === id) || null;
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
    a = { id: newId('ar-'), name: name || `${f.name} — ${geo.label(state, regionKey)} Army`, factionId: f.id, region: regionKey, units: {}, commanderId: '', champions: [], morale: 70, supply: 100, formationId: 'square', stance: 'balanced', status: 'garrison', march: null, createdTurn: w.turn };
    w.armies.push(a);
  }
  a.units[unitId] = num(a.units[unitId]) + count;
  C.wlog(state, 'army', `🪖 **${f.name}** raised ${count} ${u.name} in **${geo.label(state, regionKey)}**.`);
  return { army: a, cost };
}

function canEnter(state, a, key) {
  const r = state.world.regions[key];
  if (!r?.controller || r.controller === a.factionId) return 'own';
  const rel = C.relation(state, a.factionId, r.controller);
  if (rel.war) return 'enemy';
  if (C.hasTreaty(state, a.factionId, r.controller, 'access') || C.stance(state, a.factionId, r.controller) === 'allied') return 'friendly';
  return 'foreign';
}

function marchTo(state, a, to) {
  const rt = geo.route(state, a.region, to);
  if (!rt || rt.hops === 0) throw new UserError('No route (or already there).');
  // Armies may cross anyone's land; without Military Access (or war) they lose supply there (see tickArmies).
  a.march = { path: rt.path, step: 0, progress: 0 };
  a.status = 'marching';
  C.wlog(state, 'army', `🚩 **${a.name}** marches from ${geo.label(state, a.region)} to **${geo.label(state, to)}** (${rt.hops} stage${rt.hops > 1 ? 's' : ''}).`);
  return rt;
}

function slowestSpeed(state, a) {
  let s = 2;
  for (const [id, n] of Object.entries(a.units)) if (num(n) > 0) s = Math.min(s, num(unitType(state, id)?.speed, 1));
  const f = formation(state, a.formationId);
  return s * num(f?.speed, 1);
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
      if (C.relation(state, fids[i], fids[j]).war) {
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
    const occupier = here.find((a) => a.status === 'garrison' && a.factionId !== r.controller && C.relation(state, a.factionId, r.controller).war);
    if (occupier && !here.some((a) => a.factionId === r.controller)) {
      if (r.occupiedBy !== occupier.factionId) { r.occupiedBy = occupier.factionId; r.occupiedSince = w.turn; C.wlog(state, 'war', `🏴 **${C.faction(state, occupier.factionId)?.name}** occupies **${geo.label(state, key)}**.`); (w.announceQueue ||= []).push({ kind: 'war', text: `🏴 **${C.faction(state, occupier.factionId)?.name}** occupies **${geo.label(state, key)}**!`, regions: [key] }); }
      else if (w.settings.autoConquest && w.turn - r.occupiedSince >= num(w.settings.occupationTurns, 12)) {
        const old = r.controller; r.controller = r.occupiedBy; r.occupiedBy = null;
        C.wlog(state, 'war', `👑 **${geo.label(state, key)}** now belongs to **${C.faction(state, r.controller)?.name}** (taken from ${C.faction(state, old)?.name}).`);
        (w.announceQueue ||= []).push({ kind: 'war', text: `👑 **${geo.label(state, key)}** has fallen to **${C.faction(state, r.controller)?.name}**.`, regions: [key] });
      }
    } else if (r.occupiedBy && !here.some((a) => a.factionId === r.occupiedBy)) { r.occupiedBy = null; C.wlog(state, 'war', `🏳️ **${geo.label(state, key)}** is free of occupation.`); }
  }
  return notes;
}
const groupBy = (list, fn) => list.reduce((m, x) => ((m[fn(x)] ||= []).push(x), m), {});
const enemiesIn = (state, a, key) => state.world.armies.filter((b) => b.region === key && b.factionId !== a.factionId && b.status !== 'disbanded' && C.relation(state, a.factionId, b.factionId).war);
const inBattle = (state, armyId) => state.world.battles.some((b) => b.status === 'preparing' && [...b.sides.A.armies, ...b.sides.D.armies].includes(armyId));

// ─────────── battles ───────────
function openBattle(state, regionKey, attackerIds, defenderIds, { hours, by } = {}) {
  const w = state.world;
  const side = (ids) => {
    const first = army(state, ids[0]);
    return { factionId: first?.factionId, armies: ids, formationId: first?.formationId || 'square', plan: [], champions: [...new Set(ids.flatMap((id) => army(state, id)?.champions || []))], commanderId: first?.commanderId || '', momentum: 0, moraleShock: 0, ready: false };
  };
  const prep = num(hours, num(w.settings.battlePrepHours, 24));
  const b = { id: newId('bt-'), region: regionKey, sides: { A: side(attackerIds), D: side(defenderIds) }, status: 'preparing', openedTurn: w.turn, openedAt: new Date().toISOString(), resolveAt: new Date(Date.now() + prep * 3600000).toISOString(), duels: [], rounds: [], result: null, by: by || null, messages: [] };
  for (const id of [...attackerIds, ...defenderIds]) { const a = army(state, id); if (a) a.status = 'battle'; }
  w.battles.unshift(b);
  if (w.battles.length > 60) w.battles.length = 60;
  const A = C.faction(state, b.sides.A.factionId); const D = C.faction(state, b.sides.D.factionId);
  const text = `⚔️ **Battle of ${geo.label(state, regionKey)}** — **${A?.name}** attacks **${D?.name}**. The armies deploy; the battle begins <t:${Math.floor(Date.parse(b.resolveAt) / 1000)}:R>. Champions may duel before then.`;
  C.wlog(state, 'war', text);
  (w.announceQueue ||= []).push({ kind: 'battle', text, battleId: b.id, regions: [regionKey] });
  return b;
}

function battle(state, id) { const b = state.world.battles.find((x) => x.id === id); if (!b) throw new UserError('Battle not found.'); return b; }
function sideOf(state, b, factionId) { return b.sides.A.factionId === factionId ? 'A' : b.sides.D.factionId === factionId ? 'D' : null; }

function setPlan(state, b, sideKey, { formationId, plan, commanderId } = {}) {
  if (b.status !== 'preparing') throw new UserError('This battle has already been fought.');
  const s = b.sides[sideKey];
  if (formationId) {
    const f = formation(state, formationId); if (!f) throw new UserError('Unknown formation.');
    const why = formationProblem(state, b, sideKey, f); if (why) throw new UserError(why);
    s.formationId = formationId;
  }
  if (Array.isArray(plan)) s.plan = plan.slice(0, num(state.world.settings.battleRounds, 5)).map((t) => (tactic(state, t) ? t : 'hold'));
  if (commanderId !== undefined) s.commanderId = commanderId;
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
  if (req.commanderRealm !== undefined) {
    const cmd = state.characters.find((c) => c.id === b.sides[sideKey].commanderId);
    if (!cmd || num(cmd.realm) < req.commanderRealm) return `${f.name} needs a commander of the ${state.realms[req.commanderRealm]?.name || `realm ${req.commanderRealm}`} or higher.`;
  }
  if (req.commanderSect?.length) {
    const cmd = state.characters.find((c) => c.id === b.sides[sideKey].commanderId);
    if (!cmd || !req.commanderSect.includes(cmd.sect)) return `${f.name} needs a commander from ${req.commanderSect.join(' / ')}.`;
  }
  return null;
}

function joinAsChampion(state, b, sideKey, c) {
  if (b.status !== 'preparing') throw new UserError('Too late — the battle has been fought.');
  for (const k of ['A', 'D']) b.sides[k].champions = b.sides[k].champions.filter((x) => x !== c.id);
  b.sides[sideKey].champions.push(c.id);
  if (!b.sides[sideKey].commanderId) b.sides[sideKey].commanderId = c.id;
}

/** Record an in-character duel. The winner's side gains momentum; a beaten commander shakes their army. */
function recordDuel(state, b, winnerId, loserId, note = '', by = '') {
  if (b.status !== 'preparing') throw new UserError('The battle is over.');
  const s = state.world.settings;
  const side = (cid) => (b.sides.A.champions.includes(cid) ? 'A' : b.sides.D.champions.includes(cid) ? 'D' : null);
  const ws = side(winnerId); const ls = side(loserId);
  if (!ws || !ls || ws === ls) throw new UserError('Both duelists must be champions on opposite sides of this battle.');
  b.sides[ws].momentum = r2(Math.min(num(s.maxMomentum, 0.3), b.sides[ws].momentum + num(s.duelMomentum, 0.08)));
  let shock = '';
  if (b.sides[ls].commanderId === loserId) { b.sides[ls].moraleShock = num(b.sides[ls].moraleShock) + 15; shock = ' Their commander has fallen — morale shaken!'; }
  b.sides[ls].champions = b.sides[ls].champions.filter((x) => x !== loserId);
  const W = state.characters.find((c) => c.id === winnerId); const L = state.characters.find((c) => c.id === loserId);
  b.duels.push({ winner: winnerId, loser: loserId, note: String(note).slice(0, 300), by, at: new Date().toISOString() });
  const text = `🤺 **${W?.name}** defeated **${L?.name}** in a duel before the Battle of ${geo.label(state, b.region)}.${shock}`;
  C.wlog(state, 'war', text);
  return text;
}

function defaultTactic(stance, round) {
  if (stance === 'aggressive') return round === 1 ? 'volley' : 'charge';
  if (stance === 'defensive') return round === 1 ? 'volley' : 'hold';
  return ['volley', 'hold', 'charge', 'hold', 'charge'][round - 1] || 'hold';
}

/** Run the battle. rng can be passed for tests. */
function resolveBattle(state, b, rng = Math.random) {
  const w = state.world;
  if (b.status !== 'preparing') return b;
  const R = num(w.settings.battleRounds, 5);
  const r = w.regions[b.region];
  const terrain = w.terrains[r?.terrain] || {};
  const cal = C.calendar(state);
  const sides = {};
  for (const k of ['A', 'D']) {
    const s = b.sides[k];
    const armies = s.armies.map((id) => army(state, id)).filter(Boolean);
    const units = sideUnits(state, b, k);
    const morale = armies.length ? armies.reduce((a, x) => a + num(x.morale) * men(x), 0) / Math.max(1, armies.reduce((a, x) => a + men(x), 0)) : 50;
    const supply = armies.length ? armies.reduce((a, x) => a + num(x.supply), 0) / armies.length : 50;
    let f = formation(state, s.formationId) || formation(state, 'square');
    if (formationProblem(state, b, k, f)) f = formation(state, 'square') || f;
    const champs = s.champions.map((id) => state.characters.find((c) => c.id === id)).filter((c) => c && c.status === 'active');
    sides[k] = { key: k, faction: C.faction(state, s.factionId), units, start: { ...units }, morale: clamp(morale - num(s.moraleShock), 0, 100), supply, formation: f, champions: champs, champPower: champs.reduce((a, c) => a + championPower(state, c), 0), momentum: num(s.momentum), plan: s.plan, stance: armies[0]?.stance || 'balanced', routed: false, retreated: false, exposed: 1 };
  }
  // Custom code can adjust each side before the fight (formations, factions, region scripts).
  const ctxBase = { region: C.regionSummary(state, b.region) };
  for (let round = 1; round <= R; round++) {
    const A = sides.A; const D = sides.D;
    const tacticOf = (S) => {
      let t = tactic(state, S.plan[round - 1] || defaultTactic(S.stance, round)) || tactic(state, 'hold');
      if (t.firstRoundOnly && round !== 1) t = tactic(state, 'charge');
      if (t.needsAmbush && !terrain.ambush) t = tactic(state, 'hold');
      if (t.seasons && !t.seasons.includes(cal.season)) t = tactic(state, 'hold');
      return t;
    };
    const tA = tacticOf(A); const tD = tacticOf(D);
    const roundLog = { round, tactics: { A: tA.id, D: tD.id }, losses: {}, morale: {}, notes: [] };
    const calc = (X, Y, tX, tY) => {
      const compY = composition(state, Y.units);
      const enemyTac = num(Y.formation.enemyTactics, 1);
      const tacMul = (v) => 1 + (num(v, 1) - 1) * enemyTac;
      let atk = 0;
      for (const [id, n] of Object.entries(X.units)) {
        const u = unitType(state, id); if (!u || n <= 0) continue;
        let m = num(u.attack);
        let counter = 0; for (const [role, share] of Object.entries(compY)) counter += share * num(u.counters?.[role], 1);
        m *= counter || 1;
        if (u.role === 'cavalry') m *= num(terrain.cavalry, 1) * num(tX.cavalry, 1);
        if (u.role === 'ranged') m *= num(terrain.ranged, 1) * num(tX.ranged, 1) * (tX.id === 'volley' ? num(u.volley, 1) / 1.6 : 1);
        else if (tX.melee) m *= num(tX.melee);
        let vs = 0; for (const [role, share] of Object.entries(compY)) vs += share * num(X.formation.vsRole?.[role], 1);
        m *= vs || 1;
        atk += n * m;
      }
      atk *= num(X.formation.attack, 1) * tacMul(num(X.formation.tactics?.[tX.id], 1)) * num(X.formation.counters?.[Y.formation.id], 1);
      atk *= tacMul(num(tX.attack, 1)) * tacMul(num(tX.beats?.[tY.id], 1));
      atk *= (0.5 + X.morale / 200) * (0.6 + 0.4 * X.supply / 100) * (1 + X.momentum);
      const champ = X.champPower * (tX.retreat ? 0.3 : 1);
      if (tX.backfire && rng() < tX.backfire) { atk *= 0.4; roundLog.notes.push(`🔥 The wind turns — ${X.faction?.name}'s fire attack backfires!`); }
      let def = 0;
      for (const [id, n] of Object.entries(Y.units)) {
        const u = unitType(state, id); if (!u || n <= 0) continue;
        def += n * num(u.defense) * (['infantry', 'spear'].includes(u.role) ? num(terrain.infantryDef, 1) : 1);
      }
      def *= num(Y.formation.defense, 1) * num(tY.defense, 1) * Y.exposed;
      if (Y.key === 'D') {
        const siege = Object.entries(X.units).reduce((a, [id, n]) => a + num(unitType(state, id)?.siege) * n, 0) / Math.max(1, Object.values(X.units).reduce((a, n) => a + n, 0));
        def *= (1 + num(r?.fort) * 0.08 * (1 - Math.min(0.8, siege * 4))) * num(terrain.defense, 1);
      }
      def += Y.champPower * 0.5;
      const total = atk + champ;
      const frac = clamp(0.1 * total / Math.max(1, def) * (0.85 + rng() * 0.3), 0, 0.35);
      return { atk: r2(atk), champ: r2(champ), def: r2(def), frac };
    };
    let resA = calc(A, D, tA, tD); let resD = calc(D, A, tD, tA);
    const sources = [...new Set([b.sides.A, b.sides.D].flatMap((s) => [formation(state, s.formationId)?.scriptId, C.faction(state, s.factionId)?.scriptId]).filter(Boolean))].map((id) => ({ scriptId: id, type: 'battle', name: 'battle' }));
    if (r?.scriptId) sources.push({ scriptId: r.scriptId, type: 'region', name: geo.label(state, b.region) });
    if (sources.length) {
      const out = C.runHooks(state, sources, 'battleRound', C.worldCtx(state, { ...ctxBase, round, attacker: { faction: A.faction?.name, formation: A.formation.id, tactic: tA.id, morale: A.morale, men: Object.values(A.units).reduce((a, n) => a + n, 0) }, defender: { faction: D.faction?.name, formation: D.formation.id, tactic: tD.id, morale: D.morale, men: Object.values(D.units).reduce((a, n) => a + n, 0) } }), { attackerLoss: resD.frac, defenderLoss: resA.frac, notes: [] });
      if (out) { resD.frac = clamp(num(out.attackerLoss, resD.frac), 0, 0.9); resA.frac = clamp(num(out.defenderLoss, resA.frac), 0, 0.9); (out.notes || []).forEach((n) => roundLog.notes.push(String(n))); }
    }
    const applyLoss = (Y, frac) => {
      let lost = 0;
      const weights = Object.entries(Y.units).map(([id, n]) => [id, n, n / Math.max(0.5, num(unitType(state, id)?.defense, 1))]);
      const wsum = weights.reduce((a, [, , x]) => a + x, 0) || 1;
      const total = Object.values(Y.units).reduce((a, n) => a + n, 0);
      const toLose = Math.round(total * frac);
      for (const [id, n, wgt] of weights) { const l = Math.min(n, Math.round(toLose * wgt / wsum)); Y.units[id] = n - l; lost += l; }
      return lost;
    };
    roundLog.losses.D = applyLoss(D, resA.frac); roundLog.losses.A = applyLoss(A, resD.frac);
    roundLog.power = { A: resA, D: resD };
    A.morale = r2(clamp(A.morale - resD.frac * 160 - (round === 1 ? num(tD.moraleHit) : 0) + num(A.formation.morale), 0, 100));
    D.morale = r2(clamp(D.morale - resA.frac * 160 - (round === 1 ? num(tA.moraleHit) : 0) + num(D.formation.morale), 0, 100));
    A.exposed = tD.exposes ? num(tD.exposes) : 1; D.exposed = tA.exposes ? num(tA.exposes) : 1;
    roundLog.morale = { A: A.morale, D: D.morale };
    b.rounds.push(roundLog);
    if (tA.retreat) A.retreated = true;
    if (tD.retreat) D.retreated = true;
    if (A.morale < 25) A.routed = true;
    if (D.morale < 25) D.routed = true;
    if (A.routed || D.routed || A.retreated || D.retreated) break;
  }
  // Pursuit
  const pursue = (Winner, Loser) => {
    const comp = composition(state, Winner.units);
    let p = 0; for (const [id, n] of Object.entries(Winner.units)) p += num(unitType(state, id)?.pursuit) * n;
    const total = Object.values(Winner.units).reduce((a, n) => a + n, 0) || 1;
    const frac = clamp(num(comp.cavalry) * 0.4 * (p / total || 1) * (Loser.retreated && !Loser.routed ? 0.5 : 1) * (Loser.formation.tactics?.retreat ? 0.6 : 1), 0, 0.3);
    const lost = Math.round(Object.values(Loser.units).reduce((a, n) => a + n, 0) * frac);
    for (const id of Object.keys(Loser.units)) Loser.units[id] = Math.max(0, Loser.units[id] - Math.round(lost * Loser.units[id] / Math.max(1, Object.values(Loser.units).reduce((a, n) => a + n, 0))));
    return lost;
  };
  let winner = null; let pursuit = 0;
  const A = sides.A; const D = sides.D;
  if ((A.routed || A.retreated) && !(D.routed || D.retreated)) { winner = 'D'; pursuit = pursue(D, A); }
  else if ((D.routed || D.retreated) && !(A.routed || A.retreated)) { winner = 'A'; pursuit = pursue(A, D); }
  else {
    // Nobody broke: the side with clearly better morale left carries the day; otherwise the defender holds.
    winner = A.morale > D.morale + 5 ? 'A' : 'D';
  }
  // Write back to the armies (losses spread over each side's armies proportionally).
  for (const k of ['A', 'D']) {
    const S = sides[k];
    for (const id of b.sides[k].armies) {
      const a = army(state, id); if (!a) continue;
      for (const [u, n] of Object.entries(a.units)) {
        const before = num(S.start[u]); const after = num(S.units[u]);
        a.units[u] = before ? Math.round(n * after / before) : n;
        if (a.units[u] <= 0) delete a.units[u];
      }
      a.morale = r2(clamp(S.morale + (k === winner ? 10 : 0), 5, 100));
      a.status = men(a) ? 'garrison' : 'disbanded';
    }
  }
  // The loser retreats to the nearest friendly region.
  const loser = winner === 'A' ? 'D' : 'A';
  for (const id of b.sides[loser].armies) {
    const a = army(state, id); if (!a || a.status === 'disbanded') continue;
    const home = geo.neighbors(state, b.region).find((k) => ['own', 'friendly'].includes(canEnter(state, a, k)));
    if (home) { a.region = home; a.march = null; }
    a.morale = r2(Math.max(5, a.morale - 10));
  }
  const lostA = Object.values(A.start).reduce((a, n) => a + n, 0) - Object.values(A.units).reduce((a, n) => a + n, 0);
  const lostD = Object.values(D.start).reduce((a, n) => a + n, 0) - Object.values(D.units).reduce((a, n) => a + n, 0);
  b.status = 'fought';
  b.result = { winner, winnerFaction: sides[winner].faction?.id, lost: { A: lostA, D: lostD }, pursuit, routed: { A: A.routed, D: D.routed }, retreated: { A: A.retreated, D: D.retreated }, fought: new Date().toISOString() };
  if (r) { r.prosperity = r2(Math.max(0, r.prosperity - 3)); r.security = r2(Math.max(0, r.security - 8)); r.unrest = r2(Math.min(100, r.unrest + 4)); }
  if (A.faction && D.faction) C.addRelation(state, A.faction.id, D.faction.id, -5);
  const text = `⚔️ **Battle of ${geo.label(state, b.region)}** — **${sides[winner].faction?.name}** ${winner === 'A' ? 'won the attack' : 'held the field'}. Losses: ${A.faction?.name} ${lostA}, ${D.faction?.name} ${lostD}.`;
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
 * Quick what-if used by the dashboard: simulate two compositions without touching the world.
 * spec: { A: { units, formationId, plan, morale, champions: [power] }, D: {...}, terrain, fort }
 */
function simulate(state, spec, runs = 200) {
  let winsA = 0; let lossA = 0; let lossD = 0; let rounds = 0;
  const champs = (list, side) => (list || []).map((p, i) => ({ id: `__c${side}${i}`, status: 'active', realm: 0, stats: { strength: num(p), endurance: 0, mobility: 0 } }));
  const characters = [...champs(spec.A?.champions, 'A'), ...champs(spec.D?.champions, 'D')];
  for (let i = 0; i < runs; i++) {
    const w = {
      ...state.world,
      settings: { ...state.world.settings, championRealmMult: [1], championScale: 1 },
      regions: { __sim: { key: '__sim', terrain: spec.terrain || 'plains', fort: num(spec.fort), prosperity: 50, security: 50, unrest: 0, stock: {}, prices: {}, last: {}, controller: '__D', policies: [] } },
      factions: [{ id: '__A', name: 'Attacker', policies: [], scriptId: '' }, { id: '__D', name: 'Defender', policies: [], scriptId: '' }],
      relations: {}, treaties: [], log: [], announceQueue: [], activeEvents: [],
    };
    const mk = (id, fid, s) => ({ id, name: id, factionId: fid, region: '__sim', units: { ...(s.units || {}) }, champions: [], morale: num(s.morale, 70), supply: num(s.supply, 100), formationId: s.formationId || 'square', stance: s.stance || 'balanced', status: 'garrison' });
    w.armies = [mk('aA', '__A', spec.A || {}), mk('aD', '__D', spec.D || {})];
    const side = (fid, aid, s, key) => ({ factionId: fid, armies: [aid], formationId: s.formationId || 'square', plan: s.plan || [], champions: characters.filter((c) => c.id.startsWith(`__c${key}`)).map((c) => c.id), commanderId: '', momentum: num(s.momentum), moraleShock: 0 });
    const b = { id: 'sim', region: '__sim', sides: { A: side('__A', 'aA', spec.A || {}, 'A'), D: side('__D', 'aD', spec.D || {}, 'D') }, status: 'preparing', duels: [], rounds: [] };
    w.battles = [b];
    resolveBattle({ ...state, characters, world: w }, b);
    if (b.result.winner === 'A') winsA++;
    lossA += b.result.lost.A; lossD += b.result.lost.D; rounds += b.rounds.length;
  }
  return { runs, attackerWins: r2(winsA / runs * 100), avgLossA: Math.round(lossA / runs), avgLossD: Math.round(lossD / runs), avgRounds: r2(rounds / runs) };
}

module.exports = {
  unitType, formation, tactic, army, men, composition, armyStrength, championPower, canCommand,
  recruitCost, recruit, marchTo, canEnter, tickArmies, openBattle, battle, sideOf, setPlan, sideUnits, formationProblem,
  joinAsChampion, recordDuel, resolveBattle, resolveDue, simulate, defaultTactic,
};
