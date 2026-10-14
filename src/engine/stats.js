'use strict';
/**
 * Stat points, soft/hard caps, the 50% rule and Qi gains.
 *
 * Pools:
 *   pools.normal — points that can only go into Strength / Endurance / Mobility   (/give all)
 *   pools.flex   — points that can go anywhere, including Qi   (/give allqi, starting points)
 * "Stat total" = Strength + Endurance + Mobility (Qi never counts).
 */
const scripts = require('./scripts');
const { r2, fmt, clone, numOrNull, UserError } = require('../utils');

const NORMAL = ['strength', 'endurance', 'mobility'];
const ALL = [...NORMAL, 'qi'];
const LABEL = { strength: 'Strength', endurance: 'Endurance', mobility: 'Mobility', qi: 'Qi' };
const ALIASES = {
  strength: 'strength', strenght: 'strength', str: 'strength',
  endurance: 'endurance', endu: 'endurance', end: 'endurance',
  mobility: 'mobility', mob: 'mobility', agility: 'mobility', agi: 'mobility',
  qi: 'qi', chi: 'qi',
};

const normalTotal = (c) => r2(NORMAL.reduce((s, k) => s + (Number(c.stats[k]) || 0), 0));
const realmOf = (state, c) => state.realms[Math.max(0, Math.min(c.realm || 0, state.realms.length - 1))];
const nextRealmOf = (state, c) => state.realms[(c.realm || 0) + 1] || null;

function caps(state, c) {
  const r = realmOf(state, c) || {};
  return {
    soft: numOrNull(r.softCapStats),
    hard: numOrNull(r.hardCapStats),
    softQi: numOrNull(r.softCapQi),
    hardQi: numOrNull(r.hardCapQi),
    mult: state.settings.softCapGainMultiplier ?? 0.5,
  };
}

/** How much a normal stat really grows when `points` are spent, starting from stat total `total`. */
function normalGain(total, points, cp) {
  let remaining = Math.max(0, Number(points) || 0);
  let gained = 0;
  let t = total;
  const soft = cp.soft ?? Infinity;
  const hard = cp.hard ?? Infinity;
  if (t < soft && t < hard) {
    const full = Math.min(remaining, soft - t, hard - t);
    gained += full;
    remaining -= full;
    t += full;
  }
  if (remaining > 0 && t < hard && cp.mult > 0) {
    const part = Math.min(remaining * cp.mult, hard - t);
    gained += part;
    remaining -= part / cp.mult;
    t += part;
  }
  return { gained: r2(gained), spent: r2((Number(points) || 0) - remaining) };
}

function resetImpurityOf(c) {
  c.impurity = 0;
  c.burstApplied = false;
}

/** Add Qi directly (Breakthroughs, pills, points). Applies script hooks and the Qi hard cap. */
function gainQi(state, c, amount, { resetImpurity = false, source = 'unknown' } = {}) {
  amount = Number(amount) || 0;
  if (amount < 0) {
    const before = c.stats.qi;
    c.stats.qi = r2(Math.max(0, c.stats.qi + amount));
    return { gained: r2(c.stats.qi - before), effective: amount, capped: false, reset: false, errors: [] };
  }
  let effective = amount;
  let errors = [];
  if (amount > 0) {
    const res = scripts.runChain(state, c, 'qiGain', amount, { extra: { source } });
    const v = Number(res.value);
    if (Number.isFinite(v) && v >= 0) effective = v;
    errors = res.errors;
  }
  const cp = caps(state, c);
  const room = Math.max(0, (cp.hardQi ?? Infinity) - c.stats.qi);
  const gained = r2(Math.min(effective, room));
  c.stats.qi = r2(c.stats.qi + gained);
  let reset = false;
  if (gained > 0 && resetImpurity && (c.impurity > 0 || c.burstApplied)) {
    resetImpurityOf(c);
    reset = true;
  }
  return { gained, effective: r2(effective), capped: effective > room, reset, errors };
}

/** Raise a normal stat directly (pill yields). Soft/hard caps apply. */
function gainStat(state, c, stat, amount) {
  const { gained } = normalGain(normalTotal(c), amount, caps(state, c));
  c.stats[stat] = r2(c.stats[stat] + gained);
  return gained;
}

/** Spend unspent points into one stat. Mutates c. */
function spendPoints(state, c, stat, amount) {
  amount = r2(amount);
  if (!(amount > 0)) throw new UserError(`The amount for ${LABEL[stat]} must be above 0.`);
  if (stat === 'qi') {
    if (c.pools.flex < amount) throw new UserError(`Not enough points for Qi: you have **${fmt(c.pools.flex)}** flexible points. (Only starting points and "allqi" points can go into Qi.)`);
    const res = gainQi(state, c, amount, { resetImpurity: state.settings.staffQiResetsImpurity, source: 'points' });
    if (res.gained <= 0) throw new UserError('No Qi could be gained — you are at the Qi hard cap for your realm.');
    const spent = res.gained >= res.effective ? amount : r2((amount * res.gained) / res.effective);
    c.pools.flex = r2(c.pools.flex - spent);
    return { stat, requested: amount, spent, gained: res.gained, hardCapped: spent < amount, softCapped: false, reset: res.reset };
  }
  const avail = r2(c.pools.normal + c.pools.flex);
  if (avail < amount) throw new UserError(`Not enough points: you asked for **${fmt(amount)}** but only have **${fmt(avail)}** to spend.`);
  const cp = caps(state, c);
  const { gained, spent } = normalGain(normalTotal(c), amount, cp);
  if (spent <= 0) throw new UserError(`You are **hard capped** at ${fmt(cp.hard)} stat points for ${realmOf(state, c).name}. A Realm Breakthrough is needed to grow further.`);
  c.stats[stat] = r2(c.stats[stat] + gained);
  const fromNormal = Math.min(c.pools.normal, spent);
  c.pools.normal = r2(c.pools.normal - fromNormal);
  c.pools.flex = r2(c.pools.flex - (spent - fromNormal));
  return { stat, requested: amount, spent, gained, softCapped: gained < spent, hardCapped: spent < amount };
}

/** The biggest value a single normal stat may have under the 50% rule. */
function maxPerStat(state, c) {
  const pct = Number(state.settings.maxSingleStatPercent) || 0;
  if (pct <= 0 || pct >= 100) return Infinity;
  const denom = normalTotal(c) + (c.pools.normal || 0) + (c.pools.flex || 0);
  return r2((denom * pct) / 100);
}

/** Returns an error message if the 50% rule is broken for any of `keys`, otherwise null. */
function check50(state, c, keys) {
  const max = maxPerStat(state, c);
  if (max === Infinity) return null;
  const pct = state.settings.maxSingleStatPercent;
  for (const k of keys) {
    if (k === 'qi') continue;
    if (c.stats[k] > max + 1e-9) {
      return `**${LABEL[k]}** would be ${fmt(c.stats[k])}, but no stat may hold more than ${pct}% of your stat points (max **${fmt(max)}**). Qi doesn't count towards the total.`;
    }
  }
  return null;
}

/** Turn "strength 5\nmobility 5, qi 3" into [{stat, amount}]. */
function parseAllocation(text) {
  const rx = /\b(strength|strenght|str|endurance|endu|end|mobility|mob|agility|agi|qi|chi)\b\s*[:=+]?\s*(\d+(?:[.,]\d+)?)/gi;
  const out = [];
  let m;
  while ((m = rx.exec(String(text || '')))) out.push({ stat: ALIASES[m[1].toLowerCase()], amount: Number(m[2].replace(',', '.')) });
  return out;
}

/** Apply several allocations at once; all-or-nothing. */
function applyAllocation(state, c, entries) {
  if (!entries.length) throw new UserError('Nothing to allocate. Example: `strength 5`');
  const work = clone(c);
  const results = entries.map((e) => spendPoints(state, work, e.stat, e.amount));
  const keys = entries.some((e) => e.stat === 'qi') ? NORMAL : [...new Set(entries.map((e) => e.stat))];
  const err = check50(state, work, keys);
  if (err) throw new UserError(err);
  Object.assign(c, work);
  return results;
}

/** Points (raw) that can still be granted before the stat hard cap, counting points already waiting in pools. */
function rawNormalCapacity(state, c) {
  if (state.settings.discardPointsPastHardCap === false) return Infinity;
  const cp = caps(state, c);
  if (cp.hard == null) return Infinity;
  const base = normalTotal(c);
  const T = base + normalGain(base, (c.pools.normal || 0) + (c.pools.flex || 0), cp).gained;
  const soft = cp.soft == null ? cp.hard : Math.min(cp.soft, cp.hard);
  let raw = 0;
  if (T < soft) raw += soft - T;
  const from = Math.max(T, soft);
  if (cp.hard > from) raw += cp.mult > 0 ? (cp.hard - from) / cp.mult : 0;
  return r2(Math.max(0, raw));
}

function qiRoom(state, c) {
  const cp = caps(state, c);
  return cp.hardQi == null ? Infinity : r2(Math.max(0, cp.hardQi - c.stats.qi));
}

/** Staff grants: kind 'all' (normal pool) or 'allqi' (flex pool). Negative amounts remove points. */
function grantPoints(state, c, kind, amount) {
  const pool = kind === 'allqi' ? 'flex' : 'normal';
  amount = r2(amount);
  if (amount < 0) {
    const take = Math.min(-amount, c.pools[pool]);
    c.pools[pool] = r2(c.pools[pool] - take);
    return { granted: -take, discarded: 0, preview: null };
  }
  let cap = rawNormalCapacity(state, c);
  if (kind === 'allqi') cap += qiRoom(state, c);
  const granted = r2(Math.min(amount, cap));
  const cp = caps(state, c);
  const base = normalTotal(c);
  const T = base + normalGain(base, c.pools.normal + c.pools.flex, cp).gained;
  const preview = normalGain(T, granted, cp);
  c.pools[pool] = r2(c.pools[pool] + granted);
  return { granted, discarded: r2(amount - granted), preview };
}

/** Human-readable soft/hard cap warnings for sheets and commands. */
function capLines(state, c) {
  const cp = caps(state, c);
  const T = normalTotal(c);
  const q = c.stats.qi;
  const out = [];
  if (cp.hard != null && T >= cp.hard) out.push(`⛔ **Hard capped** — ${fmt(T)}/${fmt(cp.hard)} stat points. A Realm Breakthrough is needed to grow further.`);
  else if (cp.soft != null && T >= cp.soft) out.push(`⚠️ **Soft cap reached** (${fmt(cp.soft)}) — stat gains are reduced by ${Math.round((1 - cp.mult) * 100)}% until the hard cap of ${fmt(cp.hard ?? Infinity)}.`);
  if (cp.hardQi != null && q >= cp.hardQi) out.push(`⛔ **Qi hard capped** at ${fmt(cp.hardQi)}.`);
  else if (cp.softQi != null && q >= cp.softQi) out.push(`ℹ️ **Qi soft cap** (${fmt(cp.softQi)}) reached — Qi gains are not reduced, hard cap is ${fmt(cp.hardQi ?? Infinity)}.`);
  return out;
}

function capSummary(state, c) {
  const cp = caps(state, c);
  return `Stats: soft ${fmt(cp.soft ?? Infinity)} / hard ${fmt(cp.hard ?? Infinity)} · Qi: soft ${fmt(cp.softQi ?? Infinity)} / hard ${fmt(cp.hardQi ?? Infinity)}`;
}

function breakthroughCheck(state, c) {
  const next = nextRealmOf(state, c);
  if (!next) return { next: null, ok: false, reasons: ['You are already at the final realm.'] };
  const reasons = [];
  const T = normalTotal(c);
  if (T < (Number(next.reqStats) || 0)) reasons.push(`Stat points ${fmt(T)}/${fmt(next.reqStats)}`);
  if (c.stats.qi < (Number(next.reqQi) || 0)) reasons.push(`Qi ${fmt(c.stats.qi)}/${fmt(next.reqQi)}`);
  return { next, ok: reasons.length === 0, reasons };
}

function poolsLine(state, c) {
  return `**${fmt(c.pools.normal)}** stat points (Strength/Endurance/Mobility) · **${fmt(c.pools.flex)}** flexible points (any stat, incl. Qi)`;
}

module.exports = {
  NORMAL, ALL, LABEL, ALIASES, normalTotal, realmOf, nextRealmOf, caps, normalGain, gainQi, gainStat, resetImpurityOf,
  spendPoints, maxPerStat, check50, parseAllocation, applyAllocation, rawNormalCapacity, qiRoom, grantPoints,
  capLines, capSummary, breakthroughCheck, poolsLine,
};
