'use strict';
/**
 * Builds every panel the bot shows (sheet, stats, inventory, item, market, realm, crafting, compare…)
 * from the dashboard-editable templates. Each function returns { content?, embeds, ...extra }.
 */
const store = require('../store');
const world = require('../world');
const templates = require('../engine/templates');
const ui = require('../engine/ui');
const stats = require('../engine/stats');
const effects = require('../engine/effects');
const chars = require('../engine/characters');
const economy = require('../engine/economy');
const rolls = require('../engine/rolls');
const crafting = require('../engine/crafting');
const combat = require('../engine/combat');
const { BONUS_LABEL } = require('../engine/weapons');
const { ART_KIND_LABEL } = require('../defaults');
const { fmt, truncate } = require('../utils');

const S = () => store.state.settings;
const rarityOf = (name) => store.state.rarities.find((r) => r.name === name) || { name, color: '#888888', emoji: '⬜' };
const itemIcon = (it) => it.emoji || rarityOf(it.rarity).emoji || '•';
const refName = (ref, kind) => chars.refName(store.state, ref, kind);
const names = (refs) => (refs || []).map((r) => refName(r)).filter(Boolean);
const msg = (key, vars, opts) => templates.render(store.state, key, vars, opts);
const E = (k) => ui.emoji(store.state, k);
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

/** "35" or "__40__" when bonuses/effects changed the value. */
const shown = (base, eff) => (Math.abs(eff - base) > 1e-9 ? `__${fmt(eff)}__` : fmt(base));

function weaponText(w) {
  if (!w) return { weapon: 'None', weaponGrade: '', weaponDescription: '' };
  const grade = w.weapon?.grade && w.weapon.grade !== 'Default' ? w.weapon.grade : '';
  return { weapon: `${w.name}${grade ? ` — ${grade}` : ''}`, weaponGrade: grade, weaponDescription: truncate(w.description || '', 700) };
}

function bonusLines(sh) {
  const lines = sh.bonuses.map((b) => `${signed(b.amount)} ${BONUS_LABEL[b.stat] || b.stat} — ${b.source}`);
  if (sh.fx.statMultiplier !== 1) lines.push(`${signed(Math.round((sh.fx.statMultiplier - 1) * 100))}% Strength / Endurance / Mobility — Impurity`);
  if (sh.qiBars.effects) lines.push(`${signed(sh.qiBars.effects)} Qi Bars — Traits / cultivation`);
  if (sh.qiBars.overridden) lines.push(`Qi Bars set to ${fmt(sh.qiBars.total)} — Traits / cultivation`);
  return lines;
}

function unspentText(c) {
  if (c.pools.normal + c.pools.flex <= 0) return 'None';
  return `${fmt(c.pools.normal)} stat points (Strength/Endurance/Mobility) · ${fmt(c.pools.flex)} flexible points (any stat, incl. Qi) — press ${E('stats')} Stats in /menu`;
}

// ---------------- sheet ----------------
function sheetVars(c) {
  const st = store.state;
  const sh = effects.compute(st, c);
  const ma = c.martialArts;
  const qb = sh.qiBars;
  const title = chars.titleString(st, c);
  return {
    sh,
    vars: {
      name: c.name,
      title,
      nameAndTitle: title ? `${c.name}, "${title}"` : c.name,
      sect: c.sect || 'Rogue',
      ...weaponText(sh.weapon),
      strength: shown(c.stats.strength, sh.effStats.strength),
      endurance: shown(c.stats.endurance, sh.effStats.endurance),
      mobility: shown(c.stats.mobility, sh.effStats.mobility),
      qi: shown(c.stats.qi, sh.effStats.qi),
      qiBars: qb.temp || qb.weapon || qb.effects || qb.overridden ? `__${fmt(qb.total)}__` : fmt(qb.total),
      impurity: fmt(c.impurity),
      realm: sh.realm.name,
      cultivationMethods: names(c.cultivationMethods).join('\n') || 'None',
      qiCore: refName(c.qiCore) || 'None',
      traits: c.traits.map((t) => refName(t, 'trait')).filter(Boolean).join(', ') || 'None',
      nyang: fmt(c.nyang),
      currency: S().currencyName,
      rolls: String(c.rolls),
      coreArts: names(ma.core).join(', '),
      specialArts: names(ma.special).join(', '),
      forbiddenArts: names(ma.forbidden).join(', '),
      genericArts: names(ma.generic).join(', '),
      statTotal: fmt(sh.normalTotal),
      unspent: unspentText(c),
      nextRealm: sh.next ? `Next Realm: **${sh.next.name} —** needs ${fmt(sh.next.reqStats)} Stat Points & ${fmt(sh.next.reqQi)} Qi.` : 'Final realm reached.',
      bonuses: bonusLines(sh).join('\n'),
      caps: sh.capLines.join('\n'),
      effects: [...sh.drawbacks, ...sh.notes, ...sh.scriptErrors.map((x) => `${E('warning')} Script error — ${x}`), c.breakthroughBonus ? `${E('pill')} +${fmt(c.breakthroughBonus)}% Realm Breakthrough chance stored` : ''].filter(Boolean).join('\n'),
      owner: `<@${c.ownerId}>`,
      approvedBy: c.approvedBy?.name || '—',
    },
  };
}

const sheet = (c) => msg('characterSheet', sheetVars(c).vars);

// ---------------- stats ----------------
function statsPanel(c, isOwner) {
  const st = store.state;
  const { sh, vars } = sheetVars(c);
  const max = stats.maxPerStat(st, c);
  const has = c.pools.normal + c.pools.flex;
  return msg('statsPanel', {
    ...vars,
    normalPoints: fmt(c.pools.normal),
    flexPoints: fmt(c.pools.flex),
    maxPerStat: max === Infinity ? '—' : fmt(max),
    percentRule: String(st.settings.maxSingleStatPercent),
    capSummary: stats.capSummary(st, c),
    caps: sh.capLines.join('\n'),
    hint: isOwner ? (has > 0 ? 'Tap +1 / +5, or ✏️ Spend points to enter several stats at once.' : 'No points to spend — staff reward you after RPs and fights.') : `Viewing ${c.name}`,
  });
}

// ---------------- inventory & items ----------------
function ownedItems(c) {
  return Object.entries(c.inventory)
    .map(([id, q]) => ({ it: store.state.items.find((i) => i.id === id), q }))
    .filter((x) => x.it && x.q > 0);
}

function inventory(c) {
  const st = store.state;
  const order = st.rarities.map((r) => r.name);
  const owned = ownedItems(c).sort((a, b) => order.indexOf(b.it.rarity) - order.indexOf(a.it.rarity) || a.it.name.localeCompare(b.it.name));
  const weapon = effects.compute(st, c).weapon;
  const groups = {};
  for (const x of owned) (groups[x.it.rarity] ||= []).push(`${itemIcon(x.it)} **${x.it.name}** ×${x.q} · *${x.it.type}*${weapon && x.it.id === weapon.id ? ` · ${E('weapon')} equipped` : ''}`);
  const text = [...order].reverse().filter((n) => groups[n]).map((n) => `**${rarityOf(n).emoji} ${n}**\n${groups[n].join('\n')}`).join('\n');
  return msg('inventoryPanel', {
    name: c.name,
    items: truncate(text || '*Empty.*', 4000),
    weapon: weaponText(weapon).weapon,
    nyang: fmt(c.nyang),
    currency: S().currencyName,
    rolls: String(c.rolls),
  });
}

/** Details of a martial art / cultivation method / qi core. */
function artDetails(a) {
  const lines = [];
  if (['core', 'special', 'forbidden', 'generic'].includes(a.kind)) {
    if (a.replacesCore) lines.push('**Replaces the Core art** when learned');
    lines.push(a.shareable ? `Can be shared${a.shareLimit ? ` (max ${a.shareLimit})` : ''}` : "Can't be shared");
  } else {
    const aff = Object.entries(a.affinities || {}).filter(([, v]) => Number(v)).map(([k, v]) => `${k} ${signed(Number(v))}%`);
    if (a.kind === 'cultivation') lines.push(`**Absorption Rate**: ${fmt(a.baseAbsorption ?? 100)}%${a.absorption ? ` (${signed(a.absorption)}% bonus)` : ''}`);
    else if (a.absorption) lines.push(`**Absorption bonus**: ${signed(a.absorption)}%`);
    lines.push(`**Affinity**: ${aff.join(', ') || 'None'}`);
    if (a.impurityReduction) lines.push(`**Impurity from pills**: ${signed(-a.impurityReduction)}%`);
  }
  return lines.join('\n');
}

function itemDetails(it) {
  const p = it.pill || {};
  switch (it.type) {
    case 'manual': {
      const art = (store.state.arts || []).find((x) => x.id === it.manual?.artId);
      return art ? `**Teaches**: ${art.name} *(${ART_KIND_LABEL[art.kind]})*\n${artDetails(art)}` : '*Teaches nothing yet.*';
    }
    case 'pill': {
      const y = p.yieldType === 'none' ? 'None' : p.yieldType === 'points' ? `${fmt(p.yieldAmount)} stat points` : p.yieldType === 'flex' ? `${fmt(p.yieldAmount)} flexible points` : `+${fmt(p.yieldAmount)} ${stats.LABEL[p.yieldType] || p.yieldType}`;
      const realmName = p.peakRealm !== null && p.peakRealm !== undefined ? store.state.realms[p.peakRealm]?.name : null;
      return [
        `**Yield**: ${y}`,
        p.impurity < 0 ? `**Removes Impurity**: ${fmt(-p.impurity)}` : `**Impurity**: ${fmt(p.impurity)}`,
        `**Affinity**: ${p.element || 'None'}`,
        p.breakthroughBonus ? `**Realm Breakthrough**: +${fmt(p.breakthroughBonus)}%${p.keepOnFail ? ` (${fmt(p.keepOnFail)}% kept if the attempt fails)` : ''}` : '',
        realmName ? `**Made for**: ${realmName} — ${fmt(p.realmFalloff ?? 50)}% weaker per realm above` : '',
        p.tolerance ? `**Tolerance**: ${fmt(p.tolerance)}% weaker for each one taken this month` : '',
        p.monthlyLimit ? `**Limit**: ${p.monthlyLimit} per month` : '',
      ].filter(Boolean).join('\n');
    }
    case 'poison': {
      const x = it.poison;
      return [`**T${x.tier}**${x.repeatable ? ' [REPEATABLE]' : ''} · Affinity: ${x.element || 'None'} · Impurity +${fmt(x.impurity)}`, x.debuff && `**Debuff**: ${x.debuff}`, x.gimmick && `**Gimmick**: ${x.gimmick}`, x.activation && `**Activation**: ${x.activation}`, x.triggersBurst && `${E('warning')} Can trigger the 100-Impurity meridian burst`].filter(Boolean).join('\n');
    }
    case 'purification': {
      const x = it.purification;
      return [`**T${x.tier}** · Affinity: ${x.element || 'None'}`, x.gimmick && `**Gimmick**: ${x.gimmick}`].filter(Boolean).join('\n');
    }
    case 'weapon': {
      const b = Object.entries(it.bonuses || {}).filter(([, v]) => Number(v)).map(([k, v]) => `${signed(Number(v))} ${BONUS_LABEL[k]}`);
      return [`**Grade**: ${it.weapon?.grade || 'Default'}`, b.length ? `**When equipped**: ${b.join(', ')}` : ''].filter(Boolean).join('\n');
    }
    default:
      return '';
  }
}

function tradingText(it) {
  const st = store.state;
  const t = [];
  if (it.shop?.enabled) t.push(`Shop: **${fmt(it.shop.price)}** ${st.settings.currencyName}${it.shop.stock >= 0 ? ` (${it.shop.stock} left)` : ''}`);
  const sell = economy.shopSellPrice(st, it);
  if (sell > 0) t.push(`Shop buys for ${fmt(sell)}`);
  t.push(it.tradeable ? 'Tradeable' : 'Not tradeable');
  if (it.tradeable && it.marketable) t.push('Can be sold on the player market');
  return t.join(' · ');
}

function itemInfo(it, c = null) {
  const extra = [it.consumable && it.type !== 'pill' ? `**Consumable** — use it from your inventory or \`/consume\`${it.useEffect ? `\n**Effect:** ${it.useEffect}` : ''}` : '', it.type === 'pill' && it.useEffect ? `**Effect:** ${it.useEffect}` : ''].filter(Boolean).join('\n');
  const r = rarityOf(it.rarity);
  return msg('itemInfo', {
    item: it.name,
    emoji: itemIcon(it),
    rarity: it.rarity,
    rarityEmoji: r.emoji || '',
    type: it.type,
    description: truncate(it.description || '*No description.*', 3500),
    details: [itemDetails(it), extra].filter(Boolean).join('\n'),
    trading: tradingText(it),
    owned: c ? `×${economy.qtyOf(c, it.id)}` : '',
  }, { color: r.color });
}

// ---------------- market ----------------
/** Shop items + sect shops + player listings as one list. filter: all | players | shop | sect */
function marketEntries(filter = 'all', c = null) {
  const st = store.state;
  const out = [];
  if (filter === 'all' || filter === 'shop') {
    for (const it of economy.shopItems(st)) out.push({ kind: 'S', id: it.id, it, price: world.economy.dynamicItemPrice(st, it, it.shop.price, c), base: it.shop.price, qty: it.shop.stock, seller: null });
  }
  if ((filter === 'all' || filter === 'sect') && st.world?.settings?.enabled) {
    for (const o of world.economy.sectShopOffers(st, c)) {
      if (!o.allowed && filter === 'all') continue;
      out.push({ kind: 'F', id: `${o.faction.id}|${o.it.id}`, it: o.it, price: o.price, base: o.base, qty: o.stock, seller: null, faction: o.faction, terms: o });
    }
  }
  if (filter === 'all' || filter === 'players') {
    for (const l of st.market) {
      const it = st.items.find((x) => x.id === l.itemId);
      if (it) out.push({ kind: 'L', id: l.id, it, price: l.price, qty: l.qty, seller: st.characters.find((x) => x.id === l.sellerCharId), listing: l });
    }
  }
  return out.sort((a, b) => a.it.name.localeCompare(b.it.name) || a.price - b.price);
}

const FILTER_NAME = { all: 'Everything', players: 'Player market', shop: 'Shop', sect: 'Sect shops' };
const PER_PAGE = 20;
const TIER_LABEL = { member: 'member price', ally: 'ally price', neutral: 'outsider price', rival: 'rival price', war: 'enemy' };

function market(c, filter = 'all', page = 0) {
  const st = store.state;
  const list = marketEntries(filter, c);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  page = Math.max(0, Math.min(pages - 1, Number(page) || 0));
  const slice = list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const lines = slice.map((x) => (x.kind === 'S'
    ? `${E('shop')} ${itemIcon(x.it)} **${x.it.name}** — ${E('nyang')} ${fmt(x.price)}${x.price !== x.base ? ` *(base ${fmt(x.base)})*` : ''} · Shop${x.qty >= 0 ? ` (${x.qty} left)` : ''}`
    : x.kind === 'F'
      ? `${x.faction.icon || '🏯'} ${itemIcon(x.it)} **${x.it.name}** — ${x.terms.allowed ? `${E('nyang')} ${fmt(x.price)} · ${x.faction.name} (${TIER_LABEL[x.terms.tier] || x.terms.tier})` : `🔒 ${x.terms.reason}`}${x.qty >= 0 ? ` (${x.qty} left)` : ''}`
      : `${E('player')} ${itemIcon(x.it)} **${x.it.name}** ×${x.qty} — ${E('nyang')} ${fmt(x.price)} each · by ${x.seller?.name || '?'}`));
  const empty = filter === 'players' ? 'No player listings yet. Sell yours from Inventory → List on market.' : filter === 'sect' ? 'No sect sells anything yet (staff set sect shops in the dashboard → Politics).' : 'Nothing for sale yet.';
  return {
    ...msg('marketPanel', { filter: FILTER_NAME[filter] || filter, entries: truncate(lines.join('\n') || empty, 4000), page: String(page + 1), pages: String(pages), nyang: fmt(c.nyang), currency: st.settings.currencyName }),
    slice, page, pages,
  };
}

function findEntry(key, c = null) {
  const i = String(key).indexOf('.');
  const kind = String(key).slice(0, i); const id = String(key).slice(i + 1);
  return marketEntries('all', c).find((x) => x.kind === kind && x.id === id) || marketEntries('sect', c).find((x) => x.kind === kind && x.id === id) || null;
}

function marketEntry(c, entry) {
  const st = store.state;
  const it = entry.it;
  return msg('marketEntry', {
    item: it.name,
    emoji: itemIcon(it),
    rarity: it.rarity,
    description: truncate(it.description || '*No description.*', 3000),
    price: `${E('nyang')} ${fmt(entry.price)} ${st.settings.currencyName}${entry.kind === 'L' ? ' each' : ''}`,
    seller: entry.kind === 'S' ? 'Shop' : entry.kind === 'F' ? `${entry.faction.name} (${TIER_LABEL[entry.terms.tier] || entry.terms.tier}${entry.terms.pct ? `, ${entry.terms.pct > 0 ? '+' : ''}${entry.terms.pct}%` : ''})` : entry.seller?.name || '?',
    available: entry.qty >= 0 ? String(entry.qty) : 'Unlimited',
    details: itemDetails(it),
    nyang: fmt(c.nyang),
    currency: st.settings.currencyName,
  }, { color: rarityOf(it.rarity).color });
}

// ---------------- realm ----------------
function realm(c) {
  const st = store.state;
  const { sh, vars } = sheetVars(c);
  const chk = stats.breakthroughCheck(st, c);
  const ch = chars.breakthroughChance(st, c);
  const mark = (ok) => E(ok ? 'ok' : 'missing');
  const next = chk.next
    ? [`**Next realm: ${chk.next.name}**`,
      `${mark(sh.normalTotal >= chk.next.reqStats)} ${fmt(chk.next.reqStats)} stat points`,
      `${mark(c.stats.qi >= chk.next.reqQi)} ${fmt(chk.next.reqQi)} Qi`,
      '',
      `**Breakthrough chance: ${fmt(ch.total)}%**`,
      `-# Base ${fmt(ch.base)}%${ch.pills ? ` · pills +${fmt(ch.pills)}%` : ''}${ch.scriptDelta ? ` · effects ${signed(ch.scriptDelta)}%` : ''} — consume breakthrough pills first to raise it.`].join('\n')
    : '🏔️ You have reached the final realm.';
  const ladder = st.realms.map((r, idx) => `${idx === c.realm ? '▶' : idx < c.realm ? '·' : '　'} ${idx === c.realm ? `**${r.name}**` : r.name}`).join('\n');
  return {
    ...msg('realmPanel', { ...vars, capSummary: stats.capSummary(st, c), caps: sh.capLines.join('\n'), next, ladder: truncate(ladder, 1024) }),
    check: chk,
    chance: ch,
  };
}

// ---------------- crafting ----------------
function craftList(c, page = 0) {
  const st = store.state;
  const list = st.recipes.filter((r) => r.enabled);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  page = Math.max(0, Math.min(pages - 1, Number(page) || 0));
  const slice = list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const lines = slice.map((r) => `${crafting.check(st, c, r).ok ? E('ok') : '▫️'} **${r.name}** — ${crafting.describe(st, r)}`);
  return { ...msg('craftPanel', { recipes: truncate(lines.join('\n') || 'No recipes yet. Staff add them in the dashboard.', 4000), page: String(page + 1), pages: String(pages) }), slice, page, pages };
}

function recipe(c, r) {
  const st = store.state;
  const chk = crafting.check(st, c, r);
  const needs = [
    ...chk.inputs.map((x) => `${E(x.have >= x.need ? 'ok' : 'missing')} ${x.need}× ${x.item?.name || '?'} *(you have ${x.have})*`),
    r.nyangCost ? `${E(c.nyang >= r.nyangCost ? 'ok' : 'missing')} ${fmt(r.nyangCost)} ${st.settings.currencyName}` : '',
    r.minRealm ? `${E((c.realm || 0) >= r.minRealm ? 'ok' : 'missing')} Realm ${st.realms[r.minRealm]?.name} or higher` : '',
  ].filter(Boolean).join('\n');
  const makes = r.outputs.map((o) => `${o.qty}× ${st.items.find((i) => i.id === o.itemId)?.name || '?'}`).join('\n');
  const chance = `Success chance: **${fmt(r.successChance)}%**${r.successChance < 100 ? (r.consumeOnFail ? ' — materials are lost on failure' : ' — materials are kept on failure') : ''}`;
  return { ...msg('recipePanel', { recipe: r.name, description: r.description, needs, makes, chance }), check: chk };
}

function dropRates(c) {
  const rows = rolls.chanceTable(store.state, c);
  return msg('dropRates', {
    rates: rows.map((r) => `${r.emoji} **${r.name}** — ${fmt(r.percent)}% · ${r.items} item(s) can drop`).join('\n'),
    note: c?.sect ? `Includes ${c.sect} bonuses, if any. Each roll uses one drop roll.` : 'Each roll uses one drop roll. Staff give rolls as rewards.',
  });
}

function consumeResult(c, it, lines) {
  return msg('consumeResult', { name: c.name, player: `<@${c.ownerId}>`, item: it.name, lines: truncate(lines.join('\n') || 'Nothing happened.', 4000) });
}

// ---------------- compare ----------------
function tierText(res, diff, formula) {
  if (!res.row) return '—';
  const r = res.row;
  let t = `${formula ? `${formula} = ` : ''}**${signed(diff)}** → **${r.tier ? `${r.tier} ` : ''}${r.name}**\n${r.desc}`;
  if (res.capped) t += `\n-# Would be ${res.wanted.tier || ''} ${res.wanted.name}, but that needs +${res.wanted.reqRT} Realm Tier${res.wanted.reqRT > 1 ? 's' : ''} above the enemy.`;
  return truncate(t, 1024);
}

function compare(a, b) {
  const st = store.state;
  const r = combat.compare(st, a, b);
  const A = r.a.s;
  const B = r.b.s;
  const rtTxt = r.rt === 0 ? 'Same realm tier' : `${r.rt > 0 ? a.name : b.name} is ${Math.abs(r.rt)} realm tier${Math.abs(r.rt) > 1 ? 's' : ''} higher`;
  const line = (k) => `${E(k)} ${stats.LABEL[k]}: ${fmt(A[k])} vs ${fmt(B[k])}`;
  return msg('compare', {
    first: a.name,
    second: b.name,
    header: [`**${a.name}** — ${r.a.realm} · **${b.name}** — ${r.b.realm} · ${rtTxt}`, line('strength'), line('endurance'), line('mobility'), line('qi'), '-# Current effective stats (weapons, impurity and temporary effects included).'].join('\n'),
    firstHits: tierText(r.aHitsB, r.aHitsB.diff, `STR ${fmt(A.strength)} − END ${fmt(B.endurance)}`),
    secondHits: tierText(r.bHitsA, r.bHitsA.diff, `STR ${fmt(B.strength)} − END ${fmt(A.endurance)}`),
    clash: tierText(r.clash, r.clash.diff),
    clashWinner: r.clash.winner ? ` — ${r.clash.winner.name} wins` : '',
    speed: tierText(r.speed, r.speed.diff),
    faster: r.speed.faster ? ` — ${r.speed.faster.name} is faster` : '',
    notes: `${st.combat.damageNote || ''} ${st.combat.clashNote || ''}`.trim(),
  });
}

module.exports = {
  rarityOf, itemIcon, sheet, sheetVars, statsPanel, ownedItems, inventory, itemInfo, itemDetails, marketEntries, findEntry, market, marketEntry,
  realm, craftList, recipe, dropRates, consumeResult, compare, FILTER_NAME, artDetails,
};
