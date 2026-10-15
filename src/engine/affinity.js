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

function absorption(state, c) {
  const refs = [...(c.cultivationMethods || []), c.qiCore].filter((r) => r && r.id);
  const items = refs.map((r) => state.items.find((i) => i.id === r.id)).filter(Boolean);
  const general = combine(items.map((i) => i.cultivation?.absorption || 0));
  const per = {};
  for (const it of items) {
    for (const [el, v] of Object.entries(it.cultivation?.affinities || {})) {
      if (Number(v)) (per[el] ||= []).push(Number(v));
    }
  }
  const byElement = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, combine(v)]));
  // Impurity reduction %: same rule (best positive + all negatives). Negative = pills are MORE toxic.
  const impurityReduction = combine(items.map((i) => i.cultivation?.impurityReduction || 0));
  return { general, byElement, impurityReduction, sources: items.map((i) => i.name) };
}

/** Total % bonus for a pill of `element` (general + element). */
function rateFor(abs, element) {
  return r2(abs.general + (element ? abs.byElement[element] || 0 : 0));
}

module.exports = { combine, absorption, rateFor };
