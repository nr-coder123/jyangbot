'use strict';
/**
 * Runs the world on the clock: every minute it settles travel, caravans and battles, and advances
 * a turn when one is due. The bot plugs in a `deliver` function to post announcements and DMs;
 * without the bot (dashboard only) the world still runs and everything goes to the World log.
 */
const store = require('../store');
const T = require('./tick');

const SYSTEM = { name: 'world', source: 'system' };
let deliver = null;
let timer = null;
let busy = false;

function setDeliver(fn) { deliver = fn; }

async function step() {
  const st = store.state;
  if (busy || !st?.world?.settings?.enabled) return;
  busy = true;
  try {
    const rt = T.realtime(st);
    let turn = null;
    if (T.due(st)) {
      turn = T.runTurn(st);
      store.log(SYSTEM, 'world.turn', `Turn ${turn.turn} — ${turn.calendar} · ${turn.events.length} new event(s) · avg prosperity ${turn.avgProsperity}`);
    }
    const queue = st.world.announceQueue || [];
    st.world.announceQueue = [];
    if (rt.arrivals.length || rt.caravans.length || rt.battles.length || turn || queue.length) store.markDirty();
    if (deliver) await deliver({ ...rt, turn, queue }).catch((e) => console.error('[world] deliver failed', e));
  } catch (e) {
    console.error('[world] step failed', e);
  } finally {
    busy = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(step, 60000);
  setTimeout(step, 5000);
}

/** Staff "Advance turn" from the dashboard or /admin. */
async function advance(n = 1, actor = SYSTEM) {
  const st = store.state;
  const out = [];
  for (let i = 0; i < Math.max(1, Math.min(50, n)); i++) out.push(T.runTurn(st, { by: actor.name }));
  store.log(actor, 'world.turn', `Advanced ${out.length} turn(s) by hand → turn ${st.world.turn}`);
  await step();
  return out;
}

module.exports = { start, step, advance, setDeliver };
