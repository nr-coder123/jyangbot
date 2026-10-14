'use strict';
/**
 * /menu — the one place players need. Opens their stat sheet with buttons:
 *   📜 Sheet · 📊 Stats (spend points) · 🎒 Inventory (use/learn/sell, roll, shop) · ☯️ Realm (breakthrough) · ⚒️ Craft
 *
 * Custom ids: m:<v|a|s>:<viewerId>:<charId>:<name>[:<arg>[:<arg2>]]   (v = view, a = action, s = select)
 *             mm:<modal>:<viewerId>:<charId>[:<arg>]
 * Only the person who opened the menu can press its buttons; only the owner can change the character.
 */
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const store = require('../../store');
const stats = require('../../engine/stats');
const effects = require('../../engine/effects');
const chars = require('../../engine/characters');
const economy = require('../../engine/economy');
const rolls = require('../../engine/rolls');
const crafting = require('../../engine/crafting');
const allocation = require('../allocation');
const botStatus = require('../status');
const { sheetEmbed, itemEmbed, inventoryEmbed, itemIcon } = require('../render');
const { EPH, actor, requireChar, requireAccess, message, sendToChannel } = require('../util');
const { UserError, fmt, truncate, clone } = require('../../utils');

const menu = new SlashCommandBuilder()
  .setName('menu')
  .setDescription('Your character: sheet, stats, inventory, shop, realm and crafting')
  .addUserOption((o) => o.setName('player').setDescription("Look at another player's character"))
  .addBooleanOption((o) => o.setName('public').setDescription('Show it in the channel instead of only to you'));

// ---------- helpers ----------
const cid = (kind, ctx, name, ...args) => ['m', kind, ctx.viewer, ctx.c.id, name, ...args].join(':').slice(0, 100);
const row = (...comps) => new ActionRowBuilder().addComponents(...comps.filter(Boolean));
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(!!disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const S = () => store.state.settings;
const undoStacks = new Map(); // userId -> [{ charId, snap, label }]

function pushUndo(userId, c, label) {
  const list = undoStacks.get(userId) || [];
  list.push({ charId: c.id, label, snap: clone({ stats: c.stats, pools: c.pools, impurity: c.impurity, burstApplied: c.burstApplied }) });
  if (list.length > 20) list.shift();
  undoStacks.set(userId, list);
}

function navRow(ctx, active) {
  const b = (view, label, emoji) => btn(cid('v', ctx, view), label, view === active ? ButtonStyle.Primary : ButtonStyle.Secondary, false, emoji);
  return row(b('sheet', 'Sheet', '📜'), b('stats', 'Stats', '📊'), b('inv', 'Inventory', '🎒'), b('realm', 'Realm', '☯️'), b('craft', 'Craft', '⚒️'));
}

// ---------- views ----------
const VIEWS = {};

VIEWS.sheet = (ctx) => {
  const st = store.state;
  const { c } = ctx;
  const components = [navRow(ctx, 'sheet')];
  if (ctx.isOwner && !c.titles.stem && st.settings.titles.stems.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(cid('s', ctx, 'stem')).setPlaceholder('🏯 Choose your title Stem (you can pick once)')
      .addOptions(st.settings.titles.stems.slice(0, 25).map((s) => ({ label: truncate(s, 100), value: truncate(s, 100), description: truncate(st.settings.titles.notes?.[s] || 'Fits your story or personality', 100) })))));
  }
  const mine = st.characters.filter((x) => x.ownerId === c.ownerId && x.status === 'active');
  if (ctx.isOwner && mine.length > 1) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(cid('s', ctx, 'switch')).setPlaceholder('🔁 Switch character')
      .addOptions(mine.slice(0, 25).map((x) => ({ label: truncate(x.name, 100), value: x.id, default: x.id === c.id })))));
  }
  return { embeds: [sheetEmbed(c)], components };
};

VIEWS.stats = (ctx) => {
  const st = store.state;
  const { c } = ctx;
  const sh = effects.compute(st, c);
  const line = (emoji, k) => `${emoji} **${stats.LABEL[k]}**  ${fmt(c.stats[k])}${Math.abs(sh.effStats[k] - c.stats[k]) > 1e-9 ? ` → **${fmt(sh.effStats[k])}**` : ''}`;
  const max = stats.maxPerStat(st, c);
  const has = c.pools.normal + c.pools.flex;
  const e = new EmbedBuilder()
    .setColor('#b3261e')
    .setTitle(`📊 ${c.name} — Stats`)
    .setDescription([
      line('💪', 'strength'), line('🛡️', 'endurance'), line('💨', 'mobility'), line('🌀', 'qi'),
      `Stat total: **${fmt(sh.normalTotal)}** *(Qi not counted)* · Qi Bars: **${fmt(sh.qiBars.total)}**`,
      '',
      '**Points to spend**',
      `• **${fmt(c.pools.normal)}** stat points — Strength / Endurance / Mobility`,
      `• **${fmt(c.pools.flex)}** flexible points — any stat, including Qi`,
      max !== Infinity ? `No stat may go above **${fmt(max)}** (${st.settings.maxSingleStatPercent}% rule).` : '',
      '',
      `Caps for ${sh.realm.name}: ${stats.capSummary(st, c)}`,
      ...sh.capLines,
    ].filter((x) => x !== null).join('\n'))
    .setFooter({ text: ctx.isOwner ? (has > 0 ? 'Tap +1 / +5, or ✏️ Spend to enter several stats at once.' : 'No points to spend — staff reward you after RPs and fights.') : `Viewing ${c.name}` });
  const components = [navRow(ctx, 'stats')];
  if (ctx.isOwner) {
    const canNormal = (n) => c.pools.normal + c.pools.flex >= n;
    const canQi = (n) => c.pools.flex >= n;
    const plus = (n) => row(
      btn(cid('a', ctx, 'add', 'strength', n), `+${n} STR`, ButtonStyle.Success, !canNormal(n), '💪'),
      btn(cid('a', ctx, 'add', 'endurance', n), `+${n} END`, ButtonStyle.Success, !canNormal(n), '🛡️'),
      btn(cid('a', ctx, 'add', 'mobility', n), `+${n} MOB`, ButtonStyle.Success, !canNormal(n), '💨'),
      btn(cid('a', ctx, 'add', 'qi', n), `+${n} Qi`, ButtonStyle.Success, !canQi(n), '🌀'),
    );
    components.push(plus(1), plus(5));
    const undo = (undoStacks.get(ctx.viewer) || []).filter((u) => u.charId === c.id).length;
    components.push(row(
      btn(cid('a', ctx, 'spend'), 'Spend points…', ButtonStyle.Primary, has <= 0, '✏️'),
      botStatus.messageContent ? btn(cid('a', ctx, 'type'), 'Type in chat', ButtonStyle.Secondary, has <= 0, '⌨️') : null,
      btn(cid('a', ctx, 'undo'), `Undo${undo ? ` (${undo})` : ''}`, ButtonStyle.Secondary, !undo, '↩️'),
    ));
    const known = [...Object.entries(c.martialArts).flatMap(([cat, list]) => list.map((r) => ({ r, label: `${cat} art` }))), ...c.cultivationMethods.map((r) => ({ r, label: 'cultivation method' }))]
      .map((x) => ({ name: chars.refName(st, x.r), label: x.label })).filter((x) => x.name);
    if (known.length) {
      components.push(row(new StringSelectMenuBuilder().setCustomId(cid('s', ctx, 'forget')).setPlaceholder('🍂 Forget a martial art / cultivation method (frees a slot)')
        .addOptions(known.slice(0, 25).map((x) => ({ label: truncate(x.name, 100), value: truncate(x.name, 100), description: x.label })))));
    }
  }
  return { embeds: [e], components };
};

VIEWS.inv = (ctx) => {
  const st = store.state;
  const { c } = ctx;
  const owned = Object.entries(c.inventory).map(([id, q]) => ({ it: st.items.find((i) => i.id === id), q })).filter((x) => x.it && x.q > 0)
    .sort((a, b) => a.it.name.localeCompare(b.it.name));
  const components = [navRow(ctx, 'inv')];
  if (owned.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(cid('s', ctx, 'item')).setPlaceholder('🔎 Pick an item to see, use, learn or sell')
      .addOptions(owned.slice(0, 25).map((x) => ({ label: truncate(`${x.it.name} ×${x.q}`, 100), value: x.it.id, description: truncate(`${x.it.rarity} ${x.it.type}`, 100) })))));
  }
  if (ctx.isOwner) {
    components.push(row(
      btn(cid('a', ctx, 'roll'), `Roll for a drop (${c.rolls})`, ButtonStyle.Success, c.rolls < 1, '🎲'),
      btn(cid('v', ctx, 'shop', 0), 'Shop', ButtonStyle.Primary, false, '🏮'),
      btn(cid('v', ctx, 'rates'), 'Drop rates', ButtonStyle.Secondary, false, '📈'),
    ));
  }
  const e = inventoryEmbed(c);
  if (owned.length > 25) e.setDescription(`Showing the first 25 items in the picker. Use \`/item\` to look up any item.`);
  return { embeds: [e], components };
};

VIEWS.rates = (ctx) => {
  const rows = rolls.chanceTable(store.state, ctx.c);
  const e = new EmbedBuilder().setTitle('📈 Drop rates').setColor('#7a5c2e')
    .setDescription(rows.map((r) => `${r.emoji} **${r.name}** — ${fmt(r.percent)}% · ${r.items} item(s) can drop`).join('\n'))
    .setFooter({ text: ctx.c.sect ? `Includes ${ctx.c.sect} bonuses, if any.` : 'Each roll uses one drop roll. Staff give rolls as rewards.' });
  return { embeds: [e], components: [navRow(ctx, 'inv'), row(btn(cid('v', ctx, 'inv'), 'Back', ButtonStyle.Secondary, false, '◀'))] };
};

VIEWS.item = (ctx, itemId) => {
  const st = store.state;
  const it = st.items.find((i) => i.id === itemId);
  if (!it) return VIEWS.inv(ctx);
  const q = economy.qtyOf(ctx.c, it.id);
  const e = itemEmbed(it).addFields({ name: 'Owned', value: `×${q}`, inline: true });
  const sell = economy.shopSellPrice(st, it);
  const buttons = [];
  if (ctx.isOwner && q > 0) {
    if (it.type === 'pill') buttons.push(btn(cid('a', ctx, 'use', it.id), 'Consume', ButtonStyle.Success, false, '💊'));
    if (['manual', 'cultivation', 'core'].includes(it.type)) buttons.push(btn(cid('a', ctx, 'learn', it.id), 'Learn', ButtonStyle.Success, false, '📖'));
    if (sell > 0) buttons.push(btn(cid('a', ctx, 'sell', it.id), `Sell 1 for ${fmt(sell)}`, ButtonStyle.Secondary, false, '💰'));
  }
  buttons.push(btn(cid('v', ctx, 'inv'), 'Back', ButtonStyle.Secondary, false, '◀'));
  if (ctx.isOwner && it.tradeable) e.setFooter({ text: 'To give or sell this to a player: /trade (ask 0 for a gift) or /market' });
  return { embeds: [e], components: [navRow(ctx, 'inv'), row(...buttons)] };
};

VIEWS.shop = (ctx, page = 0) => {
  const st = store.state;
  const list = economy.shopItems(st);
  const per = 20;
  const pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.max(0, Math.min(pages - 1, Number(page) || 0));
  const slice = list.slice(page * per, page * per + per);
  const e = new EmbedBuilder().setTitle('🏮 Shop').setColor('#c0392b')
    .setDescription(slice.map((it) => `${itemIcon(it)} **${it.name}** — ${S().currencyEmoji} ${fmt(it.shop.price)}${it.shop.stock >= 0 ? ` · ${it.shop.stock} left` : ''}`).join('\n') || 'The shop is empty.')
    .setFooter({ text: `Page ${page + 1}/${pages} · Your purse: ${fmt(ctx.c.nyang)} ${S().currencyName}` });
  const components = [navRow(ctx, 'inv')];
  if (slice.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(cid('s', ctx, 'shopitem')).setPlaceholder('🛒 Pick an item to buy')
      .addOptions(slice.map((it) => ({ label: truncate(`${it.name} — ${fmt(it.shop.price)} ${S().currencyName}`, 100), value: it.id, description: truncate(`${it.rarity} ${it.type}`, 100) })))));
  }
  components.push(row(
    btn(cid('v', ctx, 'shop', page - 1), 'Prev', ButtonStyle.Secondary, page <= 0, '⬅'),
    btn(cid('v', ctx, 'shop', page + 1), 'Next', ButtonStyle.Secondary, page >= pages - 1, '➡'),
    btn(cid('v', ctx, 'inv'), 'Inventory', ButtonStyle.Secondary, false, '🎒'),
  ));
  return { embeds: [e], components };
};

VIEWS.shopitem = (ctx, itemId) => {
  const it = store.state.items.find((i) => i.id === itemId && i.shop?.enabled);
  if (!it) return VIEWS.shop(ctx, 0);
  const e = itemEmbed(it).addFields({ name: 'Your purse', value: `${S().currencyEmoji} ${fmt(ctx.c.nyang)} ${S().currencyName}`, inline: true });
  const p = it.shop.price;
  return {
    embeds: [e],
    components: [navRow(ctx, 'inv'), row(
      btn(cid('a', ctx, 'buy', it.id, 1), `Buy 1 (${fmt(p)})`, ButtonStyle.Success, !ctx.isOwner || ctx.c.nyang < p, '🛒'),
      btn(cid('a', ctx, 'buy', it.id, 5), `Buy 5 (${fmt(p * 5)})`, ButtonStyle.Success, !ctx.isOwner || ctx.c.nyang < p * 5),
      btn(cid('a', ctx, 'buyq', it.id), 'Buy amount…', ButtonStyle.Secondary, !ctx.isOwner),
      btn(cid('v', ctx, 'shop', 0), 'Shop', ButtonStyle.Secondary, false, '◀'),
    )],
  };
};

VIEWS.realm = (ctx, confirm) => {
  const st = store.state;
  const { c } = ctx;
  const sh = effects.compute(st, c);
  const chk = stats.breakthroughCheck(st, c);
  const ch = chars.breakthroughChance(st, c);
  const mark = (ok) => (ok ? '✅' : '❌');
  const ladder = st.realms.map((r, idx) => `${idx === c.realm ? '▶' : idx < c.realm ? '·' : '　'} ${idx === c.realm ? `**${r.name}**` : r.name}`).join('\n');
  const e = new EmbedBuilder().setColor('#6a4c93').setTitle(`☯️ ${c.name} — ${sh.realm.name}`).setDescription([
    `Qi Bars: **${fmt(sh.qiBars.total)}** · Stat total: **${fmt(sh.normalTotal)}** · Qi: **${fmt(c.stats.qi)}**`,
    stats.capSummary(st, c),
    ...sh.capLines,
    '',
    chk.next
      ? [`**Next realm: ${chk.next.name}**`,
        `${mark(sh.normalTotal >= chk.next.reqStats)} ${fmt(chk.next.reqStats)} stat points`,
        `${mark(c.stats.qi >= chk.next.reqQi)} ${fmt(chk.next.reqQi)} Qi`,
        '',
        `**Breakthrough chance: ${fmt(ch.total)}%**`,
        `-# Base ${fmt(ch.base)}%${ch.pills ? ` · pills +${fmt(ch.pills)}%` : ''}${ch.scriptDelta ? ` · effects ${ch.scriptDelta > 0 ? '+' : ''}${fmt(ch.scriptDelta)}%` : ''} — consume breakthrough pills first to raise it.`].join('\n')
      : '🏔️ You have reached the final realm.',
  ].join('\n')).addFields({ name: 'Realms', value: truncate(ladder, 1024) });
  const components = [navRow(ctx, 'realm')];
  if (ctx.isOwner && chk.next) {
    components.push(confirm
      ? row(btn(cid('a', ctx, 'btgo'), `Yes — attempt (${fmt(ch.total)}%)`, ButtonStyle.Danger, false, '🌟'), btn(cid('v', ctx, 'realm'), 'Cancel', ButtonStyle.Secondary))
      : row(btn(cid('v', ctx, 'realm', 'confirm'), 'Attempt Realm Breakthrough', ButtonStyle.Success, !chk.ok, '🌟')));
  }
  return { embeds: [e], components };
};

VIEWS.craft = (ctx, page = 0) => {
  const st = store.state;
  const list = st.recipes.filter((r) => r.enabled);
  const per = 20;
  const pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.max(0, Math.min(pages - 1, Number(page) || 0));
  const slice = list.slice(page * per, page * per + per);
  const lines = slice.map((r) => `${crafting.check(st, ctx.c, r).ok ? '✅' : '▫️'} **${r.name}** — ${crafting.describe(st, r)}`);
  const e = new EmbedBuilder().setTitle('⚒️ Crafting').setColor('#2e8b57')
    .setDescription(truncate(lines.join('\n') || 'No recipes yet. Staff add them in the dashboard.', 4096))
    .setFooter({ text: `✅ = you can craft it now · Page ${page + 1}/${pages}` });
  const components = [navRow(ctx, 'craft')];
  if (slice.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(cid('s', ctx, 'recipe')).setPlaceholder('⚒️ Pick a recipe')
      .addOptions(slice.map((r) => ({ label: truncate(r.name, 100), value: r.id, description: truncate(crafting.describe(st, r), 100) })))));
  }
  if (pages > 1) components.push(row(btn(cid('v', ctx, 'craft', page - 1), 'Prev', ButtonStyle.Secondary, page <= 0, '⬅'), btn(cid('v', ctx, 'craft', page + 1), 'Next', ButtonStyle.Secondary, page >= pages - 1, '➡')));
  return { embeds: [e], components };
};

VIEWS.recipe = (ctx, recipeId) => {
  const st = store.state;
  const r = st.recipes.find((x) => x.id === recipeId);
  if (!r) return VIEWS.craft(ctx, 0);
  const chk = crafting.check(st, ctx.c, r);
  const e = new EmbedBuilder().setTitle(`⚒️ ${r.name}`).setColor('#2e8b57').setDescription(truncate([
    r.description,
    '**Needs**',
    ...chk.inputs.map((x) => `${x.have >= x.need ? '✅' : '❌'} ${x.need}× ${x.item?.name || '?'} *(you have ${x.have})*`),
    r.nyangCost ? `${ctx.c.nyang >= r.nyangCost ? '✅' : '❌'} ${fmt(r.nyangCost)} ${S().currencyName}` : '',
    r.minRealm ? `${(ctx.c.realm || 0) >= r.minRealm ? '✅' : '❌'} Realm ${st.realms[r.minRealm]?.name} or higher` : '',
    '',
    '**Makes**',
    ...r.outputs.map((o) => `${o.qty}× ${st.items.find((i) => i.id === o.itemId)?.name || '?'}`),
    '',
    `Success chance: **${fmt(r.successChance)}%**${r.successChance < 100 ? (r.consumeOnFail ? ' — materials are lost on failure' : ' — materials are kept on failure') : ''}`,
  ].filter((x) => x !== '').join('\n'), 4096));
  return {
    embeds: [e],
    components: [navRow(ctx, 'craft'), row(
      btn(cid('a', ctx, 'craft', r.id), 'Craft', ButtonStyle.Success, !ctx.isOwner || !chk.ok, '⚒️'),
      btn(cid('v', ctx, 'craft', 0), 'Recipes', ButtonStyle.Secondary, false, '◀'),
    )],
  };
};

function render(ctx, view, arg, notice) {
  const v = (VIEWS[view] || VIEWS.sheet)(ctx, arg);
  return { content: notice ? truncate(notice, 2000) : '', ...v, allowedMentions: { parse: [] } };
}

// ---------- /menu ----------
async function execute(i) {
  const user = i.options.getUser('player');
  const c = user && user.id !== i.user.id ? requireChar(user.id, true) : requireChar(i.user.id);
  const ctx = { viewer: i.user.id, c, isOwner: c.ownerId === i.user.id };
  const pub = i.options.getBoolean('public') ?? !!S().menuPublicByDefault;
  return i.reply({ ...render(ctx, 'sheet'), flags: pub ? undefined : EPH });
}

function contextFrom(i, parts) {
  const [, , viewer, charId] = parts;
  if (viewer !== i.user.id) throw new UserError('This menu belongs to someone else — open your own with `/menu`.');
  const c = store.state.characters.find((x) => x.id === charId);
  if (!c) throw new UserError('That character no longer exists.');
  return { viewer, c, isOwner: c.ownerId === i.user.id };
}

function ownerOnly(ctx) {
  if (!ctx.isOwner) throw new UserError("You can only change your own character. Open yours with `/menu`.");
}

const isEphemeral = (i) => !!i.message?.flags?.has?.(MessageFlags.Ephemeral);

/** Public post for rolls / crafting / breakthroughs when the menu itself is private. */
async function announce(i, payload, { preferAnnouncements = false } = {}) {
  if (preferAnnouncements && (await sendToChannel(i.client, S().channels.announcements, payload))) return;
  if (!isEphemeral(i)) return;
  try { await i.channel?.send(payload); } catch {}
}

async function onButton(i) {
  requireAccess(i, 'menu');
  const parts = i.customId.split(':');
  const ctx = contextFrom(i, parts);
  const [, kind, , , name, arg, arg2] = parts;
  const st = store.state;
  const { c } = ctx;

  if (kind === 'v') return i.update(render(ctx, name, arg));

  ownerOnly(ctx);
  switch (name) {
    case 'add': {
      pushUndo(i.user.id, c, `${stats.LABEL[arg]} +${arg2}`);
      try {
        const [r] = stats.applyAllocation(st, c, [{ stat: arg, amount: Number(arg2) }]);
        store.log(actor(i), 'stats.allocate', `${c.name}: ${stats.LABEL[r.stat]} +${fmt(r.gained)} (${fmt(r.spent)} pts)`);
        const note = `✅ ${stats.LABEL[r.stat]} **+${fmt(r.gained)}**${r.softCapped ? ` *(soft cap: ${fmt(r.spent)} pts → ${fmt(r.gained)})*` : ''}${r.reset ? ' · Impurity reset' : ''}`;
        return i.update(render(ctx, 'stats', null, note));
      } catch (e) {
        undoStacks.get(i.user.id)?.pop();
        throw e;
      }
    }
    case 'spend': {
      const field = (id, label) => row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('0'));
      return i.showModal(new ModalBuilder().setCustomId(['mm', 'spend', ctx.viewer, c.id].join(':')).setTitle('Spend points').addComponents(
        field('strength', `💪 Strength (stat + flexible points)`),
        field('endurance', '🛡️ Endurance'),
        field('mobility', '💨 Mobility'),
        field('qi', `🌀 Qi (flexible points only: ${fmt(c.pools.flex)})`.slice(0, 45)),
      ));
    }
    case 'type': {
      if (!botStatus.messageContent) throw new UserError('Typing in chat is turned off — use the buttons or ✏️ Spend instead.');
      const w = allocation.open(i.channel, i.user.id, c);
      return i.reply({ content: `⌨️ For the next ${w.minutes} minutes, type your stats in this channel, e.g.\n\`\`\`\nstrength 5\nmobility 5\nqi 3\n\`\`\`\`points\` shows what's left · \`undo\` reverts · \`done\` closes.`, flags: EPH });
    }
    case 'undo': {
      const list = undoStacks.get(i.user.id) || [];
      const idx = list.map((u) => u.charId).lastIndexOf(c.id);
      if (idx < 0) throw new UserError('Nothing to undo.');
      const [u] = list.splice(idx, 1);
      Object.assign(c, clone(u.snap));
      store.log(actor(i), 'stats.undo', `${c.name}: undid ${u.label}`);
      return i.update(render(ctx, 'stats', null, `↩️ Undid ${u.label}.`));
    }
    case 'roll': {
      if (c.rolls < 1) throw new UserError('You have no drop rolls. Staff give them as rewards.');
      c.rolls -= 1;
      const r = rolls.rollDrop(st, c);
      if (!r.item) {
        c.rolls += 1;
        throw new UserError(`You rolled **${r.rarity.name}**, but no ${r.rarity.name} items can drop yet. Your roll was refunded.`);
      }
      economy.addItem(c, r.item.id, 1);
      store.log(actor(i), 'roll', `${c.name} rolled ${r.rarity.name}: ${r.item.name}`);
      if (S().announceRolls) {
        await announce(i, message('rollResult', { player: `<@${c.ownerId}>`, character: c.name, item: r.item.name, rarity: r.rarity.name, emoji: r.rarity.emoji || '', description: truncate(r.item.description, 500) }, { color: r.rarity.color }));
      }
      return i.update(render(ctx, 'item', r.item.id, `🎲 You rolled **${r.rarity.emoji || ''} ${r.rarity.name}** — **${r.item.name}**! (${c.rolls} roll(s) left)`));
    }
    case 'use': {
      const it = st.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      const r = chars.consumePill(st, c, it);
      store.log(actor(i), 'item.use', `${c.name} consumed ${it.name}: ${r.lines.join('; ')}`);
      const note = `💊 **${it.name}** consumed:\n${[...r.lines, ...(r.result.errors || []).map((e) => `⚠️ ${e}`)].join('\n') || 'Nothing happened.'}`;
      return i.update(render(ctx, economy.qtyOf(c, it.id) > 0 ? 'item' : 'inv', it.id, note));
    }
    case 'learn': {
      const it = st.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      const r = chars.learnItem(st, c, it);
      store.log(actor(i), 'item.learn', `${c.name} learned ${it.name}`);
      return i.update(render(ctx, 'inv', null, `📖 You learned **${it.name}**! ${r.note}`));
    }
    case 'sell': {
      const it = st.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      const r = economy.sellToShop(st, c, it, 1);
      store.log(actor(i), 'shop.sell', `${c.name} sold 1× ${it.name} for ${r.total}`);
      return i.update(render(ctx, economy.qtyOf(c, it.id) > 0 ? 'item' : 'inv', it.id, `💰 Sold **${it.name}** for ${S().currencyEmoji} ${fmt(r.total)}. Purse: ${fmt(c.nyang)}.`));
    }
    case 'buy': {
      const it = st.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      const r = economy.buyFromShop(st, c, it, Number(arg2) || 1);
      store.log(actor(i), 'shop.buy', `${c.name} bought ${r.qty}× ${it.name} for ${r.cost}`);
      return i.update(render(ctx, 'shopitem', it.id, `🛒 Bought ${r.qty}× **${it.name}** for ${S().currencyEmoji} ${fmt(r.cost)}. Purse: ${fmt(c.nyang)}.`));
    }
    case 'buyq': {
      return i.showModal(new ModalBuilder().setCustomId(['mm', 'buyq', ctx.viewer, c.id, arg].join(':')).setTitle('How many?').addComponents(
        row(new TextInputBuilder().setCustomId('qty').setLabel('Quantity').setStyle(TextInputStyle.Short).setRequired(true).setValue('1')),
      ));
    }
    case 'btgo': {
      const r = chars.attemptBreakthrough(st, c);
      store.log(actor(i), 'realm.breakthrough', `${c.name}: ${r.from} → ${r.to} ${r.success ? 'SUCCESS' : 'FAILED'} (rolled ${fmt(r.roll)} vs ${fmt(r.chance.total)}%)`);
      const vars = { player: `<@${c.ownerId}>`, character: c.name, from: r.from, realm: r.to, chance: fmt(r.chance.total), roll: fmt(r.roll) };
      const msg = message(r.success ? 'breakthroughSuccess' : 'breakthroughFail', vars, { ping: [c.ownerId] });
      if (S().announceBreakthroughs) await announce(i, msg, { preferAnnouncements: true });
      const note = r.success
        ? `🌟 **Breakthrough!** You reached **${r.to}** (rolled ${fmt(r.roll)} under ${fmt(r.chance.total)}%).`
        : `💢 You failed to reach **${r.to}** (rolled ${fmt(r.roll)}, needed under ${fmt(r.chance.total)}%).${r.failImpurity ? ` Backlash: Impurity now ${fmt(r.failImpurity.impurity)}.` : ''}`;
      return i.update(render(ctx, 'realm', null, note));
    }
    case 'craft': {
      const recipe = st.recipes.find((x) => x.id === arg);
      if (!recipe) throw new UserError('Recipe not found.');
      const r = crafting.craft(st, c, recipe);
      const items = r.outputs.map((o) => `${o.qty}× ${o.item?.name}`).join(', ');
      store.log(actor(i), 'craft', `${c.name}: ${recipe.name} ${r.success ? 'success' : 'FAILED'} (${items})`);
      if (S().announceCrafting) await announce(i, message(r.success ? 'craftSuccess' : 'craftFail', { player: `<@${c.ownerId}>`, character: c.name, recipe: recipe.name, items }));
      return i.update(render(ctx, 'recipe', recipe.id, r.success ? `⚒️ Crafted **${recipe.name}** → ${items}!` : `💥 Crafting failed (rolled ${fmt(r.roll)}, needed under ${fmt(recipe.successChance)}%).${recipe.consumeOnFail ? ' The materials were lost.' : ''}`));
    }
    default:
      throw new UserError('Unknown button.');
  }
}

async function onSelect(i) {
  // Select menus share the "m" prefix; route by kind.
  requireAccess(i, 'menu');
  const parts = i.customId.split(':');
  const ctx = contextFrom(i, parts);
  const name = parts[4];
  const value = i.values[0];
  const st = store.state;
  const { c } = ctx;
  if (name === 'item') return i.update(render(ctx, 'item', value));
  if (name === 'shopitem') return i.update(render(ctx, 'shopitem', value));
  if (name === 'recipe') return i.update(render(ctx, 'recipe', value));
  ownerOnly(ctx);
  if (name === 'stem') {
    if (c.titles.stem) throw new UserError(`You already have the stem **${c.titles.stem}**. Ask staff to change it.`);
    if (!st.settings.titles.stems.includes(value)) throw new UserError('Pick a stem from the list.');
    c.titles.stem = value;
    store.log(actor(i), 'title.stem', `${c.name} chose ${value}`);
    return i.update(render(ctx, 'sheet', null, `🏯 You are now known as **${chars.titleString(st, c)}**.`));
  }
  if (name === 'switch') {
    const next = st.characters.find((x) => x.id === value && x.ownerId === i.user.id && x.status === 'active');
    if (!next) throw new UserError('Character not found.');
    st.users[i.user.id] = { ...(st.users[i.user.id] || {}), activeCharacterId: next.id };
    store.markDirty();
    return i.update(render({ ...ctx, c: next }, 'sheet', null, `🔁 Active character: **${next.name}**`));
  }
  if (name === 'forget') {
    const r = chars.forget(st, c, value);
    store.log(actor(i), 'item.forget', `${c.name} forgot ${r.name}`);
    return i.update(render(ctx, 'stats', null, `🍂 Forgot the ${r.label} **${r.name}**.`));
  }
  throw new UserError('Unknown menu.');
}

async function onModal(i) {
  requireAccess(i, 'menu');
  const parts = i.customId.split(':');
  const ctx = contextFrom(i, ['m', 'x', parts[2], parts[3]]);
  ownerOnly(ctx);
  const st = store.state;
  const { c } = ctx;
  if (parts[1] === 'spend') {
    const entries = stats.ALL.map((k) => ({ stat: k, amount: Number(String(i.fields.getTextInputValue(k) || '0').replace(',', '.')) || 0 })).filter((e) => e.amount > 0);
    if (!entries.length) throw new UserError('Type a number in at least one box.');
    pushUndo(i.user.id, c, entries.map((e) => `${stats.LABEL[e.stat]} +${e.amount}`).join(', '));
    try {
      const res = stats.applyAllocation(st, c, entries);
      store.log(actor(i), 'stats.allocate', `${c.name}: ${res.map((r) => `${stats.LABEL[r.stat]} +${fmt(r.gained)} (${fmt(r.spent)} pts)`).join(', ')}`);
      const note = `✅ ${res.map((r) => `${stats.LABEL[r.stat]} **+${fmt(r.gained)}**${r.softCapped ? ' *(soft cap)*' : ''}`).join(' · ')}`;
      return i.update(render(ctx, 'stats', null, note));
    } catch (e) {
      undoStacks.get(i.user.id)?.pop();
      throw e;
    }
  }
  if (parts[1] === 'buyq') {
    const it = st.items.find((x) => x.id === parts[4]);
    if (!it) throw new UserError('Item not found.');
    const r = economy.buyFromShop(st, c, it, Number(i.fields.getTextInputValue('qty')));
    store.log(actor(i), 'shop.buy', `${c.name} bought ${r.qty}× ${it.name} for ${r.cost}`);
    return i.update(render(ctx, 'shopitem', it.id, `🛒 Bought ${r.qty}× **${it.name}** for ${S().currencyEmoji} ${fmt(r.cost)}. Purse: ${fmt(c.nyang)}.`));
  }
}

async function onComponent(i) {
  return i.isAnySelectMenu() ? onSelect(i) : onButton(i);
}

module.exports = {
  commands: [{ data: menu, execute }],
  buttons: { m: onComponent },
  modals: { mm: onModal },
  render,
  VIEWS,
};
