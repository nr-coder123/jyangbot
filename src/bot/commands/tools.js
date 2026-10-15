'use strict';
/** /consume, /equip, /compare, /item, /purify, /help */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const store = require('../../store');
const chars = require('../../engine/characters');
const weapons = require('../../engine/weapons');
const ui = require('../../engine/ui');
const { purify, TIER_NAMES } = require('../../engine/fengshui');
const { EPH, actor, requireChar, findItem, itemChoices, inventoryChoices } = require('../util');
const panels = require('../panels');

// ---------- /consume ----------
const consume = new SlashCommandBuilder()
  .setName('consume')
  .setDescription('Consume one of your pills / elixirs')
  .addStringOption((o) => o.setName('pill').setDescription('Pill or elixir from your inventory').setRequired(true).setAutocomplete(true));

async function executeConsume(i) {
  const st = store.state;
  const c = requireChar(i.user.id);
  const it = findItem(i.options.getString('pill'));
  const r = chars.consumePill(st, c, it);
  store.log(actor(i), 'item.use', `${c.name} consumed ${it.name}: ${r.lines.join('; ').replace(/\*/g, '')}`);
  const out = panels.consumeResult(c, it, [...r.lines, ...(r.result.errors || []).map((e) => `${ui.emoji(st, 'warning')} ${e}`)]);
  return i.reply({ ...out, allowedMentions: { parse: [] } });
}

// ---------- /equip ----------
const equip = new SlashCommandBuilder()
  .setName('equip')
  .setDescription('Choose your main weapon')
  .addStringOption((o) => o.setName('weapon').setDescription('Weapon from your inventory').setRequired(true).setAutocomplete(true));

async function executeEquip(i) {
  const st = store.state;
  const c = requireChar(i.user.id);
  const it = findItem(i.options.getString('weapon'));
  weapons.equip(st, c, it);
  store.log(actor(i), 'item.equip', `${c.name} equipped ${it.name}`);
  const grade = it.weapon?.grade && it.weapon.grade !== 'Default' ? ` (${it.weapon.grade})` : '';
  return i.reply({ content: `${ui.emoji(st, 'weapon')} **${c.name}** now wields **${it.name}**${grade}.`, allowedMentions: { parse: [] } });
}

// ---------- /compare ----------
const compare = new SlashCommandBuilder()
  .setName('compare')
  .setDescription("Compare two players' characters: damage, clash and speed")
  .addUserOption((o) => o.setName('player').setDescription('Player to compare').setRequired(true))
  .addUserOption((o) => o.setName('against').setDescription('Compare against this player (default: you)'));

async function executeCompare(i) {
  const u1 = i.options.getUser('player');
  const u2 = i.options.getUser('against') || i.user;
  const a = requireChar(u2.id, u2.id !== i.user.id);
  const b = requireChar(u1.id, u1.id !== i.user.id);
  if (a.id === b.id) return i.reply({ content: 'Pick two different players.', flags: EPH });
  return i.reply({ ...panels.compare(a, b), allowedMentions: { parse: [] } });
}

// ---------- /item ----------
const item = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Look up any item and read its description')
  .addStringOption((o) => o.setName('name').setDescription('Item').setRequired(true).setAutocomplete(true));
const executeItem = (i) => i.reply({ ...panels.itemInfo(findItem(i.options.getString('name'))), allowedMentions: { parse: [] } });

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
const help = new SlashCommandBuilder().setName('help').setDescription('How to play');
async function executeHelp(i) {
  const s = store.state.settings;
  const e = new EmbedBuilder().setTitle('📜 How to play').setColor('#b3261e').setDescription([
    '**1. `/submit`** your character document. Staff review it.',
    '**2. `/menu`** — everything about your character lives here:',
    '　**Sheet** · **Stats** (tap to spend points) · **Inventory** (consume, learn, equip, sell, roll drops, crafting) · **Market** · **Realm** (Realm Breakthrough)',
    '**3. `/progress`** your finished RPs and fights to earn points.',
    '',
    '**Quick commands:** `/consume` a pill · `/equip` a weapon · `/market` to buy and sell',
    `**Trading:** \`/trade\` items or ${s.currencyName} with a player (ask for nothing to make it a gift)`,
    '**Tools:** `/compare @player` · `/item` to read any item · `/purify` Feng Shui calculator',
    '',
    `-# Rules: no stat above ${s.maxSingleStatPercent}% of your stat points (Qi not counted). "Stat points" only go into Strength/Endurance/Mobility; "flexible points" can also go into Qi.`,
  ].join('\n'));
  return i.reply({ embeds: [e], flags: EPH });
}

module.exports = {
  commands: [
    { data: consume, execute: executeConsume, autocomplete: (i) => inventoryChoices(i, i.user.id, (it) => it.type === 'pill') },
    {
      data: equip,
      execute: executeEquip,
      autocomplete: (i) => {
        const dw = store.state.settings.defaultWeaponId;
        return inventoryChoices(i, i.user.id, (it) => it.type === 'weapon' || it.id === dw);
      },
    },
    { data: compare, execute: executeCompare },
    { data: item, execute: executeItem, autocomplete: (i) => itemChoices(i) },
    { data: purifyCmd, execute: executePurify },
    { data: help, execute: executeHelp },
  ],
};
