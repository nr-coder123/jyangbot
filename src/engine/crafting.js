'use strict';
/** Crafting: combine items (+ optional Nyang) into new items. Recipes are made in the dashboard. */
const economy = require('./economy');
const { r2, fmt, UserError } = require('../utils');

const itemOf = (state, id) => state.items.find((i) => i.id === id);

/** What the character has vs. what the recipe needs. */
function check(state, c, recipe) {
  const reasons = [];
  const inputs = recipe.inputs.map((x) => {
    const have = economy.qtyOf(c, x.itemId);
    if (have < x.qty) reasons.push(`${x.qty - have}× more ${itemOf(state, x.itemId)?.name || 'missing item'}`);
    return { item: itemOf(state, x.itemId), itemId: x.itemId, need: x.qty, have };
  });
  if (recipe.nyangCost > 0 && c.nyang < recipe.nyangCost) reasons.push(`${fmt(recipe.nyangCost - c.nyang)} more ${state.settings.currencyName}`);
  if (recipe.minRealm > (c.realm || 0)) reasons.push(`realm ${state.realms[recipe.minRealm]?.name || recipe.minRealm} or higher`);
  if (!recipe.enabled) reasons.push('this recipe is disabled');
  if (recipe.outputs.some((o) => !itemOf(state, o.itemId))) reasons.push('an output item no longer exists');
  return { ok: reasons.length === 0, reasons, inputs };
}

function craft(state, c, recipe) {
  const chk = check(state, c, recipe);
  if (!chk.ok) throw new UserError(`You can't craft **${recipe.name}** yet: ${chk.reasons.join(', ')}.`);
  if (recipe.nyangCost > 0) economy.spendNyang(state, c, recipe.nyangCost);
  const roll = r2(Math.random() * 100);
  const success = roll < recipe.successChance;
  if (success || recipe.consumeOnFail) for (const x of recipe.inputs) economy.removeItem(state, c, x.itemId, x.qty);
  if (success) for (const o of recipe.outputs) economy.addItem(c, o.itemId, o.qty);
  return { success, roll, outputs: recipe.outputs.map((o) => ({ item: itemOf(state, o.itemId), qty: o.qty })) };
}

function describe(state, recipe) {
  const list = (rows) => rows.map((x) => `${x.qty}× ${itemOf(state, x.itemId)?.name || '?'}`).join(' + ') || 'nothing';
  return `${list(recipe.inputs)}${recipe.nyangCost ? ` + ${fmt(recipe.nyangCost)} ${state.settings.currencyName}` : ''} → ${list(recipe.outputs)}${recipe.successChance < 100 ? ` (${fmt(recipe.successChance)}%)` : ''}`;
}

module.exports = { check, craft, describe };
