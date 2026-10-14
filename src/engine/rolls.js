'use strict';
const { norm, num, r2, weightedPick, UserError } = require('../utils');

/** Rarity weights, including the character's sect bonus (e.g. The 72 Strongholds). */
function rarityWeights(state, c) {
  const sect = c && state.sects.find((s) => norm(s.name) === norm(c.sect));
  return state.rarities.map((r) => ({ rarity: r, weight: Math.max(0, num(r.chance) + num(sect?.rarityBonus?.[r.name])) }));
}

function chanceTable(state, c) {
  const w = rarityWeights(state, c);
  const total = w.reduce((a, b) => a + b.weight, 0) || 1;
  return w.map((x) => ({
    name: x.rarity.name,
    emoji: x.rarity.emoji,
    percent: r2((x.weight / total) * 100),
    items: state.items.filter((i) => i.inDropPool && i.rarity === x.rarity.name).length,
  }));
}

function rollDrop(state, c) {
  const picked = weightedPick(rarityWeights(state, c), (x) => x.weight);
  if (!picked) throw new UserError('All drop rates are 0 — set them in the dashboard.');
  const pool = state.items.filter((i) => i.inDropPool && i.rarity === picked.rarity.name);
  const item = weightedPick(pool, (i) => Math.max(0, num(i.dropWeight, 1)));
  return { rarity: picked.rarity, item };
}

module.exports = { rarityWeights, chanceTable, rollDrop };
