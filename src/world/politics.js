'use strict';
/** Factions over time: policies, income, tribute. */
const geo = require('./geo');
const C = require('./common');
const { num, r2, clamp, UserError, newId } = require('../utils');

const policyDef = (state, id) => state.world.policies.find((p) => p.id === id) || null;

/** All policies a faction has adopted: [{ def, region|'' , since }] */
function factionPolicies(state, f) {
  const out = f.policies.map((p) => ({ def: policyDef(state, p.policyId), region: p.region || '', since: p.since })).filter((x) => x.def);
  for (const [k, r] of Object.entries(state.world.regions)) for (const p of r.policies || []) if (p.factionId === f.id) { const def = policyDef(state, p.policyId); if (def) out.push({ def, region: k, since: p.since }); }
  return out;
}

function canAdopt(state, f, policyId, region) {
  const def = policyDef(state, policyId);
  if (!def || def.enabled === false) return 'Unknown policy.';
  if (def.kinds?.length && !def.kinds.includes(f.kind)) return `Only ${def.kinds.join(' / ')} factions can adopt ${def.name}.`;
  const active = factionPolicies(state, f);
  if (def.scope === 'region') {
    const r = state.world.regions[region];
    if (!r || r.population === undefined) return 'Pick a region (a province or special prefecture).';
    if (r.controller !== f.id) return `${f.name} does not control ${geo.label(state, region)}.`;
    if (active.some((x) => x.def.id === def.id && x.region === region)) return 'Already in force there.';
  } else if (active.some((x) => x.def.id === def.id)) return 'Already in force.';
  const clash = active.find((x) => (def.exclusive || []).includes(x.def.id) || (x.def.exclusive || []).includes(def.id));
  if (clash) return `${def.name} cannot be combined with ${clash.def.name}.`;
  if (f.treasury < num(def.cost?.treasury)) return `Needs ${def.cost.treasury} in the treasury (${f.name} has ${Math.floor(f.treasury)}).`;
  return null;
}

function adoptPolicy(state, f, policyId, region = '', { free = false } = {}) {
  const why = canAdopt(state, f, policyId, region);
  if (why && !(free && !/Unknown|Already|control|combined|Pick/.test(why))) throw new UserError(why);
  const def = policyDef(state, policyId);
  if (!free) f.treasury = r2(f.treasury - num(def.cost?.treasury));
  if (def.scope === 'region') state.world.regions[region].policies.push({ policyId, factionId: f.id, since: state.world.turn });
  else f.policies.push({ policyId, region: '', since: state.world.turn });
  C.wlog(state, 'policy', `${def.emoji} **${f.name}** adopted **${def.name}**${def.scope === 'region' ? ` in ${geo.label(state, region)}` : ''}.`);
  (state.world.announceQueue ||= []).push({ kind: 'policy', text: `${def.emoji} **${f.name}** adopted **${def.name}**${def.scope === 'region' ? ` in **${geo.label(state, region)}**` : ''}. ${def.description}`, regions: def.scope === 'region' ? [region] : C.controlled(state, f.id).map((r) => r.key) });
  return def;
}

function revokePolicy(state, f, policyId, region = '', { force = false } = {}) {
  const def = policyDef(state, policyId);
  const turns = (since) => state.world.turn - num(since);
  if (def?.scope === 'region' || region) {
    const r = state.world.regions[region];
    const p = r?.policies.find((x) => x.policyId === policyId && x.factionId === f.id);
    if (!p) throw new UserError('Not in force there.');
    if (!force && turns(p.since) < num(def?.minTurns, 4)) throw new UserError(`${def.name} must stay at least ${def.minTurns} turns.`);
    r.policies = r.policies.filter((x) => x !== p);
  } else {
    const p = f.policies.find((x) => x.policyId === policyId);
    if (!p) throw new UserError('Not in force.');
    if (!force && turns(p.since) < num(def?.minTurns, 4)) throw new UserError(`${def.name} must stay at least ${def.minTurns} turns.`);
    f.policies = f.policies.filter((x) => x !== p);
  }
  C.wlog(state, 'policy', `${def?.emoji || ''} **${f.name}** revoked **${def?.name || policyId}**.`);
}

function tickFactions(state, ledger) {
  const w = state.world;
  const notes = [];
  for (const f of w.factions) {
    if (!f.active) continue;
    // Taxes wait in a pending purse and reach the treasury every `taxEveryTurns` turns.
    const every = Math.max(1, Math.floor(num(w.settings.taxEveryTurns, 1)));
    let taxes = 0;
    if (w.turn % every === 0) { taxes = r2(num(f.taxPending)); f.treasury = r2(f.treasury + taxes); f.taxPending = 0; }
    const inc = { taxes, policies: 0, upkeep: 0, armies: 0, tribute: 0, buildings: r2(ledger.buildings?.[f.id] || 0) };
    // Policy upkeep and faction-wide policy income
    for (const { def, region, since } of factionPolicies(state, f)) {
      const strength = C.policyStrength(def, w.turn - num(since));
      const upT = num(def.upkeep?.treasury);
      if (f.treasury < upT) {
        if (region) { const r = w.regions[region]; r.policies = r.policies.filter((p) => !(p.policyId === def.id && p.factionId === f.id)); } else f.policies = f.policies.filter((p) => p.policyId !== def.id);
        C.wlog(state, 'policy', `${def.emoji} **${f.name}** could not pay for **${def.name}** — it lapsed.`);
        continue;
      }
      f.treasury = r2(f.treasury - upT); inc.upkeep -= upT;
      if (!region && def.effects?.treasury) {
        const v = num(def.effects.treasury) * strength * Math.max(1, C.controlled(state, f.id).length);
        f.treasury = r2(f.treasury + v); inc.policies += v;
      }
    }
    // Donations, disciples' fees and the sect's own fields: a small income even without land.
    const dues = r2(num(w.settings.baseIncome, 5) + num(w.settings.memberIncome, 3) * C.members(state, f).length);
    if (dues) { f.treasury = r2(f.treasury + dues); inc.dues = dues; }
    // Retainers, officials and upkeep of halls: a share of the treasury every turn (stops endless hoarding).
    const admin = r2(Math.max(0, f.treasury) * num(w.settings.adminCost, 1.5) / 100);
    f.treasury = r2(f.treasury - admin); inc.admin = -admin;
    // Custom code
    if (f.scriptId) {
      const out = C.runHooks(state, [{ scriptId: f.scriptId, type: 'faction', name: f.name }], 'factionTick', C.worldCtx(state, { faction: C.factionSummary(state, f) }), { treasury: 0, notes: [] });
      if (out) { f.treasury = r2(f.treasury + num(out.treasury)); (out.notes || []).forEach((n) => notes.push(`${f.name}: ${n}`)); }
    }
    f.lastIncome = inc;
  }
  tickAgreements(state, ledger);
  return notes;
}

/** Tribute (agreements and alliances), expiry and custom code of agreements. */
function tickAgreements(state, ledger) {
  const w = state.world;
  const pay = (payerId, recvId, percent, fixed) => {
    const payer = C.faction(state, payerId); const recv = C.faction(state, recvId);
    if (!payer || !recv) return;
    const amount = r2(Math.min(Math.max(0, payer.treasury), num(fixed) + num(payer.lastIncome?.taxes) * num(percent) / 100));
    if (!(amount > 0)) return;
    payer.treasury = r2(payer.treasury - amount); recv.treasury = r2(recv.treasury + amount);
    if (payer.lastIncome) payer.lastIncome.tribute = r2(num(payer.lastIncome.tribute) - amount);
    if (recv.lastIncome) recv.lastIncome.tribute = r2(num(recv.lastIncome.tribute) + amount);
  };
  for (const t of [...w.agreements]) {
    if (t.endTurn && t.endTurn <= w.turn) { require('./diplomacy').endAgreement(state, t.id, 'has run its course'); continue; }
    if (t.tribute) pay(t.tribute.payer, t.tribute.receiver, t.tribute.percent, t.tribute.fixed);
    if (t.scriptId) {
      const out = C.runHooks(state, [{ scriptId: t.scriptId, type: 'agreement', name: t.name }], 'treatyTick', C.worldCtx(state, { treaty: { id: t.id, name: t.name, parties: t.parties.map((id) => C.factionSummary(state, C.faction(state, id))), perks: t.perks, note: t.note, startTurn: t.startTurn, endTurn: t.endTurn } }), { transfers: [], end: false, notes: [] });
      if (out) {
        for (const tr of out.transfers || []) pay(tr.from, tr.to, 0, tr.nyang);
        if (out.end) require('./diplomacy').endAgreement(state, t.id, 'ended by its terms');
      }
    }
  }
  for (const a of w.alliances) if (num(a.tribute) > 0 && a.leader) for (const m of a.members) if (m !== a.leader) pay(m, a.leader, a.tribute, 0);
}

module.exports = { policyDef, factionPolicies, canAdopt, adoptPolicy, revokePolicy, tickFactions, tickAgreements };
