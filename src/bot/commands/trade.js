'use strict';
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../../store');
const economy = require('../../engine/economy');
const { EPH, actor, requireChar, findItem, itemChoices, inventoryChoices } = require('../util');
const { itemIcon } = require('../render');
const { UserError, fmt, norm, truncate } = require('../../utils');

// ---------- /pay ----------
const pay = new SlashCommandBuilder()
  .setName('pay')
  .setDescription('Send Nyang to another player')
  .addUserOption((o) => o.setName('player').setDescription('Who receives it').setRequired(true))
  .addNumberOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1));

async function executePay(i) {
  const st = store.state;
  const from = requireChar(i.user.id);
  const user = i.options.getUser('player');
  const to = requireChar(user.id, true);
  if (to.ownerId === from.ownerId) throw new UserError("You can't pay yourself.");
  const amount = i.options.getNumber('amount');
  economy.spendNyang(st, from, amount);
  economy.addNyang(to, amount);
  store.log(actor(i), 'pay', `${from.name} → ${to.name}: ${amount}`);
  return i.reply({ content: `${st.settings.currencyEmoji} **${from.name}** sent **${fmt(amount)}** ${st.settings.currencyName} to **${to.name}** (<@${user.id}>).` });
}

// ---------- /trade ----------
const trade = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Offer a trade to another player (they accept with a button)')
  .addUserOption((o) => o.setName('player').setDescription('Who you trade with').setRequired(true))
  .addStringOption((o) => o.setName('give_item').setDescription('Item you give').setAutocomplete(true))
  .addIntegerOption((o) => o.setName('give_quantity').setDescription('How many you give (default 1)').setMinValue(1))
  .addNumberOption((o) => o.setName('give_nyang').setDescription('Nyang you give').setMinValue(0))
  .addStringOption((o) => o.setName('want_item').setDescription('Item you want from them').setAutocomplete(true))
  .addIntegerOption((o) => o.setName('want_quantity').setDescription('How many you want (default 1)').setMinValue(1))
  .addNumberOption((o) => o.setName('want_nyang').setDescription('Nyang you want').setMinValue(0));

function tradeEmbed(t, status) {
  const st = store.state;
  const from = st.characters.find((c) => c.id === t.fromCharId);
  const to = st.characters.find((c) => c.id === t.toCharId);
  return new EmbedBuilder()
    .setTitle('🤝 Trade offer')
    .setColor(t.status === 'accepted' ? '#3aa55d' : t.status === 'pending' ? '#d4a017' : '#7f8c8d')
    .setDescription(`**${from?.name}** (<@${t.fromUserId}>) gives: ${economy.describeSide(st, t.give)}\n**${to?.name}** (<@${t.toUserId}>) gives: ${economy.describeSide(st, t.want)}\n\n${status || `Expires <t:${Math.floor(Date.parse(t.expiresAt) / 1000)}:R>`}`)
    .setFooter({ text: `Trade ${t.id}` });
}

async function executeTrade(i) {
  const st = store.state;
  const from = requireChar(i.user.id);
  const user = i.options.getUser('player');
  const to = requireChar(user.id, true);
  const gi = i.options.getString('give_item');
  const wi = i.options.getString('want_item');
  const t = economy.createTrade(
    st, from, to,
    { itemId: gi ? findItem(gi).id : null, qty: i.options.getInteger('give_quantity') || 1, nyang: i.options.getNumber('give_nyang') || 0 },
    { itemId: wi ? findItem(wi).id : null, qty: i.options.getInteger('want_quantity') || 1, nyang: i.options.getNumber('want_nyang') || 0 },
  );
  store.markDirty();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`trade:accept:${t.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`trade:decline:${t.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`trade:cancel:${t.id}`).setLabel('Cancel (sender)').setStyle(ButtonStyle.Secondary),
  );
  return i.reply({ content: `<@${user.id}>, **${from.name}** wants to trade with you!`, embeds: [tradeEmbed(t)], components: [row], allowedMentions: { users: [user.id] } });
}

async function autocompleteTrade(i) {
  const f = i.options.getFocused(true);
  if (f.name === 'give_item') return inventoryChoices(i, i.user.id, (it) => it.tradeable);
  return itemChoices(i, (it) => it.tradeable);
}

async function onTradeButton(i) {
  const st = store.state;
  const [, action, id] = i.customId.split(':');
  const t = st.trades.find((x) => x.id === id);
  if (!t) throw new UserError('Trade not found.');
  if (t.status !== 'pending') throw new UserError(`This trade is already ${t.status}.`);
  if (action === 'cancel') {
    if (i.user.id !== t.fromUserId) throw new UserError('Only the sender can cancel.');
    t.status = 'cancelled';
    store.markDirty();
    return i.update({ embeds: [tradeEmbed(t, '🚫 Cancelled by the sender.')], components: [] });
  }
  if (i.user.id !== t.toUserId) throw new UserError('Only the player receiving the offer can accept or decline it.');
  if (action === 'decline') {
    t.status = 'declined';
    store.markDirty();
    return i.update({ embeds: [tradeEmbed(t, '❌ Declined.')], components: [] });
  }
  try {
    const { from, to } = economy.settleTrade(st, t);
    store.log(actor(i), 'trade.accept', `${from.name} ⇄ ${to.name}: ${economy.describeSide(st, t.give)} for ${economy.describeSide(st, t.want)}`.replace(/\*/g, ''));
    return i.update({ embeds: [tradeEmbed(t, '✅ Trade complete!')], components: [] });
  } catch (e) {
    store.markDirty();
    if (t.status === 'expired') await i.update({ embeds: [tradeEmbed(t, '⌛ Expired.')], components: [] }).catch(() => {});
    throw e;
  }
}

// ---------- /market ----------
const market = new SlashCommandBuilder()
  .setName('market')
  .setDescription('Player market — sell items to other players')
  .addSubcommand((s) =>
    s.setName('list').setDescription('Put an item up for sale')
      .addStringOption((o) => o.setName('item').setDescription('Item from your inventory').setRequired(true).setAutocomplete(true))
      .addNumberOption((o) => o.setName('price').setDescription('Price PER UNIT in Nyang').setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName('quantity').setDescription('How many (default 1)').setMinValue(1)))
  .addSubcommand((s) =>
    s.setName('view').setDescription('Browse listings')
      .addStringOption((o) => o.setName('search').setDescription('Filter by item name'))
      .addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1)))
  .addSubcommand((s) =>
    s.setName('buy').setDescription('Buy from a listing')
      .addStringOption((o) => o.setName('listing').setDescription('Listing').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('quantity').setDescription('How many (default 1)').setMinValue(1)))
  .addSubcommand((s) => s.setName('cancel').setDescription('Take your listing down').addStringOption((o) => o.setName('listing').setDescription('Your listing').setRequired(true).setAutocomplete(true)));

function listingLabel(l) {
  const st = store.state;
  const it = st.items.find((x) => x.id === l.itemId);
  const seller = st.characters.find((c) => c.id === l.sellerCharId);
  return { it, seller, text: `${l.qty}× ${it?.name || '?'} @ ${fmt(l.price)} each — ${seller?.name || '?'} [${l.id}]` };
}

async function executeMarket(i) {
  const st = store.state;
  const s = st.settings;
  const sub = i.options.getSubcommand();
  if (sub === 'view') {
    const q = norm(i.options.getString('search'));
    const list = st.market.filter((l) => !q || norm(listingLabel(l).it?.name).includes(q));
    const per = 15;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const page = Math.min(pages, i.options.getInteger('page') || 1);
    const lines = list.slice((page - 1) * per, page * per).map((l) => {
      const { it, seller } = listingLabel(l);
      return `\`${l.id}\` ${it ? itemIcon(it) : ''} **${it?.name || '?'}** ×${l.qty} — ${s.currencyEmoji} **${fmt(l.price)}** each · by ${seller?.name || '?'}`;
    });
    return i.reply({ embeds: [new EmbedBuilder().setTitle('🏪 Player Market').setColor('#16a085').setDescription(lines.join('\n') || 'No listings.').setFooter({ text: `Page ${page}/${pages} · /market buy` })] });
  }
  const c = requireChar(i.user.id);
  if (sub === 'list') {
    const it = findItem(i.options.getString('item'));
    const l = economy.listOnMarket(st, c, it, i.options.getInteger('quantity') || 1, i.options.getNumber('price'));
    store.log(actor(i), 'market.list', `${c.name}: ${l.qty}× ${it.name} @ ${l.price}`);
    return i.reply({ content: `🏪 Listed ${l.qty}× **${it.name}** at ${s.currencyEmoji} **${fmt(l.price)}** each. Listing \`${l.id}\`.` });
  }
  const l = st.market.find((x) => x.id === i.options.getString('listing') || x.id === String(i.options.getString('listing')).toUpperCase());
  if (!l) throw new UserError('Listing not found.');
  if (sub === 'buy') {
    const q = i.options.getInteger('quantity') || 1;
    const { it } = listingLabel(l);
    const r = economy.buyFromMarket(st, c, l, q);
    store.log(actor(i), 'market.buy', `${c.name} bought ${q}× ${it?.name} from ${r.seller?.name} for ${r.cost}`);
    return i.reply({ content: `🛍️ **${c.name}** bought ${q}× **${it?.name}** from **${r.seller?.name || 'a former seller'}** for ${s.currencyEmoji} **${fmt(r.cost)}**.${r.seller ? ` <@${r.seller.ownerId}>` : ''}` });
  }
  if (sub === 'cancel') {
    if (l.sellerUserId !== i.user.id && !require('../util').isStaff(i)) throw new UserError('That is not your listing.');
    const seller = economy.cancelListing(st, l);
    store.log(actor(i), 'market.cancel', `${listingLabel(l).text}`);
    return i.reply({ content: `Listing \`${l.id}\` removed; items returned to **${seller?.name || '—'}**.`, flags: EPH });
  }
}

async function autocompleteMarket(i) {
  const st = store.state;
  const sub = i.options.getSubcommand();
  if (sub === 'list') return inventoryChoices(i, i.user.id, (it) => it.tradeable);
  const q = norm(i.options.getFocused());
  const list = st.market.filter((l) => (sub === 'cancel' ? l.sellerUserId === i.user.id : true)).map((l) => ({ l, label: listingLabel(l).text })).filter((x) => !q || norm(x.label).includes(q));
  return i.respond(list.slice(0, 25).map((x) => ({ name: truncate(x.label, 100), value: x.l.id })));
}

module.exports = {
  commands: [
    { data: pay, execute: executePay },
    { data: trade, execute: executeTrade, autocomplete: autocompleteTrade },
    { data: market, execute: executeMarket, autocomplete: autocompleteMarket },
  ],
  buttons: { trade: onTradeButton },
};
