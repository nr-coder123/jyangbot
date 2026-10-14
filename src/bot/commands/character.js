'use strict';
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('../../store');
const chars = require('../../engine/characters');
const { EPH, requireStaff, actor, listChoices, sendToChannel } = require('../util');
const { sheetEmbed } = require('../render');
const { UserError, newId, norm, truncate, fmt } = require('../../utils');

const data = new SlashCommandBuilder()
  .setName('character')
  .setDescription('Character applications and management')
  .addSubcommand((s) =>
    s.setName('submit').setDescription('Submit your character document for staff approval')
      .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('document').setDescription('Link to your character doc').setRequired(true))
      .addStringOption((o) => o.setName('sect').setDescription('Sect / clan (leave empty for Rogue)').setAutocomplete(true)))
  .addSubcommand((s) =>
    s.setName('approve').setDescription('[Staff] Approve a character (creates the stat sheet)')
      .addUserOption((o) => o.setName('player').setDescription('Owner of the character').setRequired(true))
      .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true))
      .addStringOption((o) => o.setName('sect').setDescription('Sect / clan').setAutocomplete(true))
      .addStringOption((o) => o.setName('document').setDescription('Link to the character doc')))
  .addSubcommand((s) =>
    s.setName('reject').setDescription('[Staff] Reject a pending application')
      .addStringOption((o) => o.setName('application').setDescription('Pending application').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason shown to the player')))
  .addSubcommand((s) => s.setName('pending').setDescription('[Staff] List pending applications'))
  .addSubcommand((s) =>
    s.setName('list').setDescription('List approved characters')
      .addUserOption((o) => o.setName('player').setDescription('Only this player')))
  .addSubcommand((s) =>
    s.setName('switch').setDescription('Switch your active character')
      .addStringOption((o) => o.setName('name').setDescription('Your character').setRequired(true).setAutocomplete(true)));

function appEmbed(app, extra = '') {
  const color = app.status === 'approved' ? '#3aa55d' : app.status === 'rejected' ? '#c0392b' : '#d4a017';
  return new EmbedBuilder()
    .setTitle(`📜 Character Application — ${app.name}`)
    .setColor(color)
    .setDescription(`**Player:** <@${app.userId}>\n**Sect:** ${app.sect || 'Rogue'}\n**Document:** ${app.docLink}\n**Status:** ${app.status.toUpperCase()}${extra}`)
    .setFooter({ text: `Application ${app.id}` })
    .setTimestamp(new Date(app.createdAt));
}

const appButtons = (id) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app:approve:${id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`app:reject:${id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
  );

/** Approve + create the character + give the base roles. */
async function approve(i, { userId, userTag, name, sect, docLink, applicationId }) {
  const st = store.state;
  const c = chars.createCharacter(st, { ownerId: userId, ownerTag: userTag, name, sect, docLink, approvedBy: { id: i.user.id, name: i.user.username } });
  const app = applicationId && st.applications.find((a) => a.id === applicationId);
  if (app) Object.assign(app, { status: 'approved', characterId: c.id, decidedBy: i.user.username, decidedAt: new Date().toISOString() });
  store.log(actor(i), 'character.approve', `${c.name} — owner ${userTag} (${userId})${c.sect ? `, ${c.sect}` : ''}`);

  const roleIds = [...(st.settings.approvedRoleIds || [])];
  const sectObj = chars.sectOf(st, c.sect);
  if (sectObj?.roleId) roleIds.push(sectObj.roleId);
  let roleNote = '';
  if (roleIds.filter(Boolean).length && i.guild) {
    try {
      const member = await i.guild.members.fetch(userId);
      await member.roles.add(roleIds.filter(Boolean));
      roleNote = `\nRoles given: ${roleIds.filter(Boolean).map((r) => `<@&${r}>`).join(' ')}`;
    } catch (e) {
      roleNote = `\n⚠️ Couldn't give roles (${e.message}). The bot needs **Manage Roles** and its role must be above those roles.`;
    }
  }
  const s = st.settings;
  const announce = `✅ <@${userId}>, **${c.name}** has been approved by **${i.user.username}**! You have **${fmt(c.pools.flex)}** starting points to spend anywhere (Qi included) — type \`/stats allocate\` and then e.g. \`strength 5\`.${roleNote}`;
  return { c, announce, startNote: s.startingNyang ? ` You also start with ${s.startingNyang} ${s.currencyName}.` : '' };
}

async function execute(i) {
  const st = store.state;
  const sub = i.options.getSubcommand();

  if (sub === 'submit') {
    const sect = i.options.getString('sect') || '';
    const sectObj = chars.sectOf(st, sect);
    if (sect && sectObj && !sectObj.playable) throw new UserError(`**${sectObj.name}** can't be chosen by players (staff-assigned only).`);
    const app = {
      id: newId('A'),
      userId: i.user.id,
      userTag: i.user.username,
      name: i.options.getString('name').trim(),
      sect: sectObj ? sectObj.name : sect,
      docLink: i.options.getString('document'),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    st.applications.unshift(app);
    store.log(actor(i), 'application.submit', `${app.name} by ${app.userTag}`);
    const payload = { embeds: [appEmbed(app)], components: [appButtons(app.id)] };
    const posted = await sendToChannel(i.client, st.settings.channels.submissions, payload);
    if (posted) {
      app.messageId = posted.id;
      app.channelId = posted.channelId;
      return i.reply({ content: `📜 Your application for **${app.name}** was sent to <#${posted.channelId}>. Staff will review it soon!`, flags: EPH });
    }
    const msg = await i.reply({ ...payload, withResponse: true });
    app.channelId = i.channelId;
    app.messageId = msg?.resource?.message?.id;
    return;
  }

  if (sub === 'approve') {
    requireStaff(i);
    const user = i.options.getUser('player');
    const name = i.options.getString('name');
    const pending = st.applications.find((a) => a.status === 'pending' && a.userId === user.id && norm(a.name) === norm(name));
    const r = await approve(i, {
      userId: user.id,
      userTag: user.username,
      name,
      sect: i.options.getString('sect') || pending?.sect || '',
      docLink: i.options.getString('document') || pending?.docLink || '',
      applicationId: pending?.id,
    });
    return i.reply({ content: r.announce + r.startNote, embeds: [sheetEmbed(r.c)] });
  }

  if (sub === 'reject') {
    requireStaff(i);
    const app = st.applications.find((a) => a.id === i.options.getString('application'));
    if (!app || app.status !== 'pending') throw new UserError('That application is not pending.');
    const reason = i.options.getString('reason') || '';
    Object.assign(app, { status: 'rejected', reason, decidedBy: i.user.username, decidedAt: new Date().toISOString() });
    store.log(actor(i), 'application.reject', `${app.name} by ${app.userTag}${reason ? ` — ${reason}` : ''}`);
    return i.reply({ content: `❌ <@${app.userId}>, your application for **${app.name}** was not approved.${reason ? `\n> ${reason}` : ''}` });
  }

  if (sub === 'pending') {
    requireStaff(i);
    const list = st.applications.filter((a) => a.status === 'pending');
    const text = list.map((a) => `• **${a.name}** — <@${a.userId}> — ${a.sect || 'Rogue'} — [doc](${a.docLink}) \`${a.id}\``).join('\n') || 'No pending applications.';
    return i.reply({ content: truncate(text, 1900), flags: EPH });
  }

  if (sub === 'list') {
    const u = i.options.getUser('player');
    const list = st.characters.filter((c) => c.status === 'active' && (!u || c.ownerId === u.id));
    const text = list.map((c) => `• **${c.name}** — <@${c.ownerId}> — ${st.realms[c.realm]?.name} — ${c.sect || 'Rogue'} *(approved by ${c.approvedBy?.name || '—'})*`).join('\n') || 'No characters.';
    return i.reply({ content: truncate(text, 1900), allowedMentions: { parse: [] } });
  }

  if (sub === 'switch') {
    const v = i.options.getString('name');
    const c = st.characters.find((x) => x.ownerId === i.user.id && x.status === 'active' && (x.id === v || norm(x.name) === norm(v)));
    if (!c) throw new UserError("You don't own an active character with that name.");
    st.users[i.user.id] = { ...(st.users[i.user.id] || {}), activeCharacterId: c.id };
    store.markDirty();
    return i.reply({ content: `Active character: **${c.name}**`, flags: EPH });
  }
}

async function autocomplete(i) {
  const st = store.state;
  const f = i.options.getFocused(true);
  if (f.name === 'sect') return listChoices(i, st.sects.filter((s) => s.playable || i.options.getSubcommand() === 'approve').map((s) => s.name));
  if (f.name === 'application') {
    return i.respond(st.applications.filter((a) => a.status === 'pending' && norm(a.name).includes(norm(f.value))).slice(0, 25).map((a) => ({ name: truncate(`${a.name} — ${a.userTag}`, 100), value: a.id })));
  }
  if (f.name === 'name' && i.options.getSubcommand() === 'switch') {
    return i.respond(st.characters.filter((c) => c.ownerId === i.user.id && c.status === 'active').slice(0, 25).map((c) => ({ name: c.name, value: c.id })));
  }
  return i.respond([]);
}

// Buttons on application posts
async function onAppButton(i) {
  requireStaff(i);
  const [, action, id] = i.customId.split(':');
  const app = store.state.applications.find((a) => a.id === id);
  if (!app) throw new UserError('Application not found.');
  if (app.status !== 'pending') throw new UserError(`This application was already ${app.status}.`);
  if (action === 'approve') {
    const r = await approve(i, { userId: app.userId, userTag: app.userTag, name: app.name, sect: app.sect, docLink: app.docLink, applicationId: app.id });
    await i.update({ embeds: [appEmbed(app, `\n**Approved by:** ${i.user.username}`)], components: [] });
    return i.followUp({ content: r.announce + r.startNote });
  }
  const modal = new ModalBuilder()
    .setCustomId(`appreject:${id}`)
    .setTitle(`Reject ${truncate(app.name, 35)}`)
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason (shown to the player)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)));
  return i.showModal(modal);
}

async function onRejectModal(i) {
  requireStaff(i);
  const id = i.customId.split(':')[1];
  const app = store.state.applications.find((a) => a.id === id);
  if (!app || app.status !== 'pending') throw new UserError('That application is not pending anymore.');
  const reason = i.fields.getTextInputValue('reason') || '';
  Object.assign(app, { status: 'rejected', reason, decidedBy: i.user.username, decidedAt: new Date().toISOString() });
  store.log(actor(i), 'application.reject', `${app.name} by ${app.userTag}${reason ? ` — ${reason}` : ''}`);
  if (i.message) await i.message.edit({ embeds: [appEmbed(app, `\n**Rejected by:** ${i.user.username}${reason ? `\n**Reason:** ${reason}` : ''}`)], components: [] }).catch(() => {});
  return i.reply({ content: `❌ <@${app.userId}>, your application for **${app.name}** was not approved.${reason ? `\n> ${reason}` : ''}` });
}

module.exports = {
  commands: [{ data, execute, autocomplete }],
  buttons: { app: onAppButton },
  modals: { appreject: onRejectModal },
  approve,
};
