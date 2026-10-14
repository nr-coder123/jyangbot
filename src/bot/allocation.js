'use strict';
/**
 * The 5-minute "type your stats in chat" window opened from /menu → 📊 Stats → "Type in chat".
 * While open, the bot reads the player's messages in that channel:
 *   strength 5
 *   mobility 5
 *   endurance 5
 * Words: "points" (show remaining), "undo" (revert this window), "done" (close).
 */
const store = require('../store');
const stats = require('../engine/stats');
const { UserError, clone, fmt } = require('../utils');

const sessions = new Map(); // userId -> session

function remainingText(c) {
  const st = store.state;
  const max = stats.maxPerStat(st, c);
  return [
    `Remaining: ${stats.poolsLine(st, c)}`,
    `Current: STR **${fmt(c.stats.strength)}** · END **${fmt(c.stats.endurance)}** · MOB **${fmt(c.stats.mobility)}** · Qi **${fmt(c.stats.qi)}** (stat total ${fmt(stats.normalTotal(c))})`,
    max !== Infinity ? `Max per stat (${st.settings.maxSingleStatPercent}% rule): **${fmt(max)}**` : '',
    ...stats.capLines(st, c),
  ].filter(Boolean).join('\n');
}

function open(channel, userId, c) {
  close(userId);
  const minutes = Number(store.state.settings.allocationWindowMinutes) || 5;
  const s = {
    userId,
    channelId: channel.id,
    charId: c.id,
    expiresAt: Date.now() + minutes * 60000,
    snapshot: clone({ stats: c.stats, pools: c.pools, impurity: c.impurity, burstApplied: c.burstApplied }),
    changes: [],
  };
  s.timer = setTimeout(() => {
    if (sessions.get(userId) === s) {
      sessions.delete(userId);
      channel.send({ content: `⌛ <@${userId}>, your stat window for **${c.name}** has closed.`, allowedMentions: { users: [userId] } }).catch(() => {});
    }
  }, minutes * 60000);
  sessions.set(userId, s);
  return { minutes, expiresAt: s.expiresAt };
}

function close(userId) {
  const s = sessions.get(userId);
  if (s) clearTimeout(s.timer);
  sessions.delete(userId);
  return s;
}

async function onMessage(msg) {
  if (msg.author.bot) return;
  const s = sessions.get(msg.author.id);
  if (!s || s.channelId !== msg.channelId) return;
  if (Date.now() > s.expiresAt) return close(msg.author.id);
  const st = store.state;
  const c = st.characters.find((x) => x.id === s.charId);
  if (!c) return close(msg.author.id);

  const text = msg.content.trim();
  const word = text.toLowerCase();
  const reply = (content) => msg.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});

  if (['done', 'finish', 'close', 'stop', 'cancel'].includes(word)) {
    close(msg.author.id);
    return reply(`✅ Stat window closed for **${c.name}**.\n${remainingText(c)}`);
  }
  if (word === 'undo' || word === 'reset') {
    Object.assign(c, clone(s.snapshot));
    s.changes = [];
    store.log({ id: msg.author.id, name: msg.author.username, source: 'discord' }, 'stats.undo', `${c.name}: reverted this allocation window`);
    return reply(`↩️ Reverted everything from this window.\n${remainingText(c)}`);
  }
  if (word === 'points' || word === 'remaining') return reply(remainingText(c));

  const entries = stats.parseAllocation(text);
  if (!entries.length) return; // ordinary chat, ignore
  try {
    const results = stats.applyAllocation(st, c, entries);
    s.changes.push(...results);
    store.log({ id: msg.author.id, name: msg.author.username, source: 'discord' }, 'stats.allocate', `${c.name}: ${results.map((r) => `${stats.LABEL[r.stat]} +${fmt(r.gained)} (${fmt(r.spent)} pts)`).join(', ')}`);
    const lines = results.map((r) => {
      let t = `• ${stats.LABEL[r.stat]} **+${fmt(r.gained)}**`;
      if (r.softCapped) t += ` *(soft cap: ${fmt(r.spent)} points → ${fmt(r.gained)})*`;
      if (r.hardCapped) t += ` *(hard cap: only ${fmt(r.spent)} of ${fmt(r.requested)} points used)*`;
      if (r.reset) t += ' *(Impurity reset — received Qi)*';
      return t;
    });
    const left = Math.max(0, Math.round((s.expiresAt - Date.now()) / 60000));
    return reply(`${lines.join('\n')}\n${remainingText(c)}\n-# Window closes in ~${left} min · type \`undo\` or \`done\``);
  } catch (e) {
    if (e instanceof UserError) return reply(`❌ ${e.message}\nNothing was changed.`);
    throw e;
  }
}

module.exports = { open, close, onMessage, remainingText, sessions };
