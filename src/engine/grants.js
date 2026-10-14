'use strict';
/**
 * Staff rewards and deductions, shared by /give, /take, the progress "Grant" button and the dashboard.
 *   all     -> stat points for Strength/Endurance/Mobility only
 *   allqi   -> flexible points (any stat, including Qi)
 *   qi      -> Qi directly (a Breakthrough). Resets impurity.
 *   nyang, rolls, qibars
 * Every function returns { lines, summary }:
 *   summary = short text for reports ("+50 Stat Points"), lines = details/warnings.
 */
const stats = require('./stats');
const { r2, fmt, num, UserError } = require('../utils');

const GRANT_TYPES = ['all', 'allqi', 'qi', 'nyang', 'rolls', 'qibars'];
const TAKE_TYPES = ['all', 'allqi', 'stat', 'nyang', 'rolls', 'qibars'];

function positive(amount) {
  amount = Number(amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new UserError('Amount must be a number above 0.');
  return amount;
}

function grant(state, c, type, amount) {
  type = String(type || '').toLowerCase().trim();
  if (!GRANT_TYPES.includes(type)) throw new UserError(`Unknown type "${type}". Use one of: ${GRANT_TYPES.join(', ')}.`);
  amount = positive(amount);
  const s = state.settings;
  const lines = [];
  let summary = '';
  switch (type) {
    case 'all':
    case 'allqi': {
      const r = stats.grantPoints(state, c, type, amount);
      summary = type === 'all' ? `+${fmt(r.granted)} Stat Points` : `+${fmt(r.granted)} Points (Qi allowed)`;
      lines.push(type === 'all' ? 'Spendable on Strength / Endurance / Mobility.' : 'Spendable on any stat, **including Qi**.');
      if (r.discarded > 0) lines.push(`⛔ ${fmt(r.discarded)} points discarded — hard cap for ${stats.realmOf(state, c).name}.`);
      if (r.preview && r.granted > 0 && r.preview.gained < r.granted - 1e-9) {
        lines.push(`⚠️ Soft cap: spent on Strength/Endurance/Mobility they're worth about **${fmt(r.preview.gained)}** stat points.`);
      }
      break;
    }
    case 'qi': {
      const r = stats.gainQi(state, c, amount, { resetImpurity: s.staffQiResetsImpurity, source: 'staff' });
      summary = `+${fmt(r.gained)} Qi`;
      if (r.effective < amount) lines.push(`ℹ️ A cultivation effect changed the gain from ${fmt(amount)} to ${fmt(r.effective)}.`);
      if (r.capped) lines.push(`⛔ Qi hard cap reached (${fmt(stats.caps(state, c).hardQi)}).`);
      if (r.reset) lines.push('🧹 Impurity reset to 0.');
      break;
    }
    case 'nyang':
      c.nyang = r2(c.nyang + amount);
      summary = `+${fmt(amount)} ${s.currencyName}`;
      break;
    case 'rolls':
      c.rolls = Math.floor(num(c.rolls) + amount);
      summary = `+${Math.floor(amount)} Drop Roll${amount === 1 ? '' : 's'}`;
      break;
    case 'qibars':
      c.bonusQiBars = r2(num(c.bonusQiBars) + amount);
      summary = `+${fmt(amount)} Qi Bar${amount === 1 ? '' : 's'}`;
      break;
    default:
      break;
  }
  if (['all', 'allqi', 'qi'].includes(type)) lines.push(...stats.capLines(state, c));
  return { lines, summary };
}

/**
 * Take things away. type 'stat' needs opts.stat (strength/endurance/mobility/qi);
 * opts.refund puts the removed stat points back into the character's unspent points (a respec).
 */
function take(state, c, type, amount, opts = {}) {
  type = String(type || '').toLowerCase().trim();
  if (!TAKE_TYPES.includes(type)) throw new UserError(`Unknown type "${type}". Use one of: ${TAKE_TYPES.join(', ')}.`);
  amount = positive(amount);
  const s = state.settings;
  const lines = [];
  let summary = '';
  const cut = (have) => r2(Math.min(have, amount));
  switch (type) {
    case 'all': {
      const n = cut(c.pools.normal);
      c.pools.normal = r2(c.pools.normal - n);
      summary = `-${fmt(n)} unspent Stat Points`;
      break;
    }
    case 'allqi': {
      const n = cut(c.pools.flex);
      c.pools.flex = r2(c.pools.flex - n);
      summary = `-${fmt(n)} unspent Points (Qi allowed)`;
      break;
    }
    case 'stat': {
      const stat = stats.ALIASES[String(opts.stat || '').toLowerCase()];
      if (!stat) throw new UserError('Choose which stat to take from.');
      const n = cut(c.stats[stat]);
      c.stats[stat] = r2(c.stats[stat] - n);
      summary = `-${fmt(n)} ${stats.LABEL[stat]}`;
      if (opts.refund) {
        const pool = stat === 'qi' ? 'flex' : 'normal';
        c.pools[pool] = r2(c.pools[pool] + n);
        lines.push(`↩️ Refunded as ${fmt(n)} unspent ${pool === 'flex' ? 'points (Qi allowed)' : 'stat points'} — they can be spent again.`);
      }
      break;
    }
    case 'nyang': {
      const n = cut(c.nyang);
      c.nyang = r2(c.nyang - n);
      summary = `-${fmt(n)} ${s.currencyName}`;
      break;
    }
    case 'rolls': {
      const n = Math.floor(cut(c.rolls));
      c.rolls -= n;
      summary = `-${n} Drop Roll${n === 1 ? '' : 's'}`;
      break;
    }
    case 'qibars':
      c.bonusQiBars = r2(num(c.bonusQiBars) - amount);
      summary = `-${fmt(amount)} Qi Bar${amount === 1 ? '' : 's'}`;
      break;
    default:
      break;
  }
  return { lines, summary };
}

module.exports = { GRANT_TYPES, TAKE_TYPES, grant, take };
