'use strict';
/**
 * Diplomacy: actions (the "Diplomacy map"), proposals between Sect Representatives, and their effects.
 *
 * A proposal goes:  proposed → (other side's representative accepts) → (the target character's player
 * consents, for marriages and sworn brotherhood) → (staff approve, if the action needs it) → done.
 * Unilateral actions (gifts, denouncing, declaring war…) skip the acceptance step.
 */
const C = require('./common');
const P = require('./politics');
const { num, r2, newId, UserError, clamp } = require('../utils');

const action = (state, id) => state.world.actions.find((a) => a.id === id) || null;
const cdKey = (a, x, y) => `dip|${a}|${[x, y].sort().join('|')}`;

/** Every action with whether `from` can use it on `to` right now, and why not. */
function actionsFor(state, fromId, toId) {
  const w = state.world;
  const from = C.faction(state, fromId); const to = C.faction(state, toId);
  const rel = C.relation(state, fromId, toId);
  const treaties = C.treatiesBetween(state, fromId, toId).map((t) => t.type);
  return w.actions.filter((a) => a.enabled !== false).map((a) => {
    const req = a.requires || {};
    const reasons = [];
    if (!from || !to || fromId === toId) reasons.push('Pick another faction.');
    if (rel.value < num(req.minRelation, -100)) reasons.push(`Relations must be at least ${req.minRelation} (now ${Math.round(rel.value)}).`);
    if (rel.value > num(req.maxRelation, 100)) reasons.push(`Relations must be at most ${req.maxRelation}.`);
    if (req.atWar === true && !rel.war) reasons.push('Only during a war.');
    if (req.atWar === false && rel.war) reasons.push('Not while at war.');
    for (const t of req.treaties || []) if (!treaties.includes(t)) reasons.push(`Needs a ${w.treatyTypes.find((x) => x.id === t)?.name || t} first.`);
    for (const t of req.noTreaties || []) if (treaties.includes(t)) reasons.push(`Not possible with a ${w.treatyTypes.find((x) => x.id === t)?.name || t} in place.`);
    if (from && from.influence < num(a.costInfluence)) reasons.push(`Costs ${a.costInfluence} influence (you have ${Math.floor(from.influence)}).`);
    if (from && from.treasury < num(a.costTreasury)) reasons.push(`Costs ${a.costTreasury} from the treasury.`);
    const cd = num(w.cooldowns[cdKey(a.id, fromId, toId)]);
    if (cd > w.turn) reasons.push(`On cooldown for ${cd - w.turn} more turn(s).`);
    if (a.id === 'break' && !treaties.length) reasons.push('There is no treaty to break.');
    return { action: a, available: !reasons.length, reasons };
  });
}

function findProposal(state, id) {
  const p = state.world.proposals.find((x) => x.id === id);
  if (!p) throw new UserError('That proposal no longer exists.');
  return p;
}

/**
 * Create a proposal. args: { actionId, from, to, proposer (character), subjectCharId (your character who marries/swears),
 * targetCharId (their character), terms, note, staff }
 */
function propose(state, args) {
  const w = state.world;
  const a = action(state, args.actionId);
  if (!a) throw new UserError('Unknown action.');
  const opt = actionsFor(state, args.from, args.to).find((x) => x.action.id === a.id);
  if (!opt.available && !args.staff) throw new UserError(opt.reasons.join(' '));
  if (a.needsCharacters) {
    if (!args.subjectCharId || !args.targetCharId) throw new UserError(`${a.name} needs one character from each side.`);
    const s = state.characters.find((c) => c.id === args.subjectCharId); const t = state.characters.find((c) => c.id === args.targetCharId);
    if (!s || !t) throw new UserError('Character not found.');
    if (C.factionOfChar(state, t)?.id !== args.to) throw new UserError(`${t.name} is not a member of ${C.faction(state, args.to)?.name}.`);
    if (C.factionOfChar(state, s)?.id !== args.from) throw new UserError(`${s.name} is not a member of your faction.`);
    if (a.onAccept?.marry && (s.spouseId || t.spouseId)) throw new UserError(`${s.spouseId ? s.name : t.name} is already married.`);
  }
  let p = {
    id: newId('dp-'), actionId: a.id, from: args.from, to: args.to,
    proposerCharId: args.proposer?.id || '', proposerUserId: args.proposer?.ownerId || args.userId || '',
    subjectCharId: args.subjectCharId || '', targetCharId: args.targetCharId || '',
    terms: args.terms || {}, note: String(args.note || '').slice(0, 500),
    status: a.unilateral ? (a.staffApproval && !args.staff ? 'awaiting-staff' : 'approved') : 'awaiting-target',
    approvals: {}, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(), turn: w.turn, messages: [],
  };
  const fromF = C.faction(state, args.from);
  if (a.scriptId || fromF?.scriptId) {
    const out = C.runHooks(state, [{ scriptId: a.scriptId, type: 'diplomacy action', name: a.name }, { scriptId: fromF?.scriptId, type: 'faction', name: fromF?.name }], 'diplomacy',
      C.worldCtx(state, { stage: 'propose', action: { id: a.id, name: a.name }, from: C.factionSummary(state, fromF), to: C.factionSummary(state, C.faction(state, args.to)), relation: C.relation(state, args.from, args.to).value }), { ...p, blocked: '' });
    if (out?.blocked) throw new UserError(String(out.blocked));
    if (out?.terms) p.terms = out.terms;
  }
  // Pay the cost up front.
  if (!args.staff) { fromF.influence = r2(fromF.influence - num(a.costInfluence)); fromF.treasury = r2(fromF.treasury - num(a.costTreasury)); }
  w.cooldowns[cdKey(a.id, args.from, args.to)] = w.turn + num(a.cooldown, 8);
  w.proposals.unshift(p);
  if (w.proposals.length > 200) w.proposals.length = 200;
  C.wlog(state, 'diplomacy', `${a.emoji} **${fromF?.name}** → **${C.faction(state, args.to)?.name}**: ${a.name}${p.note ? ` — “${p.note}”` : ''}`);
  if (p.status === 'approved') p = execute(state, p);
  return p;
}

/** Who must act next on a proposal: 'target' (their representative), 'character' (their character's player), 'staff', or null. */
function nextStep(state, p) {
  if (p.status === 'awaiting-target') return 'target';
  if (p.status === 'awaiting-character') return 'character';
  if (p.status === 'awaiting-staff') return 'staff';
  return null;
}

/** Accept/decline. who: { kind: 'target' | 'character' | 'staff', charId, userId, name } */
function respond(state, id, accept, who) {
  const p = findProposal(state, id);
  const a = action(state, p.actionId);
  if (['done', 'rejected', 'expired', 'cancelled'].includes(p.status)) throw new UserError(`This proposal is already ${p.status}.`);
  if (Date.parse(p.expiresAt) < Date.now()) { p.status = 'expired'; throw new UserError('This proposal has expired.'); }
  const step = nextStep(state, p);
  if (who.kind !== step && !(who.kind === 'staff')) throw new UserError(step === 'staff' ? 'Waiting for staff approval.' : step === 'character' ? 'Waiting for the other character\'s player.' : 'Waiting for their representative.');
  if (!accept) {
    p.status = 'rejected'; p.rejectedBy = who.name || who.kind;
    if (who.kind !== 'staff') C.addRelation(state, p.from, p.to, num(a?.onReject?.relation, -3));
    C.wlog(state, 'diplomacy', `❌ ${a?.name}: ${C.faction(state, p.from)?.name} → ${C.faction(state, p.to)?.name} declined by ${p.rejectedBy}.`);
    return p;
  }
  p.approvals[who.kind] = { by: who.name || '', userId: who.userId || '', at: new Date().toISOString() };
  if (who.kind === 'staff' && step !== 'staff') {
    // Staff can push a proposal through every step.
    p.approvals.target ||= { by: `${who.name} (staff)` };
    if (a.needsCharacters) p.approvals.character ||= { by: `${who.name} (staff)` };
  }
  if (!p.approvals.target && !a.unilateral) { p.status = 'awaiting-target'; return p; }
  if (a.needsCharacters && !p.approvals.character) {
    const t = state.characters.find((c) => c.id === p.targetCharId);
    // If the representative who accepted IS the target character's player, that counts as consent.
    if (t && p.approvals.target?.userId && p.approvals.target.userId === t.ownerId) p.approvals.character = { by: p.approvals.target.by };
    else { p.status = 'awaiting-character'; return p; }
  }
  if (a.staffApproval && !p.approvals.staff) { p.status = 'awaiting-staff'; return p; }
  p.status = 'approved';
  return execute(state, p);
}

function execute(state, p) {
  const w = state.world;
  const a = action(state, p.actionId);
  const eff = { ...(a.onAccept || {}) };
  const from = C.faction(state, p.from); const to = C.faction(state, p.to);
  const fs = [{ scriptId: a.scriptId, type: 'diplomacy action', name: a.name }, { scriptId: from?.scriptId, type: 'faction', name: from?.name }, { scriptId: to?.scriptId, type: 'faction', name: to?.name }];
  if (fs.some((s) => s.scriptId)) {
    const out = C.runHooks(state, fs, 'diplomacy', C.worldCtx(state, { stage: 'execute', action: { id: a.id, name: a.name }, from: C.factionSummary(state, from), to: C.factionSummary(state, to), terms: p.terms }), { effects: eff, blocked: '' });
    if (out?.blocked) { p.status = 'blocked'; p.blockedReason = String(out.blocked); return p; }
    if (out?.effects) Object.assign(eff, out.effects);
  }
  const lines = [];
  if (eff.relation) C.addRelation(state, p.from, p.to, num(eff.relation));
  if (eff.transfer) { const amt = Math.min(num(eff.transfer), Infinity); to.treasury = r2(to.treasury + amt); lines.push(`${amt} Nyang sent`); }
  if (eff.influence) from.influence = r2(from.influence + num(eff.influence));
  if (eff.reputation) from.reputation = r2(clamp(num(from.reputation, 50) + num(eff.reputation), 0, 100));
  if (eff.breaks) for (const t of C.treatiesBetween(state, p.from, p.to).filter((t) => eff.breaks.includes(t.type))) P.endTreaty(state, t.id, 'was broken');
  if (eff.breaksAny) {
    const t = C.treatiesBetween(state, p.from, p.to).find((x) => !p.terms?.treatyId || x.id === p.terms.treatyId);
    if (t) { P.endTreaty(state, t.id, `was torn up by ${from.name}`); for (const o of w.factions) if (o.id !== from.id && o.active) C.addRelation(state, from.id, o.id, -2); }
  }
  if (eff.war) declareWar(state, p.from, p.to);
  if (eff.endsWar) { const rel = C.relation(state, p.from, p.to); if (rel.war) { rel.war = false; lines.push('the war is over'); } }
  if (eff.reparations) {
    const payer = p.terms?.payer === p.to ? to : from; const recv = payer === from ? to : from;
    const amt = r2(Math.min(payer.treasury, num(p.terms?.amount, eff.reparations)));
    payer.treasury = r2(payer.treasury - amt); recv.treasury = r2(recv.treasury + amt); lines.push(`${payer.name} pays ${amt} in reparations`);
  }
  if (eff.joinWar) {
    for (const [k, rel] of Object.entries(w.relations)) {
      if (!rel.war || !k.split('|').includes(p.from)) continue;
      const enemy = k.split('|').find((x) => x !== p.from);
      if (enemy && enemy !== p.to) declareWar(state, p.to, enemy, { silent: true });
    }
  }
  if (eff.treaty) {
    const tt = eff.treaty;
    const opts = { duration: num(p.terms?.duration, tt.duration), name: p.terms?.name || tt.name, terms: { ...(p.terms || {}) } };
    if (['tribute', 'vassal'].includes(tt.type)) {
      // "Offer tribute/vassalage": proposer pays. "Demand tribute": target pays.
      opts.payer = tt.reverse ? p.to : p.from; opts.receiver = tt.reverse ? p.from : p.to;
    }
    if (eff.marry) opts.couple = [p.subjectCharId, p.targetCharId];
    const t = P.makeTreaty(state, tt.type, [p.from, p.to], opts);
    p.treatyId = t.id;
  }
  if (eff.marry) {
    const s = state.characters.find((c) => c.id === p.subjectCharId); const t = state.characters.find((c) => c.id === p.targetCharId);
    if (s && t) { s.spouseId = t.id; t.spouseId = s.id; w.marriages.push({ a: s.id, b: t.id, factions: [p.from, p.to], treatyId: p.treatyId || '', turn: w.turn, at: new Date().toISOString() }); lines.push(`${s.name} and ${t.name} are married`); }
  }
  if (eff.unmarry) {
    const t = C.treatiesBetween(state, p.from, p.to, 'marriage')[0];
    if (t) P.endTreaty(state, t.id, 'was annulled');
  }
  if (eff.bond) {
    const s = state.characters.find((c) => c.id === p.subjectCharId); const t = state.characters.find((c) => c.id === p.targetCharId);
    if (s && t) { s.bonds = [...(s.bonds || []), { kind: eff.bond, with: t.id, turn: w.turn }]; t.bonds = [...(t.bonds || []), { kind: eff.bond, with: s.id, turn: w.turn }]; lines.push(`${s.name} and ${t.name} are sworn siblings`); }
  }
  p.status = 'done'; p.doneAt = new Date().toISOString(); p.result = lines;
  const text = `${a.emoji} **${a.name}** — **${from?.name}** and **${to?.name}**${lines.length ? `: ${lines.join('; ')}` : ''}.`;
  C.wlog(state, 'diplomacy', text);
  (w.announceQueue ||= []).push({ kind: 'diplomacy', text, factions: [p.from, p.to] });
  return p;
}

function declareWar(state, a, b, { silent = false } = {}) {
  const w = state.world;
  const rel = C.relation(state, a, b);
  if (rel.war) return;
  rel.war = true; rel.since = w.turn;
  for (const t of C.treatiesBetween(state, a, b).filter((t) => ['trade', 'exchange', 'access', 'nap', 'truce'].includes(t.type))) P.endTreaty(state, t.id, 'ended by war');
  const A = C.faction(state, a); const B = C.faction(state, b);
  C.wlog(state, 'war', `⚔️ **${A?.name}** and **${B?.name}** are at war!`);
  if (!silent) (w.announceQueue ||= []).push({ kind: 'war', text: `⚔️ **${A?.name}** has declared war on **${B?.name}**!`, factions: [a, b] });
  // Defensive allies of the defender join automatically.
  if (!silent) for (const t of w.treaties.filter((t) => t.parties.includes(b) && ['defensive', 'alliance'].includes(t.type))) {
    const ally = t.parties.find((x) => x !== b);
    if (ally && ally !== a) { declareWar(state, ally, a, { silent: true }); C.wlog(state, 'war', `🛡️ **${C.faction(state, ally)?.name}** honours its pact and joins the war against **${A?.name}**.`); }
  }
}

function expireProposals(state) {
  for (const p of state.world.proposals) if (['awaiting-target', 'awaiting-character', 'awaiting-staff'].includes(p.status) && Date.parse(p.expiresAt) < Date.now()) p.status = 'expired';
}

/** Data for the Diplomacy map: nodes (actions) and arrows (unlocks + treaty requirements). */
function graph(state, fromId, toId) {
  const avail = fromId && toId ? Object.fromEntries(actionsFor(state, fromId, toId).map((x) => [x.action.id, x])) : {};
  const nodes = state.world.actions.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, category: a.category, description: a.description, available: avail[a.id]?.available ?? null, reasons: avail[a.id]?.reasons || [], staffApproval: a.staffApproval, unilateral: a.unilateral, needsCharacters: a.needsCharacters }));
  const edges = [];
  for (const a of state.world.actions) {
    for (const u of a.unlocks || []) edges.push({ from: a.id, to: u, kind: 'unlocks' });
    for (const t of a.requires?.treaties || []) {
      const maker = state.world.actions.find((x) => x.onAccept?.treaty?.type === t);
      if (maker && maker.id !== a.id) edges.push({ from: maker.id, to: a.id, kind: 'requires' });
    }
  }
  return { nodes, edges };
}

module.exports = { action, actionsFor, propose, respond, execute, declareWar, nextStep, findProposal, expireProposals, graph };
