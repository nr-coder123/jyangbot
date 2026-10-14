'use strict';
/** /compare, /item, /purify, /help */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const store = require('../../store');
const combat = require('../../engine/combat');
const { purify, TIER_NAMES } = require('../../engine/fengshui');
const { EPH, findItem, findCharacter, itemChoices, characterChoices } = require('../util');
const { itemEmbed } = require('../render');
const { fmt, truncate } = require('../../utils');

// ---------- /compare ----------
const compare = new SlashCommandBuilder()
  .setName('compare')
  .setDescription('Compare two characters: damage, clash and speed')
  .addStringOption((o) => o.setName('first').setDescription('First character').setRequired(true).setAutocomplete(true))
  .addStringOption((o) => o.setName('second').setDescription('Second character').setRequired(true).setAutocomplete(true));

function tierText(res, diff) {
  if (!res.row) return '—';
  const r = res.row;
  let t = `**${r.tier ? `${r.tier} ` : ''}${r.name}** *(${diff > 0 ? '+' : ''}${fmt(diff)})*\n${r.desc}`;
  if (res.capped) t += `\n-# Would be ${res.wanted.tier || ''} ${res.wanted.name}, but that needs +${res.wanted.reqRT} Realm Tier${res.wanted.reqRT > 1 ? 's' : ''} above the enemy.`;
  return truncate(t, 1024);
}

async function executeCompare(i) {
  const st = store.state;
  const a = findCharacter(i.options.getString('first'));
  const b = findCharacter(i.options.getString('second'));
  const r = combat.compare(st, a, b);
  const A = r.a.s;
  const B = r.b.s;
  const rtTxt = r.rt === 0 ? 'Same realm tier' : `${r.rt > 0 ? a.name : b.name} is ${Math.abs(r.rt)} realm tier${Math.abs(r.rt) > 1 ? 's' : ''} higher`;
  const statLine = (label, k) => `**${label}**: ${fmt(A[k])} vs ${fmt(B[k])}`;
  const e = new EmbedBuilder()
    .setTitle(`⚔️ ${a.name} vs ${b.name}`)
    .setColor('#b3261e')
    .setDescription([
      `**${a.name}** — ${r.a.realm} · **${b.name}** — ${r.b.realm} · ${rtTxt}`,
      statLine('💪 Strength', 'strength'), statLine('🛡️ Endurance', 'endurance'), statLine('💨 Mobility', 'mobility'), statLine('🌀 Qi', 'qi'),
      '-# Current effective stats (impurity and temporary effects included).',
    ].join('\n'))
    .addFields(
      { name: `🗡️ ${a.name} hits ${b.name} (STR ${fmt(A.strength)} − END ${fmt(B.endurance)})`, value: tierText(r.aHitsB, r.aHitsB.diff) },
      { name: `🗡️ ${b.name} hits ${a.name} (STR ${fmt(B.strength)} − END ${fmt(A.endurance)})`, value: tierText(r.bHitsA, r.bHitsA.diff) },
      { name: `💥 Clash (Strength vs Strength)${r.clash.winner ? ` — ${r.clash.winner.name} wins` : ''}`, value: tierText(r.clash, r.clash.diff) },
      { name: `💨 Speed (Mobility)${r.speed.faster ? ` — ${r.speed.faster.name} is faster` : ''}`, value: tierText(r.speed, r.speed.diff) },
    );
  const note = `${st.combat.damageNote || ''} ${st.combat.clashNote || ''}`.trim();
  if (note) e.setFooter({ text: truncate(note, 2048) });
  return i.reply({ embeds: [e] });
}

// ---------- /item ----------
const item = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Look up any item and read its description')
  .addStringOption((o) => o.setName('name').setDescription('Item').setRequired(true).setAutocomplete(true));
const executeItem = (i) => i.reply({ embeds: [itemEmbed(findItem(i.options.getString('name')))] });

// ---------- /purify ----------
const ELEMENTS = ['Wood', 'Fire', 'Earth', 'Metal', 'Water', 'None'];
const tiers = [{ name: 'T1 (Earthly)', value: 1 }, { name: 'T2 (Heavenly)', value: 2 }, { name: 'T3 (Immortal)', value: 3 }];
const purifyCmd = new SlashCommandBuilder()
  .setName('purify')
  .setDescription('Feng Shui calculator: does this purification work on this poison?')
  .addIntegerOption((o) => o.setName('poison_tier').setDescription('Poison tier').setRequired(true).addChoices(...tiers))
  .addStringOption((o) => o.setName('poison_element').setDescription('Poison affinity').setRequired(true).addChoices(...ELEMENTS.map((e) => ({ name: e, value: e }))))
  .addIntegerOption((o) => o.setName('purification_tier').setDescription('Purification tier').setRequired(true).addChoices(...tiers))
  .addStringOption((o) => o.setName('purification_element').setDescription('Purification affinity').setRequired(true).addChoices(...ELEMENTS.map((e) => ({ name: e, value: e }))));

async function executePurify(i) {
  const pt = i.options.getInteger('poison_tier');
  const pe = i.options.getString('poison_element');
  const ut = i.options.getInteger('purification_tier');
  const ue = i.options.getString('purification_element');
  const r = purify(pt, pe, ut, ue);
  const word = { removed: '✅ **removed**', halved: '➗ **halved**', unchanged: '❌ unchanged' };
  return i.reply({
    embeds: [new EmbedBuilder().setTitle('🌿 Purification').setColor('#2e8b57').setDescription([
      `**${pe}** poison ${TIER_NAMES[pt]} vs **${ue}** purification ${TIER_NAMES[ut]}`,
      ...r.notes,
      `Effective purification tier: **${r.effectiveTier ? `T${r.effectiveTier}` : 'none'}**`,
      `Numerical debuff: ${word[r.numerical]}`,
      `Gimmick: ${word[r.gimmick]}`,
    ].join('\n'))],
  });
}

// ---------- /help ----------
const help = new SlashCommandBuilder().setName('help').setDescription('How to use the bot');
async function executeHelp(i) {
  const s = store.state.settings;
  const e = new EmbedBuilder().setTitle('📜 How to play').setColor('#b3261e').setDescription([
    '**1. `/submit`** your character document. Staff review it.',
    '**2. `/menu`** — everything about your character lives here:',
    '　📜 **Sheet** · 📊 **Stats** (tap to spend points) · 🎒 **Inventory** (use pills, learn manuals, roll drops, shop) · ☯️ **Realm** (Realm Breakthrough) · ⚒️ **Craft**',
    '**3. `/progress`** your finished RPs and fights to earn points.',
    '',
    `**Trading:** \`/trade\` items or ${s.currencyName} with a player (ask for 0 to gift) · \`/market\` to sell to anyone`,
    '**Tools:** `/compare` two characters · `/item` to read any item · `/purify` Feng Shui calculator',
    '',
    `-# Rules: no stat above ${s.maxSingleStatPercent}% of your stat points (Qi not counted). "Stat points" only go into Strength/Endurance/Mobility; "flexible points" can also go into Qi.`,
  ].join('\n'));
  return i.reply({ embeds: [e], flags: EPH });
}

module.exports = {
  commands: [
    { data: compare, execute: executeCompare, autocomplete: characterChoices },
    { data: item, execute: executeItem, autocomplete: (i) => itemChoices(i) },
    { data: purifyCmd, execute: executePurify },
    { data: help, execute: executeHelp },
  ],
};
