'use strict';
/**
 * Decrees: what a faction does in role-play, given a small game effect by staff — no code needed.
 *
 * A representative says in RP "my sect now forces conscription in its lands" and asks staff (/world → Realm →
 * Ask staff for a decree). Staff open the request in the dashboard, pick a preset or fill in a few plain numbers
 * ("men that can be raised +50%", "prosperity −0.3 a turn", "−20 from the treasury a turn"), and approve. The decree
 * then works every turn in the faction's lands (or only the regions chosen) until it ends or staff end it.
 * Decrees only colour the story; they never decide it. Advanced staff can still attach custom code.
 *
 * Plain fields (all optional, per turn, in the decree's regions):
 *   prosperity, population (% growth), security        added each turn
 *   taxPct, incomePct, productionPct, manpowerPct,      percentages: +50 = ×1.5, −20 = ×0.8
 *   recruitCostPct, goodPct (with good)
 *   supply, banditRisk (% caravan raid chance)          added
 *   treasury                                            Nyang added to (or, if negative, taken from) the treasury each turn
 */
const geo = require('./geo');
const C = require('./common');
const { num, r2, newId, UserError, fmt } = require('../utils');

const FIELDS = [
  { k: 'prosperity', label: 'Prosperity per turn', unit: '', hint: '+0.3 is a strong boost, −0.3 a heavy burden' },
  { k: 'population', label: 'Population growth per turn', unit: '%', hint: '+0.05 = more people over time' },
  { k: 'security', label: 'Security per turn', unit: '', hint: 'fewer bandits on the roads' },
  { k: 'taxPct', label: 'Taxes', unit: '%', hint: '+20 = 20% more taxes' },
  { k: 'incomePct', label: 'Trade & household income', unit: '%', hint: 'what the markets earn' },
  { k: 'productionPct', label: 'Production of every good', unit: '%', hint: 'farms, mines, workshops' },
  { k: 'manpowerPct', label: 'Men that can be raised each turn', unit: '%', hint: 'conscription: +50' },
  { k: 'recruitCostPct', label: 'Cost to raise troops', unit: '%', hint: '−15 = cheaper troops' },
  { k: 'supply', label: 'Army supply here', unit: '', hint: 'armies standing here are fed better' },
  { k: 'banditRisk', label: 'Caravan raid chance', unit: '%', hint: '−5 = safer roads' },
  { k: 'treasury', label: 'Treasury per turn', unit: 'Nyang', hint: 'negative = what it costs (paid once a turn, not per region)' },
];
const P = (id, name, emoji, description, values, turns = 0) => ({ id, name, emoji, description, values, turns });
const PRESETS = [
  P('conscription', 'Conscription', '🪖', 'Every household must send a son to the sect\'s banners.', { manpowerPct: 50, recruitCostPct: -15, prosperity: -0.3, population: -0.05, treasury: -20 }),
  P('martial-law', 'Martial Law', '⚔️', 'Curfews, checkpoints and patrols in every town.', { security: 2, prosperity: -0.2, incomePct: -5, treasury: -15 }),
  P('war-levy', 'War Levy', '💰', 'A special tax to pay for the war.', { taxPct: 30, prosperity: -0.4, security: -0.5 }),
  P('tax-relief', 'Tax Relief', '🌾', 'Taxes are forgiven to let the people recover.', { taxPct: -30, prosperity: 0.3, population: 0.03 }),
  P('festival', 'Grand Festival', '🏮', 'Lanterns, banquets and tournaments paid by the sect.', { prosperity: 0.5, incomePct: 10, treasury: -50 }, 3),
  P('bandit-hunt', 'Bandit Suppression', '🗡️', 'Disciples sweep the roads and hills for outlaws.', { security: 1.5, banditRisk: -5, treasury: -25 }),
  P('famine-relief', 'Famine Relief', '🍚', 'Granaries are opened and soup kitchens set up.', { prosperity: 0.2, population: 0.05, treasury: -30 }, 6),
  P('closed-gates', 'Closed Gates', '🚪', 'The sect seals its lands from outsiders.', { security: 1.5, incomePct: -10 }),
  P('open-recruitment', 'Open Recruitment', '📣', 'Wanderers and commoners are welcome in the outer halls.', { recruitCostPct: -10, manpowerPct: 20, security: -0.3 }),
  P('forced-labour', 'Forced Labour', '⛏️', 'Mines and fields work day and night.', { productionPct: 20, prosperity: -0.4, population: -0.05, security: -0.5 }),
];

const pct = (v) => 1 + num(v) / 100;
/** The effect block a decree applies to each of its regions every turn. */
function effectsOf(d) {
  const v = d.values || {};
  const e = { ...(d.effects || {}) };
  const add = (k, x) => { if (num(x)) e[k] = r2(num(e[k]) + num(x)); };
  const mul = (k, x) => { if (num(x)) e[k] = num(e[k], 1) * pct(x); };
  add('prosperity', v.prosperity); add('population', v.population); add('security', v.security); add('supply', v.supply);
  if (num(v.banditRisk)) e.caravanRisk = r2(num(e.caravanRisk) + num(v.banditRisk) / 100);
  mul('tax', v.taxPct); mul('income', v.incomePct); mul('manpower', v.manpowerPct); mul('recruitCost', v.recruitCostPct);
  if (num(v.productionPct)) e.production = { ...(e.production || {}), '*': num(e.production?.['*'], 1) * pct(v.productionPct) };
  if (v.good && num(v.goodPct)) e.production = { ...(e.production || {}), [v.good]: num(e.production?.[v.good], 1) * pct(v.goodPct) };
  delete e.treasury; // paid once per faction (see tickDecrees)
  return e;
}
/** One line per effect, in plain words. */
function describe(state, d) {
  const v = d.values || {};
  const sign = (x) => (num(x) > 0 ? `+${fmt(num(x))}` : fmt(num(x)));
  const out = [];
  for (const f of FIELDS) if (num(v[f.k])) out.push(`${f.label} ${sign(v[f.k])}${f.unit === '%' ? '%' : f.unit ? ` ${f.unit}` : ''}`);
  if (v.good && num(v.goodPct)) out.push(`Production of ${state.world.goods.find((g) => g.id === v.good)?.name || v.good} ${sign(v.goodPct)}%`);
  if (d.effects && Object.keys(d.effects).length) out.push('extra effects');
  if (d.scriptId) out.push('custom code');
  return out;
}
function normalize(d = {}) {
  const values = {};
  for (const f of FIELDS) if (num(d.values?.[f.k])) values[f.k] = num(d.values[f.k]);
  if (d.values?.good && num(d.values?.goodPct)) { values.good = String(d.values.good); values.goodPct = num(d.values.goodPct); }
  return {
    id: d.id || newId('dc-'), name: String(d.name || 'Decree').slice(0, 80), emoji: String(d.emoji || '📜').slice(0, 8),
    description: String(d.description || '').slice(0, 1000), regions: Array.isArray(d.regions) ? [...new Set(d.regions.map(String))] : [],
    values, effects: d.effects && typeof d.effects === 'object' && !Array.isArray(d.effects) ? d.effects : {}, scriptId: d.scriptId || '',
    since: num(d.since), until: Math.max(0, num(d.until)), by: String(d.by || '').slice(0, 80),
  };
}
const active = (state, f) => (f?.decrees || []).filter((d) => !d.until || d.until > state.world.turn);
/** Decrees of the faction that rules a region and apply to it. */
function decreesIn(state, key) {
  const r = state.world.regions[key];
  const f = r && C.faction(state, r.controller);
  if (!f) return [];
  return active(state, f).filter((d) => !d.regions.length || d.regions.includes(key) || d.regions.some((k) => geo.marketOf(state, k) === key));
}
/** Put a decree in force. spec: { name, description, regions, values, effects, turns, emoji, scriptId } */
function issue(state, f, spec, { by = '', silent = false } = {}) {
  if (!f) throw new UserError('Unknown faction.');
  const w = state.world;
  const regions = (spec.regions || []).map((k) => geo.marketOf(state, k)).filter((k) => w.regions[k]);
  const d = normalize({ ...spec, regions, since: w.turn, until: num(spec.turns) > 0 ? w.turn + num(spec.turns) : num(spec.until), by });
  f.decrees = [...(f.decrees || []).filter((x) => x.id !== d.id), d];
  const where = d.regions.length ? ` in ${d.regions.map((k) => geo.label(state, k)).join(', ')}` : '';
  C.wlog(state, 'decree', `${d.emoji} **${f.name}** decrees **${d.name}**${where}.`);
  if (!silent) (w.announceQueue ||= []).push({ kind: 'policy', text: `${d.emoji} **${f.name}** decrees **${d.name}**${where}.${d.description ? `\n*${d.description}*` : ''}` });
  return d;
}
function end(state, f, id, { reason = 'is lifted' } = {}) {
  const d = (f?.decrees || []).find((x) => x.id === id);
  if (!d) throw new UserError('Decree not found.');
  f.decrees = f.decrees.filter((x) => x !== d);
  C.wlog(state, 'decree', `${d.emoji} **${f.name}**'s decree **${d.name}** ${reason}.`);
  return d;
}
/** Each turn: decrees cost (or pay) their treasury line; ended ones go. Returns { [factionId]: treasury change }. */
function tickDecrees(state) {
  const w = state.world;
  const out = {};
  for (const f of w.factions) {
    for (const d of [...(f.decrees || [])]) {
      if (d.until && d.until <= w.turn) { end(state, f, d.id, { reason: 'has run its course' }); continue; }
      const t = num(d.values?.treasury);
      if (!t) continue;
      const v = t < 0 ? -Math.min(-t, Math.max(0, f.treasury)) : t;
      f.treasury = r2(f.treasury + v);
      out[f.id] = r2((out[f.id] || 0) + v);
    }
  }
  return out;
}

module.exports = { FIELDS, PRESETS, effectsOf, describe, normalize, active, decreesIn, issue, end, tickDecrees };
