'use strict';
/** Factions over time: policies, income, influence, treaties and relation drift. */
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
  if (f.influence < num(def.cost?.influence)) return `Needs ${def.cost.influence} influence (${f.name} has ${Math.floor(f.influence)}).`;
  if (f.treasury < num(def.cost?.treasury)) return `Needs ${def.cost.treasury} in the treasury.`;
  return null;
}

function adoptPolicy(state, f, policyId, region = '', { free = false } = {}) {
  const why = canAdopt(state, f, policyId, region);
  if (why && !(free && !/Unknown|Already|control|combined|Pick/.test(why))) throw new UserError(why);
  const def = policyDef(state, policyId);
  if (!free) { f.influence = r2(f.influence - num(def.cost?.influence)); f.treasury = r2(f.treasury - num(def.cost?.treasury)); }
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

/** Influence income formula (shown in the dashboard). */
function influenceIncome(state, f) {
  const regions = C.controlled(state, f.id);
  const fromLand = regions.reduce((a, r) => a + num(r.prosperity) / 100 * 0.4, 0);
  const fromMembers = Math.min(3, C.members(state, f).length * 0.15);
  const fromRep = (num(f.reputation, 50) - 50) / 100;
  return r2(0.5 + fromLand + fromMembers + fromRep);
}

function tickFactions(state, ledger) {
  const w = state.world;
  const notes = [];
  for (const f of w.factions) {
    if (!f.active) continue;
    const inc = { taxes: r2(ledger.factionTax[f.id] || 0), policies: 0, upkeep: 0, armies: 0, tribute: 0, influence: 0 };
    // Policy upkeep and faction-wide policy effects (treasury / influence / relation)
    for (const { def, region, since } of factionPolicies(state, f)) {
      const strength = C.policyStrength(def, w.turn - num(since));
      const upT = num(def.upkeep?.treasury); const upI = num(def.upkeep?.influence);
      if (f.treasury < upT || f.influence < upI) {
        if (region) { const r = w.regions[region]; r.policies = r.policies.filter((p) => !(p.policyId === def.id && p.factionId === f.id)); } else f.policies = f.policies.filter((p) => p.policyId !== def.id);
        C.wlog(state, 'policy', `${def.emoji} **${f.name}** could not pay for **${def.name}** — it lapsed.`);
        continue;
      }
      f.treasury = r2(f.treasury - upT); f.influence = r2(f.influence - upI); inc.upkeep -= upT;
      if (!region) {
        const regions = Math.max(1, C.controlled(state, f.id).length);
        if (def.effects?.treasury) { const v = num(def.effects.treasury) * strength * regions; f.treasury = r2(f.treasury + v); inc.policies += v; }
        if (def.effects?.influence) { const v = num(def.effects.influence) * strength; f.influence = r2(f.influence + v); inc.influence += v; }
        if (def.effects?.relation) for (const o of w.factions) if (o.id !== f.id && o.active) C.addRelation(state, f.id, o.id, num(def.effects.relation) * strength);
      }
    }
    // Donations, disciples' fees and the sect's own fields: a small income even without land.
    const dues = r2(num(w.settings.baseIncome, 5) + num(w.settings.memberIncome, 3) * C.members(state, f).length);
    if (dues) { f.treasury = r2(f.treasury + dues); inc.dues = dues; }
    // Retainers, officials and upkeep of halls: a share of the treasury every turn (stops endless hoarding).
    const admin = r2(Math.max(0, f.treasury) * num(w.settings.adminCost, 1.5) / 100);
    f.treasury = r2(f.treasury - admin); inc.admin = -admin;
    // Influence
    const infl = influenceIncome(state, f);
    f.influence = r2(Math.min(1000, f.influence + infl)); inc.influence += infl;
    f.reputation = r2(clamp(num(f.reputation, 50) + (num(f.reputation, 50) < 60 ? 0.1 : 0), 0, 100));
    // Custom code
    if (f.scriptId) {
      const out = C.runHooks(state, [{ scriptId: f.scriptId, type: 'faction', name: f.name }], 'factionTick', C.worldCtx(state, { faction: C.factionSummary(state, f) }), { treasury: 0, influence: 0, notes: [] });
      if (out) { f.treasury = r2(f.treasury + num(out.treasury)); f.influence = r2(f.influence + num(out.influence)); (out.notes || []).forEach((n) => notes.push(`${f.name}: ${n}`)); }
    }
    f.lastIncome = inc;
  }
  tickTreaties(state, ledger);
  // Relations drift slowly back toward neutral; wars and treaties push them.
  for (const [k, rel] of Object.entries(w.relations)) {
    const [a, b] = k.split('|');
    if (!C.faction(state, a)?.active || !C.faction(state, b)?.active) continue;
    let d = -rel.value * 0.004;
    if (rel.war) d -= 0.15;
    for (const t of C.treatiesBetween(state, a, b)) d += num(w.treatyTypes.find((x) => x.id === t.type)?.drift);
    rel.value = r2(clamp(rel.value + d, -100, 100));
  }
  return notes;
}

function tickTreaties(state, ledger) {
  const w = state.world;
  for (const t of [...w.treaties]) {
    if (t.endTurn && t.endTurn <= w.turn) { endTreaty(state, t.id, 'expired'); continue; }
    const type = w.treatyTypes.find((x) => x.id === t.type);
    // Marriage bonds last while the couple lives and stays married.
    if (t.type === 'marriage' && t.couple) {
      const [a, b] = t.couple.map((id) => state.characters.find((c) => c.id === id));
      if (!a || !b || a.status !== 'active' || b.status !== 'active' || a.spouseId !== b.id) { endTreaty(state, t.id, 'dissolved'); continue; }
    }
    // Tribute / vassalage: payer → receiver, a share of the payer's taxes this turn.
    const share = num(t.terms?.tribute, num(type?.tribute));
    if (share && t.payer && t.receiver) {
      const payer = C.faction(state, t.payer); const recv = C.faction(state, t.receiver);
      if (payer && recv) {
        const amount = r2(Math.min(payer.treasury, Math.max(num(t.terms?.fixed), num(ledger.factionTax[payer.id]) * share / 100)));
        payer.treasury = r2(payer.treasury - amount); recv.treasury = r2(recv.treasury + amount);
        if (payer.lastIncome) payer.lastIncome.tribute = r2(num(payer.lastIncome.tribute) - amount);
        if (recv.lastIncome) recv.lastIncome.tribute = r2(num(recv.lastIncome.tribute) + amount);
      }
    }
    if (t.scriptId) {
      const out = C.runHooks(state, [{ scriptId: t.scriptId, type: 'treaty', name: t.name }], 'treatyTick', C.worldCtx(state, { treaty: { id: t.id, name: t.name, type: t.type, parties: t.parties.map((id) => C.factionSummary(state, C.faction(state, id))), terms: t.terms, startTurn: t.startTurn, endTurn: t.endTurn } }), { transfers: [], relation: 0, end: false, notes: [] });
      if (out) {
        for (const tr of out.transfers || []) {
          const from = C.faction(state, tr.from); const to = C.faction(state, tr.to);
          const amt = r2(Math.max(0, Math.min(num(tr.nyang), from ? from.treasury : 0)));
          if (from && to && amt) { from.treasury = r2(from.treasury - amt); to.treasury = r2(to.treasury + amt); }
        }
        if (out.relation) C.addRelation(state, t.parties[0], t.parties[1], num(out.relation));
        if (out.end) endTreaty(state, t.id, 'ended by its terms');
      }
    }
  }
}

function makeTreaty(state, type, parties, { duration = 0, name = '', terms = {}, payer = null, receiver = null, effects = {}, scriptId = '', couple = null, note = '' } = {}) {
  const w = state.world;
  const def = w.treatyTypes.find((x) => x.id === type);
  const t = { id: newId('tr-'), type, name: name || def?.name || type, parties: [...parties], payer, receiver, terms, effects, scriptId, couple, note, startTurn: w.turn, endTurn: num(duration) ? w.turn + num(duration) : null };
  w.treaties.push(t);
  const names = parties.map((id) => C.faction(state, id)?.name || id);
  C.wlog(state, 'treaty', `${def?.emoji || '📜'} **${t.name}** signed between **${names.join('** and **')}**${t.endTurn ? ` for ${duration} turns` : ''}.`);
  return t;
}
function endTreaty(state, id, reason = 'ended') {
  const w = state.world;
  const t = w.treaties.find((x) => x.id === id);
  if (!t) return null;
  w.treaties = w.treaties.filter((x) => x.id !== id);
  if (t.type === 'marriage' && t.couple) {
    for (const cid of t.couple) { const c = state.characters.find((x) => x.id === cid); if (c && t.couple.includes(c.spouseId)) c.spouseId = ''; }
    w.marriages = w.marriages.filter((m) => m.treatyId !== id);
  }
  C.wlog(state, 'treaty', `📜 **${t.name}** between ${t.parties.map((p) => C.faction(state, p)?.name || p).join(' and ')} ${reason}.`);
  return t;
}

module.exports = { policyDef, factionPolicies, canAdopt, adoptPolicy, revokePolicy, influenceIncome, tickFactions, makeTreaty, endTreaty };
