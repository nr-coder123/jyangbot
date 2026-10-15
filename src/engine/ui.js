'use strict';
/**
 * Emojis and button looks, editable in the dashboard (Messages → Emojis & Buttons).
 * Emojis can be unicode (💪) or custom server emojis (<:strength:123456789012345678>), or empty to remove them.
 * Every message template can use them as {e.strength}, {e.qi}, ...
 */

const EMOJIS = {
  strength: ['💪', 'Strength'],
  endurance: ['🛡️', 'Endurance'],
  mobility: ['💨', 'Mobility'],
  qi: ['🌀', 'Qi'],
  qiBars: ['🔋', 'Qi Bars'],
  impurity: ['☣️', 'Impurity'],
  nyang: ['🪙', 'Currency (Nyang)'],
  rolls: ['🎲', 'Drop rolls'],
  weapon: ['⚔️', 'Main weapon'],
  realm: ['☯️', 'Realm'],
  sheet: ['📜', 'Character sheet'],
  stats: ['📊', 'Stats panel'],
  inventory: ['🎒', 'Inventory'],
  market: ['🏪', 'Market'],
  shop: ['🏮', 'Shop (sold by the server)'],
  player: ['👥', 'Player listing'],
  craft: ['⚒️', 'Crafting'],
  pill: ['💊', 'Consumed pill'],
  ok: ['✅', 'Requirement met'],
  missing: ['❌', 'Requirement missing'],
  warning: ['⚠️', 'Warning'],
  hardCap: ['⛔', 'Hard cap'],
};

// key: [label, emoji, where it appears]
const BUTTONS = {
  sheet: ['Sheet', '📜', 'Menu tab'],
  stats: ['Stats', '📊', 'Menu tab'],
  inventory: ['Inventory', '🎒', 'Menu tab'],
  market: ['Market', '🏪', 'Menu tab'],
  realm: ['Realm', '☯️', 'Menu tab'],
  addStat: ['+{n} {stat}', '{statEmoji}', 'Stats: +1 / +5 buttons ({n}, {stat} = short stat name, {statEmoji} = that stat\'s emoji)'],
  spend: ['Spend points…', '✏️', 'Stats'],
  typeChat: ['Type in chat', '⌨️', 'Stats'],
  undo: ['Undo', '↩️', 'Stats'],
  roll: ['Roll for a drop ({rolls})', '🎲', 'Inventory ({rolls} = rolls left)'],
  craft: ['Crafting', '⚒️', 'Inventory'],
  rates: ['Drop rates', '📈', 'Inventory'],
  consume: ['Consume', '💊', 'Item'],
  learn: ['Learn', '📖', 'Item'],
  equip: ['Equip', '⚔️', 'Item (weapons)'],
  sellShop: ['Sell 1 for {price}', '💰', 'Item ({price})'],
  list: ['List on market', '🏷️', 'Item'],
  filterAll: ['All', '', 'Market filter'],
  filterPlayers: ['Player market', '👥', 'Market filter'],
  filterShop: ['Shop', '🏮', 'Market filter'],
  buy1: ['Buy 1 ({price})', '🛒', 'Market entry'],
  buyAmount: ['Buy amount…', '', 'Market entry'],
  unlist: ['Take down', '🗑️', 'Market entry (own listing)'],
  craftDo: ['Craft', '⚒️', 'Recipe'],
  breakthrough: ['Attempt Realm Breakthrough', '🌟', 'Realm'],
  confirm: ['Yes — attempt ({chance}%)', '🌟', 'Realm confirmation ({chance})'],
  cancel: ['Cancel', '', 'Confirmations'],
  back: ['Back', '◀', 'Everywhere'],
  prev: ['Prev', '⬅', 'Pages'],
  next: ['Next', '➡', 'Pages'],
};

const STAT_SHORT = { strength: 'STR', endurance: 'END', mobility: 'MOB', qi: 'Qi' };

const fill = (s, vars) => String(s ?? '').replace(/\{([\w.]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

function emojis(state) {
  const over = state.settings.ui?.emojis || {};
  const out = {};
  for (const [k, [def]] of Object.entries(EMOJIS)) out[k] = typeof over[k] === 'string' ? over[k] : def;
  if (typeof over.nyang !== 'string' && state.settings.currencyEmoji) out.nyang = state.settings.currencyEmoji;
  return out;
}

function emoji(state, key) {
  return emojis(state)[key] ?? '';
}

/** Template variables {e.key} for every emoji. */
function emojiVars(state) {
  return Object.fromEntries(Object.entries(emojis(state)).map(([k, v]) => [`e.${k}`, v]));
}

function statShort(state, stat) {
  return state.settings.ui?.statShort?.[stat] || STAT_SHORT[stat] || stat;
}

/** { label, emoji } for a button key, with {placeholders} filled. Never returns both empty. */
function button(state, key, vars = {}) {
  const def = BUTTONS[key] || [key, ''];
  const over = state.settings.ui?.buttons?.[key] || {};
  const label = fill(typeof over.label === 'string' ? over.label : def[0], vars).trim().slice(0, 80);
  const em = fill(typeof over.emoji === 'string' ? over.emoji : def[1], vars).trim();
  return { label: label || (em ? '' : fill(def[0], vars) || key), emoji: em };
}

module.exports = { EMOJIS, BUTTONS, STAT_SHORT, emojis, emoji, emojiVars, button, statShort, fill };
