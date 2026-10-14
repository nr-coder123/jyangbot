'use strict';
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../store');
const chars = require('../engine/characters');
const { UserError, norm, truncate, findByName } = require('../utils');

const EPH = MessageFlags.Ephemeral;

function isStaff(i) {
  const m = i.member;
  if (!m) return false;
  const p = m.permissions;
  if (p && typeof p.has === 'function' && (p.has(PermissionFlagsBits.ManageGuild) || p.has(PermissionFlagsBits.Administrator))) return true;
  const roleIds = m.roles?.cache ? [...m.roles.cache.keys()] : Array.isArray(m.roles) ? m.roles : [];
  return (store.state.settings.staffRoleIds || []).some((r) => roleIds.includes(r));
}

function requireStaff(i) {
  if (!isStaff(i)) throw new UserError('Only staff can do that (Manage Server permission, or a staff role set in the dashboard).');
}

const actor = (i) => ({ id: i.user.id, name: i.user.username, source: 'discord' });

function requireChar(userId, other = false) {
  const c = chars.activeCharacterOf(store.state, userId);
  if (!c) throw new UserError(other ? "That player doesn't have an approved character." : "You don't have an approved character yet. Submit one with `/character submit`.");
  return c;
}

/** Character for an optional `player` option: someone else's (anyone may view) or your own. */
function charFor(i, opt = 'player') {
  const u = i.options.getUser(opt);
  return u && u.id !== i.user.id ? requireChar(u.id, true) : requireChar(i.user.id);
}

function findItem(value) {
  const it = findByName(store.state.items, value);
  if (!it) throw new UserError(`Item "${value}" not found.`);
  return it;
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

function listChoices(i, values) {
  const q = norm(i.options.getFocused());
  return i.respond(values.filter((v) => !q || norm(v).includes(q)).slice(0, 25).map((v) => ({ name: truncate(v, 100), value: truncate(v, 100) })));
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

module.exports = { EPH, isStaff, requireStaff, actor, requireChar, charFor, findItem, itemChoices, inventoryChoices, listChoices, sendToChannel };
