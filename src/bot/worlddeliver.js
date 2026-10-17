'use strict';
/** Posts world news, events, battles and caravan results to Discord. */
const store = require('../store');
const templates = require('../engine/templates');
const W = require('../world');
const WP = require('./worldpanels');
const { sendToChannel } = require('./util');
const { truncate, fmt } = require('../utils');

const st = () => store.state;

async function dm(client, userId, payload) {
  try { const u = await client.users.fetch(userId); await u.send(payload); } catch {}
}

function channelFor(item) {
  const s = st();
  const ch = s.settings.channels;
  if (['battle', 'battle-result', 'war'].includes(item.kind) && ch.war) return [ch.war];
  if (item.kind === 'event' && item.regions?.length) {
    const own = [...new Set(item.regions.map((k) => s.world.regions[k]?.announceChannelId || s.world.regions[W.geo.provinceOf(k)]?.announceChannelId).filter(Boolean))];
    if (own.length) return [...own, ...(ch.world && !own.includes(ch.world) ? [ch.world] : [])].slice(0, 4);
  }
  return [ch.world || ch.announcements].filter(Boolean);
}

function makeDeliver(client) {
  const worldCmd = require('./commands/world');
  return async ({ caravans, battles, turn, queue }) => {
    const s = st();
    const cal = W.common.calendar(s).text;
    for (const item of queue) {
      if (item.kind === 'battle') {
        const b = s.world.battles.find((x) => x.id === item.battleId);
        if (!b) continue;
        const post = WP.battlePost(b);
        for (const id of channelFor(item)) {
          const m = await sendToChannel(client, id, { content: post.content, embeds: post.embeds, components: worldCmd.battleComponents(b), allowedMentions: { parse: [] } });
          if (m) (b.messages ||= []).push({ channelId: m.channelId, messageId: m.id });
        }
        continue;
      }
      if (item.kind === 'battle-result') continue; // posted with the battle below
      const key = item.kind === 'event' ? 'worldEvent' : 'worldNews';
      const payload = templates.render(s, key, { text: truncate(item.text, 3800), name: item.name || '', emoji: item.emoji || '', description: item.description || '', regions: (item.regions || []).map((k) => W.geo.label(s, k)).join(', '), turns: item.endTurn ? String(item.endTurn - s.world.turn) : '', calendar: cal });
      for (const id of channelFor(item)) await sendToChannel(client, id, { ...payload, allowedMentions: { parse: [] } });
    }
    for (const b of battles) {
      const report = WP.battleReport(b);
      for (const m of b.messages || []) {
        try { const ch = await client.channels.fetch(m.channelId); const msg = await ch.messages.fetch(m.messageId); await msg.edit({ components: [] }); await msg.reply({ ...report, allowedMentions: { parse: [] } }); } catch {}
      }
      if (!(b.messages || []).length) for (const id of channelFor({ kind: 'battle-result' })) await sendToChannel(client, id, { ...report, allowedMentions: { parse: [] } });
    }
    for (const { cv, c, g } of caravans) {
      if (!c) continue;
      const r = cv.result || {};
      await dm(client, c.ownerId, { content: `🐫 Your caravan of **${cv.qty} ${g?.name || cv.good}** reached **${W.geo.label(s, cv.to)}**.${r.lost ? ` 🏴 Bandits took ${Math.round(r.lost * 100)}% on the way.` : ''}${r.sold ? ` Sold ${r.sold} for ${fmt(r.earned)} ${s.settings.currencyName}.` : ''}${r.kept ? ` ${r.kept} could not be sold (the merchants ran out of coin) and went into your inventory.` : ''}` });
    }
    if (turn && s.world.settings.postTurnSummary && s.settings.channels.world) {
      const lines = [`🗓️ **Turn ${turn.turn}** — ${turn.calendar}`, `Average prosperity ${turn.avgProsperity}${turn.hungry.length ? ` · 🥣 hungry: ${turn.hungry.map((k) => W.geo.label(s, k)).join(', ')}` : ''}`];
      await sendToChannel(client, s.settings.channels.world, { content: truncate(lines.join('\n'), 1900), allowedMentions: { parse: [] } });
    }
  };
}

module.exports = { makeDeliver };
