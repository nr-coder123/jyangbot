'use strict';
const { Client, GatewayIntentBits, Events, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../config');
const store = require('../store');
const allocation = require('./allocation');
const access = require('./access');
const status = require('./status');
const sectsync = require('./sectsync');
const { EPH, sendToChannel } = require('./util');
const { UserError, truncate } = require('../utils');

const MODULES = ['menu', 'submit', 'progress', 'trade', 'tools', 'staff', 'world'];
const modules = MODULES.map((m) => require(`./commands/${m}`));
const commands = new Map();
const components = {};
const modals = {};
for (const m of modules) {
  for (const c of m.commands || []) {
    commands.set(c.data.name, c);
    if (c.staff) access.staffDefaults.add(c.data.name);
  }
  Object.assign(components, m.buttons || {});
  Object.assign(modals, m.modals || {});
}

let client = null;

const SUB = 1;
const GROUP = 2;

/** Every command + subcommand with its default text (for the dashboard). */
function catalog() {
  return [...commands.values()].map((c) => {
    const j = c.data.toJSON();
    const subs = (j.options || []).filter((o) => o.type === SUB).map((o) => ({ name: o.name, description: o.description, options: (o.options || []).map((x) => ({ name: x.name, description: x.description, required: !!x.required })) }));
    return {
      name: j.name,
      description: j.description,
      staffDefault: access.staffDefaults.has(j.name),
      options: subs.length ? [] : (j.options || []).map((x) => ({ name: x.name, description: x.description, required: !!x.required })),
      subcommands: subs,
      rule: access.ruleFor(j.name),
      subRules: Object.fromEntries(subs.map((s) => [s.name, access.subRule(j.name, s.name)])),
    };
  });
}

/** JSON sent to Discord, with the dashboard's descriptions, visibility and on/off switches applied. */
function commandJSON() {
  const out = [];
  for (const c of commands.values()) {
    const j = c.data.toJSON();
    const rule = access.ruleFor(j.name);
    if (rule.enabled === false) continue;
    if (rule.description) j.description = truncate(rule.description, 100);
    j.default_member_permissions = rule.hidden ? String(PermissionFlagsBits.ManageGuild) : null;
    j.dm_permission = false;
    j.options = (j.options || []).filter((o) => {
      if (o.type !== SUB && o.type !== GROUP) return true;
      const sr = access.subRule(j.name, o.name);
      if (sr.enabled === false) return false;
      if (sr.description) o.description = truncate(sr.description, 100);
      return true;
    });
    out.push(j);
  }
  return out;
}

async function registerCommands() {
  if (!client || !status.online) throw new UserError('The bot is offline, so commands could not be sent to Discord.');
  const body = commandJSON();
  if (config.guildId) {
    await client.application.commands.set(body, config.guildId);
    console.log(`[bot] registered ${body.length} commands in guild ${config.guildId}`);
  } else {
    await client.application.commands.set(body);
    console.log(`[bot] registered ${body.length} global commands (can take up to an hour — set GUILD_ID for instant updates)`);
  }
  return body.length;
}

async function handleError(i, err) {
  const userFacing = err instanceof UserError;
  if (!userFacing) console.error('[bot] interaction error', err);
  if (i.isAutocomplete()) return;
  const content = userFacing ? `❌ ${err.message}` : '⚠️ Something went wrong. Staff can check the server logs.';
  try {
    if (i.deferred && !i.replied && !i.isMessageComponent()) await i.editReply({ content });
    else if (i.deferred && i.isMessageComponent()) await i.followUp({ content, flags: EPH });
    else if (i.replied) await i.followUp({ content, flags: EPH });
    else await i.reply({ content, flags: EPH });
  } catch {}
}

async function onInteraction(i) {
  try {
    if (i.inGuild() && i.member && !i.isAutocomplete()) sectsync.syncMember(i.member);
    if (i.isAutocomplete()) {
      const c = commands.get(i.commandName);
      if (c?.autocomplete) await c.autocomplete(i);
      else await i.respond([]);
      return;
    }
    if (i.isChatInputCommand()) {
      const c = commands.get(i.commandName);
      if (!c) return;
      if (!i.inGuild()) throw new UserError('Please use the bot inside the server.');
      const why = access.check(i.member, i.channelId, i.commandName, i.options.getSubcommand(false));
      if (why) throw new UserError(why);
      await c.execute(i);
      store.markDirty();
      return;
    }
    if (i.isButton() || i.isAnySelectMenu()) {
      const h = components[i.customId.split(':')[0]];
      if (h) await h(i);
      store.markDirty();
      return;
    }
    if (i.isModalSubmit()) {
      const h = modals[i.customId.split(':')[0]];
      if (h) await h(i);
      store.markDirty();
    }
  } catch (err) {
    await handleError(i, err);
  }
}

function wire() {
  client.once(Events.ClientReady, async (c) => {
    Object.assign(status, { online: true, tag: c.user.tag, guilds: c.guilds.cache.size, startedAt: new Date().toISOString() });
    console.log(`[bot] logged in as ${c.user.tag}`);
    if (status.membersIntent) {
      try {
        let n = 0;
        for (const g of c.guilds.cache.values()) for (const m of (await g.members.fetch()).values()) n += sectsync.syncMember(m).length;
        if (n) store.markDirty();
        console.log(`[sects] startup sync: ${n} sect change(s)`);
      } catch (e) {
        console.warn('[sects] startup sync failed', e.message);
      }
    }
    require('../world/runner').setDeliver(require('./worlddeliver').makeDeliver(client));
    try {
      await registerCommands();
    } catch (e) {
      status.error = `Command registration failed: ${e.message}`;
      console.error('[bot]', status.error);
    }
  });
  client.on(Events.InteractionCreate, onInteraction);
  client.on(Events.GuildMemberUpdate, (oldM, newM) => {
    try {
      if (sectsync.syncMember(newM).length) store.markDirty();
    } catch (e) {
      console.error('[sects] sync failed', e);
    }
  });
  client.on(Events.MessageCreate, (m) => allocation.onMessage(m).catch((e) => console.error('[bot] allocation', e)));
  client.on(Events.ShardDisconnect, () => (status.online = false));
  client.on(Events.ShardResume, () => (status.online = true));
  client.on(Events.Error, (e) => console.error('[bot] client error', e));
}

async function login({ messageContent, members }) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (messageContent) intents.push(GatewayIntentBits.MessageContent);
  if (members) intents.push(GatewayIntentBits.GuildMembers);
  client = new Client({ intents });
  status.messageContent = !!messageContent;
  status.membersIntent = !!members;
  wire();
  await client.login(config.token);
}

async function start() {
  if (!config.token) {
    status.error = 'DISCORD_TOKEN is not set — the dashboard works, but the bot is offline.';
    console.warn('[bot]', status.error);
    return;
  }
  // Try with every optional privileged intent, then fall back if the developer portal hasn't enabled them.
  const attempts = [
    { messageContent: config.messageContent, members: true },
    { messageContent: config.messageContent, members: false },
    { messageContent: false, members: true },
    { messageContent: false, members: false },
  ].filter((a, i, list) => list.findIndex((b) => b.messageContent === a.messageContent && b.members === a.members) === i);
  let lastErr;
  for (const a of attempts) {
    try {
      await login(a);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      try { client.destroy(); } catch {}
      if (!/intent/i.test(String(e.message))) break;
    }
  }
  if (lastErr) {
    status.error = lastErr.message;
    throw lastErr;
  }
  const missing = [];
  if (config.messageContent && !status.messageContent) missing.push('Message Content (the "Type in chat" stat mode)');
  if (!status.membersIntent) missing.push('Server Members (instant sect sync when roles change — sects still sync whenever the player uses the bot)');
  if (missing.length) {
    status.error = `Privileged intents off in the Discord developer portal: ${missing.join('; ')}.`;
    console.warn('[bot]', status.error);
  }

  // Mirror the changelog to a Discord channel if one is configured.
  store.on('log', (entry) => {
    const ch = store.state.settings.channels.log;
    if (!ch || !status.online) return;
    const e = new EmbedBuilder()
      .setColor(entry.source === 'dashboard' ? '#2980b9' : '#7f8c8d')
      .setDescription(truncate(`**${entry.action}** — ${entry.details}`, 4000))
      .setFooter({ text: `${entry.actor} · ${entry.source}` })
      .setTimestamp(new Date(entry.at));
    sendToChannel(client, ch, { embeds: [e] });
  });
}

function getDiscordInfo() {
  if (!client || !status.online) return { status, guilds: [] };
  const guilds = client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    channels: g.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).map((c) => ({ id: c.id, name: c.name, parentId: c.parentId || '' })).sort((a, b) => a.name.localeCompare(b.name)),
    categories: g.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).map((c) => ({ id: c.id, name: c.name, position: c.position })).sort((a, b) => a.position - b.position),
    roles: g.roles.cache.filter((r) => r.id !== g.id && !r.managed).map((r) => ({ id: r.id, name: r.name, position: r.position, color: r.hexColor })).sort((a, b) => b.position - a.position),
    members: g.members.cache.filter((m) => !m.user.bot).map((m) => ({ id: m.id, name: m.displayName })),
  }));
  return { status, guilds, botUser: client.user ? { name: client.user.username, avatar: client.user.displayAvatarURL({ size: 64 }) } : null };
}

/** Dashboard "Send test" for message templates. Mentions are shown but never ping. */
async function sendTest(channelId, payload) {
  const ok = await sendToChannel(client, channelId, { ...payload, allowedMentions: { parse: [] } });
  if (!ok) throw new UserError('Could not post in that channel (check the bot can see and write there).');
}

/** Dashboard: a character's sect was changed — update the member's sect roles. */
async function applySectRoles(userId, sectName) {
  if (!client || !status.online) return { ok: false, reason: 'bot offline' };
  return sectsync.applySectRoles(client, userId, sectName);
}

/** Dashboard: create a Discord category for each province that has none. */
async function createCategories(list) {
  if (!client || !status.online) throw new UserError('The bot is offline.');
  const g = config.guildId ? await client.guilds.fetch(config.guildId) : client.guilds.cache.first();
  if (!g) throw new UserError('The bot is not in a server.');
  const out = [];
  for (const x of list.slice(0, 40)) {
    const c = await g.channels.create({ name: x.name.slice(0, 100), type: ChannelType.GuildCategory });
    out.push({ key: x.key, id: c.id });
  }
  return out;
}

/** Dashboard: update (or post) a diplomacy proposal in Discord. */
async function postProposal(p) {
  if (!client || !status.online) return;
  return require('./commands/world').postProposal(client, p);
}

async function stop() {
  try {
    if (client) await client.destroy();
  } catch {}
}

module.exports = { start, stop, status, getDiscordInfo, commandJSON, catalog, registerCommands, sendTest, applySectRoles, createCategories, postProposal };
