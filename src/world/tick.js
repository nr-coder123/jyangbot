'use strict';
/** The world turn and the real-time checks (travel, caravans, battles). */
const geo = require('./geo');
const C = require('./common');
const E = require('./economy');
const EV = require('./events');
const P = require('./politics');
const D = require('./diplomacy');
const M = require('./military');
const { num, r2 } = require('../utils');

/** Advance the world by one turn. Returns a summary. */
function runTurn(state, { by = 'system' } = {}) {
  const w = state.world;
  w.turn += 1;
  const ledger = { tax: 0, factionTax: {}, players: [] };
  const started = EV.tickEvents(state);
  const keys = geo.marketKeys(state);
  const regionResults = [];
  for (const k of keys) if (w.regions[k]) regionResults.push(E.tickRegion(state, k, ledger));
  const peddled = E.peddlerTrade(state);
  const arrived = E.arriveNpcCaravans(state);
  const sent = E.dispatchNpcCaravans(state);
  const factionNotes = P.tickFactions(state, ledger);
  const armyNotes = M.tickArmies(state);
  D.expireProposals(state);
  // Sect shop restock
  for (const f of w.factions) for (const e of f.shop.items) if (num(e.restock) > 0 && e.stock >= 0) e.stock = e.stock + num(e.restock);
  const now = Date.now();
  w.lastTurnAt = new Date(now).toISOString();
  w.nextTurnAt = new Date(now + num(w.settings.turnHours, 6) * 3600000).toISOString();
  const avgP = regionResults.length ? r2(regionResults.reduce((a, x) => a + w.regions[x.key].prosperity, 0) / regionResults.length) : 0;
  const hungry = regionResults.filter((x) => x.food < 0.8).map((x) => x.key);
  const summary = { turn: w.turn, at: w.lastTurnAt, by, calendar: C.calendar(state).text, events: started.map((e) => e.eventId), caravansSent: sent, localTrade: peddled, caravansArrived: arrived.length, avgProsperity: avgP, hungry, notes: [...factionNotes, ...armyNotes].slice(0, 20), players: ledger.players.length };
  w.history.unshift(summary);
  if (w.history.length > 200) w.history.length = 200;
  if (C.calendar(state).day === 1 && w.turn > 0) (w.announceQueue ||= []).push({ kind: 'season', text: `${C.calendar(state).emoji} **${C.calendar(state).seasonName}** has come — ${C.calendar(state).text}.` });
  return summary;
}

/** Things that happen on the clock, not on turns. Returns notifications for the bot. */
function realtime(state, now = Date.now()) {
  const arrivals = E.settleTravel(state, now);
  const caravans = E.settlePlayerCaravans(state, now);
  const battles = M.resolveDue(state, now);
  return { arrivals, caravans, battles };
}

/** Is a turn due? */
function due(state, now = Date.now()) {
  const w = state.world;
  if (!w?.settings?.enabled || w.settings.paused) return false;
  if (!w.nextTurnAt) { w.nextTurnAt = new Date(now + num(w.settings.turnHours, 6) * 3600000).toISOString(); return false; }
  return Date.parse(w.nextTurnAt) <= now;
}

module.exports = { runTurn, realtime, due };
