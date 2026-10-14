'use strict';
/**
 * Message templates. Every announcement the bot posts is a Discohook-compatible message
 * ({ content, embeds:[...] }) that can be edited in the dashboard → Messages.
 * Placeholders like {player} are replaced when the message is sent.
 */
const { clone, truncate } = require('../utils');

const E = (o) => ({ embeds: [o.embed], content: o.content || '' });

const DEFS = {
  progressionReport: {
    label: 'Progression Report (/give, progress rewards)',
    placeholders: ['player', 'character', 'summary', 'details', 'staff', 'reason'],
    default: E({ content: '{player}', embed: { color: 0xd9a441, description: '## Progression Report\n{summary} to {player}\n{details}\n## Approved by\n{staff}', footer: { text: '{reason}' } } }),
  },
  deductionReport: {
    label: 'Deduction Report (/take)',
    placeholders: ['player', 'character', 'summary', 'details', 'staff', 'reason'],
    default: E({ content: '{player}', embed: { color: 0x8b1e1e, description: '## Deduction Report\n{summary} from {player}\n{details}\n## Issued by\n{staff}', footer: { text: '{reason}' } } }),
  },
  applicationPost: {
    label: 'New application (posted in the submissions channel)',
    placeholders: ['player', 'character', 'sect', 'document', 'id'],
    default: E({ embed: { color: 0xd4a017, title: '📜 Character Application — {character}', description: '**Player:** {player}\n**Sect:** {sect}\n**Document:** {document}', footer: { text: 'Application {id}' } } }),
  },
  applicationApproved: {
    label: 'Character approved',
    placeholders: ['player', 'character', 'staff', 'points', 'roles'],
    default: E({ content: '{player}', embed: { color: 0x3aa55d, title: '✅ {character} has been approved!', description: 'Approved by {staff}.\nYou have **{points}** starting points to spend anywhere (Qi included).\nType **/menu** and press **📊 Stats** to build your sheet.\n{roles}' } }),
  },
  applicationRejected: {
    label: 'Character rejected',
    placeholders: ['player', 'character', 'staff', 'reason'],
    default: E({ content: '{player}', embed: { color: 0xc0392b, title: '❌ Application not approved', description: 'Your application for **{character}** was not approved by {staff}.\n{reason}' } }),
  },
  progressPost: {
    label: 'Progress submission (posted in the progress channel)',
    placeholders: ['player', 'character', 'link', 'summary', 'breakthrough', 'id'],
    default: E({ embed: { color: 0xd4a017, title: '⚔️ Progress — {character}', description: '**Player:** {player}\n**Link:** {link}\n{breakthrough}\n{summary}', footer: { text: 'Submission {id}' } } }),
  },
  breakthroughSuccess: {
    label: 'Realm Breakthrough — success',
    placeholders: ['player', 'character', 'from', 'realm', 'chance', 'roll'],
    default: E({ content: '{player}', embed: { color: 0xf1c40f, title: '🌟 {character} broke through to {realm}!', description: 'From **{from}** to **{realm}**.\nChance: **{chance}%** · Rolled **{roll}**' } }),
  },
  breakthroughFail: {
    label: 'Realm Breakthrough — failure',
    placeholders: ['player', 'character', 'from', 'realm', 'chance', 'roll'],
    default: E({ embed: { color: 0x7f8c8d, title: '💢 {character} failed to reach {realm}', description: 'Chance: **{chance}%** · Rolled **{roll}**\nPill bonuses were spent. Gather yourself and try again.' } }),
  },
  rollResult: {
    label: 'Drop roll result',
    placeholders: ['player', 'character', 'item', 'rarity', 'emoji', 'description'],
    default: E({ embed: { title: '🎲 {character} found {emoji} {item}!', description: '**Rarity:** {rarity}\n{description}' } }),
  },
  craftSuccess: {
    label: 'Crafting — success',
    placeholders: ['player', 'character', 'recipe', 'items'],
    default: E({ embed: { color: 0x2e8b57, title: '⚒️ {character} crafted {recipe}!', description: 'Obtained: {items}' } }),
  },
  craftFail: {
    label: 'Crafting — failure',
    placeholders: ['player', 'character', 'recipe', 'items'],
    default: E({ embed: { color: 0x7f8c8d, title: '💥 {character} failed to craft {recipe}', description: 'The materials were lost.' } }),
  },
};

function get(state, key) {
  return clone(state.templates?.[key] || DEFS[key]?.default || { content: '', embeds: [] });
}

function fill(str, vars) {
  return String(str ?? '').replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? '') : m));
}

/** Render a template into a Discord message payload ({ content?, embeds }). Empty parts are dropped. */
function render(state, key, vars = {}, { color } = {}) {
  const t = get(state, key);
  const tidy = (s) => s.replace(/\n{3,}/g, '\n\n').trim();
  const embeds = (t.embeds || []).slice(0, 10).map((e) => {
    const o = {};
    if (e.title) o.title = truncate(fill(e.title, vars), 256);
    if (e.url) o.url = fill(e.url, vars);
    if (e.description) o.description = truncate(tidy(fill(e.description, vars)), 4096);
    const col = e.color ?? color;
    if (col !== undefined && col !== null && col !== '') o.color = typeof col === 'string' ? parseInt(col.replace('#', ''), 16) || 0 : col;
    if (e.author?.name) o.author = { name: truncate(fill(e.author.name, vars), 256), ...(e.author.icon_url ? { icon_url: fill(e.author.icon_url, vars) } : {}), ...(e.author.url ? { url: fill(e.author.url, vars) } : {}) };
    if (e.footer?.text) {
      const text = tidy(fill(e.footer.text, vars));
      if (text) o.footer = { text: truncate(text, 2048), ...(e.footer.icon_url ? { icon_url: fill(e.footer.icon_url, vars) } : {}) };
    }
    if (e.thumbnail?.url) o.thumbnail = { url: fill(e.thumbnail.url, vars) };
    if (e.image?.url) o.image = { url: fill(e.image.url, vars) };
    if (e.timestamp) o.timestamp = Number.isNaN(Date.parse(e.timestamp)) ? new Date().toISOString() : e.timestamp;
    const fields = (e.fields || []).map((f) => ({ name: truncate(fill(f.name, vars), 256), value: truncate(tidy(fill(f.value, vars)), 1024), inline: !!f.inline })).filter((f) => f.name.trim() && f.value.trim());
    if (fields.length) o.fields = fields.slice(0, 25);
    return o;
  }).filter((o) => o.title || o.description || o.fields || o.image || o.author);
  const content = tidy(fill(t.content || '', vars));
  return { content: content || undefined, embeds };
}

/** Accept Discohook JSON ({messages:[{data}]}), a single message ({content, embeds}) or a bare embed. */
function normalizeImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a JSON object.');
  if (Array.isArray(obj.messages)) obj = obj.messages[0]?.data || {};
  if (!obj.embeds && (obj.title || obj.description || obj.fields)) obj = { embeds: [obj] };
  return { content: typeof obj.content === 'string' ? obj.content : '', embeds: Array.isArray(obj.embeds) ? obj.embeds.slice(0, 10) : [] };
}

module.exports = { DEFS, get, render, fill, normalizeImport };
