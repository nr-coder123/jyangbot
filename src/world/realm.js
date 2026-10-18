'use strict';
/**
 * The realm: what a faction's representatives may do, the staff approval queue, buildings and faction caravans.
 *
 * ─ Ranks & powers ─
 *   Every representative has a rank (World settings → Representative ranks). A rank gives each power
 *   (diplomacy, alliances, war, armies, policies, buildings, trade, treasury, land claims) one of three levels:
 *     free  — done on the spot        staff — becomes a request staff approve or reject        none — not allowed
 *   and a spending limit: anything that costs more than it goes to staff too. The leader uses the leader rank.
 *   Staff can always act directly. This keeps an angry player from wrecking their sect out of character.
 *
 * ─ Buildings ─
 *   Bought with the treasury in regions the faction rules; they take some turns to build and cost upkeep.
 *   They belong to whoever rules the region. When a region is taken (an approved takeover), each building may be
 *   razed (settings.buildingRazeChance). Battles fought in a region damage its buildings; below half strength
 *   they work at half effect, at 0 they are gone. Repairs cost a share of the price.
 *
 * ─ Faction caravans ─
 *   A trade faction (a "Trade Guild", by default factions of kind guild) buys goods with its treasury in one market
 *   and sells them in another, where it has trade rights: unclaimed land, its own, or a ruler it has free trade
 *   with. The profit (or loss) goes to its treasury. Players themselves don't buy from province markets.
 */
const geo = require('./geo');
const C = require('./common');
const W = require('./defaults');
const { num, r2, newId, clamp, UserError, fmt } = require('../utils');

// ─────────── ranks & powers ───────────
const ranks = (state) => (Array.isArray(state.world.settings.repRanks) && state.world.settings.repRanks.length ? state.world.settings.repRanks : W.REP_RANKS);
const rank = (state, id) => ranks(state).find((r) => r.id === id) || null;
/** The rank a character holds in their faction, or null if they hold no office. */
function rankOf(state, f, c, member) {
  if (!f || !c) return null;
  const s = state.world.settings;
  if (f.leaderCharId === c.id) return rank(state, s.leaderRank || 'leader') || ranks(state)[0];
  if (f.representatives.includes(c.id)) return rank(state, f.repRanks?.[c.id] || s.defaultRepRank) || rank(state, s.defaultRepRank) || ranks(state)[0];
  if (C.isRepresentative(state, f, c, member)) return rank(state, s.defaultRepRank) || ranks(state)[0];
  return null;
}
/** 'free' | 'staff' | 'none' */
function powerLevel(state, f, c, member, power, { staff = false } = {}) {
  if (staff) return 'free';
  const r = rankOf(state, f, c, member);
  if (!r) return 'none';
  return ['free', 'staff', 'none'].includes(r.powers?.[power]) ? r.powers[power] : 'none';
}
function powerSummary(state, f, c, member) {
  const r = rankOf(state, f, c, member);
  if (!r) return null;
  const by = { free: [], staff: [], none: [] };
  for (const p of W.POWERS) by[r.powers?.[p.id] || 'none'].push(p.name.toLowerCase());
  return { rank: r, ...by };
}

// ─────────── actions & the staff queue ───────────
const ACTIONS = {
  policy: { power: 'policies', cost: (s, f, p) => num(s.world.policies.find((x) => x.id === p.policyId)?.cost?.treasury), run: (s, f, p) => { const def = require('./politics').adoptPolicy(s, f, p.policyId, p.region || ''); return `${def.name} is now in force${p.region ? ` in ${geo.label(s, p.region)}` : ''}.`; }, describe: (s, f, p) => `adopt the policy ${s.world.policies.find((x) => x.id === p.policyId)?.name || p.policyId}${p.region ? ` in ${geo.label(s, p.region)}` : ''}` },
  revoke: { power: 'policies', run: (s, f, p) => { require('./politics').revokePolicy(s, f, p.policyId, p.region || ''); return 'Policy revoked.'; }, describe: (s, f, p) => `revoke ${s.world.policies.find((x) => x.id === p.policyId)?.name || p.policyId}` },
  build: { power: 'build', cost: (s, f, p) => num(buildingType(s, p.typeId)?.cost), run: (s, f, p) => { const b = startBuilding(s, f, p.region, p.typeId); return `Construction of the ${buildingType(s, b.typeId).name} in ${geo.label(s, p.region)} has begun (ready on turn ${b.readyTurn}).`; }, describe: (s, f, p) => `build a ${buildingType(s, p.typeId)?.name || p.typeId} in ${geo.label(s, p.region)} (${fmt(buildingType(s, p.typeId)?.cost)})` },
  repair: { power: 'build', cost: (s, f, p) => repairCost(s, p.region, p.buildingId), run: (s, f, p) => { const c = repairBuilding(s, f, p.region, p.buildingId); return `Repaired for ${fmt(c)}.`; }, describe: (s, f, p) => `repair a building in ${geo.label(s, p.region)}` },
  upgrade: { power: 'build', cost: (s, f, p) => upgradeCost(s, p.region, p.buildingId), run: (s, f, p) => { const b = upgradeBuilding(s, f, p.region, p.buildingId); return `Upgraded to level ${b.level}.`; }, describe: (s, f, p) => `upgrade a building in ${geo.label(s, p.region)} (${fmt(upgradeCost(s, p.region, p.buildingId))})` },
  embargo: { power: 'diplomacy', run: (s, f, p) => { const to = C.faction(s, p.target); if (!to) throw new UserError('Unknown faction.'); if (!f.embargoes.includes(to.id)) f.embargoes.push(to.id); (s.world.announceQueue ||= []).push({ kind: 'diplomacy', text: `**${f.name}** closes its markets to **${to.name}**: no trade between their lands.` }); return `Embargo on ${to.name}.`; }, describe: (s, f, p) => `close your markets to ${C.faction(s, p.target)?.name} (embargo)` },
  'lift-embargo': { power: 'diplomacy', run: (s, f, p) => { f.embargoes = f.embargoes.filter((x) => x !== p.target); (s.world.announceQueue ||= []).push({ kind: 'diplomacy', text: `**${f.name}** opens its markets to **${C.faction(s, p.target)?.name}** again.` }); return 'Embargo lifted.'; }, describe: (s, f, p) => `lift the embargo on ${C.faction(s, p.target)?.name}` },
  demolish: { power: 'build', run: (s, f, p) => { demolishBuilding(s, f, p.region, p.buildingId); return 'Pulled down.'; }, describe: (s, f, p) => `pull down a building in ${geo.label(s, p.region)}` },
  war: { power: 'war', run: (s, f, p) => { const x = require('./diplomacy').declareWar(s, f.id, p.target, { reason: p.reason }); return `War declared: ${x.name}.`; }, describe: (s, f, p) => `declare war on ${C.faction(s, p.target)?.name}${p.reason ? ` (“${p.reason}”)` : ''}` },
  offer: { power: (s, f, p) => require('./diplomacy').KINDS[p.kind]?.power || 'diplomacy', run: (s, f, p, by) => { const D = require('./diplomacy'); const pr = D.propose(s, { kind: p.kind, from: f.id, to: p.to, payload: p.payload, note: p.note, proposer: by.char, userId: by.userId }); (s.world.announceQueue ||= []).push({ kind: 'proposal', proposalId: pr.id }); return `Offer sent to ${C.faction(s, p.to)?.name}.`; }, describe: (s, f, p) => `offer ${C.faction(s, p.to)?.name}: ${require('./diplomacy').KINDS[p.kind]?.name || p.kind}${p.note ? ` (“${p.note}”)` : ''}` },
  'end-agreement': { power: 'diplomacy', run: (s, f, p) => { const t = s.world.agreements.find((x) => x.id === p.agreementId); if (!t || !t.parties.includes(f.id)) throw new UserError('Agreement not found.'); require('./diplomacy').endAgreement(s, t.id, `was ended by ${f.name}`); return 'Agreement ended.'; }, describe: (s, f, p) => `end the ${s.world.agreements.find((x) => x.id === p.agreementId)?.name || 'agreement'}` },
  'alliance-create': { power: 'alliance', run: (s, f, p) => { const a = require('./diplomacy').createAlliance(s, { name: p.name, hanzi: p.hanzi, color: p.color, members: [f.id], leader: f.id, note: p.note }); return `The ${a.name} is founded.`; }, describe: (s, f, p) => `found the alliance “${p.name}”` },
  'alliance-leave': { power: 'alliance', run: (s, f) => { const a = C.allianceOf(s, f.id); if (!a) throw new UserError('Not in an alliance.'); require('./diplomacy').removeMember(s, a.id, f.id); return `Left the ${a.name}.`; }, describe: (s, f) => `leave the ${C.allianceOf(s, f.id)?.name || 'alliance'}` },
  'alliance-kick': { power: 'alliance', run: (s, f, p) => { const a = C.allianceOf(s, f.id); if (!a || a.leader !== f.id) throw new UserError('Only the alliance\'s leader can expel members.'); require('./diplomacy').removeMember(s, a.id, p.target, { reason: 'is expelled from' }); return 'Expelled.'; }, describe: (s, f, p) => `expel ${C.faction(s, p.target)?.name} from the ${C.allianceOf(s, f.id)?.name}` },
  recruit: { power: 'army', cost: (s, f, p) => require('./military').recruitCost(s, geo.marketOf(s, p.region), f, p.unitId, p.count).total, run: (s, f, p) => { const r = require('./military').recruit(s, f, p.region, p.unitId, p.count, { name: p.army || undefined }); return `Raised ${p.count} ${require('./military').unitType(s, p.unitId)?.name} for ${fmt(r.cost.total)}.`; }, describe: (s, f, p) => `recruit ${p.count} ${require('./military').unitType(s, p.unitId)?.name} in ${geo.label(s, p.region)}` },
  caravan: { power: 'trade', cost: (s, f, p) => caravanQuote(s, f, p).cost, run: (s, f, p) => { const cv = sendFactionCaravan(s, f, p); return `Caravan sent: ${cv.qty} ${cv.goodName} from ${geo.label(s, cv.from)} to ${geo.label(s, cv.to)} (arrives turn ${cv.arriveTurn}).`; }, describe: (s, f, p) => `send a caravan of ${p.qty} ${s.world.goods.find((g) => g.id === p.good)?.name} from ${geo.label(s, p.from)} to ${geo.label(s, p.to)}` },
  stipend: { power: 'treasury', run: (s, f, p) => { f.stipendRate = clamp(num(p.rate), 0, num(s.world.settings.maxStipendRate, 30)); return `Stipends set to ${f.stipendRate}% of income.`; }, describe: (s, f, p) => `set stipends to ${p.rate}% of income` },
  gift: { power: 'treasury', cost: (s, f, p) => num(p.amount), run: (s, f, p) => { const to = C.faction(s, p.to); const amt = r2(Math.max(0, num(p.amount))); if (!to) throw new UserError('Unknown faction.'); if (f.treasury < amt) throw new UserError(`The treasury has only ${fmt(f.treasury)}.`); f.treasury = r2(f.treasury - amt); to.treasury = r2(to.treasury + amt); (s.world.announceQueue ||= []).push({ kind: 'diplomacy', text: `**${f.name}** sends **${fmt(amt)}** to **${to.name}**.${p.note ? ` *${p.note}*` : ''}` }); return `Sent ${fmt(amt)} to ${to.name}.`; }, describe: (s, f, p) => `send ${fmt(p.amount)} to ${C.faction(s, p.to)?.name}` },
  claim: { power: 'land', run: (s, f, p, by) => { const t = require('./territory').requestTakeover(s, { regions: [p.region], to: f.id, reason: p.reason, by: { id: by.userId, name: by.char?.name || by.name, charId: by.char?.id } }); return `Claim on ${geo.label(s, p.region)} sent to staff (${t.id}).`; }, describe: (s, f, p) => `claim ${geo.label(s, p.region)}` },
};
const powerOf = (state, f, kind, payload) => (typeof ACTIONS[kind].power === 'function' ? ACTIONS[kind].power(state, f, payload) : ACTIONS[kind].power);

/**
 * Do something for a faction. by: { char, member, userId, name, staff }.
 * Returns { done: true, text } or { pending: request } when staff must approve first.
 */
function perform(state, kind, f, payload, by = {}) {
  const def = ACTIONS[kind];
  if (!def) throw new UserError('Unknown action.');
  if (!f) throw new UserError('Your character has no faction.');
  const power = powerOf(state, f, kind, payload);
  const level = powerLevel(state, f, by.char, by.member, power, { staff: by.staff });
  const pname = W.POWERS.find((p) => p.id === power)?.name || power;
  if (level === 'none') throw new UserError(`Your office doesn't allow that (${pname}). Ask your sect's leader or staff.`);
  const cost = def.cost ? num(def.cost(state, f, payload)) : 0;
  const limit = num(rankOf(state, f, by.char, by.member)?.spendLimit, 0);
  // Claims always go to staff through the takeover queue, so they don't need a second approval here.
  const needsStaff = !by.staff && kind !== 'claim' && (level === 'staff' || cost > limit);
  if (cost > 0 && f.treasury < cost && !by.staff) throw new UserError(`That costs ${fmt(cost)} and ${f.name}'s treasury has ${fmt(f.treasury)}.`);
  if (needsStaff) return { pending: request(state, kind, f, payload, by, level === 'staff' ? `${pname} needs staff approval for this rank` : `costs ${fmt(cost)}, over this rank's limit of ${fmt(limit)}`) };
  return { done: true, text: def.run(state, f, payload, by) };
}
function request(state, kind, f, payload, by, why) {
  const w = state.world;
  const q = { id: newId('rq-'), kind, factionId: f.id, payload, charId: by.char?.id || '', userId: by.userId || by.char?.ownerId || '', byName: by.char?.name || by.name || '', summary: ACTIONS[kind].describe(state, f, payload), why, status: 'pending', at: new Date().toISOString(), turn: w.turn, decidedBy: null, result: '', messages: [] };
  w.requests.unshift(q);
  if (w.requests.length > 300) w.requests.length = 300;
  C.wlog(state, 'request', `**${f.name}** asks staff: ${q.byName ? `${q.byName} wants to ` : ''}${q.summary}.`);
  (w.announceQueue ||= []).push({ kind: 'request', requestId: q.id });
  return q;
}
function findRequest(state, id) { const q = state.world.requests.find((x) => x.id === id); if (!q) throw new UserError('Request not found.'); return q; }
function approveRequest(state, id, by = {}) {
  const q = findRequest(state, id);
  if (q.status !== 'pending') throw new UserError(`Already ${q.status}.`);
  const f = C.faction(state, q.factionId);
  if (!f) throw new UserError('That faction no longer exists.');
  const char = state.characters.find((c) => c.id === q.charId) || null;
  q.result = ACTIONS[q.kind].run(state, f, q.payload, { char, userId: q.userId, name: q.byName });
  q.status = 'approved'; q.decidedBy = by.name || 'staff'; q.decidedAt = new Date().toISOString();
  C.wlog(state, 'request', `Staff approved: ${f.name} — ${q.summary}.`);
  return q;
}
function rejectRequest(state, id, by = {}, reason = '') {
  const q = findRequest(state, id);
  if (q.status !== 'pending') throw new UserError(`Already ${q.status}.`);
  q.status = 'rejected'; q.decidedBy = by.name || 'staff'; q.decidedAt = new Date().toISOString(); q.result = reason;
  C.wlog(state, 'request', `Staff rejected: ${C.faction(state, q.factionId)?.name} — ${q.summary}.`);
  return q;
}

// ─────────── buildings ───────────
const buildingType = (state, id) => (state.world.buildingTypes || []).find((b) => b.id === id) || null;
function startBuilding(state, f, key, typeId, { free = false } = {}) {
  const w = state.world;
  key = geo.marketOf(state, key);
  const r = w.regions[key];
  const t = buildingType(state, typeId);
  if (!r || !t) throw new UserError('Unknown region or building.');
  if (r.controller !== f.id) throw new UserError(`${f.name} doesn't rule ${geo.label(state, key)}.`);
  if (r.buildings.some((b) => b.typeId === typeId)) throw new UserError(`${geo.label(state, key)} already has a ${t.name}.`);
  if (t.requires?.terrains?.length && !t.requires.terrains.includes(r.terrain)) throw new UserError(`${t.name} needs ${t.requires.terrains.join(' / ')} land.`);
  if (t.requires?.anyProduction?.length && !t.requires.anyProduction.some((g) => num(r.production[g]) > 0)) throw new UserError(`${t.name} needs a region that produces ${t.requires.anyProduction.join(' or ')}.`);
  if (!free) { if (f.treasury < num(t.cost)) throw new UserError(`A ${t.name} costs ${fmt(t.cost)}; the treasury has ${fmt(f.treasury)}.`); f.treasury = r2(f.treasury - num(t.cost)); r.coffers = r2(r.coffers + num(t.cost) * 0.4); }
  const b = { id: newId('bd-'), typeId, factionId: f.id, level: 1, hp: 100, status: num(t.turns) > 0 ? 'building' : 'ready', readyTurn: w.turn + num(t.turns), builtTurn: w.turn, name: '', lastProfit: 0, lastRun: 1 };
  r.buildings.push(b);
  C.wlog(state, 'build', `**${f.name}** begins a **${t.name}** in ${geo.label(state, key)}.`);
  return b;
}
function findBuilding(state, key, id) {
  const r = state.world.regions[geo.marketOf(state, key)];
  const b = r?.buildings.find((x) => x.id === id);
  if (!b) throw new UserError('Building not found.');
  return { r, b, t: buildingType(state, b.typeId) };
}
function repairCost(state, key, id) {
  const { b, t } = findBuilding(state, key, id);
  return r2(num(t?.cost) * (100 - b.hp) / 100 * num(state.world.settings.buildingRepairShare, 0.6));
}
function repairBuilding(state, f, key, id) {
  const { r, b } = findBuilding(state, key, id);
  if (r.controller !== f.id) throw new UserError('Not your region.');
  const cost = repairCost(state, key, id);
  if (f.treasury < cost) throw new UserError(`Repairs cost ${fmt(cost)}.`);
  f.treasury = r2(f.treasury - cost); b.hp = 100;
  return cost;
}
function upgradeCost(state, key, id) {
  const { b, t } = findBuilding(state, key, id);
  if (b.level >= num(t?.maxLevel, 1)) return 0;
  return r2(num(t?.cost) * (b.level === 1 ? 0.9 : 1.2));
}
function upgradeBuilding(state, f, key, id) {
  const { r, b, t } = findBuilding(state, key, id);
  if (f && r.controller !== f.id) throw new UserError('Not your region.');
  if (b.level >= num(t?.maxLevel, 1)) throw new UserError(`${t?.name} is already at its highest level.`);
  if (b.status !== 'ready') throw new UserError('Finish building it first.');
  const cost = upgradeCost(state, key, id);
  if (f) { if (f.treasury < cost) throw new UserError(`Upgrading costs ${fmt(cost)}.`); f.treasury = r2(f.treasury - cost); }
  b.level += 1;
  return b;
}
function demolishBuilding(state, f, key, id) {
  const { r, b, t } = findBuilding(state, key, id);
  if (f && r.controller !== f.id) throw new UserError('Not your region.');
  r.buildings = r.buildings.filter((x) => x !== b);
  C.wlog(state, 'build', `The ${t?.name || 'building'} in ${geo.label(state, r.key)} is pulled down.`);
}
/** Each turn: finish construction, pay upkeep (unpaid buildings decay), keep ownership with the region's ruler. */
function tickBuildings(state) {
  const w = state.world;
  for (const key of geo.marketKeys(state)) {
    const r = w.regions[key];
    for (const b of [...(r.buildings || [])]) {
      const t = buildingType(state, b.typeId);
      if (!t) continue;
      if (r.controller && b.factionId !== r.controller) b.factionId = r.controller;
      if (b.status === 'building' && w.turn >= b.readyTurn) {
        b.status = 'ready';
        const f = C.faction(state, b.factionId);
        (w.announceQueue ||= []).push({ kind: 'build', text: `The **${t.name}** in **${geo.label(state, key)}** is finished${f ? ` — ${f.name} built it` : ''}.`, regions: [key] });
      }
      const f = C.faction(state, b.factionId);
      // Production buildings pay their workers out of what they make (economy.runBuilding); the rest cost upkeep.
      const up = require('./economy').isProducer(t) ? 0 : num(t.upkeep);
      if (f && up > 0 && b.status === 'ready') {
        if (f.treasury >= up) { f.treasury = r2(f.treasury - up); if (f.lastIncome) f.lastIncome.buildings = r2(num(f.lastIncome.buildings) - up); } else b.hp = r2(Math.max(0, b.hp - 2));
      }
      if (b.hp <= 0) { r.buildings = r.buildings.filter((x) => x !== b); C.wlog(state, 'build', `The neglected ${t.name} in ${geo.label(state, key)} has fallen to ruin.`); }
    }
  }
}
/** A region changes hands: each building may be razed. Returns the names of those destroyed. */
function razeOnCapture(state, key, rng = Math.random) {
  const r = state.world.regions[geo.marketOf(state, key)];
  if (!r?.buildings?.length) return [];
  const chance = num(state.world.settings.buildingRazeChance, 0.5);
  const lost = [];
  r.buildings = r.buildings.filter((b) => { if (rng() < chance) { lost.push(buildingType(state, b.typeId)?.name || b.typeId); return false; } b.factionId = r.controller || ''; return true; });
  return lost;
}
/** A battle was fought here: buildings are damaged (walls most when the attacker wins). */
function battleDamage(state, key, { days = 10, attackerWon = false } = {}, rng = Math.random) {
  const r = state.world.regions[geo.marketOf(state, key)];
  if (!r?.buildings?.length) return [];
  const k = num(state.world.settings.battleBuildingDamage, 1) * clamp(days / 10, 0.5, 1.5);
  const out = [];
  for (const b of [...r.buildings]) {
    const t = buildingType(state, b.typeId);
    const dmg = r2((10 + rng() * 30) * k * (num(t?.fort) > 0 && attackerWon ? 1.5 : 1));
    b.hp = r2(Math.max(0, b.hp - dmg));
    out.push({ name: t?.name || b.typeId, hp: b.hp, destroyed: b.hp <= 0 });
    if (b.hp <= 0) r.buildings = r.buildings.filter((x) => x !== b);
  }
  return out;
}

// ─────────── faction caravans ───────────
function canRunCaravans(state, f) {
  const mode = state.world.settings.factionCaravans || 'guilds';
  if (mode === 'none') return false;
  if (mode === 'all') return true;
  return f.kind === 'guild' || !!f.tradeCharter;
}
/** May faction f trade in market `key`? Unclaimed land, its own, or a ruler it has free trade with (and is not at war with). */
function tradeRight(state, f, key) {
  const ruler = state.world.regions[geo.marketOf(state, key)]?.controller;
  if (!ruler || ruler === f.id) return true;
  if (C.atWar(state, f.id, ruler)) return false;
  return C.hasPerk(state, f.id, ruler, 'freeTrade');
}
function caravanQuote(state, f, p) {
  const E = require('./economy');
  const from = geo.marketOf(state, p.from); const to = geo.marketOf(state, p.to);
  const g = E.good(state, p.good);
  if (!g) throw new UserError('Unknown good.');
  if (from === to) throw new UserError('Pick two different markets.');
  const qty = Math.floor(num(p.qty));
  const cap = num(state.world.settings.caravanCapacity, 120) * 5 / Math.max(0.5, num(g.weight, 1));
  if (qty < 1) throw new UserError('Send at least 1.');
  if (qty > cap) throw new UserError(`A caravan carries at most ${Math.floor(cap)} ${g.name}.`);
  const buy = E.quote(state, from, g.id, qty, 'buy', null);
  const rt = geo.route(state, from, to);
  if (!rt) throw new UserError('No road there.');
  const sellNow = E.quote(state, to, g.id, qty, 'sell', null);
  const fee = r2(qty * 0.3 * rt.hops);
  return { from, to, g, qty, cost: r2(buy.total + fee), buy: buy.total, fee, expected: sellNow.total, route: rt };
}
function sendFactionCaravan(state, f, p) {
  const w = state.world;
  const E = require('./economy');
  if (!canRunCaravans(state, f)) throw new UserError(`${f.name} doesn't run trade caravans (World settings → Faction caravans).`);
  const q = caravanQuote(state, f, p);
  for (const k of [q.from, q.to]) if (!tradeRight(state, f, k)) throw new UserError(`${f.name} has no trade rights in ${geo.label(state, k)} — it needs free trade with ${C.faction(state, w.regions[k].controller)?.name}.`);
  if (f.treasury < q.cost) throw new UserError(`The caravan costs ${fmt(q.cost)}; the treasury has ${fmt(f.treasury)}.`);
  const rf = w.regions[q.from];
  f.treasury = r2(f.treasury - q.cost);
  rf.stock[q.g.id] = r2(num(rf.stock[q.g.id]) - q.qty);
  rf.coffers = r2(rf.coffers + q.buy);
  rf.last.tradeValue = r2(num(rf.last.tradeValue) + q.buy);
  E.updatePrices(state, q.from, C.regionMods(state, q.from));
  const turns = num(w.settings.factionCaravanTurns) > 0 ? num(w.settings.factionCaravanTurns) : Math.max(1, Math.ceil(q.route.distance / 150));
  const cv = { id: newId('cv-'), npc: false, owner: { type: 'faction', id: f.id }, from: q.from, to: q.to, path: q.route.path, good: q.g.id, goodName: q.g.name, qty: q.qty, cost: q.cost, departTurn: w.turn, arriveTurn: w.turn + turns, status: 'travelling' };
  w.caravans.push(cv);
  C.wlog(state, 'trade', `**${f.name}** sends a caravan of ${q.qty} ${q.g.name} from ${geo.label(state, q.from)} to ${geo.label(state, q.to)}.`);
  return cv;
}
/** Each turn: faction caravans that arrive sell their cargo (whatever the merchants can pay for). */
function settleFactionCaravans(state) {
  const w = state.world;
  const E = require('./economy');
  const out = [];
  for (const cv of w.caravans) {
    if (cv.owner?.type !== 'faction' || cv.status !== 'travelling' || cv.arriveTurn > w.turn) continue;
    const f = C.faction(state, cv.owner.id);
    const rd = w.regions[cv.to];
    const { lost } = E.journeyLoss(state, cv, 0.05);
    let qty = Math.floor(cv.qty * (1 - lost));
    let earned = 0; let sold = 0;
    if (rd && qty > 0) {
      let n = qty;
      while (n > 0) { const q = E.quote(state, cv.to, cv.good, n, 'sell', null); if (q.total <= rd.coffers) { earned = q.total; sold = n; break; } n = Math.floor(n * 0.7); }
      if (sold) { rd.stock[cv.good] = r2(num(rd.stock[cv.good]) + sold); rd.coffers = r2(rd.coffers - earned); rd.last.tradeValue = r2(num(rd.last.tradeValue) + earned); E.updatePrices(state, cv.to, C.regionMods(state, cv.to)); }
      // Unsold cargo is sold off cheaply to peddlers.
      if (qty > sold) { const rest = (qty - sold) * num(rd.prices[cv.good]) * 0.3; earned += rest; rd.stock[cv.good] = r2(num(rd.stock[cv.good]) + qty - sold); }
    }
    earned = r2(earned);
    if (f) { f.treasury = r2(f.treasury + earned); if (f.lastIncome) f.lastIncome.trade = r2(num(f.lastIncome.trade) + earned - cv.cost); }
    cv.status = 'arrived'; cv.result = { lost: r2(lost), sold, earned, profit: r2(earned - cv.cost) };
    out.push(cv);
    if (!cv.auto) (w.announceQueue ||= []).push({ kind: 'trade', text: `**${f?.name || 'A caravan'}**'s caravan of ${cv.qty} ${cv.goodName || cv.good} reached **${geo.label(state, cv.to)}**${lost ? ` (bandits took ${Math.round(lost * 100)}%)` : ''}: sold for ${fmt(earned)}, profit **${fmt(r2(earned - cv.cost))}**.`, factions: f ? [f.id] : [] });
  }
  return out;
}

/**
 * Each turn every faction's merchant houses trade by themselves — no setup needed: they buy where goods are plentiful
 * and sell where they are scarce, inside the faction's own lands and those of every faction it has **free trade** with
 * (trade guilds also in unclaimed land). The treasury pays for the cargo (a small share at a time) and receives the sale.
 */
function autoTrade(state) {
  const w = state.world;
  const s = w.settings;
  if (!s.autoTrade) return 0;
  const E = require('./economy');
  const markets = geo.marketKeys(state);
  let sent = 0;
  for (const f of w.factions) {
    if (!f.active || f.treasury < 200) continue;
    const partners = w.factions.filter((o) => o.id !== f.id && o.active && C.hasPerk(state, f.id, o.id, 'freeTrade')).map((o) => o.id);
    const guild = canRunCaravans(state, f);
    const M = markets.filter((k) => { const ruler = w.regions[k].controller; return ruler === f.id || partners.includes(ruler) || (guild && !ruler); });
    if (M.length < 2) continue;
    const n = Math.min(6, num(s.autoTradeCaravans, 2) + partners.length);
    const offers = [];
    for (const g of w.goods) {
      const src = []; const dst = [];
      for (const k of M) {
        const r = w.regions[k];
        const sur = num(r.stock[g.id]) - num(r.targets[g.id]) * 1.1;
        const def = num(r.targets[g.id]) * 0.9 - num(r.stock[g.id]);
        if (sur > 2) src.push({ k, r, sur });
        if (def > 2) dst.push({ k, r, def });
      }
      for (const a of src) for (const d of dst) {
        if (a.k === d.k) continue;
        const rt = geo.route(state, a.k, d.k);
        if (!rt || rt.hops > 6) continue;
        const ps = num(a.r.prices[g.id], g.basePrice); const pd = num(d.r.prices[g.id], g.basePrice);
        const margin = pd - ps * (1 + 0.04 * rt.hops);
        if (margin < ps * num(s.autoTradeMinMargin, 0.15)) continue;
        offers.push({ g, a, d, rt, ps, pd, score: margin * Math.min(a.sur, d.def) });
      }
    }
    offers.sort((x, y) => y.score - x.score);
    const used = new Set();
    let made = 0;
    for (const o of offers) {
      if (made >= n) break;
      const tag = `${o.a.k}|${o.g.id}`; const tag2 = `${o.d.k}|${o.g.id}`;
      if (used.has(tag) || used.has(tag2)) continue;
      const budget = f.treasury * num(s.autoTradeInvest, 0.08) / o.ps;
      const cap = num(s.caravanCapacity, 120) * 5 / Math.max(0.5, num(o.g.weight, 1));
      const qty = Math.floor(Math.min(o.a.sur, o.d.def, budget, cap, o.d.r.coffers / Math.max(0.01, o.pd)));
      if (qty < 2) continue;
      const cost = r2(qty * o.ps);
      f.treasury = r2(f.treasury - cost);
      o.a.r.stock[o.g.id] = r2(num(o.a.r.stock[o.g.id]) - qty);
      o.a.r.coffers = r2(o.a.r.coffers + cost);
      o.a.r.last.tradeValue = r2(num(o.a.r.last.tradeValue) + cost);
      w.caravans.push({ id: newId('cv-'), npc: false, auto: true, owner: { type: 'faction', id: f.id }, from: o.a.k, to: o.d.k, path: o.rt.path, good: o.g.id, goodName: o.g.name, qty, cost, departTurn: w.turn, arriveTurn: w.turn + Math.max(1, Math.ceil(o.rt.distance / 150)), status: 'travelling' });
      used.add(tag); used.add(tag2);
      made++; sent++;
    }
    if (made) for (const k of new Set(offers.slice(0, made).map((o) => o.a.k))) E.updatePrices(state, k, C.regionMods(state, k));
  }
  return sent;
}

module.exports = {
  autoTrade, upgradeCost, upgradeBuilding,
  ranks, rank, rankOf, powerLevel, powerSummary,
  ACTIONS, perform, request, findRequest, approveRequest, rejectRequest,
  buildingType, startBuilding, repairCost, repairBuilding, demolishBuilding, tickBuildings, razeOnCapture, battleDamage,
  canRunCaravans, tradeRight, caravanQuote, sendFactionCaravan, settleFactionCaravans,
};
