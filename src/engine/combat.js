'use strict';
/**
 * Stat comparison between two characters (/compare):
 *   Damage  = attacker Strength − defender Endurance   (T1–T8)
 *   Clash   = Strength − Strength                      (Equal … Overwhelmed)
 *   Speed   = Mobility − Mobility                      (T1–T6)
 * Rows needing a Realm Tier (RT) advantage are capped to the best row the realm difference allows.
 */
const effects = require('./effects');
const { r2 } = require('../utils');

function rowFor(rows, diff) {
  const sorted = [...rows].sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity));
  let row = sorted[0];
  for (const r of sorted) if (diff >= (r.min ?? -Infinity)) row = r;
  return row;
}

/** Row for `diff`, stepped down if the realm-tier advantage `rt` isn't enough. */
function resolve(rows, diff, rt) {
  const wanted = rowFor(rows, diff);
  if (!wanted) return { row: null, wanted: null, capped: false };
  if ((wanted.reqRT || 0) <= rt) return { row: wanted, wanted, capped: false };
  const allowed = [...rows]
    .filter((r) => (r.min ?? -Infinity) <= (wanted.min ?? -Infinity) && (r.reqRT || 0) <= rt)
    .sort((a, b) => (b.min ?? -Infinity) - (a.min ?? -Infinity))[0];
  return { row: allowed || wanted, wanted, capped: true };
}

function compare(state, a, b) {
  const sa = effects.compute(state, a);
  const sb = effects.compute(state, b);
  const A = sa.effStats;
  const B = sb.effStats;
  const rt = (a.realm || 0) - (b.realm || 0);
  const tables = state.combat;

  const atkAB = r2(A.strength - B.endurance);
  const atkBA = r2(B.strength - A.endurance);
  const clashDiff = r2(A.strength - B.strength);
  const mobDiff = r2(A.mobility - B.mobility);

  const clash = { diff: Math.abs(clashDiff), winner: clashDiff > 0 ? a : clashDiff < 0 ? b : null, ...resolve(tables.clash, Math.abs(clashDiff), Infinity) };
  const fasterIsA = mobDiff >= 0;
  const speed = { diff: Math.abs(mobDiff), faster: mobDiff > 0 ? a : mobDiff < 0 ? b : null, ...resolve(tables.mobility, Math.abs(mobDiff), fasterIsA ? rt : -rt) };

  return {
    a: { c: a, s: A, realm: sa.realm.name },
    b: { c: b, s: B, realm: sb.realm.name },
    rt,
    aHitsB: { diff: atkAB, ...resolve(tables.damage, atkAB, rt) },
    bHitsA: { diff: atkBA, ...resolve(tables.damage, atkBA, -rt) },
    clash,
    speed,
  };
}

module.exports = { rowFor, resolve, compare };
