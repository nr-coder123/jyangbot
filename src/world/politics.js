'use strict';
/** Factions over time: income, decrees, tribute. */
const C = require('./common');
const { num, r2 } = require('../utils');

function tickFactions(state, ledger) {
  const w = state.world;
  const notes = [];
  // Decrees: what they cost (or bring) each turn, and the ones that ran their course.
  const decreeLedger = require('./decrees').tickDecrees(state);
  for (const f of w.factions) {
    if (!f.active) continue;
    // Taxes wait in a pending purse and reach the treasury every `taxEveryTurns` turns.
    const every = Math.max(1, Math.floor(num(w.settings.taxEveryTurns, 1)));
    let taxes = 0;
    if (w.turn % every === 0) { taxes = r2(num(f.taxPending)); f.treasury = r2(f.treasury + taxes); f.taxPending = 0; }
    const inc = { taxes, decrees: r2(num(decreeLedger[f.id])), upkeep: 0, armies: 0, tribute: 0, buildings: r2(ledger.buildings?.[f.id] || 0) };
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

module.exports = { tickFactions, tickAgreements };
