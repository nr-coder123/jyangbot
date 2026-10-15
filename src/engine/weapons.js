'use strict';
/** Main weapon: equipped item (if still owned) or the Default Weapon. Bonuses apply only while equipped. */
const economy = require('./economy');
const { UserError, num } = require('../utils');

const BONUS_LABEL = { strength: 'Strength', endurance: 'Endurance', mobility: 'Mobility', qi: 'Qi', qiBars: 'Qi Bars' };

function mainWeapon(state, c) {
  const eq = c.weaponId && state.items.find((i) => i.id === c.weaponId);
  if (eq && economy.qtyOf(c, eq.id) > 0) return eq;
  return state.items.find((i) => i.id === state.settings.defaultWeaponId) || null;
}

function equip(state, c, item) {
  if (item.type !== 'weapon') throw new UserError(`**${item.name}** is not a weapon.`);
  if (economy.qtyOf(c, item.id) < 1 && item.id !== state.settings.defaultWeaponId) throw new UserError(`You don't have **${item.name}**.`);
  const before = mainWeapon(state, c);
  c.weaponId = item.id;
  return { before };
}

/** [{ stat, amount, source }] from the equipped weapon. */
function weaponBonuses(state, c) {
  const w = mainWeapon(state, c);
  if (!w) return [];
  const grade = w.weapon?.grade && w.weapon.grade !== 'Default' ? ` (${w.weapon.grade})` : '';
  return Object.entries(w.bonuses || {})
    .filter(([, v]) => num(v) !== 0)
    .map(([stat, amount]) => ({ stat, amount: num(amount), source: `${w.name}${grade}` }));
}

module.exports = { BONUS_LABEL, mainWeapon, equip, weaponBonuses };
