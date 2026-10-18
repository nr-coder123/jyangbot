'use strict';
/**
 * /menu — the one place players need. Opens their character sheet with tabs:
 *   Sheet · Stats (spend points) · Inventory (consume, learn, equip, sell, list, roll, craft) · Market · Realm
 * /market opens the same menu on the Market tab.
 *
 * Custom ids: m:<v|a|s>:<viewerId>:<charId>:<name>[:<arg>[:<arg2>]]   (v = view, a = action, s = select)
 *             mm:<modal>:<viewerId>:<charId>[:<arg>]
 * A "~n" suffix is added automatically if two components would share an id (Discord forbids that).
 */
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, parseEmoji,
} = require('discord.js');
const store = require('../../store');
const stats = require('../../engine/stats');
const chars = require('../../engine/characters');
const economy = require('../../engine/economy');
const world = require('../../world');
const rolls = require('../../engine/rolls');
const crafting = require('../../engine/crafting');
const ui = require('../../engine/ui');
const weapons = require('../../engine/weapons');
const allocation = require('../allocation');
const botStatus = require('../status');
const sectsync = require('../sectsync');
const panels = require('../panels');
const { EPH, actor, requireChar, requireAccess, message, sendToChannel, logConsumption } = require('../util');
const { UserError, fmt, truncate, clone } = require('../../utils');

const menu = new SlashCommandBuilder()
  .setName('menu')
  .setDescription('Your character: sheet, stats, inventory, market and realm')
  .addUserOption((o) => o.setName('player').setDescription("Look at another player's character"))
  .addBooleanOption((o) => o.setName('public').setDescription('Show it in the channel instead of only to you'));

const marketCmd = new SlashCommandBuilder()
  .setName('market')
  .setDescription('Browse the market: the shop and items other players are selling')
  .addStringOption((o) => o.setName('show').setDescription('What to show').addChoices(
    { name: 'Everything', value: 'all' }, { name: 'Player market only', value: 'players' }, { name: 'Shop only', value: 'shop' },
  ));

// ---------- component helpers ----------
const st = () => store.state;
const S = () => store.state.settings;
const cid = (kind, ctx, name, ...args) => ['m', kind, ctx.viewer, ctx.c.id, name, ...args.map((a) => (a === undefined || a === null ? '' : a))].join(':').replace(/:+$/, '').slice(0, 95);
const row = (...comps) => {
  const list = comps.filter(Boolean);
  return list.length ? new ActionRowBuilder().addComponents(...list) : null;
};

/** A button whose label/emoji come from the dashboard (Messages → Emojis & Buttons). */
function btn(id, key, { style = ButtonStyle.Secondary, disabled = false, vars = {} } = {}) {
  const look = ui.button(st(), key, vars);
  const b = new ButtonBuilder().setCustomId(id).setStyle(style).setDisabled(!!disabled);
  if (look.label) b.setLabel(look.label);
  if (look.emoji) {
    try { b.setEmoji(look.emoji); } catch { if (!look.label) b.setLabel(key); }
  }
  return b;
}

function select(id, placeholder, options) {
  return new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(truncate(placeholder, 150)).addOptions(options.slice(0, 25).map((o) => {
    const opt = { label: truncate(o.label, 100), value: o.value, ...(o.description ? { description: truncate(o.description, 100) } : {}), ...(o.default ? { default: true } : {}) };
    const em = o.emoji && parseEmoji(o.emoji);
    if (em && (em.id || em.name)) opt.emoji = em.id ? { id: em.id, name: em.name, animated: !!em.animated } : { name: em.name };
    return opt;
  }));
}

function navRow(ctx, active) {
  const b = (view, key) => btn(cid('v', ctx, view), key, { style: view === active ? ButtonStyle.Primary : ButtonStyle.Secondary });
  return row(b('sheet', 'sheet'), b('stats', 'stats'), b('inv', 'inventory'), b('market', 'market'), b('realm', 'realm'));
}

/** Discord rejects duplicate custom ids in one message — make every id unique. */
function dedupe(components) {
  const seen = new Map();
  for (const r of components) {
    for (const comp of r.components) {
      const id = comp.data.custom_id;
      if (!id) continue;
      const n = seen.get(id) || 0;
      seen.set(id, n + 1);
      if (n) comp.setCustomId(`${id}~${n}`.slice(0, 100));
    }
  }
  return components;
}

const undoStacks = new Map(); // userId -> [{ charId, snap, label }]
function pushUndo(userId, c, label) {
  const list = undoStacks.get(userId) || [];
  list.push({ charId: c.id, label, snap: clone({ stats: c.stats, pools: c.pools, impurity: c.impurity, burstApplied: c.burstApplied }) });
  if (list.length > 20) list.shift();
  undoStacks.set(userId, list);
}

// ---------- views ----------
const VIEWS = {};

VIEWS.sheet = (ctx) => {
  const mine = st().characters.filter((x) => x.ownerId === ctx.c.ownerId && x.status === 'active');
  const components = [navRow(ctx, 'sheet')];
  if (ctx.isOwner && mine.length > 1) {
    components.push(row(select(cid('s', ctx, 'switch'), '🔁 Switch character', mine.map((x) => ({ label: x.name, value: x.id, default: x.id === ctx.c.id })))));
  }
  return { ...panels.sheet(ctx.c), components };
};

VIEWS.stats = (ctx) => {
  const { c } = ctx;
  const components = [navRow(ctx, 'stats')];
  if (ctx.isOwner) {
    const has = c.pools.normal + c.pools.flex;
    const plus = (n) => row(...stats.ALL.map((k) => btn(cid('a', ctx, 'add', k, n), 'addStat', {
      style: ButtonStyle.Success,
      disabled: k === 'qi' ? c.pools.flex < n : has < n,
      vars: { n, stat: ui.statShort(st(), k), statEmoji: ui.emoji(st(), k) },
    })));
    components.push(plus(1), plus(5));
    const undo = (undoStacks.get(ctx.viewer) || []).filter((u) => u.charId === c.id).length;
    components.push(row(
      btn(cid('a', ctx, 'spend'), 'spend', { style: ButtonStyle.Primary, disabled: has <= 0 }),
      botStatus.messageContent ? btn(cid('a', ctx, 'type'), 'typeChat', { disabled: has <= 0 }) : null,
      btn(cid('a', ctx, 'undo'), 'undo', { disabled: !undo }),
    ));
    const known = [...Object.entries(c.martialArts).flatMap(([cat, list]) => list.map((r) => ({ r, label: `${cat} art` }))), ...c.cultivationMethods.map((r) => ({ r, label: 'cultivation method' }))]
      .map((x) => ({ name: chars.refName(st(), x.r), label: x.label })).filter((x) => x.name);
    if (known.length) components.push(row(select(cid('s', ctx, 'forget'), '🍂 Forget a martial art / cultivation method (frees a slot)', known.map((x) => ({ label: x.name, value: truncate(x.name, 100), description: x.label })))));
  }
  return { ...panels.statsPanel(c, ctx.isOwner), components };
};

VIEWS.inv = (ctx) => {
  const { c } = ctx;
  const owned = panels.ownedItems(c).sort((a, b) => a.it.name.localeCompare(b.it.name));
  const components = [navRow(ctx, 'inv')];
  if (owned.length) {
    components.push(row(select(cid('s', ctx, 'item'), '🔎 Pick an item to see, use, learn, equip or sell',
      owned.map((x) => ({ label: `${x.it.name} ×${x.q}`, value: x.it.id, description: `${x.it.rarity} ${x.it.type}`, emoji: x.it.emoji || panels.rarityOf(x.it.rarity).emoji })))));
  }
  components.push(row(
    ctx.isOwner ? btn(cid('a', ctx, 'roll'), 'roll', { style: ButtonStyle.Success, disabled: c.rolls < 1, vars: { rolls: c.rolls } }) : null,
    btn(cid('v', ctx, 'craft'), 'craft'),
    btn(cid('v', ctx, 'rates'), 'rates'),
  ));
  return { ...panels.inventory(c), components };
};

VIEWS.rates = (ctx) => ({ ...panels.dropRates(ctx.c), components: [navRow(ctx, 'inv'), row(btn(cid('v', ctx, 'inv'), 'back'))] });

VIEWS.item = (ctx, itemId) => {
  const it = st().items.find((i) => i.id === itemId);
  if (!it) return VIEWS.inv(ctx);
  const { c } = ctx;
  const q = economy.qtyOf(c, it.id);
  const buttons = [];
  if (ctx.isOwner && q > 0) {
    if (it.type === 'pill') buttons.push(btn(cid('a', ctx, 'use', it.id), 'consume', { style: ButtonStyle.Success }));
    else if (it.consumable) buttons.push(btn(cid('a', ctx, 'use', it.id), 'use', { style: ButtonStyle.Success }));
    if (it.type === 'manual') buttons.push(btn(cid('a', ctx, 'learn', it.id), 'learn', { style: ButtonStyle.Success }));
    if (it.type === 'weapon') {
      const equipped = weapons.mainWeapon(st(), c)?.id === it.id;
      buttons.push(btn(cid('a', ctx, 'equip', it.id), 'equip', { style: ButtonStyle.Success, disabled: equipped }));
    }
    const sell = economy.shopSellPrice(st(), it);
    if (sell > 0) buttons.push(btn(cid('a', ctx, 'sell', it.id), 'sellShop', { vars: { price: fmt(sell) } }));
    if (it.tradeable && it.marketable) buttons.push(btn(cid('a', ctx, 'list', it.id), 'list'));
  }
  return { ...panels.itemInfo(it, c), components: [navRow(ctx, 'inv'), row(...buttons.slice(0, 5)), row(btn(cid('v', ctx, 'inv'), 'back'))].filter(Boolean) };
};

VIEWS.market = (ctx, filter = 'all', page = 0) => {
  filter = ['all', 'players', 'shop'].includes(filter) ? filter : 'all';
  const m = panels.market(ctx.c, filter, page);
  const components = [navRow(ctx, 'market')];
  if (m.slice.length) {
    components.push(row(select(cid('s', ctx, 'entry', filter), '🛒 Pick something to buy', m.slice.map((x) => ({
      label: `${x.it.name}${x.kind === 'L' ? ` ×${x.qty}` : ''} — ${fmt(x.price)} ${S().currencyName}`,
      value: `${x.kind}.${x.id}`,
      description: x.kind === 'S' ? `Shop · ${x.it.rarity} ${x.it.type}` : `Player: ${x.seller?.name || '?'} · ${x.it.rarity} ${x.it.type}`,
      emoji: x.kind === 'S' ? ui.emoji(st(), 'shop') : ui.emoji(st(), 'player'),
    })))));
  }
  const f = (key, value) => btn(cid('v', ctx, 'market', value, 0), key, { style: filter === value ? ButtonStyle.Primary : ButtonStyle.Secondary });
  // Filters and page buttons share a row: at most 5 buttons (Discord refuses a 6th, and the market would not open).
  components.push(row(
    f('filterAll', 'all'), f('filterPlayers', 'players'), f('filterShop', 'shop'),
    m.pages > 1 ? btn(cid('v', ctx, 'market', filter, m.page - 1), 'prev', { disabled: m.page <= 0 }) : null,
    m.pages > 1 ? btn(cid('v', ctx, 'market', filter, m.page + 1), 'next', { disabled: m.page >= m.pages - 1 }) : null,
  ));
  return { content: m.content, embeds: m.embeds, components: components.filter(Boolean) };
};

VIEWS.entry = (ctx, key, filter = 'all') => {
  const { c } = ctx;
  const entry = panels.findEntry(key, c);
  if (!entry) return VIEWS.market(ctx, filter, 0);
  const own = entry.kind === 'L' && entry.listing.sellerUserId === ctx.viewer;
  const canBuy = ctx.isOwner && !own && c.nyang >= entry.price && entry.qty !== 0;
  return {
    ...panels.marketEntry(c, entry),
    components: [navRow(ctx, 'market'), row(
      !own ? btn(cid('a', ctx, 'buy', key, 1), 'buy1', { style: ButtonStyle.Success, disabled: !canBuy, vars: { price: fmt(entry.price) } }) : null,
      !own ? btn(cid('a', ctx, 'buyq', key), 'buyAmount', { disabled: !ctx.isOwner || entry.qty === 0 }) : null,
      own ? btn(cid('a', ctx, 'unlist', entry.id), 'unlist', { style: ButtonStyle.Danger }) : null,
      btn(cid('v', ctx, 'market', filter, 0), 'back'),
    )],
  };
};

VIEWS.realm = (ctx, confirm) => {
  const r = panels.realm(ctx.c);
  const components = [navRow(ctx, 'realm')];
  if (ctx.isOwner && r.check.next) {
    components.push(confirm
      ? row(btn(cid('a', ctx, 'btgo'), 'confirm', { style: ButtonStyle.Danger, vars: { chance: fmt(r.chance.total) } }), btn(cid('v', ctx, 'realm', 'no'), 'cancel'))
      : row(btn(cid('v', ctx, 'realm', 'confirm'), 'breakthrough', { style: ButtonStyle.Success, disabled: !r.check.ok })));
  }
  return { content: r.content, embeds: r.embeds, components };
};

VIEWS.craft = (ctx, page = 0) => {
  const m = panels.craftList(ctx.c, page);
  const components = [navRow(ctx, 'inv')];
  if (m.slice.length) components.push(row(select(cid('s', ctx, 'recipe'), '⚒️ Pick a recipe', m.slice.map((r) => ({ label: r.name, value: r.id, description: crafting.describe(st(), r) })))));
  components.push(row(
    m.pages > 1 ? btn(cid('v', ctx, 'craft', m.page - 1), 'prev', { disabled: m.page <= 0 }) : null,
    m.pages > 1 ? btn(cid('v', ctx, 'craft', m.page + 1), 'next', { disabled: m.page >= m.pages - 1 }) : null,
    btn(cid('v', ctx, 'inv'), 'back'),
  ));
  return { content: m.content, embeds: m.embeds, components };
};

VIEWS.recipe = (ctx, recipeId) => {
  const r = st().recipes.find((x) => x.id === recipeId);
  if (!r) return VIEWS.craft(ctx, 0);
  const p = panels.recipe(ctx.c, r);
  return {
    content: p.content,
    embeds: p.embeds,
    components: [navRow(ctx, 'inv'), row(btn(cid('a', ctx, 'craft', r.id), 'craftDo', { style: ButtonStyle.Success, disabled: !ctx.isOwner || !p.check.ok }), btn(cid('v', ctx, 'craft', 0), 'back'))],
  };
};

/** Build a full message for a view. `notice` replaces the text above the embed; `extra` embeds go first. */
function render(ctx, view, arg, notice, extra = [], arg2) {
  const v = (VIEWS[view] || VIEWS.sheet)(ctx, arg, arg2);
  return {
    content: notice ? truncate(notice, 2000) : v.content || '',
    embeds: [...extra, ...(v.embeds || [])].slice(0, 10),
    components: dedupe(v.components.filter(Boolean)),
    allowedMentions: { parse: [] },
  };
}

// ---------- commands ----------
async function openFor(i, view, arg) {
  const user = i.options.getUser('player');
  if (user && user.id !== i.user.id) await sectsync.syncUserId(i.guild, user.id);
  const c = user && user.id !== i.user.id ? requireChar(user.id, true) : requireChar(i.user.id);
  const ctx = { viewer: i.user.id, c, isOwner: c.ownerId === i.user.id };
  const pub = i.options.getBoolean('public') ?? !!S().menuPublicByDefault;
  return i.reply({ ...render(ctx, view, arg), flags: pub ? undefined : EPH });
}

const executeMenu = (i) => openFor(i, 'sheet');
const executeMarket = (i) => openFor(i, 'market', i.options.getString('show') || 'all');

// ---------- interactions ----------
function parse(i) {
  return i.customId.replace(/~\d+$/, '').split(':');
}

function contextFrom(i, parts) {
  const [, , viewer, charId] = parts;
  if (viewer !== i.user.id) throw new UserError('This menu belongs to someone else — open your own with `/menu`.');
  const c = st().characters.find((x) => x.id === charId);
  if (!c) throw new UserError('That character no longer exists.');
  return { viewer, c, isOwner: c.ownerId === i.user.id };
}

function ownerOnly(ctx) {
  if (!ctx.isOwner) throw new UserError('You can only change your own character. Open yours with `/menu`.');
}

const isEphemeral = (i) => !!i.message?.flags?.has?.(MessageFlags.Ephemeral);

/** Public post for rolls / crafting / breakthroughs when the menu itself is private. */
async function announce(i, payload, { preferAnnouncements = false } = {}) {
  if (preferAnnouncements && (await sendToChannel(i.client, S().channels.announcements, payload))) return;
  if (!isEphemeral(i)) return;
  try { await i.channel?.send(payload); } catch {}
}

function buyEntry(i, ctx, key, qty) {
  const state = st();
  const { c } = ctx;
  const entry = panels.findEntry(key, c);
  if (!entry) throw new UserError('That is no longer for sale.');
  if (entry.kind === 'S') {
    const r = economy.buyFromShop(state, c, entry.it, qty, entry.price);
    store.log(actor(i), 'shop.buy', `${c.name} bought ${r.qty}× ${entry.it.name} for ${r.cost}`);
    return `🛒 Bought ${r.qty}× **${entry.it.name}** for ${ui.emoji(state, 'nyang')} ${fmt(r.cost)}. Purse: ${fmt(c.nyang)}.`;
  }
  const r = economy.buyFromMarket(state, c, entry.listing, qty);
  store.log(actor(i), 'market.buy', `${c.name} bought ${qty}× ${entry.it.name} from ${r.seller?.name} for ${r.cost}`);
  return `🛒 Bought ${qty}× **${entry.it.name}** from **${r.seller?.name || 'a former seller'}** for ${ui.emoji(state, 'nyang')} ${fmt(r.cost)}. Purse: ${fmt(c.nyang)}.`;
}

async function onButton(i) {
  requireAccess(i, 'menu');
  const parts = parse(i);
  const ctx = contextFrom(i, parts);
  const [, kind, , , name, arg, arg2] = parts;
  const state = st();
  const { c } = ctx;

  if (kind === 'v') return i.update(render(ctx, name, arg, null, [], arg2));

  ownerOnly(ctx);
  switch (name) {
    case 'add': {
      pushUndo(i.user.id, c, `${stats.LABEL[arg]} +${arg2}`);
      try {
        const [r] = stats.applyAllocation(state, c, [{ stat: arg, amount: Number(arg2) }]);
        store.log(actor(i), 'stats.allocate', `${c.name}: ${stats.LABEL[r.stat]} +${fmt(r.gained)} (${fmt(r.spent)} pts)`);
        return i.update(render(ctx, 'stats', null, `${ui.emoji(state, 'ok')} ${stats.LABEL[r.stat]} **+${fmt(r.gained)}**${r.softCapped ? ` *(soft cap: ${fmt(r.spent)} pts → ${fmt(r.gained)})*` : ''}${r.reset ? ' · Impurity reset' : ''}`));
      } catch (e) {
        undoStacks.get(i.user.id)?.pop();
        throw e;
      }
    }
    case 'spend': {
      const field = (id, label) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('0'));
      return i.showModal(new ModalBuilder().setCustomId(['mm', 'spend', ctx.viewer, c.id].join(':')).setTitle('Spend points').addComponents(
        field('strength', 'Strength'),
        field('endurance', 'Endurance'),
        field('mobility', 'Mobility'),
        field('qi', `Qi (flexible points only: ${fmt(c.pools.flex)})`.slice(0, 45)),
      ));
    }
    case 'type': {
      if (!botStatus.messageContent) throw new UserError('Typing in chat is turned off — use the buttons or Spend points instead.');
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
      const r = rolls.rollDrop(state, c);
      if (!r.item) {
        c.rolls += 1;
        throw new UserError(`You rolled **${r.rarity.name}**, but no ${r.rarity.name} items can drop yet. Your roll was refunded.`);
      }
      economy.addItem(c, r.item.id, 1);
      store.log(actor(i), 'roll', `${c.name} rolled ${r.rarity.name}: ${r.item.name}`);
      if (S().announceRolls) await announce(i, message('rollResult', { player: `<@${c.ownerId}>`, character: c.name, item: r.item.name, rarity: r.rarity.name, emoji: r.rarity.emoji || '', description: truncate(r.item.description, 500) }, { color: r.rarity.color }));
      return i.update(render(ctx, 'item', r.item.id, `${ui.emoji(state, 'rolls')} You rolled **${r.rarity.emoji || ''} ${r.rarity.name}** — **${r.item.name}**! (${c.rolls} roll(s) left)`));
    }
    case 'use': {
      const it = state.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      const r = chars.useItem(state, c, it);
      const result = panels.consumeResult(c, it, [...r.lines, ...(r.result.errors || []).map((e) => `${ui.emoji(state, 'warning')} ${e}`)]);
      logConsumption(i, c, it, r.lines, result.embeds).catch(() => {});
      return i.update(render(ctx, economy.qtyOf(c, it.id) > 0 ? 'item' : 'inv', it.id, null, result.embeds));
    }
    case 'learn': {
      const it = state.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      const r = chars.learnItem(state, c, it);
      store.log(actor(i), 'item.learn', `${c.name} learned ${it.name}`);
      return i.update(render(ctx, 'inv', null, `📖 You learned **${r.art.name}**! ${r.note}`));
    }
    case 'equip': {
      const it = state.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      weapons.equip(state, c, it);
      store.log(actor(i), 'item.equip', `${c.name} equipped ${it.name}`);
      return i.update(render(ctx, 'item', it.id, `${ui.emoji(state, 'weapon')} **${it.name}** is now your main weapon.`));
    }
    case 'sell': {
      const it = state.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      const r = economy.sellToShop(state, c, it, 1);
      store.log(actor(i), 'shop.sell', `${c.name} sold 1× ${it.name} for ${r.total}`);
      return i.update(render(ctx, economy.qtyOf(c, it.id) > 0 ? 'item' : 'inv', it.id, `💰 Sold **${it.name}** for ${ui.emoji(state, 'nyang')} ${fmt(r.total)}. Purse: ${fmt(c.nyang)}.`));
    }
    case 'list': {
      const it = state.items.find((x) => x.id === arg);
      if (!it) throw new UserError('Item not found.');
      if (!it.tradeable || !it.marketable) throw new UserError(`**${it.name}** can't be sold on the player market.`);
      const input = (id, label, value) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setValue(value));
      return i.showModal(new ModalBuilder().setCustomId(['mm', 'list', ctx.viewer, c.id, it.id].join(':')).setTitle(truncate(`Sell ${it.name}`, 45)).addComponents(
        input('price', `Price per item (${S().currencyName})`.slice(0, 45), String(economy.shopSellPrice(state, it) || it.shop?.price || 10)),
        input('qty', `How many? (you have ${economy.qtyOf(c, it.id)})`.slice(0, 45), '1'),
      ));
    }
    case 'buy': {
      const note = buyEntry(i, ctx, arg, Number(arg2) || 1);
      return i.update(render(ctx, panels.findEntry(arg, c) ? 'entry' : 'market', arg, note));
    }
    case 'buyq': {
      return i.showModal(new ModalBuilder().setCustomId(['mm', 'buyq', ctx.viewer, c.id, arg].join(':')).setTitle('How many?').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qty').setLabel('Quantity').setStyle(TextInputStyle.Short).setRequired(true).setValue('1')),
      ));
    }
    case 'unlist': {
      const l = state.market.find((x) => x.id === arg);
      if (!l) throw new UserError('That listing is gone.');
      if (l.sellerUserId !== i.user.id) throw new UserError('That is not your listing.');
      economy.cancelListing(state, l);
      store.log(actor(i), 'market.cancel', `${c.name} took down ${l.qty}× ${state.items.find((x) => x.id === l.itemId)?.name}`);
      return i.update(render(ctx, 'market', 'players', '🗑️ Listing taken down — the items are back in your inventory.'));
    }
    case 'btgo': {
      const r = chars.attemptBreakthrough(state, c);
      store.log(actor(i), 'realm.breakthrough', `${c.name}: ${r.from} → ${r.to} ${r.success ? 'SUCCESS' : 'FAILED'} (rolled ${fmt(r.roll)} vs ${fmt(r.chance.total)}%)`);
      const vars = { player: `<@${c.ownerId}>`, character: c.name, from: r.from, realm: r.to, chance: fmt(r.chance.total), roll: fmt(r.roll) };
      if (S().announceBreakthroughs) await announce(i, message(r.success ? 'breakthroughSuccess' : 'breakthroughFail', vars, { ping: [c.ownerId] }), { preferAnnouncements: true });
      const note = r.success
        ? `🌟 **Breakthrough!** You reached **${r.to}** (rolled ${fmt(r.roll)} under ${fmt(r.chance.total)}%).`
        : `💢 You failed to reach **${r.to}** (rolled ${fmt(r.roll)}, needed under ${fmt(r.chance.total)}%).${r.failImpurity ? ` Backlash: Impurity now ${fmt(r.failImpurity.impurity)}.` : ''}${r.keptBonus ? ` Your pills left +${fmt(r.keptBonus)}% for the next attempt.` : ''}`;
      return i.update(render(ctx, 'realm', null, note));
    }
    case 'craft': {
      const recipe = state.recipes.find((x) => x.id === arg);
      if (!recipe) throw new UserError('Recipe not found.');
      const r = crafting.craft(state, c, recipe);
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
  requireAccess(i, 'menu');
  const parts = parse(i);
  const ctx = contextFrom(i, parts);
  const name = parts[4];
  const value = i.values[0];
  const state = st();
  if (name === 'item') return i.update(render(ctx, 'item', value));
  if (name === 'entry') return i.update(render(ctx, 'entry', value, null, [], parts[5] || 'all'));
  if (name === 'recipe') return i.update(render(ctx, 'recipe', value));
  ownerOnly(ctx);
  const { c } = ctx;
  if (name === 'switch') {
    const next = state.characters.find((x) => x.id === value && x.ownerId === i.user.id && x.status === 'active');
    if (!next) throw new UserError('Character not found.');
    state.users[i.user.id] = { ...(state.users[i.user.id] || {}), activeCharacterId: next.id };
    store.markDirty();
    return i.update(render({ ...ctx, c: next }, 'sheet', null, `🔁 Active character: **${next.name}**`));
  }
  if (name === 'forget') {
    const r = chars.forget(state, c, value);
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
  const state = st();
  const { c } = ctx;
  const numIn = (k) => Number(String(i.fields.getTextInputValue(k) || '0').replace(',', '.'));
  if (parts[1] === 'spend') {
    const entries = stats.ALL.map((k) => ({ stat: k, amount: numIn(k) || 0 })).filter((e) => e.amount > 0);
    if (!entries.length) throw new UserError('Type a number in at least one box.');
    pushUndo(i.user.id, c, entries.map((e) => `${stats.LABEL[e.stat]} +${e.amount}`).join(', '));
    try {
      const res = stats.applyAllocation(state, c, entries);
      store.log(actor(i), 'stats.allocate', `${c.name}: ${res.map((r) => `${stats.LABEL[r.stat]} +${fmt(r.gained)} (${fmt(r.spent)} pts)`).join(', ')}`);
      return i.update(render(ctx, 'stats', null, `${ui.emoji(state, 'ok')} ${res.map((r) => `${stats.LABEL[r.stat]} **+${fmt(r.gained)}**${r.softCapped ? ' *(soft cap)*' : ''}`).join(' · ')}`));
    } catch (e) {
      undoStacks.get(i.user.id)?.pop();
      throw e;
    }
  }
  if (parts[1] === 'buyq') {
    const note = buyEntry(i, ctx, parts[4], Math.floor(numIn('qty')));
    return i.update(render(ctx, panels.findEntry(parts[4], c) ? 'entry' : 'market', parts[4], note));
  }
  if (parts[1] === 'list') {
    const it = state.items.find((x) => x.id === parts[4]);
    if (!it) throw new UserError('Item not found.');
    const l = economy.listOnMarket(state, c, it, Math.floor(numIn('qty')), numIn('price'));
    store.log(actor(i), 'market.list', `${c.name}: ${l.qty}× ${it.name} @ ${l.price}`);
    return i.update(render(ctx, 'entry', `L.${l.id}`, `🏷️ Listed ${l.qty}× **${it.name}** at ${ui.emoji(state, 'nyang')} ${fmt(l.price)} each. Anyone can buy it from the Market.`, [], 'players'));
  }
}

const onComponent = (i) => (i.isAnySelectMenu() ? onSelect(i) : onButton(i));

module.exports = {
  commands: [
    { data: menu, execute: executeMenu },
    { data: marketCmd, execute: executeMarket },
  ],
  buttons: { m: onComponent },
  modals: { mm: onModal },
  render,
  VIEWS,
};
