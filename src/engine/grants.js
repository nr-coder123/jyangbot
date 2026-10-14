'use strict';
/**
 * Staff rewards, shared by /give, the progress-submission "Grant" button and the dashboard.
 *   all     -> stat points for Strength/Endurance/Mobility only
 *   allqi   -> flexible points (any stat, including Qi)
 *   qi      -> Qi directly (a Breakthrough). Resets impurity.
 *   nyang, rolls, qibars
 */
const stats = require('./stats');
const { r2, fmt, num, UserError } = require('../utils');

const GRANT_TYPES = ['all', 'allqi', 'qi', 'nyang', 'rolls', 'qibars'];

function grant(state, c, type, amount) {
  type = String(type || '').toLowerCase().trim();
  amount = Number(amount);
  if (!GRANT_TYPES.includes(type)) throw new UserError(`Unknown type "${type}". Use one of: ${GRANT_TYPES.join(', ')}.`);
  if (!Number.isFinite(amount) || amount === 0) throw new UserError('Amount must be a non-zero number.');
  const s = state.settings;
  const lines = [];
  switch (type) {
    case 'all':
    case 'allqi': {
      const r = stats.grantPoints(state, c, type, amount);
      const what = type === 'all' ? 'stat points (Strength/Endurance/Mobility only)' : 'flexible points (any stat, **including Qi**)';
      lines.push(`${r.granted >= 0 ? 'Granted' : 'Removed'} **${fmt(Math.abs(r.granted))}** ${what} to **${c.name}**.`);
      if (r.discarded > 0) lines.push(`⛔ **${fmt(r.discarded)}** points were discarded — ${c.name} is at the hard cap for ${stats.realmOf(state, c).name}.`);
      if (r.preview && r.granted > 0 && r.preview.gained < r.granted - 1e-9) {
        lines.push(`⚠️ **Soft cap:** spent on Strength/Endurance/Mobility, these ${fmt(r.granted)} points become about **${fmt(r.preview.gained)}** stat points (gains past ${fmt(stats.caps(state, c).soft)} are reduced).`);
      }
      break;
    }
    case 'qi': {
      const r = stats.gainQi(state, c, amount, { resetImpurity: s.staffQiResetsImpurity, source: 'staff' });
      lines.push(`${amount > 0 ? 'Breakthrough!' : 'Removed Qi.'} **${c.name}** ${amount > 0 ? 'gains' : 'loses'} **${fmt(Math.abs(r.gained))}** Qi (now ${fmt(c.stats.qi)}).`);
      if (amount > 0 && r.effective < amount) lines.push(`ℹ️ A cultivation effect changed the gain from ${fmt(amount)} to ${fmt(r.effective)}.`);
      if (r.capped) lines.push(`⛔ Qi hard cap reached (${fmt(stats.caps(state, c).hardQi)}). The rest was lost.`);
      if (r.reset) lines.push('🧹 Impurity reset to 0 (received Qi).');
      break;
    }
    case 'nyang':
      c.nyang = r2(Math.max(0, c.nyang + amount));
      lines.push(`${amount > 0 ? 'Gave' : 'Took'} **${fmt(Math.abs(amount))}** ${s.currencyName} → ${c.name} now has **${fmt(c.nyang)}**.`);
      break;
    case 'rolls':
      c.rolls = Math.max(0, Math.floor(num(c.rolls) + amount));
      lines.push(`${amount > 0 ? 'Gave' : 'Took'} **${Math.abs(amount)}** drop roll(s) → ${c.name} has **${c.rolls}**. They can use \`/roll\`.`);
      break;
    case 'qibars':
      c.bonusQiBars = r2(num(c.bonusQiBars) + amount);
      lines.push(`${amount > 0 ? 'Added' : 'Removed'} **${fmt(Math.abs(amount))}** Qi Bar(s) → bonus Qi Bars now **${fmt(c.bonusQiBars)}**.`);
      break;
    default:
      break;
  }
  if (['all', 'allqi', 'qi'].includes(type)) lines.push(...stats.capLines(state, c));
  return lines;
}

module.exports = { GRANT_TYPES, grant };
