'use strict';
/** The world turn and the real-time checks (battles). */
const geo = require('./geo');
const C = require('./common');
const E = require('./economy');
const EV = require('./events');
const P = require('./politics');
const D = require('./diplomacy');
const M = require('./military');
const T = require('./territory');
const R = require('./realm');
const { num, r2 } = require('../utils');

/** Advance the world by one turn. Returns a summary. */
function runTurn(state, { by = 'system' } = {}) {
  const w = state.world;
  w.turn += 1;
  const ledger = { tax: 0, factionTax: {}, buildings: {}, players: [] };
  const started = EV.tickEvents(state);
  const keys = geo.marketKeys(state);
  const regionResults = [];
  for (const k of keys) if (w.regions[k]) regionResults.push(E.tickRegion(state, k, ledger));
  const peddled = E.peddlerTrade(state, ledger);
  const arrived = E.arriveNpcCaravans(state);
  const sent = E.dispatchNpcCaravans(state);
  const factionNotes = P.tickFactions(state, ledger);
  R.tickBuildings(state);
  const tradeArrived = R.settleFactionCaravans(state);
  const autoSent = R.autoTrade(state);
  const armyNotes = M.tickArmies(state);
  // Stipends: a share of the turn's net income is set aside, then paid out to members each season.
  for (const f of w.factions) {
    if (!f.active || !f.lastIncome) continue;
    const net = Object.entries(f.lastIncome).filter(([k]) => k !== 'stipend').reduce((a, [, v]) => a + num(v), 0);
    const put = T.accrueStipend(state, f, net);
    if (put) f.lastIncome.stipend = -put;
  }
  const stipends = T.tickStipends(state);
  D.expireProposals(state);
  const now = Date.now();
  w.lastTurnAt = new Date(now).toISOString();
  w.nextTurnAt = new Date(now + num(w.settings.turnHours, 6) * 3600000).toISOString();
  const avgP = regionResults.length ? r2(regionResults.reduce((a, x) => a + w.regions[x.key].prosperity, 0) / regionResults.length) : 0;
  const hungry = regionResults.filter((x) => x.food < 0.8).map((x) => x.key);
  const summary = { turn: w.turn, at: w.lastTurnAt, by, calendar: C.calendar(state).text, events: started.map((e) => e.eventId), caravansSent: sent, localTrade: peddled, caravansArrived: arrived.length, avgProsperity: avgP, hungry, notes: [...factionNotes, ...armyNotes].slice(0, 20), players: ledger.players.length, trade: tradeArrived.length, autoTrade: autoSent, stipends: stipends.map((x) => x.total) };
  // The player market follows the world's rules: listings above an item's resale cap are corrected down.
  const EE = require('../engine/economy');
  for (const l of state.market || []) { const it = (state.items || []).find((x) => x.id === l.itemId); if (!it) continue; const cap = EE.resaleCap(state, it); if (l.price > cap) l.price = r2(cap); }
  w.history.unshift(summary);
  if (w.history.length > 200) w.history.length = 200;
  if (C.calendar(state).day === 1 && w.turn > 0) (w.announceQueue ||= []).push({ kind: 'season', text: `${C.calendar(state).emoji} **${C.calendar(state).seasonName}** has come — ${C.calendar(state).text}.` });
  return summary;
}

/** Things that happen on the clock, not on turns. Returns notifications for the bot. */
function realtime(state, now = Date.now()) {
  const battles = M.resolveDue(state, now);
  return { arrivals: [], caravans: [], battles };
}

/** Is a turn due? */
function due(state, now = Date.now()) {
  const w = state.world;
  if (!w?.settings?.enabled || w.settings.paused) return false;
  if (!w.nextTurnAt) { w.nextTurnAt = new Date(now + num(w.settings.turnHours, 6) * 3600000).toISOString(); return false; }
  return Date.parse(w.nextTurnAt) <= now;
}

module.exports = { runTurn, realtime, due };
