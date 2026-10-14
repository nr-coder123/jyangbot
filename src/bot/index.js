'use strict';
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const config = require('../config');
const store = require('../store');
const allocation = require('./allocation');
const { EPH, sendToChannel } = require('./util');
const { UserError, truncate } = require('../utils');

const modules = ['character', 'stats', 'give', 'realm', 'items', 'trade', 'title', 'admin'].map((m) => require(`./commands/${m}`));
const commands = new Map();
const buttons = {};
const modals = {};
for (const m of modules) {
  for (const c of m.commands || []) commands.set(c.data.name, c);
  Object.assign(buttons, m.buttons || {});
  Object.assign(modals, m.modals || {});
}

const status = { online: false, tag: null, error: null, messageContent: false, guilds: 0, startedAt: null };
let client = null;

function commandJSON() {
  return [...commands.values()].map((c) => c.data.toJSON());
}

async function registerCommands() {
  const body = commandJSON();
  if (config.guildId) {
    await client.application.commands.set(body, config.guildId);
    console.log(`[bot] registered ${body.length} commands in guild ${config.guildId}`);
  } else {
    await client.application.commands.set(body);
    console.log(`[bot] registered ${body.length} global commands (can take up to an hour to appear — set GUILD_ID for instant updates)`);
  }
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
      await c.execute(i);
      store.markDirty();
      return;
    }
    if (i.isButton()) {
      const h = buttons[i.customId.split(':')[0]];
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
    status.online = true;
    status.tag = c.user.tag;
    status.guilds = c.guilds.cache.size;
    status.startedAt = new Date().toISOString();
    status.error = null;
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
  client.botState = status;
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
      console.warn('[bot] Message Content intent is not enabled in the Discord developer portal. Starting without it — "/stats allocate" chat typing is disabled, "/stats add" still works.');
      try { client.destroy(); } catch {}
      await login(false);
      status.error = 'Message Content intent disabled in the developer portal — chat stat typing is off.';
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
    roles: g.roles.cache.filter((r) => r.id !== g.id && !r.managed).map((r) => ({ id: r.id, name: r.name, position: r.position })).sort((a, b) => b.position - a.position),
  }));
  return { status, guilds };
}

async function stop() {
  try {
    if (client) await client.destroy();
  } catch {}
}

module.exports = { start, stop, status, getDiscordInfo, commandJSON };
