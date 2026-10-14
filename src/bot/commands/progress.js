'use strict';
/** /progress — players submit finished RPs/fights; approvers reward them from the post's buttons. */
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('../../store');
const { grant, GRANT_TYPES } = require('../../engine/grants');
const { EPH, requireAccess, actor, requireChar, message, sendToChannel } = require('../util');
const { UserError, newId, truncate } = require('../../utils');

const progress = new SlashCommandBuilder()
  .setName('progress')
  .setDescription('Submit a finished RP interaction or fight for rewards')
  .addStringOption((o) => o.setName('link').setDescription('Link to the RP / fight').setRequired(true))
  .addStringOption((o) => o.setName('summary').setDescription('Short summary of what happened').setRequired(true).setMaxLength(1500))
  .addBooleanOption((o) => o.setName('breakthrough').setDescription('Was this a Breakthrough feat (asking for Qi)?'));

function post(p) {
  const m = message('progressPost', {
    player: `<@${p.userId}>`, character: p.charName, link: p.link, summary: p.summary, id: p.id,
    breakthrough: p.breakthrough ? '🌟 **Breakthrough requested (Qi)**' : '',
  });
  const status = p.status === 'pending' ? '🕒 Pending' : p.status === 'rewarded' ? `✅ Rewarded by ${p.decidedBy}: ${p.reward}` : `Dismissed by ${p.decidedBy}`;
  if (m.embeds[0]) m.embeds[0].fields = [...(m.embeds[0].fields || []), { name: 'Status', value: truncate(status, 1024) }];
  m.components = p.status === 'pending'
    ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prog:grant:${p.id}`).setLabel('Grant reward').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`prog:dismiss:${p.id}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary),
    )]
    : [];
  return m;
}

async function execute(i) {
  const c = requireChar(i.user.id);
  const p = {
    id: newId('P'), userId: i.user.id, charId: c.id, charName: c.name,
    link: i.options.getString('link'), summary: i.options.getString('summary'), breakthrough: !!i.options.getBoolean('breakthrough'),
    status: 'pending', createdAt: new Date().toISOString(),
  };
  store.state.progress.unshift(p);
  if (store.state.progress.length > 1000) store.state.progress.length = 1000;
  store.log(actor(i), 'progress.submit', `${c.name}: ${truncate(p.summary, 200)}`);
  const posted = await sendToChannel(i.client, store.state.settings.channels.progress, post(p));
  if (posted) return i.reply({ content: '⚔️ Submitted! Staff will review it.', flags: EPH });
  return i.reply(post(p));
}

async function onButton(i) {
  requireAccess(i, 'give');
  const [, action, id] = i.customId.split(':');
  const p = store.state.progress.find((x) => x.id === id);
  if (!p) throw new UserError('Submission not found.');
  if (p.status !== 'pending') throw new UserError(`Already ${p.status}.`);
  if (action === 'dismiss') {
    Object.assign(p, { status: 'dismissed', decidedBy: i.user.username });
    store.log(actor(i), 'progress.dismiss', `${p.charName} (${p.id})`);
    return i.update(post(p));
  }
  const input = (id2, label, value, required = true, style = TextInputStyle.Short) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id2).setLabel(label).setStyle(style).setRequired(required).setValue(value));
  return i.showModal(new ModalBuilder().setCustomId(`proggrant:${id}`).setTitle(truncate(`Reward ${p.charName}`, 45)).addComponents(
    input('type', 'Type: all / allqi / qi / nyang / rolls / qibars', p.breakthrough ? 'qi' : 'all'),
    input('amount', 'Amount', p.breakthrough ? '1' : '25'),
    input('extra', 'Optional 2nd reward, e.g. "nyang 100"', '', false),
    input('reason', 'Reason (shown on the report)', '', false, TextInputStyle.Paragraph),
  ));
}

async function onModal(i) {
  requireAccess(i, 'give');
  const p = store.state.progress.find((x) => x.id === i.customId.split(':')[1]);
  if (!p || p.status !== 'pending') throw new UserError('That submission is no longer pending.');
  const c = store.state.characters.find((x) => x.id === p.charId);
  if (!c) throw new UserError('The character no longer exists.');
  const reason = i.fields.getTextInputValue('reason') || '';
  const r1 = grant(store.state, c, i.fields.getTextInputValue('type'), i.fields.getTextInputValue('amount'));
  const results = [r1];
  const extra = (i.fields.getTextInputValue('extra') || '').trim();
  if (extra) {
    const [t, a] = extra.split(/\s+/);
    if (!GRANT_TYPES.includes(String(t).toLowerCase())) throw new UserError(`Second reward type "${t}" is unknown.`);
    results.push(grant(store.state, c, t, a));
  }
  const summary = results.map((r) => r.summary).join(', ');
  store.log(actor(i), 'progress.reward', `${c.name}: ${summary}${reason ? ` — ${reason}` : ''}`);
  Object.assign(p, { status: 'rewarded', decidedBy: i.user.username, reward: summary });
  if (i.message) await i.message.edit(post(p)).catch(() => {});
  const report = message('progressionReport', {
    player: `<@${c.ownerId}>`, character: c.name, summary, details: results.flatMap((r) => r.lines).join('\n'), staff: `<@${i.user.id}>`, reason,
  }, { ping: [c.ownerId] });
  // Report goes to the announcements channel if set, otherwise right here.
  const sent = await sendToChannel(i.client, store.state.settings.channels.announcements, report);
  if (sent) return i.reply({ content: `Rewarded ${p.charName}: ${summary}`, flags: EPH });
  return i.reply(report);
}

module.exports = {
  commands: [{ data: progress, execute }],
  buttons: { prog: onButton },
  modals: { proggrant: onModal },
};
