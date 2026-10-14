'use strict';
const { Client, GatewayIntentBits, Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const store = require('../store');
const allocation = require('./allocation');
const access = require('./access');
const status = require('./status');
const { EPH, sendToChannel } = require('./util');
const { UserError, truncate } = require('../utils');

const MODULES = ['menu', 'submit', 'progress', 'trade', 'tools', 'staff'];
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
    if (i.deferred && !i.replied) await i.editReply({ content });
    else if (i.replied) await i.followUp({ content, flags: EPH });
    else await i.reply({ content, flags: EPH });
  } catch {}
}

async function onInteraction(i) {
  try {
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
    try {
      await registerCommands();
    } catch (e) {
      status.error = `Command registration failed: ${e.message}`;
      console.error('[bot]', status.error);
    }
  });
  client.on(Events.InteractionCreate, onInteraction);
  client.on(Events.MessageCreate, (m) => allocation.onMessage(m).catch((e) => console.error('[bot] allocation', e)));
  client.on(Events.ShardDisconnect, () => (status.online = false));
  client.on(Events.ShardResume, () => (status.online = true));
  client.on(Events.Error, (e) => console.error('[bot] client error', e));
}

async function login(withMessageContent) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (withMessageContent) intents.push(GatewayIntentBits.MessageContent);
  client = new Client({ intents });
  status.messageContent = withMessageContent;
  wire();
  await client.login(config.token);
}

async function start() {
  if (!config.token) {
    status.error = 'DISCORD_TOKEN is not set — the dashboard works, but the bot is offline.';
    console.warn('[bot]', status.error);
    return;
  }
  try {
    await login(config.messageContent);
  } catch (e) {
    if (config.messageContent && /intent/i.test(String(e.message))) {
      console.warn('[bot] Message Content intent is off in the Discord developer portal. Starting without it — stat typing in chat is disabled, buttons still work.');
      try { client.destroy(); } catch {}
      await login(false);
      status.error = 'Message Content intent is off in the developer portal — "Type in chat" is disabled (buttons work).';
    } else {
      status.error = e.message;
      throw e;
    }
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
    channels: g.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
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

async function stop() {
  try {
    if (client) await client.destroy();
  } catch {}
}

module.exports = { start, stop, status, getDiscordInfo, commandJSON, catalog, registerCommands, sendTest };
