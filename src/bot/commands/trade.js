'use strict';
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../../store');
const economy = require('../../engine/economy');
const { actor, requireChar, findItem, itemChoices, inventoryChoices } = require('../util');
const { UserError } = require('../../utils');

// ---------- /trade ----------
const trade = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Trade or give items / Nyang to a player (ask for nothing to make it a gift)')
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

module.exports = {
  commands: [
        { data: trade, execute: executeTrade, autocomplete: autocompleteTrade },
  ],
  buttons: { trade: onTradeButton },
};
