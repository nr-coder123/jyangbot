'use strict';
/** Embeds for stat sheets, items and inventories. */
const { EmbedBuilder } = require('discord.js');
const store = require('../store');
const effects = require('../engine/effects');
const stats = require('../engine/stats');
const chars = require('../engine/characters');
const economy = require('../engine/economy');
const { fmt, truncate } = require('../utils');

const rarityOf = (name) => store.state.rarities.find((r) => r.name === name) || { name, color: '#888888', emoji: '⬜' };
const itemIcon = (it) => it.emoji || rarityOf(it.rarity).emoji || '•';
const refName = (ref, kind) => chars.refName(store.state, ref, kind);
const field = (s) => truncate(s || '—', 1024);

function sheetEmbed(c) {
  const st = store.state;
  const sh = effects.compute(st, c);
  const line = (k) => {
    const base = c.stats[k];
    const eff = sh.effStats[k];
    return `**${stats.LABEL[k]}**: ${fmt(base)}${Math.abs(eff - base) > 1e-9 ? ` → **${fmt(eff)}**` : ''}`;
  };
  const list = (refs) => (refs || []).map((r) => refName(r)).filter(Boolean);
  const ma = c.martialArts;
  const qiBarsTxt = `${fmt(sh.qiBars.total)}${sh.qiBars.temp ? ` *(incl. ${sh.qiBars.temp > 0 ? '+' : ''}${fmt(sh.qiBars.temp)} temporary)*` : ''}`;
  const desc = [
    '### Name', c.name,
    '### Titles', chars.titleString(st, c),
    '### Sect', c.sect || 'Rogue',
    '',
    `**[__\`\`Realm\`\`__]**: ${sh.realm.name}`,
    '',
    line('strength'), line('endurance'), line('mobility'),
    '',
    line('qi'),
    `**Qi Bars**: ${qiBarsTxt}`,
    '',
    `**[\`\`Impurity\`\`]**: ${fmt(c.impurity)}`,
    '',
    `**[\`\`Special Traits\`\`]**: ${c.traits.map((t) => refName(t, 'trait')).filter(Boolean).join(', ')}`,
    '### Cultivation Methods', list(c.cultivationMethods).join('\n') || '—',
    '### Qi Core', refName(c.qiCore) || '—',
    '### Martial Arts',
    `**Core**: ${list(ma.core).join(', ')}`,
    `**Special**: ${list(ma.special).join(', ')}`,
    `**Forbidden/Heavenly**: ${list(ma.forbidden).join(', ')}`,
    `**Generic**: ${list(ma.generic).join(', ')}`,
  ].join('\n');

  const e = new EmbedBuilder().setColor('#b3261e').setDescription(truncate(desc, 4096));
  const unspent = c.pools.normal + c.pools.flex;
  e.addFields({
    name: 'Progress',
    value: field([
      `Stat total: **${fmt(sh.normalTotal)}** *(Qi not counted)*`,
      unspent > 0 ? `Unspent: ${stats.poolsLine(st, c)} — use \`/stats allocate\`` : 'No unspent points.',
      stats.capSummary(st, c),
      sh.next ? `Next realm **${sh.next.name}**: needs ${fmt(sh.next.reqStats)} stat points & ${fmt(sh.next.reqQi)} Qi` : 'Final realm reached.',
    ].join('\n')),
  });
  if (sh.capLines.length) e.addFields({ name: 'Caps', value: field(sh.capLines.join('\n')) });
  const fx = [...sh.drawbacks, ...sh.notes, ...sh.scriptErrors.map((x) => `⚠️ Script error — ${x}`)];
  if (fx.length) e.addFields({ name: 'Active effects', value: field(fx.join('\n')) });
  e.addFields({ name: 'Purse', value: `${st.settings.currencyEmoji} **${fmt(c.nyang)}** ${st.settings.currencyName} · 🎲 ${c.rolls} drop roll(s)${c.breakthroughBonus ? ` · 💊 +${fmt(c.breakthroughBonus)}% breakthrough` : ''}`, inline: false });
  e.setFooter({ text: truncate(`Owner: ${c.ownerTag || c.ownerId} · Approved by ${c.approvedBy?.name || '—'} · ID ${c.id}`, 2048) });
  return e;
}

function itemEmbed(it) {
  const st = store.state;
  const r = rarityOf(it.rarity);
  const e = new EmbedBuilder()
    .setTitle(truncate(`${itemIcon(it)} ${it.name}`, 256))
    .setColor(r.color || '#888888')
    .setDescription(truncate(it.description || '*No description.*', 4096));
  const f = [{ name: 'Rarity', value: `${r.emoji || ''} ${it.rarity}`, inline: true }, { name: 'Type', value: it.type, inline: true }];
  if (it.type === 'manual') {
    const m = it.manual;
    f.push({ name: 'Martial Art', value: field(`${m.category === 'forbidden' ? 'Forbidden/Heavenly' : m.category[0].toUpperCase() + m.category.slice(1)}${m.replacesCore ? ' · **replaces Core**' : ''}\n${m.shareable ? `Can be shared${m.shareLimit ? ` (max ${m.shareLimit})` : ''}` : "Can't be shared"}`), inline: true });
  }
  if (it.type === 'cultivation' || it.type === 'core') {
    const aff = Object.entries(it.cultivation.affinities || {}).filter(([, v]) => Number(v)).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}%`);
    f.push({ name: 'Absorption', value: field(`General: ${fmt(it.cultivation.absorption)}%\nAffinity: ${aff.join(', ') || 'None'}`), inline: true });
  }
  if (it.type === 'pill') {
    const p = it.pill;
    const y = p.yieldType === 'none' ? 'None' : p.yieldType === 'points' ? `${fmt(p.yieldAmount)} stat points` : p.yieldType === 'flex' ? `${fmt(p.yieldAmount)} flexible points` : `+${fmt(p.yieldAmount)} ${stats.LABEL[p.yieldType] || p.yieldType}`;
    f.push({ name: 'Elixir', value: field(`Yield: **${y}**\nImpurity: **${fmt(p.impurity)}**\nAffinity: ${p.element || 'None'}${p.breakthroughBonus ? `\nBreakthrough chance: **+${fmt(p.breakthroughBonus)}%**` : ''}`), inline: false });
  }
  if (it.type === 'poison') {
    const p = it.poison;
    f.push({ name: `Poison — T${p.tier}${p.repeatable ? ' [REPEATABLE]' : ''}`, value: field([`Affinity: ${p.element || 'None'}`, `Impurity: +${fmt(p.impurity)}`, p.debuff && `**Debuff**: ${p.debuff}`, p.gimmick && `**Gimmick**: ${p.gimmick}`, p.activation && `Activation: ${p.activation}`, p.triggersBurst && '⚠️ Can trigger the 100-Impurity meridian burst'].filter(Boolean).join('\n')) });
  }
  if (it.type === 'purification') {
    const p = it.purification;
    f.push({ name: `Purification — T${p.tier}`, value: field([`Affinity: ${p.element || 'None'}`, p.gimmick && `**Gimmick**: ${p.gimmick}`].filter(Boolean).join('\n')) });
  }
  const trade = [];
  if (it.shop?.enabled) trade.push(`Shop: **${fmt(it.shop.price)}** ${st.settings.currencyName}${it.shop.stock >= 0 ? ` (${it.shop.stock} left)` : ''}`);
  const sell = economy.shopSellPrice(st, it);
  if (sell > 0) trade.push(`Shop buys for ${fmt(sell)}`);
  trade.push(it.tradeable ? 'Tradeable' : 'Not tradeable');
  if (it.inDropPool) trade.push('In drop pool');
  f.push({ name: 'Trading', value: field(trade.join(' · ')) });
  e.addFields(f);
  return e;
}

function inventoryEmbed(c) {
  const st = store.state;
  const entries = Object.entries(c.inventory)
    .map(([id, q]) => ({ it: st.items.find((i) => i.id === id), q }))
    .filter((x) => x.it && x.q > 0);
  const order = st.rarities.map((r) => r.name);
  entries.sort((a, b) => order.indexOf(b.it.rarity) - order.indexOf(a.it.rarity) || a.it.name.localeCompare(b.it.name));
  const e = new EmbedBuilder().setTitle(`🎒 ${c.name}'s Inventory`).setColor('#7a5c2e');
  const groups = {};
  for (const x of entries) (groups[x.it.rarity] ||= []).push(`${itemIcon(x.it)} **${x.it.name}** ×${x.q} · *${x.it.type}*`);
  for (const name of [...order].reverse()) {
    if (groups[name]) e.addFields({ name: `${rarityOf(name).emoji} ${name}`, value: field(groups[name].join('\n')) });
  }
  if (!entries.length) e.setDescription('*Empty.*');
  e.setFooter({ text: `${fmt(c.nyang)} ${st.settings.currencyName} · ${c.rolls} drop roll(s) · /item info to read descriptions` });
  return e;
}

module.exports = { rarityOf, itemIcon, sheetEmbed, itemEmbed, inventoryEmbed };
