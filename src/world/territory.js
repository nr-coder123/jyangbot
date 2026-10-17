'use strict';
/**
 * Territory, takeovers, offices, stipends and role-play travel.
 *
 * ─ Who rules what ─
 *   Every province has a ruler (or none). A prefecture follows its province unless it was painted on its own
 *   (`ownController`). Provinces in `world.map.split` are shown — and painted — prefecture by prefecture; their
 *   province-level ruler (who taxes the provincial market) is whoever holds the largest area of it.
 *
 * ─ Takeovers ─
 *   A takeover moves one or more regions to another faction. Staff can do it at once (`/takeover`, painting on the
 *   map), players' representatives can claim a region (staff approve or reject), and long occupations in war
 *   create a pending takeover. Every approved takeover remembers what it replaced, so it can be reverted in one click.
 *
 * ─ Coffers, treasury and stipends ─
 *   Region coffers = the local merchants' and households' purse. It pays players who sell goods and fills when they buy.
 *   Taxes move part of it each turn to the ruling faction's treasury. The treasury pays armies, policies and diplomacy.
 *   A faction may set aside `stipendRate`% of each turn's positive net income into a stipend fund; every season the fund
 *   is shared among active members by weight (member 1, representative 2, leader 3) with a soft cap per person:
 *        raw_i  = fund × w_i ÷ Σw
 *        cap_i  = softCap × w_i × (1 + ln(members) ÷ 4)       — big factions get a slightly higher cap
 *        paid_i = cap_i × (1 − e^(−raw_i ÷ cap_i))             — never more than cap_i, however small the faction
 *   Whatever is not paid goes back to the treasury. So a 3-member faction with a rich treasury cannot make its members
 *   rich quickly: each one gets at most cap_i per season.
 */
const geo = require('./geo');
const C = require('./common');
const { normalizeRegion } = require('./state');
const { num, r2, newId, norm, UserError } = require('../utils');

// ─────────── control ───────────
function controllerOf(state, key) {
  const w = state.world;
  if (!key) return null;
  if (!key.includes('/')) return w.regions[key]?.controller || null;
  const r = w.regions[key];
  if (r && r.ownController) return r.controller || null;
  return w.regions[geo.provinceOf(key)]?.controller || null;
}
const isSplit = (state, prov) => (state.world.map.split || []).includes(prov);

function snapshotOf(state, key) {
  const r = state.world.regions[key];
  return { key, existed: !!r, controller: r ? r.controller || null : null, ownController: !!r?.ownController, occupiedBy: r?.occupiedBy || null };
}
function ensureRecord(state, key) {
  const w = state.world;
  if (!w.regions[key]) w.regions[key] = normalizeRegion(key, { controller: controllerOf(state, key) });
  return w.regions[key];
}
/** Inheriting prefectures always mirror their province. */
function syncChildren(state, prov) {
  const w = state.world;
  const pc = w.regions[prov]?.controller || null;
  for (const p of geo.prefectures(prov)) { const r = w.regions[p.key]; if (r && !r.ownController) r.controller = pc; }
}
/** Province ruler of a split province = whoever holds the most area (unclaimed counts too). */
function recomputeProvince(state, prov) {
  const w = state.world;
  const area = new Map();
  for (const p of geo.prefectures(prov)) {
    if (w.regions[p.key]?.special) continue;
    const owner = controllerOf(state, p.key) || '';
    area.set(owner, (area.get(owner) || 0) + num(p.area, 1));
  }
  if (!area.size) return;
  const best = [...area.entries()].sort((a, b) => b[1] - a[1])[0][0] || null;
  if (w.regions[prov]) w.regions[prov].controller = best;
  syncChildren(state, prov);
}

/**
 * Paint `keys` for faction `fid` (null = unclaim). Returns the snapshot needed to undo it.
 * A province key paints the whole province (its prefectures follow it again); a prefecture key paints just that one.
 */
function paint(state, keys, fid, { log = true } = {}) {
  const w = state.world;
  if (fid && !C.faction(state, fid)) throw new UserError('Unknown faction.');
  const touched = new Map();
  const remember = (k) => { if (!touched.has(k)) touched.set(k, snapshotOf(state, k)); };
  const provs = new Set();
  for (const key of [...new Set(keys)].filter((k) => geo.get(k))) {
    const prov = geo.provinceOf(key);
    if (!key.includes('/')) {
      remember(key);
      for (const p of geo.prefectures(key)) if (w.regions[p.key]) remember(p.key);
      ensureRecord(state, key).controller = fid || null;
      // What you see is what you get: painting the whole province resets its ordinary prefectures.
      for (const p of geo.prefectures(key)) { const r = w.regions[p.key]; if (r && !r.special) r.ownController = false; }
      syncChildren(state, key);
    } else {
      remember(key); remember(prov);
      if (isSplit(state, prov)) {
        // Fix every sibling to what it shows now, so changing one doesn't move the others.
        for (const p of geo.prefectures(prov)) {
          if (p.key === key) continue;
          const r = w.regions[p.key];
          if (!r || !r.ownController) { remember(p.key); const cur = controllerOf(state, p.key); const rec = ensureRecord(state, p.key); rec.controller = cur; rec.ownController = true; }
        }
      }
      const r = ensureRecord(state, key);
      r.controller = fid || null; r.ownController = true;
      provs.add(prov);
    }
  }
  for (const p of provs) if (isSplit(state, p)) recomputeProvince(state, p);
  for (const k of touched.keys()) { const r = w.regions[k]; if (r && r.occupiedBy && r.occupiedBy === r.controller) r.occupiedBy = null; }
  const before = [...touched.values()];
  if (log && before.length) C.wlog(state, 'map', `🖌️ ${keys.length} region${keys.length === 1 ? '' : 's'} → ${C.faction(state, fid)?.name || 'unclaimed'}`);
  return before;
}

/** Put regions back exactly as a snapshot from paint() recorded them. */
function restore(state, snapshot) {
  const w = state.world;
  const seen = new Set(); // snapshots can be chained: the first entry for a key is the oldest state
  for (const s of snapshot || []) {
    if (!s || !geo.get(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    if (!s.existed && !geo.isMarket(state, s.key) && s.key.includes('/')) { delete w.regions[s.key]; continue; }
    const r = ensureRecord(state, s.key);
    r.controller = s.controller && C.faction(state, s.controller) ? s.controller : null;
    r.ownController = !!s.ownController;
    if ('occupiedBy' in r) r.occupiedBy = s.occupiedBy || null;
  }
  for (const prov of new Set((snapshot || []).map((s) => geo.provinceOf(s.key)))) syncChildren(state, prov);
}

/** Toggle a province between whole and prefecture-by-prefecture. Splitting keeps every prefecture as it looks now. */
function setSplit(state, prov, on) {
  const w = state.world;
  if (!geo.isProvince(prov)) throw new UserError('Only provinces can be split.');
  const list = new Set(w.map.split || []);
  if (on) {
    list.add(prov);
  } else {
    list.delete(prov);
  }
  w.map.split = [...list];
  return w.map.split;
}

/** Everything a faction holds, provinces and prefectures, as shown on the map. */
function holdings(state, fid) {
  const out = [];
  for (const p of geo.provinces()) {
    if (isSplit(state, p.key)) { for (const pf of geo.prefectures(p.key)) if (controllerOf(state, pf.key) === fid) out.push(pf.key); } else if (controllerOf(state, p.key) === fid) out.push(p.key);
  }
  for (const [k, r] of Object.entries(state.world.regions)) if (r.special && !isSplit(state, geo.provinceOf(k)) && r.ownController && r.controller === fid) out.push(k);
  return [...new Set(out)];
}

// ─────────── takeovers ───────────
function takeover(state, id) { const t = state.world.takeovers.find((x) => x.id === id); if (!t) throw new UserError('Takeover not found.'); return t; }

function requestTakeover(state, { regions, to, reason = '', by = {}, source = 'player' }) {
  const w = state.world;
  regions = [...new Set((regions || []).filter((k) => geo.get(k)))];
  if (!regions.length) throw new UserError('Pick at least one region.');
  if (to && !C.faction(state, to)) throw new UserError('Unknown faction.');
  const dup = w.takeovers.find((t) => t.status === 'pending' && t.to === (to || null) && t.regions.join() === regions.join());
  if (dup) return dup;
  const t = { id: newId('tk-'), regions, from: regions.map((k) => controllerOf(state, k)), to: to || null, reason: String(reason).slice(0, 500), source, by: { id: by.id || '', name: by.name || '', charId: by.charId || '' }, status: 'pending', at: new Date().toISOString(), turn: w.turn, before: null, decidedBy: null, decidedAt: null };
  w.takeovers.unshift(t);
  if (w.takeovers.length > 200) w.takeovers.length = 200;
  const text = `📜 **Takeover requested** — ${regions.map((k) => `**${geo.label(state, k)}**`).join(', ')} → **${C.faction(state, to)?.name || 'unclaimed'}**${reason ? ` · “${reason}”` : ''} (${source === 'conquest' ? 'after a long occupation' : `by ${t.by.name || 'a representative'}`}). Staff decide.`;
  C.wlog(state, 'takeover', text);
  (w.announceQueue ||= []).push({ kind: 'takeover', text, takeoverId: t.id, regions });
  return t;
}

function approveTakeover(state, id, by = {}) {
  const t = takeover(state, id);
  if (t.status !== 'pending') throw new UserError(`This takeover was already ${t.status}.`);
  t.before = paint(state, t.regions, t.to, { log: false });
  t.status = 'approved'; t.decidedBy = by.name || by.id || 'staff'; t.decidedAt = new Date().toISOString();
  for (const k of t.regions) { const r = state.world.regions[geo.marketOf(state, k)]; if (r && r.occupiedBy === t.to) r.occupiedBy = null; }
  // Buildings may not survive the change of masters (only when a whole market changes hands).
  const razed = [];
  for (const k of t.regions) if (geo.isMarket(state, k) && t.from[t.regions.indexOf(k)] && t.from[t.regions.indexOf(k)] !== t.to) razed.push(...require('./realm').razeOnCapture(state, k));
  t.razed = razed;
  const text = `👑 ${t.regions.map((k) => `**${geo.label(state, k)}**`).join(', ')} ${t.regions.length > 1 ? 'now belong' : 'now belongs'} to **${C.faction(state, t.to)?.name || 'no one'}**.${t.reason ? ` *${t.reason}*` : ''}${razed.length ? ` Razed in the change of masters: ${razed.join(', ')}.` : ''}`;
  C.wlog(state, 'takeover', text);
  (state.world.announceQueue ||= []).push({ kind: 'takeover-done', text, takeoverId: t.id, regions: t.regions });
  return t;
}
function rejectTakeover(state, id, by = {}) {
  const t = takeover(state, id);
  if (t.status !== 'pending') throw new UserError(`This takeover was already ${t.status}.`);
  t.status = 'rejected'; t.decidedBy = by.name || by.id || 'staff'; t.decidedAt = new Date().toISOString();
  C.wlog(state, 'takeover', `✖️ Takeover of ${t.regions.map((k) => geo.label(state, k)).join(', ')} rejected.`);
  return t;
}
/** Undo an approved takeover (regions that changed hands again since are left alone). */
function revertTakeover(state, id, by = {}) {
  const t = takeover(state, id);
  if (t.status !== 'approved') throw new UserError('Only approved takeovers can be reverted.');
  const still = new Set(t.regions.filter((k) => controllerOf(state, k) === t.to));
  const snap = (t.before || []).filter((s) => still.has(s.key) || !t.regions.includes(s.key));
  restore(state, snap);
  t.status = 'reverted'; t.revertedBy = by.name || by.id || 'staff'; t.revertedAt = new Date().toISOString();
  C.wlog(state, 'takeover', `↩️ Takeover of ${t.regions.map((k) => geo.label(state, k)).join(', ')} reverted.`);
  return t;
}
/** Staff shortcut: request + approve in one go. */
function forceTakeover(state, { regions, to, reason, by }) {
  const t = requestTakeover(state, { regions, to, reason, by, source: 'staff' });
  if (t.status === 'pending') {
    // The "requested" announcement is noise for an instant staff takeover.
    const q = state.world.announceQueue || []; const i = q.findIndex((x) => x.takeoverId === t.id && x.kind === 'takeover'); if (i >= 0) q.splice(i, 1);
    approveTakeover(state, t.id, by);
  }
  return t;
}

// ─────────── offices (representatives & leader) ───────────
const OFFICES = ['member', 'representative', 'leader'];
function officeOf(state, c) {
  const f = C.factionOfChar(state, c);
  if (!f || !c) return 'member';
  if (f.leaderCharId === c.id) return 'leader';
  if (f.representatives.includes(c.id)) return 'representative';
  return 'member';
}
/** Representatives lead the faction's diplomacy, trade and politics; they usually don't fight. */
function setOffice(state, c, office) {
  if (!OFFICES.includes(office)) throw new UserError('Office must be member, representative or leader.');
  const f = C.factionOfChar(state, c);
  if (!f) throw new UserError(`${c.name} is not in a faction (their sect has none).`);
  f.representatives = f.representatives.filter((id) => id !== c.id);
  if (f.leaderCharId === c.id) f.leaderCharId = '';
  if (office === 'representative') {
    const max = num(state.world.settings.maxRepresentatives, 2);
    const reps = f.representatives.filter((id) => state.characters.some((x) => x.id === id && x.status === 'active'));
    if (max > 0 && reps.length >= max) throw new UserError(`${f.name} already has ${reps.length} representative${reps.length === 1 ? '' : 's'} (the limit is ${max}). Remove one first.`);
    f.representatives.push(c.id);
  }
  if (office === 'leader') f.leaderCharId = c.id;
  return f;
}
const isNonCombatant = (state, c) => !state.world.settings.representativesFight && officeOf(state, c) === 'representative';

// ─────────── stipends ───────────
/** Called once per turn per faction with its net income. */
function accrueStipend(state, f, net) {
  const rate = Math.min(num(state.world.settings.maxStipendRate, 30), num(f.stipendRate));
  if (rate <= 0 || net <= 0) return 0;
  const amt = r2(net * rate / 100);
  if (f.treasury < amt) return 0;
  f.treasury = r2(f.treasury - amt);
  f.stipendFund = r2(num(f.stipendFund) + amt);
  return amt;
}
function stipendPlan(state, f, fund = num(f.stipendFund)) {
  const s = state.world.settings;
  const mem = C.members(state, f);
  const weight = (c) => { const o = officeOf(state, c); return o === 'leader' ? num(s.leaderWeight, 3) : o === 'representative' ? num(s.repWeight, 2) : 1; };
  const W = mem.reduce((a, c) => a + weight(c), 0);
  const capBase = num(s.stipendSoftCap, 150) * (1 + Math.log(Math.max(1, mem.length)) / 4);
  const rows = mem.map((c) => {
    const wgt = weight(c);
    const raw = W ? fund * wgt / W : 0;
    const cap = capBase * wgt;
    const paid = cap > 0 ? Math.floor(cap * (1 - Math.exp(-raw / cap))) : Math.floor(raw);
    return { id: c.id, name: c.name, office: officeOf(state, c), weight: wgt, raw: r2(raw), cap: r2(cap), paid };
  });
  const total = rows.reduce((a, x) => a + x.paid, 0);
  return { fund: r2(fund), members: mem.length, rows, total, returned: r2(fund - total), capBase: r2(capBase) };
}
function payStipends(state, f) {
  const plan = stipendPlan(state, f);
  if (!plan.members || plan.fund <= 0) return null;
  for (const row of plan.rows) { const c = state.characters.find((x) => x.id === row.id); if (c) c.nyang = r2(num(c.nyang) + row.paid); }
  f.treasury = r2(f.treasury + plan.returned);
  f.stipendFund = 0;
  f.lastStipend = { turn: state.world.turn, total: plan.total, returned: plan.returned, paid: Object.fromEntries(plan.rows.map((x) => [x.id, x.paid])) };
  const cur = state.settings?.currencyName || 'Nyang';
  const text = `💰 **${f.name}** paid its seasonal stipends: ${fmtNum(plan.total)} ${cur} to ${plan.members} member${plan.members === 1 ? '' : 's'}${plan.returned > 0.5 ? ` (${fmtNum(plan.returned)} back to the treasury)` : ''}.`;
  C.wlog(state, 'stipend', text);
  (state.world.announceQueue ||= []).push({ kind: 'stipend', text, factionId: f.id, regions: [], dms: plan.rows.filter((x) => x.paid > 0).map((x) => ({ charId: x.id, text: `💰 Stipend from **${f.name}**: **${fmtNum(x.paid)} ${cur}**${x.office !== 'member' ? ` (${x.office})` : ''}.` })) });
  return plan;
}
const fmtNum = (n) => Math.round(num(n)).toLocaleString('en-US');
function tickStipends(state) {
  const every = Math.max(1, num(state.world.settings.stipendEveryTurns, 28));
  if (state.world.turn % every !== 0) return [];
  return state.world.factions.filter((f) => f.active && num(f.stipendFund) > 0).map((f) => payStipends(state, f)).filter(Boolean);
}

// ─────────── role-play travel (text RP: nobody waits) ───────────
const DEFAULT_SPEEDS = [{ id: 'foot', label: 'On foot', kmPerDay: 30 }, { id: 'horse', label: 'By horse', kmPerDay: 60 }, { id: 'qinggong', label: 'Qinggong', kmPerDay: 150 }];
function rpTravel(state, from, to) {
  const rt = geo.route(state, from, to);
  if (!rt) return null;
  const km = Math.round(rt.distance * num(state.world.settings.kmPerPx, 5));
  const speeds = (Array.isArray(state.world.settings.travelSpeeds) && state.world.settings.travelSpeeds.length ? state.world.settings.travelSpeeds : DEFAULT_SPEEDS);
  const days = speeds.map((s) => ({ id: s.id, label: s.label, days: Math.max(0.5, Math.round(km / Math.max(1, num(s.kmPerDay, 30)) * 2) / 2) }));
  return { from, to, km, li: km * 2, hops: rt.hops, path: rt.path, days, text: `${km.toLocaleString('en-US')} km (${(km * 2).toLocaleString('en-US')} li) · ${days.map((d) => `${d.label.toLowerCase()} ~${d.days} day${d.days === 1 ? '' : 's'}`).join(' · ')}` };
}
const channelMode = (state) => (state.world.settings.travelMode || 'channel') === 'channel';

/** In channel mode, a character is wherever its player last posted or used /world in a region channel. */
function notePresence(state, c, channel) {
  if (!c || !channelMode(state)) return null;
  const key = geo.regionOfChannel(state, channel);
  if (!key || key === c.location) return null;
  const from = c.location;
  c.location = key; c.travel = null;
  return { from, to: key };
}

// ─────────── per-character trade cap ───────────
function tradeRoom(state, c) {
  const cap = num(state.world.settings.maxTradePerTurn, 0);
  if (!cap) return Infinity;
  const t = c.worldTrade && c.worldTrade.turn === state.world.turn ? num(c.worldTrade.value) : 0;
  return Math.max(0, cap - t);
}
function noteTrade(state, c, value) {
  if (!c.worldTrade || c.worldTrade.turn !== state.world.turn) c.worldTrade = { turn: state.world.turn, value: 0 };
  c.worldTrade.value = r2(c.worldTrade.value + Math.abs(num(value)));
}

module.exports = {
  controllerOf, isSplit, paint, restore, setSplit, holdings, recomputeProvince, syncChildren,
  takeover, requestTakeover, approveTakeover, rejectTakeover, revertTakeover, forceTakeover,
  OFFICES, officeOf, setOffice, isNonCombatant,
  accrueStipend, stipendPlan, payStipends, tickStipends,
  rpTravel, channelMode, notePresence, DEFAULT_SPEEDS,
  tradeRoom, noteTrade,
};
