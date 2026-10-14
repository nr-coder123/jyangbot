'use strict';
/**
 * Feng Shui purification calculator.
 *   Wood: weak to Metal, boosts Fire     Earth: weak to Wood, boosts Metal
 *   Water: weak to Earth, boosts Wood    Fire: weak to Water, boosts Earth
 *   Metal: weak to Fire, boosts Water
 * - Purification element weak to the poison element -> useless.
 * - Purification element boosts the poison element  -> purification loses 1 tier.
 */
const CYCLE = {
  Wood: { weakTo: 'Metal', boosts: 'Fire' },
  Earth: { weakTo: 'Wood', boosts: 'Metal' },
  Water: { weakTo: 'Earth', boosts: 'Wood' },
  Fire: { weakTo: 'Water', boosts: 'Earth' },
  Metal: { weakTo: 'Fire', boosts: 'Water' },
};

// [purification tier][poison tier] -> outcome
const TABLE = {
  1: { 1: { numerical: 'halved', gimmick: 'removed' }, 2: { numerical: 'halved', gimmick: 'unchanged' }, 3: { numerical: 'unchanged', gimmick: 'unchanged' } },
  2: { 1: { numerical: 'removed', gimmick: 'removed' }, 2: { numerical: 'halved', gimmick: 'removed' }, 3: { numerical: 'halved', gimmick: 'unchanged' } },
  3: { 1: { numerical: 'removed', gimmick: 'removed' }, 2: { numerical: 'removed', gimmick: 'removed' }, 3: { numerical: 'halved', gimmick: 'removed' } },
};
const TIER_NAMES = { 1: 'T1 (Earthly)', 2: 'T2 (Heavenly)', 3: 'T3 (Immortal)' };

function purify(poisonTier, poisonElement, purTier, purElement) {
  const notes = [];
  let tier = Number(purTier);
  const pe = CYCLE[purElement];
  if (pe && pe.weakTo === poisonElement) {
    notes.push(`${purElement} is weak to ${poisonElement}: the purification is **useless**, regardless of tier.`);
    return { effectiveTier: 0, numerical: 'unchanged', gimmick: 'unchanged', notes };
  }
  if (pe && pe.boosts === poisonElement) {
    tier -= 1;
    notes.push(`${purElement} boosts ${poisonElement}: purification drops **-1 tier** (now ${tier > 0 ? TIER_NAMES[tier] : 'no tier'}).`);
  }
  if (tier <= 0) return { effectiveTier: 0, numerical: 'unchanged', gimmick: 'unchanged', notes };
  const res = TABLE[Math.min(3, tier)][Number(poisonTier)] || { numerical: 'unchanged', gimmick: 'unchanged' };
  return { effectiveTier: tier, ...res, notes };
}

module.exports = { CYCLE, TABLE, TIER_NAMES, purify };
