'use strict';
/**
 * Computes the "live" stat sheet: impurity drawbacks, script effects, temporary bonuses, Qi Bars.
 */
const scripts = require('./scripts');
const stats = require('./stats');
const affinity = require('./affinity');
const weapons = require('./weapons');
const { r2 } = require('../utils');

function baseFx(state, c) {
  const th = state.settings.impurity;
  const imp = Number(c.impurity) || 0;
  return {
    // Impurity 50+: pill yields reduced (default -50%). qiRegenDisabled is kept so old scripts still work.
    yieldMultiplier: imp >= (th.yieldPenaltyAt ?? 50) ? r2(1 - (th.yieldPenaltyPercent ?? 50) / 100) : 1,
    qiRegenDisabled: imp >= (th.yieldPenaltyAt ?? 50),
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
  let yieldMultiplier = Math.max(0, n(v.yieldMultiplier, 1));
  // Old scripts that set qiRegenDisabled = false meant "no impurity-50 drawback".
  if (fallback.qiRegenDisabled && v.qiRegenDisabled === false && yieldMultiplier === fallback.yieldMultiplier) yieldMultiplier = 1;
  return {
    yieldMultiplier,
    qiRegenDisabled: yieldMultiplier < 1,
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
  if (fx.yieldMultiplier < 1) drawbacks.push(`📉 Pill yields reduced by ${Math.round((1 - fx.yieldMultiplier) * 100)}% (Impurity ≥ ${th.yieldPenaltyAt ?? 50}).`);
  if (fx.statMultiplier < 1) drawbacks.push(`📉 Stats temporarily reduced by ${Math.round((1 - fx.statMultiplier) * 100)}%.`);
  if (c.burstApplied) drawbacks.push(`💥 Meridians burst — stats and Qi were permanently reduced by ${th.burstPercent}%.`);

  // Bonuses that change the shown stats: equipped weapon + temporary script effects.
  const bonuses = weapons.weaponBonuses(state, c);
  for (const k of [...stats.ALL]) if (fx.tempStats[k]) bonuses.push({ stat: k, amount: fx.tempStats[k], source: 'Effects' });
  if (fx.tempQiBars) bonuses.push({ stat: 'qiBars', amount: fx.tempQiBars, source: 'Effects (temporary)' });
  const bonusOf = (k) => bonuses.filter((b) => b.stat === k && b.source !== 'Effects' && b.source !== 'Effects (temporary)').reduce((a, b) => a + b.amount, 0);

  const effStats = {};
  for (const k of stats.NORMAL) effStats[k] = r2((c.stats[k] + fx.tempStats[k] + bonusOf(k)) * fx.statMultiplier);
  effStats.qi = r2(c.stats.qi + fx.tempStats.qi + bonusOf('qi'));

  const realm = stats.realmOf(state, c);
  const qiBonus = qiBarBonusFor(state, c.stats.qi);
  const weaponBars = bonusOf('qiBars');
  const baseBars = r2((Number(realm.qiBars) || 0) + qiBonus + (Number(c.bonusQiBars) || 0) + fx.qiBarBonus + weaponBars);
  const total = fx.qiBarsOverride !== null ? fx.qiBarsOverride : r2(baseBars + fx.tempQiBars);

  return {
    realm,
    next: stats.nextRealmOf(state, c),
    normalTotal: stats.normalTotal(c),
    effStats,
    bonuses,
    weapon: weapons.mainWeapon(state, c),
    fx,
    drawbacks,
    notes: fx.notes,
    scriptErrors: run.errors,
    qiBars: { base: baseBars, temp: fx.tempQiBars, total: Math.max(0, total), overridden: fx.qiBarsOverride !== null, realm: Number(realm.qiBars) || 0, fromQi: qiBonus, staff: Number(c.bonusQiBars) || 0, effects: fx.qiBarBonus, weapon: weaponBars },
    caps: stats.caps(state, c),
    capLines: stats.capLines(state, c),
    absorption: affinity.absorption(state, c),
  };
}

module.exports = { baseFx, sanitizeFx, compute, qiBarBonusFor };
