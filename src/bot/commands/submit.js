'use strict';
/** /submit (players) and /approve + the Approve/Reject buttons (staff / approver roles). */
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('../../store');
const chars = require('../../engine/characters');
const sectsync = require('../sectsync');
const { EPH, requireAccess, actor, listChoices, message, sendToChannel } = require('../util');
const { UserError, newId, norm, fmt, truncate } = require('../../utils');

const submit = new SlashCommandBuilder()
  .setName('submit')
  .setDescription('Submit your character for approval')
  .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true).setMaxLength(80))
  .addStringOption((o) => o.setName('document').setDescription('Link to your character document').setRequired(true))
  .addStringOption((o) => o.setName('sect').setDescription('Sect or clan (leave empty for Rogue)').setAutocomplete(true));

const approveCmd = new SlashCommandBuilder()
  .setName('approve')
  .setDescription("Approve a player's submitted character and create their stat sheet")
  .addUserOption((o) => o.setName('player').setDescription('The player whose submission you approve').setRequired(true))
  .addStringOption((o) => o.setName('sect').setDescription('Sect or clan (default: what they submitted) — gives the sect role').setAutocomplete(true))
  .addStringOption((o) => o.setName('name').setDescription('Only if they never used /submit: the character name'))
  .addStringOption((o) => o.setName('document').setDescription('Only if they never used /submit: link to the document'));

function appVars(app) {
  return { player: `<@${app.userId}>`, character: app.name, sect: app.sect || 'Rogue', document: app.docLink, id: app.id };
}

/** The post in the submissions channel, with its current status. */
function appPost(app) {
  const m = message('applicationPost', appVars(app));
  const status = app.status === 'pending' ? '🕒 Pending' : app.status === 'approved' ? `✅ Approved by ${app.decidedBy}` : `❌ Rejected by ${app.decidedBy}${app.reason ? ` — ${app.reason}` : ''}`;
  if (m.embeds[0]) m.embeds[0].fields = [...(m.embeds[0].fields || []), { name: 'Status', value: truncate(status, 1024) }];
  m.components = app.status === 'pending'
    ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`app:approve:${app.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`app:reject:${app.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
    )]
    : [];
  return m;
}

/** Create the character, give base roles, return the announcement message. */
async function approve(i, { userId, userTag, name, sect, docLink, application }) {
  const st = store.state;
  const c = chars.createCharacter(st, { ownerId: userId, ownerTag: userTag, name, sect, docLink, approvedBy: { id: i.user.id, name: i.user.username } });
  if (application) Object.assign(application, { status: 'approved', characterId: c.id, decidedBy: i.user.username, decidedAt: new Date().toISOString() });
  const perks = c.creationPerks || {};
  const perkText = [perks.coreArt && `Core art: **${perks.coreArt}**`, perks.nyang && `+${fmt(perks.nyang)} ${st.settings.currencyName} for joining ${c.sect}`].filter(Boolean).join('\n');
  store.log(actor(i), 'character.approve', `${c.name} — owner ${userTag} (${userId})${c.sect ? `, ${c.sect}` : ''}${perkText ? ` · ${perkText.replace(/\*/g, '').replace(/\n/g, ', ')}` : ''}`);

  let roles = '';
  if (i.guild) {
    try {
      const member = await i.guild.members.fetch(userId);
      const base = (st.settings.approvedRoleIds || []).filter(Boolean);
      if (base.length) await member.roles.add(base);
      await sectsync.applySectRoles(i.client, userId, c.sect); // their sect's role, and no other sect role
      const sectRole = chars.sectOf(st, c.sect)?.roleId;
      const given = [...base, sectRole].filter(Boolean);
      if (given.length) roles = `Roles: ${given.map((r) => `<@&${r}>`).join(' ')}`;
    } catch (e) {
      roles = `⚠️ Couldn't give roles (${e.message}). The bot needs Manage Roles and its role must be above them.`;
    }
  }
  return message('applicationApproved', { player: `<@${userId}>`, character: c.name, staff: `<@${i.user.id}>`, points: fmt(c.pools.flex), roles, perks: perkText, sect: c.sect || 'Rogue' }, { ping: [userId] });
}

async function executeSubmit(i) {
  const st = store.state;
  const sect = i.options.getString('sect') || '';
  const sectObj = chars.sectOf(st, sect);
  if (sect && sectObj && !sectObj.playable) throw new UserError(`**${sectObj.name}** can't be chosen by players.`);
  const name = i.options.getString('name').trim();
  if (st.applications.some((a) => a.status === 'pending' && a.userId === i.user.id && norm(a.name) === norm(name))) throw new UserError(`You already have a pending application for **${name}**.`);
  const app = {
    id: newId('A'), userId: i.user.id, userTag: i.user.username, name,
    sect: sectObj ? sectObj.name : sect, docLink: i.options.getString('document'),
    status: 'pending', createdAt: new Date().toISOString(),
  };
  st.applications.unshift(app);
  store.log(actor(i), 'application.submit', `${app.name} by ${app.userTag}`);
  const posted = await sendToChannel(i.client, st.settings.channels.submissions, appPost(app));
  if (posted) {
    app.channelId = posted.channelId;
    app.messageId = posted.id;
  }
  return i.reply({ content: `📜 Your application for **${app.name}** was sent to the staff. You'll be pinged when it's reviewed!${posted ? '' : '\n-# (Staff: set a submissions channel in the dashboard so applications appear there.)'}`, flags: EPH });
}

async function executeApprove(i) {
  const st = store.state;
  const user = i.options.getUser('player');
  // The player's own submission is used — no need to retype the name.
  const pending = st.applications.filter((a) => a.status === 'pending' && a.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const name = pending ? pending.name : (i.options.getString('name') || '').trim();
  if (!name) throw new UserError(`<@${user.id}> has no pending submission. Ask them to use \`/submit\`, or fill in **name** to approve a character directly.`);
  await i.deferReply();
  const msg = await approve(i, {
    userId: user.id, userTag: user.username, name,
    sect: i.options.getString('sect') || pending?.sect || '',
    docLink: pending?.docLink || i.options.getString('document') || '',
    application: pending,
  });
  if (pending) await refreshPost(i.client, pending);
  const where = await announce(i, msg, user.id);
  if (where === 'announced') return i.editReply({ content: `✅ Approved **${name}** for <@${user.id}> — announced.`, allowedMentions: { parse: [] } });
  return i.editReply(msg);
}

/** Post to the announcements channel if one is set, otherwise DM the player. */
async function announce(i, msg, userId) {
  const posted = await sendToChannel(i.client, store.state.settings.channels.announcements, msg);
  if (posted) return 'announced';
  try {
    const user = await i.client.users.fetch(userId);
    await user.send({ content: msg.content, embeds: msg.embeds });
    return 'dm';
  } catch {
    return null;
  }
}

async function refreshPost(client, app) {
  if (!app.channelId || !app.messageId) return;
  try {
    const ch = await client.channels.fetch(app.channelId);
    const msg = await ch.messages.fetch(app.messageId);
    await msg.edit(appPost(app));
  } catch {}
}

async function sectAutocomplete(i) {
  const staffish = i.commandName === 'approve';
  return listChoices(i, store.state.sects.filter((s) => s.playable || staffish).map((s) => s.name));
}

async function onAppButton(i) {
  requireAccess(i, 'approve');
  const [, action, id] = i.customId.split(':');
  const app = store.state.applications.find((a) => a.id === id);
  if (!app) throw new UserError('Application not found.');
  if (app.status !== 'pending') throw new UserError(`This application was already ${app.status}.`);
  if (action === 'approve') {
    await i.deferUpdate();
    const msg = await approve(i, { userId: app.userId, userTag: app.userTag, name: app.name, sect: app.sect, docLink: app.docLink, application: app });
    await i.editReply(appPost(app));
    // The submissions channel is usually staff-only, so tell the player elsewhere.
    const where = await announce(i, msg, app.userId);
    return i.followUp({ content: `Approved **${app.name}**. ${where === 'announced' ? 'Announced.' : where === 'dm' ? 'The player was told by DM.' : "⚠️ Couldn't reach the player (no announcements channel and DMs closed)."}`, flags: EPH });
  }
  return i.showModal(new ModalBuilder()
    .setCustomId(`appreject:${id}`)
    .setTitle(truncate(`Reject ${app.name}`, 45))
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason (shown to the player)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))));
}

async function onRejectModal(i) {
  requireAccess(i, 'approve');
  const app = store.state.applications.find((a) => a.id === i.customId.split(':')[1]);
  if (!app || app.status !== 'pending') throw new UserError('That application is not pending anymore.');
  const reason = i.fields.getTextInputValue('reason') || '';
  Object.assign(app, { status: 'rejected', reason, decidedBy: i.user.username, decidedAt: new Date().toISOString() });
  store.log(actor(i), 'application.reject', `${app.name} by ${app.userTag}${reason ? ` — ${reason}` : ''}`);
  if (i.message) await i.message.edit(appPost(app)).catch(() => {});
  const msg = message('applicationRejected', { player: `<@${app.userId}>`, character: app.name, staff: `<@${i.user.id}>`, reason });
  // Rejections are private: DM first, announcements channel only if DMs are closed.
  try {
    const user = await i.client.users.fetch(app.userId);
    await user.send({ content: msg.content, embeds: msg.embeds });
    return i.reply({ content: `Rejected **${app.name}** — the player was told by DM.`, flags: EPH });
  } catch {
    return i.reply({ content: `Rejected **${app.name}**. I couldn't DM the player (DMs closed) — please let them know.`, flags: EPH });
  }
}

module.exports = {
  commands: [
    { data: submit, execute: executeSubmit, autocomplete: sectAutocomplete },
    { data: approveCmd, execute: executeApprove, autocomplete: sectAutocomplete, staff: true },
  ],
  buttons: { app: onAppButton },
  modals: { appreject: onRejectModal },
  approve,
};
