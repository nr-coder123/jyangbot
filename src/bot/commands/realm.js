'use strict';
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const store = require('../../store');
const stats = require('../../engine/stats');
const chars = require('../../engine/characters');
const { purify, TIER_NAMES } = require('../../engine/fengshui');
const { EPH, requireStaff, actor, requireChar, charFor } = require('../util');
const { fmt } = require('../../utils');

// ---------- /realm ----------
const realm = new SlashCommandBuilder()
  .setName('realm')
  .setDescription('Realms and Realm Breakthroughs')
  .addSubcommand((s) => s.setName('list').setDescription('All realms, requirements, caps and chances'))
  .addSubcommand((s) => s.setName('info').setDescription('Your realm progress').addUserOption((o) => o.setName('player').setDescription('Whose progress')))
  .addSubcommand((s) => s.setName('chance').setDescription('Calculate your Realm Breakthrough chance (no attempt)'))
  .addSubcommand((s) => s.setName('breakthrough').setDescription('Attempt a Realm Breakthrough! Consume pills first to raise the chance.'));

function chanceText(ch) {
  return [
    `Base: **${fmt(ch.base)}%**`,
    ch.pills ? `Pills consumed: **+${fmt(ch.pills)}%**` : null,
    ch.scriptDelta ? `Cultivation effects: **${ch.scriptDelta > 0 ? '+' : ''}${fmt(ch.scriptDelta)}%**` : null,
    `**Total: ${fmt(ch.total)}%**`,
  ].filter(Boolean).join(' · ');
}

async function executeRealm(i) {
  const st = store.state;
  const sub = i.options.getSubcommand();
  if (sub === 'list') {
    const lines = st.realms.map((r, idx) => `**${idx + 1}. ${r.name}** — ${fmt(r.qiBars)} Qi Bars · needs ${fmt(r.reqStats)} stats / ${fmt(r.reqQi)} Qi · soft cap ${fmt(r.softCapStats ?? Infinity)}/${fmt(r.softCapQi ?? Infinity)} · hard cap ${fmt(r.hardCapStats ?? Infinity)}/${fmt(r.hardCapQi ?? Infinity)} · breakthrough ${fmt(r.breakthroughChance)}%`);
    return i.reply({ embeds: [new EmbedBuilder().setTitle('☯️ Realms').setColor('#6a4c93').setDescription(lines.join('\n')).setFooter({ text: 'Stats = Strength + Endurance + Mobility (Qi not counted). Past the soft cap stat gains are halved; Qi is not reduced.' })] });
  }
  if (sub === 'info') {
    const c = charFor(i);
    const r = stats.realmOf(st, c);
    const chk = stats.breakthroughCheck(st, c);
    const e = new EmbedBuilder().setTitle(`☯️ ${c.name} — ${r.name}`).setColor('#6a4c93').setDescription([
      `Stat total: **${fmt(stats.normalTotal(c))}** · Qi: **${fmt(c.stats.qi)}**`,
      stats.capSummary(st, c),
      ...stats.capLines(st, c),
      chk.next ? `\n**Next: ${chk.next.name}** — needs ${fmt(chk.next.reqStats)} stats & ${fmt(chk.next.reqQi)} Qi\n${chk.ok ? '✅ Requirements met — `/realm breakthrough`' : `❌ Missing: ${chk.reasons.join(', ')}`}` : '\nFinal realm.',
      `\n${chanceText(chars.breakthroughChance(st, c))}`,
    ].join('\n'));
    return i.reply({ embeds: [e] });
  }
  const c = requireChar(i.user.id);
  if (sub === 'chance') {
    const chk = stats.breakthroughCheck(st, c);
    return i.reply({ content: `**${c.name}** → ${chk.next ? chk.next.name : '—'}\n${chanceText(chars.breakthroughChance(st, c))}\n${chk.ok ? '✅ Requirements met.' : `❌ ${chk.reasons.join(', ')}`}`, flags: EPH });
  }
  if (sub === 'breakthrough') {
    const r = chars.attemptBreakthrough(st, c);
    store.log(actor(i), 'realm.breakthrough', `${c.name}: ${r.from} → ${r.to} ${r.success ? 'SUCCESS' : 'FAILED'} (rolled ${fmt(r.roll)} vs ${fmt(r.chance.total)}%)`);
    const e = new EmbedBuilder()
      .setColor(r.success ? '#f1c40f' : '#7f8c8d')
      .setTitle(r.success ? `🌟 ${c.name} broke through to ${r.to}!` : `💢 ${c.name} failed to break through to ${r.to}`)
      .setDescription([
        chanceText(r.chance),
        `Rolled **${fmt(r.roll)}** (needed under ${fmt(r.chance.total)}).`,
        r.success ? `New Qi Bars: **${fmt(stats.realmOf(st, c).qiBars)}** (+ bonuses). New caps — ${stats.capSummary(st, c)}` : 'Consumed pill bonuses are spent. Gather yourself and try again.',
        r.failImpurity ? `+${fmt(st.settings.breakthroughFailureImpurity)} Impurity from the backlash (now ${fmt(r.failImpurity.impurity)}).` : '',
      ].filter(Boolean).join('\n'));
    return i.reply({ embeds: [e] });
  }
}

// ---------- /impurity ----------
const impurity = new SlashCommandBuilder()
  .setName('impurity')
  .setDescription('Impurity / toxicity')
  .addSubcommand((s) => s.setName('check').setDescription('See impurity and its effects').addUserOption((o) => o.setName('player').setDescription('Whose impurity')))
  .addSubcommand((s) =>
    s.setName('add').setDescription('[Staff] Add impurity (pills, poisons...)')
      .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
      .addNumberOption((o) => o.setName('amount').setDescription('Impurity to add').setRequired(true).setMinValue(0))
      .addBooleanOption((o) => o.setName('poison').setDescription('From a poison? (poisons do not burst meridians)'))
      .addBooleanOption((o) => o.setName('can_burst').setDescription('Poison explicitly allows the 100-impurity burst'))
      .addStringOption((o) => o.setName('reason').setDescription('Reason')))
  .addSubcommand((s) =>
    s.setName('remove').setDescription('[Staff] Remove impurity')
      .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
      .addNumberOption((o) => o.setName('amount').setDescription('Impurity to remove').setRequired(true).setMinValue(0)))
  .addSubcommand((s) => s.setName('reset').setDescription('[Staff] Reset impurity to 0').addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true)));

async function executeImpurity(i) {
  const st = store.state;
  const sub = i.options.getSubcommand();
  const effects = require('../../engine/effects');
  if (sub === 'check') {
    const c = charFor(i);
    const sh = effects.compute(st, c);
    const th = st.settings.impurity;
    return i.reply({ content: [`**${c.name}** — Impurity **${fmt(c.impurity)}**`, ...sh.drawbacks, ...sh.notes, `-# ${th.noRegenAt}: no Qi regen in fights · ${th.debuffAt}: -${th.debuffPercent}% stats · ${th.burstAt}: meridians burst (-${th.burstPercent}% stats & Qi permanently). Resets monthly or when receiving Qi.`].join('\n') });
  }
  requireStaff(i);
  const user = i.options.getUser('player');
  const c = requireChar(user.id, true);
  if (sub === 'reset') {
    stats.resetImpurityOf(c);
    store.log(actor(i), 'impurity.reset', c.name);
    return i.reply({ content: `🧹 **${c.name}**'s impurity reset to 0.` });
  }
  const amount = i.options.getNumber('amount');
  if (sub === 'remove') {
    c.impurity = Math.max(0, c.impurity - amount);
    store.log(actor(i), 'impurity.remove', `${c.name}: -${amount}`);
    return i.reply({ content: `**${c.name}** impurity → **${fmt(c.impurity)}**` });
  }
  const poison = !!i.options.getBoolean('poison');
  const r = chars.addImpurity(st, c, amount, { poison, triggersBurst: !!i.options.getBoolean('can_burst') });
  store.log(actor(i), 'impurity.add', `${c.name}: +${amount}${poison ? ' (poison)' : ''}${i.options.getString('reason') ? ` — ${i.options.getString('reason')}` : ''}`);
  const sh = effects.compute(st, c);
  return i.reply({ content: [`<@${user.id}> **${c.name}** impurity +${fmt(amount)} → **${fmt(c.impurity)}**${poison ? ' *(poison)*' : ''}`, r.burst ? `💥 **Meridians burst!** Stats and Qi permanently reduced by ${st.settings.impurity.burstPercent}%.` : '', r.prevented ? '🛡️ A cultivation effect prevented the meridian burst.' : '', ...sh.drawbacks, ...sh.notes].filter(Boolean).join('\n') });
}

// ---------- /purify ----------
const ELEMENTS = ['Wood', 'Fire', 'Earth', 'Metal', 'Water', 'None'];
const purifyCmd = new SlashCommandBuilder()
  .setName('purify')
  .setDescription('Feng Shui calculator: does this purification work on this poison?')
  .addIntegerOption((o) => o.setName('poison_tier').setDescription('Poison tier').setRequired(true).addChoices({ name: 'T1 (Earthly)', value: 1 }, { name: 'T2 (Heavenly)', value: 2 }, { name: 'T3 (Immortal)', value: 3 }))
  .addStringOption((o) => o.setName('poison_element').setDescription('Poison affinity').setRequired(true).addChoices(...ELEMENTS.map((e) => ({ name: e, value: e }))))
  .addIntegerOption((o) => o.setName('purification_tier').setDescription('Purification tier').setRequired(true).addChoices({ name: 'T1 (Earthly)', value: 1 }, { name: 'T2 (Heavenly)', value: 2 }, { name: 'T3 (Immortal)', value: 3 }))
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

module.exports = {
  commands: [
    { data: realm, execute: executeRealm },
    { data: impurity, execute: executeImpurity },
    { data: purifyCmd, execute: executePurify },
  ],
};
