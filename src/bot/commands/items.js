'use strict';
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const store = require('../../store');
const rolls = require('../../engine/rolls');
const economy = require('../../engine/economy');
const chars = require('../../engine/characters');
const { EPH, isStaff, actor, requireChar, charFor, findItem, itemChoices, inventoryChoices, listChoices } = require('../util');
const { itemEmbed, inventoryEmbed, rarityOf, itemIcon } = require('../render');
const { UserError, fmt, truncate } = require('../../utils');

// ---------- /roll & /droprates ----------
const roll = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Use a drop roll to find an item (Earthly / Heavenly / Immortal)')
  .addUserOption((o) => o.setName('player').setDescription('[Staff] Roll for this player for free'));

async function executeRoll(i) {
  const st = store.state;
  const target = i.options.getUser('player');
  let c;
  let free = false;
  if (target) {
    if (!isStaff(i)) throw new UserError('Only staff can do free rolls for a player.');
    c = requireChar(target.id, target.id !== i.user.id);
    free = true;
  } else {
    c = requireChar(i.user.id);
    if (c.rolls < 1) throw new UserError('You have no drop rolls. Staff grant them with `/give rolls`.');
  }
  if (!free) c.rolls -= 1;
  const r = rolls.rollDrop(st, c);
  if (!r.item) {
    if (!free) c.rolls += 1;
    store.markDirty();
    throw new UserError(`Rolled **${r.rarity.name}**, but there are no ${r.rarity.name} items in the drop pool yet. Your roll was refunded.`);
  }
  economy.addItem(c, r.item.id, 1);
  store.log(actor(i), 'roll', `${c.name} rolled ${r.rarity.name}: ${r.item.name}${free ? ' (free staff roll)' : ''}`);
  const e = itemEmbed(r.item).setAuthor({ name: `${c.name} rolled ${r.rarity.emoji} ${r.rarity.name}!` });
  if (!free) e.setFooter({ text: `${c.rolls} roll(s) left · added to inventory` });
  return i.reply({ content: target ? `<@${c.ownerId}>` : undefined, embeds: [e] });
}

const droprates = new SlashCommandBuilder().setName('droprates').setDescription('Show drop chances per rarity');
async function executeDroprates(i) {
  const st = store.state;
  const c = (() => {
    try { return requireChar(i.user.id); } catch { return null; }
  })();
  const rows = rolls.chanceTable(st, c);
  return i.reply({ content: rows.map((r) => `${r.emoji} **${r.name}** — ${fmt(r.percent)}% · ${r.items} item(s) in pool`).join('\n') + (c?.sect ? `\n-# Includes ${c.sect} bonuses, if any.` : ''), flags: EPH });
}

// ---------- /inventory ----------
const inventory = new SlashCommandBuilder().setName('inventory').setDescription('Show an inventory').addUserOption((o) => o.setName('player').setDescription('Whose inventory'));
const executeInventory = (i) => i.reply({ embeds: [inventoryEmbed(charFor(i))] });

// ---------- /item ----------
const item = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Items, manuals and pills')
  .addSubcommand((s) => s.setName('info').setDescription('Read an item\'s description and details').addStringOption((o) => o.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('use').setDescription('Consume a pill / elixir').addStringOption((o) => o.setName('item').setDescription('Pill').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('learn').setDescription('Learn a manual, cultivation method or qi core from your inventory').addStringOption((o) => o.setName('item').setDescription('Manual').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('forget').setDescription('Forget a martial art or cultivation method (frees a slot, no refund)').addStringOption((o) => o.setName('name').setDescription('Art / method').setRequired(true).setAutocomplete(true)));

async function executeItem(i) {
  const st = store.state;
  const sub = i.options.getSubcommand();
  if (sub === 'info') return i.reply({ embeds: [itemEmbed(findItem(i.options.getString('item')))] });
  const c = requireChar(i.user.id);
  if (sub === 'use') {
    const it = findItem(i.options.getString('item'));
    const r = chars.consumePill(st, c, it);
    store.log(actor(i), 'item.use', `${c.name} consumed ${it.name}: ${r.lines.join('; ')}`);
    return i.reply({ embeds: [new EmbedBuilder().setColor(rarityOf(it.rarity).color).setTitle(`${itemIcon(it)} ${c.name} consumed ${it.name}`).setDescription(truncate([...r.lines, ...(r.result.errors || []).map((e) => `⚠️ Script error — ${e}`)].join('\n') || 'Nothing happened.', 4000))] });
  }
  if (sub === 'learn') {
    const it = findItem(i.options.getString('item'));
    const r = chars.learnItem(st, c, it);
    store.log(actor(i), 'item.learn', `${c.name} learned ${it.name}`);
    const share = it.type === 'manual' && it.manual.shareable ? ' This art **can be shared**.' : '';
    return i.reply({ content: `📖 **${c.name}** learned **${it.name}**! ${r.note}${share}` });
  }
  if (sub === 'forget') {
    const r = chars.forget(st, c, i.options.getString('name'));
    store.log(actor(i), 'item.forget', `${c.name} forgot ${r.name}`);
    return i.reply({ content: `🍂 **${c.name}** forgot the ${r.label} **${r.name}**.` });
  }
}

async function autocompleteItem(i) {
  const sub = i.options.getSubcommand();
  if (sub === 'info') return itemChoices(i);
  if (sub === 'use') return inventoryChoices(i, i.user.id, (it) => it.type === 'pill');
  if (sub === 'learn') return inventoryChoices(i, i.user.id, (it) => ['manual', 'cultivation', 'core'].includes(it.type));
  if (sub === 'forget') {
    const c = chars.activeCharacterOf(store.state, i.user.id);
    if (!c) return i.respond([]);
    const names = [...Object.values(c.martialArts).flat(), ...c.cultivationMethods].map((r) => chars.refName(store.state, r)).filter(Boolean);
    return listChoices(i, names);
  }
}

// ---------- /shop ----------
const shop = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('The shop')
  .addSubcommand((s) => s.setName('view').setDescription('Browse the shop').addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1)))
  .addSubcommand((s) =>
    s.setName('buy').setDescription('Buy from the shop')
      .addStringOption((o) => o.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('quantity').setDescription('How many').setMinValue(1)))
  .addSubcommand((s) =>
    s.setName('sell').setDescription('Sell an item back to the shop')
      .addStringOption((o) => o.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('quantity').setDescription('How many').setMinValue(1)));

async function executeShop(i) {
  const st = store.state;
  const s = st.settings;
  const sub = i.options.getSubcommand();
  if (sub === 'view') {
    const list = economy.shopItems(st);
    const per = 12;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const page = Math.min(pages, i.options.getInteger('page') || 1);
    const lines = list.slice((page - 1) * per, page * per).map((it) => `${itemIcon(it)} **${it.name}** — ${s.currencyEmoji} ${fmt(it.shop.price)}${it.shop.stock >= 0 ? ` · ${it.shop.stock} left` : ''}\n-# ${it.rarity} ${it.type}${it.description ? ` · ${truncate(it.description.replace(/\s+/g, ' '), 80)}` : ''}`);
    return i.reply({ embeds: [new EmbedBuilder().setTitle('🏮 Shop').setColor('#c0392b').setDescription(lines.join('\n') || 'The shop is empty.').setFooter({ text: `Page ${page}/${pages} · /shop buy · /item info for full descriptions` })] });
  }
  const c = requireChar(i.user.id);
  const it = findItem(i.options.getString('item'));
  const q = i.options.getInteger('quantity') || 1;
  if (sub === 'buy') {
    const r = economy.buyFromShop(st, c, it, q);
    store.log(actor(i), 'shop.buy', `${c.name} bought ${q}× ${it.name} for ${r.cost}`);
    return i.reply({ content: `🛒 **${c.name}** bought ${q}× **${it.name}** for ${s.currencyEmoji} **${fmt(r.cost)}** ${s.currencyName}. Balance: ${fmt(c.nyang)}.` });
  }
  if (sub === 'sell') {
    const r = economy.sellToShop(st, c, it, q);
    store.log(actor(i), 'shop.sell', `${c.name} sold ${q}× ${it.name} for ${r.total}`);
    return i.reply({ content: `💰 **${c.name}** sold ${q}× **${it.name}** for ${s.currencyEmoji} **${fmt(r.total)}** ${s.currencyName}. Balance: ${fmt(c.nyang)}.` });
  }
}

async function autocompleteShop(i) {
  if (i.options.getSubcommand() === 'buy') return itemChoices(i, (it) => it.shop?.enabled);
  return inventoryChoices(i, i.user.id, (it) => economy.shopSellPrice(store.state, it) > 0);
}

module.exports = {
  commands: [
    { data: roll, execute: executeRoll },
    { data: droprates, execute: executeDroprates },
    { data: inventory, execute: executeInventory },
    { data: item, execute: executeItem, autocomplete: autocompleteItem },
    { data: shop, execute: executeShop, autocomplete: autocompleteShop },
  ],
};
