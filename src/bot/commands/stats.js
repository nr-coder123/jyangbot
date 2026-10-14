'use strict';
const { SlashCommandBuilder } = require('discord.js');
const store = require('../../store');
const stats = require('../../engine/stats');
const allocation = require('../allocation');
const { EPH, requireChar, charFor } = require('../util');
const { sheetEmbed } = require('../render');
const { UserError, fmt, norm } = require('../../utils');

const sheet = new SlashCommandBuilder()
  .setName('sheet')
  .setDescription('Show a stat sheet')
  .addUserOption((o) => o.setName('player').setDescription('Whose sheet (default: yours)'))
  .addStringOption((o) => o.setName('character').setDescription('A specific character by name').setAutocomplete(true));

const statsCmd = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Spend your stat points')
  .addSubcommand((s) => s.setName('allocate').setDescription('Open a 5-minute window: type "strength 5" etc. in chat'))
  .addSubcommand((s) =>
    s.setName('add').setDescription('Spend points directly (same rules as the chat window)')
      .addNumberOption((o) => o.setName('strength').setDescription('Points into Strength').setMinValue(0))
      .addNumberOption((o) => o.setName('endurance').setDescription('Points into Endurance').setMinValue(0))
      .addNumberOption((o) => o.setName('mobility').setDescription('Points into Mobility').setMinValue(0))
      .addNumberOption((o) => o.setName('qi').setDescription('Points into Qi (flexible points only)').setMinValue(0)))
  .addSubcommand((s) =>
    s.setName('points').setDescription('See how many points are left to spend')
      .addUserOption((o) => o.setName('player').setDescription('Whose points (default: yours)')));

async function executeSheet(i) {
  const name = i.options.getString('character');
  if (name) {
    const c = store.state.characters.find((x) => x.id === name || norm(x.name) === norm(name));
    if (!c) throw new UserError('Character not found.');
    return i.reply({ embeds: [sheetEmbed(c)] });
  }
  return i.reply({ embeds: [sheetEmbed(charFor(i))] });
}

async function autocompleteSheet(i) {
  const q = norm(i.options.getFocused());
  return i.respond(store.state.characters.filter((c) => c.status === 'active' && norm(c.name).includes(q)).slice(0, 25).map((c) => ({ name: c.name, value: c.id })));
}

async function executeStats(i) {
  const st = store.state;
  const sub = i.options.getSubcommand();
  if (sub === 'points') {
    const c = charFor(i);
    return i.reply({ content: `**${c.name}**\n${allocation.remainingText(c)}`, flags: EPH });
  }
  const c = requireChar(i.user.id);
  if (sub === 'allocate') {
    if (c.pools.normal + c.pools.flex <= 0) throw new UserError('You have no points to spend right now.');
    if (!i.client.botState?.messageContent) {
      throw new UserError('The chat window needs the **Message Content** intent, which is off for this bot. Use `/stats add` instead (or ask staff to enable the intent).');
    }
    const w = allocation.open(i.channel, i.user.id, c);
    return i.reply({
      content: [
        `📝 **Stat window open for ${c.name}** — ${w.minutes} minutes (closes <t:${Math.floor(w.expiresAt / 1000)}:R>).`,
        'Type your stats in this channel, one or several per message:',
        '```\nstrength 5\nmobility 5\nendurance 5\nqi 5\n```',
        allocation.remainingText(c),
        '-# `points` = show remaining · `undo` = revert this window · `done` = close',
      ].join('\n'),
    });
  }
  if (sub === 'add') {
    const entries = stats.ALL.map((k) => ({ stat: k, amount: i.options.getNumber(k) || 0 })).filter((e) => e.amount > 0);
    if (!entries.length) throw new UserError('Fill in at least one stat.');
    const res = stats.applyAllocation(st, c, entries);
    store.log({ id: i.user.id, name: i.user.username, source: 'discord' }, 'stats.allocate', `${c.name}: ${res.map((r) => `${stats.LABEL[r.stat]} +${fmt(r.gained)} (${fmt(r.spent)} pts)`).join(', ')}`);
    const lines = res.map((r) => `• ${stats.LABEL[r.stat]} **+${fmt(r.gained)}**${r.softCapped ? ` *(soft cap: ${fmt(r.spent)} pts → ${fmt(r.gained)})*` : ''}${r.hardCapped ? ' *(hard cap reached)*' : ''}`);
    return i.reply({ content: `${lines.join('\n')}\n${allocation.remainingText(c)}` });
  }
}

module.exports = {
  commands: [
    { data: sheet, execute: executeSheet, autocomplete: autocompleteSheet },
    { data: statsCmd, execute: executeStats },
  ],
};
