'use strict';
/**
 * Computes the "live" stat sheet: impurity drawbacks, script effects, temporary bonuses, Qi Bars.
 */
const scripts = require('./scripts');
const stats = require('./stats');
const affinity = require('./affinity');
const { r2 } = require('../utils');

function baseFx(state, c) {
  const th = state.settings.impurity;
  const imp = Number(c.impurity) || 0;
  return {
    qiRegenDisabled: imp >= th.noRegenAt,
    statMultiplier: imp >= th.debuffAt ? r2(1 - th.debuffPercent / 100) : 1,
    preventMeridianBurst: false,
    tempStats: { strength: 0, endurance: 0, mobility: 0, qi: 0 },
    tempQiBars: 0,
    qiBarBonus: 0,
    qiBarsOverride: null,
    notes: [],
  };
}

function sanitizeFx(v, fallback) {
  if (!v || typeof v !== 'object') return fallback;
  const n = (x, d) => (x !== null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : d);
  const t = v.tempStats || {};
  return {
    qiRegenDisabled: !!v.qiRegenDisabled,
    statMultiplier: Math.max(0, n(v.statMultiplier, 1)),
    preventMeridianBurst: !!v.preventMeridianBurst,
    tempStats: { strength: n(t.strength, 0), endurance: n(t.endurance, 0), mobility: n(t.mobility, 0), qi: n(t.qi, 0) },
    tempQiBars: n(v.tempQiBars, 0),
    qiBarBonus: n(v.qiBarBonus, 0),
    qiBarsOverride: v.qiBarsOverride === null || v.qiBarsOverride === undefined || v.qiBarsOverride === '' ? null : n(v.qiBarsOverride, null),
    notes: Array.isArray(v.notes) ? v.notes.map(String).slice(0, 20) : [],
  };
}

/** Extra Qi Bars from total Qi (26+ Qi = +1, 101+ = +2, ...). Editable in Settings. */
function qiBarBonusFor(state, qi) {
  let bars = 0;
  for (const row of state.settings.qiBarBonuses || []) if (Number(qi) >= Number(row.minQi)) bars = Math.max(bars, Number(row.bars) || 0);
  return bars;
}

function compute(state, c) {
  const run = scripts.runChain(state, c, 'effects', baseFx(state, c));
  const fx = sanitizeFx(run.value, baseFx(state, c));
  const th = state.settings.impurity;
  const drawbacks = [];
  if (fx.qiRegenDisabled) drawbacks.push(`🚫 Cannot regenerate Qi during fights (Impurity ≥ ${th.noRegenAt}).`);
  if (fx.statMultiplier < 1) drawbacks.push(`📉 Stats temporarily reduced by ${Math.round((1 - fx.statMultiplier) * 100)}%.`);
  if (c.burstApplied) drawbacks.push(`💥 Meridians burst — stats and Qi were permanently reduced by ${th.burstPercent}%.`);

  const effStats = {};
  for (const k of stats.NORMAL) effStats[k] = r2((c.stats[k] + fx.tempStats[k]) * fx.statMultiplier);
  effStats.qi = r2(c.stats.qi + fx.tempStats.qi);

  const realm = stats.realmOf(state, c);
  const qiBonus = qiBarBonusFor(state, c.stats.qi);
  const baseBars = r2((Number(realm.qiBars) || 0) + qiBonus + (Number(c.bonusQiBars) || 0) + fx.qiBarBonus);
  const total = fx.qiBarsOverride !== null ? fx.qiBarsOverride : r2(baseBars + fx.tempQiBars);

  return {
    realm,
    next: stats.nextRealmOf(state, c),
    normalTotal: stats.normalTotal(c),
    effStats,
    fx,
    drawbacks,
    notes: fx.notes,
    scriptErrors: run.errors,
    qiBars: { base: baseBars, temp: fx.tempQiBars, total: Math.max(0, total), overridden: fx.qiBarsOverride !== null, realm: Number(realm.qiBars) || 0, fromQi: qiBonus, staff: Number(c.bonusQiBars) || 0, effects: fx.qiBarBonus },
    caps: stats.caps(state, c),
    capLines: stats.capLines(state, c),
    absorption: affinity.absorption(state, c),
  };
}

module.exports = { baseFx, sanitizeFx, compute, qiBarBonusFor };
