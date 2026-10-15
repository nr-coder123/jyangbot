'use strict';
/**
 * Absorption rates from cultivation methods + qi core.
 * Rule: per element take the BEST positive value, then add every NEGATIVE value.
 *   Cultivation A: Wood 10, Metal 5   |   Cultivation B: Wood 15, Metal -25
 *   => Wood 15, Metal 5 + (-25) = -20
 */
const { r2 } = require('../utils');

function combine(values) {
  const v = values.map(Number).filter((x) => Number.isFinite(x) && x !== 0);
  const pos = v.filter((x) => x > 0);
  const neg = v.filter((x) => x < 0);
  return r2((pos.length ? Math.max(...pos) : 0) + neg.reduce((a, b) => a + b, 0));
}

/**
 * Absorption from the character's cultivation methods + qi core (arts library).
 *   base    = best "base absorption" among cultivation methods (Qi Gathering = 50%: only half a pill's yield).
 *             100% when no method sets one.
 *   general = bonus % for every pill;  byElement = bonus % per pill affinity.
 * A pill's yield = raw × (base + general + element) %.
 */
function absorption(state, c) {
  const refs = [...(c.cultivationMethods || []), c.qiCore].filter((r) => r && r.id);
  const arts = refs.map((r) => (state.arts || []).find((a) => a.id === r.id)).filter(Boolean);
  const methods = arts.filter((a) => a.kind === 'cultivation' && a.baseAbsorption !== null && a.baseAbsorption !== undefined);
  const best = methods.length ? methods.reduce((x, y) => (Number(y.baseAbsorption) > Number(x.baseAbsorption) ? y : x)) : null;
  const base = best ? r2(Number(best.baseAbsorption)) : 100;
  const general = combine(arts.map((a) => a.absorption || 0));
  const per = {};
  for (const a of arts) {
    for (const [el, v] of Object.entries(a.affinities || {})) {
      if (Number(v)) (per[el] ||= []).push(Number(v));
    }
  }
  const byElement = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, combine(v)]));
  // Impurity reduction %: same rule (best positive + all negatives). Negative = pills are MORE toxic.
  const impurityReduction = combine(arts.map((a) => a.impurityReduction || 0));
  return { base, baseSource: best ? best.name : null, general, byElement, impurityReduction, sources: arts.map((a) => a.name) };
}

/** Bonus % for a pill of `element` (general + element), on top of the base absorption. */
function rateFor(abs, element) {
  return r2(abs.general + (element ? abs.byElement[element] || 0 : 0));
}

module.exports = { combine, absorption, rateFor };
