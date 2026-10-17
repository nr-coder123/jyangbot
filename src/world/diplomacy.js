'use strict';
/**
 * Diplomacy, kept simple for text role-play. The bot does not count how factions feel about each other — that is
 * role-played. It only records what was agreed:
 *   · wars (sides, allies called in by their pacts) and peace
 *   · alliances: one bloc with shared terms, shown on the map (members, colour, leader)
 *   · one-on-one agreements: a few perks (military access, free trade, shared shops, non-aggression, defensive pact,
 *     call to arms, tribute) plus a note of whatever else was agreed in RP
 *   · political marriages
 * Offers between factions are proposals: the other side's representative accepts (and, for a marriage, the other
 * character's player). Whether a representative may offer or accept something is decided by their rank (realm.js).
 */
const C = require('./common');
const WS = require('./state');
const W = require('./defaults');
const { num, r2, newId, UserError } = require('../utils');

const fname = (state, id) => C.faction(state, id)?.name || 'Unknown';
const announce = (state, kind, text, extra = {}) => { C.wlog(state, kind, text); (state.world.announceQueue ||= []).push({ kind, text, ...extra }); };

// ─────────── wars ───────────
/** Declare war. Allies with a call-to-arms join the attacker; allies with a defensive pact join the defender. */
function declareWar(state, a, b, { reason = '', name = '', force = false, silent = false } = {}) {
  const w = state.world;
  if (!C.faction(state, a) || !C.faction(state, b) || a === b) throw new UserError('Pick two different factions.');
  if (C.atWar(state, a, b)) throw new UserError(`${fname(state, a)} and ${fname(state, b)} are already at war.`);
  if (!force && C.hasPerk(state, a, b, 'nonAggression')) throw new UserError(`${fname(state, a)} and ${fname(state, b)} have a non-aggression pact. End it first (or staff can force the war).`);
  const attackers = [a]; const defenders = [b];
  for (const f of w.factions) {
    if (!f.active || f.id === a || f.id === b) continue;
    if (C.hasPerk(state, b, f.id, 'defensive') && !C.hasPerk(state, a, f.id, 'nonAggression')) defenders.push(f.id);
    else if (C.hasPerk(state, a, f.id, 'callToArms') && !C.hasPerk(state, b, f.id, 'nonAggression')) attackers.push(f.id);
  }
  const war = WS.normalizeWar({ id: newId('wr-'), name: name || `${fname(state, a)}–${fname(state, b)} War`, attackers, defenders, startTurn: w.turn, reason });
  w.wars.push(war);
  const allies = (list, main) => list.filter((x) => x !== main).map((x) => fname(state, x));
  const text = `**${fname(state, a)}** declares war on **${fname(state, b)}**${reason ? ` — “${reason}”` : ''}.${allies(attackers, a).length ? ` Joining the attack: ${allies(attackers, a).join(', ')}.` : ''}${allies(defenders, b).length ? ` Honouring their pacts, ${allies(defenders, b).join(', ')} stand${allies(defenders, b).length === 1 ? 's' : ''} with ${fname(state, b)}.` : ''}`;
  if (silent) C.wlog(state, 'war', text); else announce(state, 'war', text, { factions: [...attackers, ...defenders] });
  return war;
}
function war(state, id) { const x = state.world.wars.find((y) => y.id === id); if (!x) throw new UserError('War not found.'); return x; }
/** End a war (the whole war, or take one faction out of it). */
function makePeace(state, warId, { factionId = null, note = '' } = {}) {
  const w = state.world;
  const x = war(state, warId);
  if (factionId && (x.attackers.length + x.defenders.length > 2)) {
    x.attackers = x.attackers.filter((f) => f !== factionId); x.defenders = x.defenders.filter((f) => f !== factionId);
    if (x.attackers.length && x.defenders.length) { announce(state, 'war', `**${fname(state, factionId)}** makes peace and leaves the ${x.name}.${note ? ` *${note}*` : ''}`); return x; }
  }
  w.wars = w.wars.filter((y) => y.id !== x.id);
  // Armies fighting each other stand down: open battles of this war are called off.
  for (const b of w.battles) if (b.status === 'preparing' && !C.atWar(state, b.sides.A.factionId, b.sides.D.factionId)) { b.status = 'cancelled'; for (const id of [...b.sides.A.armies, ...b.sides.D.armies]) { const a = w.armies.find((y) => y.id === id); if (a) a.status = 'garrison'; } }
  for (const r of Object.values(w.regions)) if (r.occupiedBy && !C.atWar(state, r.occupiedBy, r.controller)) r.occupiedBy = null;
  announce(state, 'war', `The **${x.name}** is over.${note ? ` *${note}*` : ''}`);
  return x;
}
function joinWar(state, warId, factionId, side) {
  const x = war(state, warId);
  if (x.attackers.includes(factionId) || x.defenders.includes(factionId)) throw new UserError('Already in this war.');
  (side === 'defenders' ? x.defenders : x.attackers).push(factionId);
  announce(state, 'war', `**${fname(state, factionId)}** joins the ${x.name} on the ${side === 'defenders' ? 'defenders\'' : 'attackers\''} side.`);
  return x;
}

// ─────────── alliances ───────────
function alliance(state, id) { const a = state.world.alliances.find((x) => x.id === id); if (!a) throw new UserError('Alliance not found.'); return a; }
function createAlliance(state, { name, hanzi = '', color, members = [], terms, note = '', leader }) {
  const w = state.world;
  if (!name) throw new UserError('Name the alliance.');
  const a = WS.normalizeAlliance({ id: newId('al-'), name, hanzi, color: color || '#b3261e', members: [], terms, note, leader: leader || members[0] || '', foundedTurn: w.turn });
  w.alliances.push(a);
  for (const m of members) addMember(state, a.id, m, { silent: true });
  announce(state, 'alliance', `The **${a.name}** is founded${a.members.length ? ` by ${a.members.map((m) => `**${fname(state, m)}**`).join(', ')}` : ''}.`);
  return a;
}
/** A faction belongs to one alliance at most: joining another leaves the old one. */
function addMember(state, allianceId, fid, { silent = false } = {}) {
  const a = alliance(state, allianceId);
  if (!C.faction(state, fid)) throw new UserError('Unknown faction.');
  if (a.members.includes(fid)) return a;
  const old = C.allianceOf(state, fid);
  if (old) removeMember(state, old.id, fid, { silent: true });
  for (const m of a.members) if (C.atWar(state, m, fid)) throw new UserError(`${fname(state, fid)} is at war with ${fname(state, m)}, a member of the ${a.name}.`);
  a.members.push(fid);
  if (!a.leader) a.leader = fid;
  if (!silent) announce(state, 'alliance', `**${fname(state, fid)}** joins the **${a.name}**.`);
  return a;
}
function removeMember(state, allianceId, fid, { silent = false, reason = 'leaves' } = {}) {
  const w = state.world;
  const a = alliance(state, allianceId);
  a.members = a.members.filter((m) => m !== fid);
  if (a.leader === fid) a.leader = a.members[0] || '';
  if (!silent) announce(state, 'alliance', `**${fname(state, fid)}** ${reason} the **${a.name}**.`);
  if (!a.members.length) { w.alliances = w.alliances.filter((x) => x.id !== a.id); C.wlog(state, 'alliance', `The ${a.name} is no more.`); }
  return a;
}
function dissolveAlliance(state, allianceId) {
  const a = alliance(state, allianceId);
  state.world.alliances = state.world.alliances.filter((x) => x.id !== a.id);
  announce(state, 'alliance', `The **${a.name}** is dissolved.`);
  return a;
}

// ─────────── agreements ───────────
function makeAgreement(state, { parties, perks = {}, tribute = null, note = '', name = '', duration = 0, effects = {}, scriptId = '' }) {
  const w = state.world;
  const [a, b] = parties || [];
  if (!C.faction(state, a) || !C.faction(state, b) || a === b) throw new UserError('An agreement needs two different factions.');
  const t = WS.normalizeAgreement({ id: newId('ag-'), name: name || `${fname(state, a)} & ${fname(state, b)} Agreement`, parties: [a, b], perks, tribute, note, startTurn: w.turn, endTurn: num(duration) ? w.turn + num(duration) : null, effects, scriptId });
  w.agreements.push(t);
  announce(state, 'diplomacy', `**${fname(state, a)}** and **${fname(state, b)}** sign the **${t.name}**${perkText(t) ? ` — ${perkText(t)}` : ''}.${t.note ? ` *${t.note}*` : ''}`, { factions: [a, b] });
  return t;
}
function perkText(t) {
  const list = W.PERKS.filter((p) => t.perks?.[p.id]).map((p) => p.name.toLowerCase());
  if (t.tribute) list.push(`tribute ${t.tribute.percent ? `${t.tribute.percent}% of taxes` : ''}${t.tribute.percent && t.tribute.fixed ? ' + ' : ''}${t.tribute.fixed ? `${t.tribute.fixed}/turn` : ''}`.trim());
  return list.join(', ');
}
function endAgreement(state, id, reason = 'ended') {
  const w = state.world;
  const t = w.agreements.find((x) => x.id === id);
  if (!t) throw new UserError('Agreement not found.');
  w.agreements = w.agreements.filter((x) => x.id !== id);
  announce(state, 'diplomacy', `The **${t.name}** between ${t.parties.map((p) => `**${fname(state, p)}**`).join(' and ')} ${reason}.`, { factions: t.parties });
  return t;
}

// ─────────── marriages ───────────
function marry(state, aId, bId) {
  const w = state.world;
  const a = state.characters.find((c) => c.id === aId); const b = state.characters.find((c) => c.id === bId);
  if (!a || !b) throw new UserError('Character not found.');
  if (a.spouseId || b.spouseId) throw new UserError(`${a.spouseId ? a.name : b.name} is already married.`);
  a.spouseId = b.id; b.spouseId = a.id;
  const m = { a: a.id, b: b.id, factions: [C.factionOfChar(state, a)?.id || '', C.factionOfChar(state, b)?.id || ''], turn: w.turn, at: new Date().toISOString() };
  w.marriages.push(m);
  announce(state, 'diplomacy', `**${a.name}** (${C.factionOfChar(state, a)?.name || 'Rogue'}) and **${b.name}** (${C.factionOfChar(state, b)?.name || 'Rogue'}) are married.`);
  return m;
}
function divorce(state, aId) {
  const w = state.world;
  const a = state.characters.find((c) => c.id === aId);
  const b = a && state.characters.find((c) => c.id === a.spouseId);
  if (!a || !b) throw new UserError('Not married.');
  a.spouseId = ''; b.spouseId = '';
  w.marriages = w.marriages.filter((m) => !([m.a, m.b].includes(a.id) && [m.a, m.b].includes(b.id)));
  C.wlog(state, 'diplomacy', `The marriage of ${a.name} and ${b.name} is dissolved.`);
}

// ─────────── proposals (offers between factions) ───────────
/**
 * kinds:
 *   agreement       payload { name, perks, tribute: { who: 'from'|'to', percent, fixed }, duration }
 *   alliance-invite payload { allianceId }        — a member invites `to` into its alliance
 *   alliance-join   payload { allianceId }        — `from` asks the alliance's leader (`to`) to let it in
 *   alliance-found  payload { name, hanzi, color, terms } — found a new alliance together
 *   peace           payload { warId }
 *   marriage        payload { subjectCharId, targetCharId }
 *   end-agreement   payload { agreementId }       (one-sided: done at once, see realm.js)
 */
const KINDS = {
  agreement: { name: 'Agreement', power: 'diplomacy' },
  'alliance-invite': { name: 'Alliance invitation', power: 'alliance' },
  'alliance-join': { name: 'Request to join an alliance', power: 'alliance' },
  'alliance-found': { name: 'Found an alliance together', power: 'alliance' },
  peace: { name: 'Peace offer', power: 'war' },
  marriage: { name: 'Political marriage', power: 'diplomacy' },
};
function findProposal(state, id) {
  const p = state.world.proposals.find((x) => x.id === id);
  if (!p) throw new UserError('That proposal no longer exists.');
  return p;
}
function checkProposal(state, kind, from, to, payload = {}) {
  if (!KINDS[kind]) throw new UserError('Unknown kind of offer.');
  if (!C.faction(state, from) || !C.faction(state, to) || from === to) throw new UserError('Pick another faction.');
  if (kind === 'agreement' && C.atWar(state, from, to)) throw new UserError('Make peace first.');
  if (kind === 'peace') { const x = C.warBetween(state, from, to); if (!x) throw new UserError('You are not at war with them.'); payload.warId = x.id; }
  if (kind === 'alliance-invite') { const a = alliance(state, payload.allianceId); if (!a.members.includes(from)) throw new UserError('You can only invite into your own alliance.'); if (a.members.includes(to)) throw new UserError('They are already members.'); }
  if (kind === 'alliance-join') { const a = alliance(state, payload.allianceId); if (a.members.includes(from)) throw new UserError('Already a member.'); if (!a.members.includes(to)) throw new UserError('Ask a member of that alliance.'); }
  if (kind === 'alliance-found' && !payload.name) throw new UserError('Name the alliance.');
  if (kind === 'marriage') {
    const s = state.characters.find((c) => c.id === payload.subjectCharId); const t = state.characters.find((c) => c.id === payload.targetCharId);
    if (!s || !t) throw new UserError('Character not found — type the exact names.');
    if (C.factionOfChar(state, s)?.id !== from) throw new UserError(`${s.name} is not one of yours.`);
    if (C.factionOfChar(state, t)?.id !== to) throw new UserError(`${t.name} is not a member of ${fname(state, to)}.`);
    if (s.spouseId || t.spouseId) throw new UserError(`${s.spouseId ? s.name : t.name} is already married.`);
  }
  return payload;
}
function propose(state, { kind, from, to, payload = {}, note = '', proposer = null, userId = '', staffApproval = false }) {
  const w = state.world;
  payload = checkProposal(state, kind, from, to, { ...payload });
  const p = {
    id: newId('dp-'), kind, from, to, payload, note: String(note || '').slice(0, 600),
    proposerCharId: proposer?.id || '', proposerUserId: proposer?.ownerId || userId || '',
    status: 'awaiting-target', approvals: {}, needsStaff: !!staffApproval, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(), turn: w.turn, messages: [],
  };
  const fromF = C.faction(state, from);
  if (fromF?.scriptId) {
    const out = C.runHooks(state, [{ scriptId: fromF.scriptId, type: 'faction', name: fromF.name }], 'diplomacy', C.worldCtx(state, { stage: 'propose', kind, from: C.factionSummary(state, fromF), to: C.factionSummary(state, C.faction(state, to)), payload }), { blocked: '' });
    if (out?.blocked) throw new UserError(String(out.blocked));
  }
  w.proposals.unshift(p);
  if (w.proposals.length > 200) w.proposals.length = 200;
  C.wlog(state, 'diplomacy', `**${fname(state, from)}** → **${fname(state, to)}**: ${KINDS[kind].name}${p.note ? ` — “${p.note}”` : ''}`);
  return p;
}
/** Who must act next: 'target' (their representative), 'character' (their character's player), 'staff', or null. */
function nextStep(state, p) {
  return { 'awaiting-target': 'target', 'awaiting-character': 'character', 'awaiting-staff': 'staff' }[p.status] || null;
}
/** who: { kind: 'target' | 'character' | 'staff', name, userId, needsStaff (the accepting representative's rank needs staff) } */
function respond(state, id, accept, who) {
  const p = findProposal(state, id);
  if (!p.status.startsWith('awaiting')) throw new UserError(`This offer is already ${p.status}.`);
  if (Date.parse(p.expiresAt) < Date.now()) { p.status = 'expired'; throw new UserError('This offer has expired.'); }
  const step = nextStep(state, p);
  if (who.kind !== step && who.kind !== 'staff') throw new UserError(step === 'staff' ? 'Waiting for staff approval.' : step === 'character' ? 'Waiting for the other character\'s player.' : 'Waiting for their representative.');
  if (!accept) {
    p.status = 'rejected'; p.rejectedBy = who.name || who.kind;
    C.wlog(state, 'diplomacy', `${KINDS[p.kind]?.name}: ${fname(state, p.from)} → ${fname(state, p.to)} declined by ${p.rejectedBy}.`);
    return p;
  }
  p.approvals[who.kind] = { by: who.name || '', userId: who.userId || '', at: new Date().toISOString() };
  if (who.needsStaff) p.needsStaff = true;
  if (who.kind === 'staff') { p.approvals.target ||= { by: `${who.name} (staff)` }; p.approvals.character ||= { by: `${who.name} (staff)` }; p.approvals.staff = p.approvals.staff || { by: who.name }; }
  if (!p.approvals.target) { p.status = 'awaiting-target'; return p; }
  if (p.kind === 'marriage' && !p.approvals.character) {
    const t = state.characters.find((c) => c.id === p.payload.targetCharId);
    if (t && p.approvals.target?.userId && p.approvals.target.userId === t.ownerId) p.approvals.character = { by: p.approvals.target.by };
    else { p.status = 'awaiting-character'; return p; }
  }
  if (p.needsStaff && !p.approvals.staff) { p.status = 'awaiting-staff'; return p; }
  return execute(state, p);
}
function execute(state, p) {
  const { kind, from, to, payload } = p;
  const lines = [];
  if (kind === 'agreement') {
    const tribute = payload.tribute && (num(payload.tribute.percent) || num(payload.tribute.fixed)) ? { payer: payload.tribute.who === 'to' ? to : from, receiver: payload.tribute.who === 'to' ? from : to, percent: num(payload.tribute.percent), fixed: num(payload.tribute.fixed) } : null;
    const t = makeAgreement(state, { parties: [from, to], perks: payload.perks || {}, tribute, note: p.note, name: payload.name, duration: payload.duration });
    p.agreementId = t.id;
  } else if (kind === 'alliance-invite' || kind === 'alliance-join') {
    addMember(state, payload.allianceId, kind === 'alliance-invite' ? to : from);
  } else if (kind === 'alliance-found') {
    const a = createAlliance(state, { name: payload.name, hanzi: payload.hanzi, color: payload.color, terms: payload.terms, note: p.note, members: [from, to], leader: from });
    p.allianceId = a.id;
  } else if (kind === 'peace') {
    if (state.world.wars.some((x) => x.id === payload.warId)) makePeace(state, payload.warId, { note: p.note });
  } else if (kind === 'marriage') {
    marry(state, payload.subjectCharId, payload.targetCharId);
  }
  p.status = 'done'; p.doneAt = new Date().toISOString(); p.result = lines;
  return p;
}
function expireProposals(state) {
  for (const p of state.world.proposals) if (p.status.startsWith('awaiting') && Date.parse(p.expiresAt) < Date.now()) p.status = 'expired';
}

module.exports = {
  KINDS, declareWar, war, makePeace, joinWar,
  alliance, createAlliance, addMember, removeMember, dissolveAlliance,
  makeAgreement, endAgreement, perkText, marry, divorce,
  findProposal, checkProposal, propose, nextStep, respond, execute, expireProposals,
};
