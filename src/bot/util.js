'use strict';
const { MessageFlags } = require('discord.js');
const store = require('../store');
const chars = require('../engine/characters');
const templates = require('../engine/templates');
const access = require('./access');
const { UserError, norm, truncate, findByName } = require('../utils');

const EPH = MessageFlags.Ephemeral;

const isStaff = (i) => access.isStaff(i.member);

/** Throw unless the member may use `name` (and `sub`) according to the dashboard rules. */
function requireAccess(i, name, sub) {
  const why = access.check(i.member, i.channelId, name, sub);
  if (why) throw new UserError(why);
}

const actor = (i) => ({ id: i.user.id, name: i.user.username, source: 'discord' });

function requireChar(userId, other = false) {
  const c = chars.activeCharacterOf(store.state, userId);
  if (!c) throw new UserError(other ? "That player doesn't have an approved character." : "You don't have an approved character yet. Submit one with `/submit`.");
  return c;
}

function findItem(value) {
  const it = findByName(store.state.items, value);
  if (!it) throw new UserError(`Item "${value}" not found.`);
  return it;
}

function findCharacter(value) {
  const st = store.state;
  const q = norm(value);
  const c = st.characters.find((x) => x.id === value) || st.characters.find((x) => x.status === 'active' && norm(x.name) === q) || st.characters.find((x) => norm(x.name) === q);
  if (!c) throw new UserError(`Character "${value}" not found.`);
  return c;
}

function itemChoices(i, filter = () => true) {
  const q = norm(i.options.getFocused());
  const list = store.state.items
    .filter(filter)
    .filter((it) => !q || norm(it.name).includes(q))
    .slice(0, 25)
    .map((it) => ({ name: truncate(`${it.name} — ${it.rarity} ${it.type}`, 100), value: it.id }));
  return i.respond(list);
}

function inventoryChoices(i, userId, filter = () => true) {
  const c = chars.activeCharacterOf(store.state, userId);
  if (!c) return i.respond([]);
  return itemChoices(i, (it) => (c.inventory[it.id] || 0) > 0 && filter(it));
}

function characterChoices(i) {
  const q = norm(i.options.getFocused());
  return i.respond(store.state.characters.filter((c) => c.status === 'active' && (!q || norm(c.name).includes(q))).slice(0, 25).map((c) => ({ name: truncate(c.name, 100), value: c.id })));
}

function listChoices(i, values) {
  const q = norm(i.options.getFocused());
  return i.respond(values.filter((v) => !q || norm(v).includes(q)).slice(0, 25).map((v) => ({ name: truncate(v, 100), value: truncate(v, 100) })));
}

/** Build a message from a dashboard template. Mentions in the text only ping the given user ids. */
function message(key, vars, { color, ping = [] } = {}) {
  const m = templates.render(store.state, key, vars, { color });
  return { ...m, allowedMentions: { users: ping.filter(Boolean), roles: [] } };
}

async function sendToChannel(client, channelId, payload) {
  if (!channelId) return null;
  try {
    const ch = await client.channels.fetch(channelId);
    return ch && ch.isTextBased() ? await ch.send(payload) : null;
  } catch (e) {
    console.warn('[bot] could not send to channel', channelId, e.message);
    return null;
  }
}

/**
 * Record a pill being consumed: changelog entry (with the channel it happened in) and, if set,
 * a post in the consumption-log channel so staff can check pills taken mid-fight.
 */
async function logConsumption(i, c, it, lines, embeds) {
  const where = i.channelId ? ` in <#${i.channelId}>` : '';
  store.log(actor(i), 'item.consume', `${c.name} (${i.user.username}) consumed ${it.name}${where} — ${lines.join('; ').replace(/\*/g, '')}`);
  const ch = store.state.settings.channels.consumption;
  if (!ch) return;
  const link = i.channelId ? `https://discord.com/channels/${i.guildId}/${i.channelId}` : '';
  await sendToChannel(i.client, ch, {
    content: `💊 <@${c.ownerId}> (**${c.name}**) consumed **${it.name}**${where}${link ? ` · [jump](${link})` : ''} · <t:${Math.floor(Date.now() / 1000)}:f>`,
    embeds,
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  logConsumption,
  EPH, isStaff, requireAccess, actor, requireChar, findItem, findCharacter, itemChoices, inventoryChoices, characterChoices, listChoices, message, sendToChannel,
};
