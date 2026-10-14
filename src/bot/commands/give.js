'use strict';
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('../../store');
const { grant } = require('../../engine/grants');
const economy = require('../../engine/economy');
const { EPH, requireStaff, actor, requireChar, findItem, itemChoices, sendToChannel } = require('../util');
const { UserError, newId, truncate, fmt } = require('../../utils');

const KINDS = [
  ['all', 'Stat points for Strength/Endurance/Mobility only (no Qi)'],
  ['allqi', 'Flexible points usable in any stat, including Qi'],
  ['qi', 'Qi directly (a Breakthrough) — resets Impurity'],
  ['nyang', 'Nyang (currency); negative to take'],
  ['rolls', 'Drop rolls for /roll; negative to take'],
  ['qibars', 'Bonus Qi Bars (can be 0.5); negative to take'],
];

const give = new SlashCommandBuilder().setName('give').setDescription('[Staff] Reward a player');
for (const [name, desc] of KINDS) {
  give.addSubcommand((s) =>
    s.setName(name).setDescription(desc)
      .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
      .addNumberOption((o) => o.setName('amount').setDescription('Amount (negative removes)').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Why (saved in the changelog)')));
}
give.addSubcommand((s) =>
  s.setName('item').setDescription('Give (or take) an item')
    .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
    .addStringOption((o) => o.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('quantity').setDescription('How many (negative takes)'))
    .addStringOption((o) => o.setName('reason').setDescription('Why (saved in the changelog)')));

function doGrant(i, c, type, amount, reason) {
  const lines = grant(store.state, c, type, amount);
  store.log(actor(i), `give.${type}`, `${c.name}: ${amount > 0 ? '+' : ''}${amount}${reason ? ` — ${reason}` : ''}`);
  return lines;
}

async function executeGive(i) {
  requireStaff(i);
  const sub = i.options.getSubcommand();
  const user = i.options.getUser('player');
  const c = requireChar(user.id, true);
  const reason = i.options.getString('reason') || '';
  if (sub === 'item') {
    const it = findItem(i.options.getString('item'));
    const q = i.options.getInteger('quantity') ?? 1;
    if (q === 0) throw new UserError('Quantity cannot be 0.');
    if (q < 0) economy.removeItem(store.state, c, it.id, -q);
    else economy.addItem(c, it.id, q);
    store.log(actor(i), 'give.item', `${c.name}: ${q > 0 ? '+' : ''}${q}× ${it.name}${reason ? ` — ${reason}` : ''}`);
    return i.reply({ content: `${q > 0 ? '🎁 Gave' : '🗑️ Took'} ${Math.abs(q)}× **${it.name}** ${q > 0 ? 'to' : 'from'} **${c.name}** (<@${user.id}>).` });
  }
  const lines = doGrant(i, c, sub, i.options.getNumber('amount'), reason);
  return i.reply({ content: `<@${user.id}>\n${lines.join('\n')}${reason ? `\n-# ${reason}` : ''}` });
}

// ---------- Progress submissions ----------
const progress = new SlashCommandBuilder()
  .setName('progress')
  .setDescription('Submit RP interactions / fights for rewards')
  .addSubcommand((s) =>
    s.setName('submit').setDescription('Submit a finished interaction or fight for review')
      .addStringOption((o) => o.setName('link').setDescription('Link to the RP / fight').setRequired(true))
      .addStringOption((o) => o.setName('summary').setDescription('Short summary of what happened').setRequired(true).setMaxLength(1500))
      .addBooleanOption((o) => o.setName('breakthrough').setDescription('Is this a Breakthrough feat (asking for Qi)?')));

function progressEmbed(p, extra = '') {
  return new EmbedBuilder()
    .setTitle(`⚔️ Progress — ${p.charName}`)
    .setColor(p.status === 'pending' ? '#d4a017' : p.status === 'rewarded' ? '#3aa55d' : '#7f8c8d')
    .setDescription(`**Player:** <@${p.userId}>\n**Link:** ${p.link}\n${p.breakthrough ? '**🌟 Breakthrough requested (Qi)**\n' : ''}\n${p.summary}${extra}`)
    .setFooter({ text: `Submission ${p.id}` })
    .setTimestamp(new Date(p.createdAt));
}

async function executeProgress(i) {
  const c = requireChar(i.user.id);
  const p = {
    id: newId('P'),
    userId: i.user.id,
    charId: c.id,
    charName: c.name,
    link: i.options.getString('link'),
    summary: i.options.getString('summary'),
    breakthrough: !!i.options.getBoolean('breakthrough'),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  store.state.progress.unshift(p);
  if (store.state.progress.length > 1000) store.state.progress.length = 1000;
  store.log(actor(i), 'progress.submit', `${c.name}: ${truncate(p.summary, 200)}`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`prog:grant:${p.id}`).setLabel('Grant reward').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`prog:dismiss:${p.id}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary),
  );
  const payload = { embeds: [progressEmbed(p)], components: [row] };
  const posted = await sendToChannel(i.client, store.state.settings.channels.progress, payload);
  if (posted) return i.reply({ content: `⚔️ Submitted to <#${posted.channelId}> for review.`, flags: EPH });
  return i.reply(payload);
}

async function onProgressButton(i) {
  requireStaff(i);
  const [, action, id] = i.customId.split(':');
  const p = store.state.progress.find((x) => x.id === id);
  if (!p) throw new UserError('Submission not found.');
  if (p.status !== 'pending') throw new UserError(`Already ${p.status}.`);
  if (action === 'dismiss') {
    p.status = 'dismissed';
    p.decidedBy = i.user.username;
    store.log(actor(i), 'progress.dismiss', `${p.charName} (${p.id})`);
    return i.update({ embeds: [progressEmbed(p, `\n\n*Dismissed by ${i.user.username}*`)], components: [] });
  }
  const modal = new ModalBuilder()
    .setCustomId(`proggrant:${id}`)
    .setTitle(truncate(`Reward ${p.charName}`, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type').setLabel('Type: all / allqi / qi / nyang / rolls / qibars').setStyle(TextInputStyle.Short).setRequired(true).setValue(p.breakthrough ? 'qi' : 'all')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Amount').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('25')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('extra').setLabel('Optional 2nd reward, e.g. "nyang 100"').setStyle(TextInputStyle.Short).setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel('Note to the player').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
    );
  return i.showModal(modal);
}

async function onGrantModal(i) {
  requireStaff(i);
  const id = i.customId.split(':')[1];
  const p = store.state.progress.find((x) => x.id === id);
  if (!p || p.status !== 'pending') throw new UserError('That submission is no longer pending.');
  const c = store.state.characters.find((x) => x.id === p.charId);
  if (!c) throw new UserError('The character no longer exists.');
  const note = i.fields.getTextInputValue('note') || '';
  const lines = doGrant(i, c, i.fields.getTextInputValue('type'), Number(i.fields.getTextInputValue('amount')), `progress ${p.id}`);
  const extra = (i.fields.getTextInputValue('extra') || '').trim();
  if (extra) {
    const [t, a] = extra.split(/\s+/);
    lines.push(...doGrant(i, c, t, Number(a), `progress ${p.id}`));
  }
  p.status = 'rewarded';
  p.decidedBy = i.user.username;
  p.reward = lines.join(' | ');
  if (i.message) await i.message.edit({ embeds: [progressEmbed(p, `\n\n**Rewarded by ${i.user.username}:**\n${lines.join('\n')}`)], components: [] }).catch(() => {});
  return i.reply({ content: `<@${p.userId}>\n${lines.join('\n')}${note ? `\n> ${note}` : ''}` });
}

module.exports = {
  commands: [
    { data: give, execute: executeGive, autocomplete: (i) => itemChoices(i) },
    { data: progress, execute: executeProgress },
  ],
  buttons: { prog: onProgressButton },
  modals: { proggrant: onGrantModal },
};

