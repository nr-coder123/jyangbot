'use strict';
/** Staff tools: /give, /take, /impurity, /title, /admin. Who can use them is set in the dashboard → Commands. */
const { SlashCommandBuilder } = require('discord.js');
const store = require('../../store');
const config = require('../../config');
const stats = require('../../engine/stats');
const chars = require('../../engine/characters');
const effects = require('../../engine/effects');
const economy = require('../../engine/economy');
const { grant, take } = require('../../engine/grants');
const { EPH, actor, requireChar, findItem, itemChoices, message } = require('../util');
const { UserError, fmt } = require('../../utils');

// ---------- /give and /take ----------
const AMOUNT_TYPES = [
  ['all', 'Stat points for Strength / Endurance / Mobility (not Qi)'],
  ['allqi', 'Flexible points usable in any stat, including Qi'],
  ['qi', 'Qi directly — a Breakthrough (resets Impurity)'],
  ['nyang', 'Nyang'],
  ['rolls', 'Drop rolls'],
  ['qibars', 'Bonus Qi Bars (0.5 allowed)'],
];
const TAKE_AMOUNT_TYPES = [
  ['all', 'Unspent stat points (Strength / Endurance / Mobility)'],
  ['allqi', 'Unspent flexible points'],
  ['nyang', 'Nyang'],
  ['rolls', 'Drop rolls'],
  ['qibars', 'Bonus Qi Bars'],
];

function withAmount(s, verb) {
  return s.addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
    .addNumberOption((o) => o.setName('amount').setDescription(`How much to ${verb}`).setRequired(true).setMinValue(0.5))
    .addStringOption((o) => o.setName('reason').setDescription('Reason (shown on the report)'));
}

const give = new SlashCommandBuilder().setName('give').setDescription('Reward a player (points, Qi, Nyang, rolls, Qi Bars, items)');
for (const [name, desc] of AMOUNT_TYPES) give.addSubcommand((s) => withAmount(s.setName(name).setDescription(desc), 'give'));
give.addSubcommand((s) => s.setName('item').setDescription('Give an item')
  .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
  .addStringOption((o) => o.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true))
  .addIntegerOption((o) => o.setName('quantity').setDescription('How many (default 1)').setMinValue(1))
  .addStringOption((o) => o.setName('reason').setDescription('Reason (shown on the report)')));

const takeCmd = new SlashCommandBuilder().setName('take').setDescription("Remove points, stats, Nyang, rolls, Qi Bars or items from a player");
for (const [name, desc] of TAKE_AMOUNT_TYPES) takeCmd.addSubcommand((s) => withAmount(s.setName(name).setDescription(desc), 'take'));
takeCmd.addSubcommand((s) => s.setName('stat').setDescription('Lower a stat (optionally refund the points so they can be re-spent)')
  .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
  .addStringOption((o) => o.setName('stat').setDescription('Which stat').setRequired(true).addChoices(...stats.ALL.map((k) => ({ name: stats.LABEL[k], value: k }))))
  .addNumberOption((o) => o.setName('amount').setDescription('How much to remove').setRequired(true).setMinValue(0.5))
  .addBooleanOption((o) => o.setName('refund').setDescription('Give the points back as unspent points (respec)'))
  .addStringOption((o) => o.setName('reason').setDescription('Reason (shown on the report)')));
takeCmd.addSubcommand((s) => s.setName('item').setDescription('Take an item away')
  .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
  .addStringOption((o) => o.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true))
  .addIntegerOption((o) => o.setName('quantity').setDescription('How many (default 1)').setMinValue(1))
  .addStringOption((o) => o.setName('reason').setDescription('Reason (shown on the report)')));

async function executeGiveTake(i) {
  const isGive = i.commandName === 'give';
  const sub = i.options.getSubcommand();
  const user = i.options.getUser('player');
  const c = requireChar(user.id, true);
  const reason = i.options.getString('reason') || '';
  let res;
  if (sub === 'item') {
    const it = findItem(i.options.getString('item'));
    const q = i.options.getInteger('quantity') || 1;
    if (isGive) economy.addItem(c, it.id, q);
    else economy.removeItem(store.state, c, it.id, q);
    res = { summary: `${isGive ? '+' : '-'}${q}× ${it.name}`, lines: [] };
  } else if (isGive) {
    res = grant(store.state, c, sub, i.options.getNumber('amount'));
  } else {
    res = take(store.state, c, sub, i.options.getNumber('amount'), { stat: i.options.getString('stat'), refund: !!i.options.getBoolean('refund') });
  }
  store.log(actor(i), `${i.commandName}.${sub}`, `${c.name}: ${res.summary}${reason ? ` — ${reason}` : ''}`);
  return i.reply(message(isGive ? 'progressionReport' : 'deductionReport', {
    player: `<@${user.id}>`, character: c.name, summary: res.summary, details: res.lines.join('\n'), staff: `<@${i.user.id}>`, reason,
  }, { ping: [user.id] }));
}

async function autocompleteGiveTake(i) {
  if (i.commandName === 'take') {
    const user = i.options.get('player')?.value;
    const c = user && chars.activeCharacterOf(store.state, user);
    if (c) return itemChoices(i, (it) => (c.inventory[it.id] || 0) > 0);
  }
  return itemChoices(i);
}

// ---------- /impurity ----------
const impurity = new SlashCommandBuilder()
  .setName('impurity')
  .setDescription("Change a character's Impurity")
  .addSubcommand((s) => s.setName('add').setDescription('Add impurity (pills, poisons...)')
    .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
    .addNumberOption((o) => o.setName('amount').setDescription('Impurity to add').setRequired(true).setMinValue(0))
    .addBooleanOption((o) => o.setName('poison').setDescription('From a poison? (poisons never burst meridians unless allowed)'))
    .addBooleanOption((o) => o.setName('can_burst').setDescription('This poison explicitly allows the 100-impurity burst'))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove impurity')
    .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
    .addNumberOption((o) => o.setName('amount').setDescription('Impurity to remove').setRequired(true).setMinValue(0)))
  .addSubcommand((s) => s.setName('reset').setDescription('Reset impurity to 0').addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true)));

async function executeImpurity(i) {
  const st = store.state;
  const sub = i.options.getSubcommand();
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
  return i.reply({
    content: [`<@${user.id}> **${c.name}** impurity +${fmt(amount)} → **${fmt(c.impurity)}**${poison ? ' *(poison)*' : ''}`,
      r.burst ? `💥 **Meridians burst!** Stats and Qi permanently reduced by ${st.settings.impurity.burstPercent}%.` : '',
      r.prevented ? '🛡️ A cultivation effect prevented the meridian burst.' : '',
      ...sh.drawbacks, ...sh.notes].filter(Boolean).join('\n'),
    allowedMentions: { users: [user.id] },
  });
}

// ---------- /title ----------
const title = new SlashCommandBuilder()
  .setName('title')
  .setDescription("Set a character's title exactly as typed")
  .addUserOption((o) => o.setName('player').setDescription('Player').setRequired(true))
  .addStringOption((o) => o.setName('title').setDescription('e.g. Rising Dragon, Mount Hua\'s Rising Dragon — type "none" to remove').setRequired(true).setMaxLength(120))
  .addStringOption((o) => o.setName('reason').setDescription('Why (saved in the changelog)'));

async function executeTitle(i) {
  const st = store.state;
  const user = i.options.getUser('player');
  const c = requireChar(user.id, true);
  const before = c.title || '';
  const text = i.options.getString('title').trim();
  c.title = text.toLowerCase() === 'none' ? '' : text;
  store.log(actor(i), 'title.set', `${c.name}: "${before}" → "${c.title}"${i.options.getString('reason') ? ` — ${i.options.getString('reason')}` : ''}`);
  return i.reply({
    content: c.title ? `🏯 <@${user.id}> **${c.name}** is now known as **${c.title}**!` : `🏯 **${c.name}**'s title was removed.`,
    allowedMentions: { users: [user.id] },
  });
}

// ---------- /admin ----------
const admin = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Backups, dashboard link, command refresh, world events and turns')
  .addSubcommand((s) => s.setName('backup').setDescription('Save everything and create a backup now').addStringOption((o) => o.setName('label').setDescription('Label for the backup')))
  .addSubcommand((s) => s.setName('dashboard').setDescription('Get the dashboard link'))
  .addSubcommand((s) => s.setName('sync').setDescription('Re-send the slash commands to Discord (after editing them in the dashboard)'))
  .addSubcommand((s) => s.setName('event').setDescription('Force a world event in a region (drought, flood, trade fair…)')
    .addStringOption((o) => o.setName('event').setDescription('Event').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('region').setDescription('Where').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('turns').setDescription('How many turns it lasts (default: the event\'s own duration)').setMinValue(1).setMaxValue(200)))
  .addSubcommand((s) => s.setName('turn').setDescription('Advance the world by hand')
    .addIntegerOption((o) => o.setName('count').setDescription('How many turns (default 1)').setMinValue(1).setMaxValue(20)));

async function executeAdmin(i) {
  const sub = i.options.getSubcommand();
  if (sub === 'backup') {
    await i.deferReply({ flags: EPH });
    const meta = await store.createBackup(i.options.getString('label') || `Backup by ${i.user.username}`, actor(i));
    return i.editReply(`💾 Saved and backed up: **${meta.label}** (\`${meta.id}\`). Restore it from the dashboard → Save & Backups.`);
  }
  if (sub === 'dashboard') return i.reply({ content: config.publicUrl ? `🖥️ Dashboard: ${config.publicUrl}` : '🖥️ The dashboard is at your Render service URL (set PUBLIC_URL to show it here).', flags: EPH });
  if (sub === 'event') {
    const W = require('../../world');
    const ae = W.events.startEvent(store.state, i.options.getString('event'), W.geo.marketOf(store.state, i.options.getString('region')), { forced: true, by: i.user.username, duration: i.options.getInteger('turns') || undefined });
    if (!ae) return i.reply({ content: 'A custom script cancelled that event.', flags: EPH });
    store.log(actor(i), 'world.event', `Forced: ${ae.text}`);
    require('../../world/runner').step();
    return i.reply({ content: `${ae.text}\n-# Ends on turn ${ae.endTurn} (now ${store.state.world.turn}).`, flags: EPH, allowedMentions: { parse: [] } });
  }
  if (sub === 'turn') {
    await i.deferReply({ flags: EPH });
    const out = await require('../../world/runner').advance(i.options.getInteger('count') || 1, actor(i));
    const last = out[out.length - 1];
    return i.editReply(`🗓️ Advanced ${out.length} turn(s) → **turn ${last.turn}** (${last.calendar}). Average prosperity ${last.avgProsperity}.`);
  }
  if (sub === 'sync') {
    await i.deferReply({ flags: EPH });
    await require('../index').registerCommands();
    return i.editReply('✅ Slash commands re-synced with Discord.');
  }
}

module.exports = {
  commands: [
    { data: give, execute: executeGiveTake, autocomplete: autocompleteGiveTake, staff: true },
    { data: takeCmd, execute: executeGiveTake, autocomplete: autocompleteGiveTake, staff: true },
    { data: impurity, execute: executeImpurity, staff: true },
    { data: title, execute: executeTitle, staff: true },
    {
      data: admin,
      execute: executeAdmin,
      staff: true,
      autocomplete: (i) => {
        const W = require('../../world');
        const st = store.state;
        const f = i.options.getFocused(true);
        const q = String(f.value || '').toLowerCase();
        if (f.name === 'event') return i.respond(st.world.events.filter((e) => !q || e.name.toLowerCase().includes(q)).slice(0, 25).map((e) => ({ name: `${e.emoji} ${e.name}`.slice(0, 100), value: e.id })));
        return i.respond(W.geo.marketKeys(st).map((k) => ({ k, n: W.geo.fullLabel(st, k) })).filter((x) => !q || x.n.toLowerCase().includes(q) || x.k.includes(q)).slice(0, 25).map((x) => ({ name: x.n.slice(0, 100), value: x.k })));
      },
    },
  ],
};
