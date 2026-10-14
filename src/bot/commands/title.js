'use strict';
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const store = require('../../store');
const chars = require('../../engine/characters');
const { EPH, requireStaff, actor, requireChar, listChoices } = require('../util');
const { UserError, norm } = require('../../utils');

const title = new SlashCommandBuilder()
  .setName('title')
  .setDescription('Martial titles (Prefix + Stem + Suffix)')
  .addSubcommand((s) => s.setName('list').setDescription('Show available prefixes, stems and suffixes'))
  .addSubcommand((s) =>
    s.setName('stem').setDescription('Pick your own Stem (only if you have none yet)')
      .addStringOption((o) => o.setName('stem').setDescription('Stem').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) =>
    s.setName('set').setDescription('[Staff] Set a character\'s title parts (type "none" to clear one)')
      .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
      .addStringOption((o) => o.setName('prefix').setDescription('Prefix (hardest to earn)').setAutocomplete(true))
      .addStringOption((o) => o.setName('stem').setDescription('Stem').setAutocomplete(true))
      .addStringOption((o) => o.setName('suffix').setDescription('Suffix').setAutocomplete(true)));

async function execute(i) {
  const st = store.state;
  const T = st.settings.titles;
  const sub = i.options.getSubcommand();
  if (sub === 'list') {
    const note = (w) => (T.notes?.[w] ? `${w}*` : w);
    return i.reply({
      embeds: [new EmbedBuilder().setTitle('🏯 Titles').setColor('#8e44ad').addFields(
        { name: 'Prefixes (highest feats only)', value: T.prefixes.join(', ') || '—' },
        { name: 'Stems (story / personality — often self-chosen)', value: `${T.stems.map(note).join(', ')}, (Custom)` },
        { name: 'Suffixes', value: `${T.suffixes.map(note).join(', ')}, (Custom)` },
        { name: 'Notes', value: Object.entries(T.notes || {}).map(([k, v]) => `**${k}**: ${v}`).join('\n') || '—' },
      ).setFooter({ text: "Without a prefix you're named after your sect — e.g. Mount Hua's Rising Dragon, or Rogue Silent Viper." })],
      flags: EPH,
    });
  }
  if (sub === 'stem') {
    const c = requireChar(i.user.id);
    if (c.titles.stem) throw new UserError(`You already have the stem **${c.titles.stem}**. Ask staff to change it.`);
    const v = i.options.getString('stem');
    const stem = T.stems.find((x) => norm(x) === norm(v));
    if (!stem) throw new UserError('Pick a stem from the list. Custom stems are given by staff.');
    c.titles.stem = stem;
    store.log(actor(i), 'title.stem', `${c.name} chose ${stem}`);
    return i.reply({ content: `🏯 **${c.name}** is now known as **${chars.titleString(st, c)}**.${T.notes?.[stem] ? `\n-# Note: ${stem} — ${T.notes[stem]}` : ''}` });
  }
  if (sub === 'set') {
    requireStaff(i);
    const user = i.options.getUser('player');
    const c = requireChar(user.id, true);
    const before = chars.titleString(st, c);
    for (const k of ['prefix', 'stem', 'suffix']) {
      const v = i.options.getString(k);
      if (v === null) continue;
      c.titles[k] = norm(v) === 'none' ? '' : v.trim();
    }
    store.log(actor(i), 'title.set', `${c.name}: ${before} → ${chars.titleString(st, c)}`);
    return i.reply({ content: `🏯 <@${user.id}> **${c.name}** is now **${chars.titleString(st, c)}**!` });
  }
}

async function autocomplete(i) {
  const T = store.state.settings.titles;
  const f = i.options.getFocused(true);
  const map = { prefix: T.prefixes, stem: T.stems, suffix: T.suffixes };
  return listChoices(i, [...(map[f.name] || []), ...(i.options.getSubcommand() === 'set' ? ['none'] : [])]);
}

module.exports = { commands: [{ data: title, execute, autocomplete }] };
