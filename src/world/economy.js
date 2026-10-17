'use strict';
/**
 * Regional economy, inspired by Bannerlord's supply-chain mods:
 *  · every market (province or special prefecture) has stock, production, demand and coffers
 *  · prices follow stock vs. what the market wants to hold:  price = base × (target ÷ stock)^elasticity
 *  · workshops turn local inputs into outputs (supply chains), merchant caravans move surplus to shortage
 *  · coffers = the merchants' purse: households fill it, imports and purchases from players drain it
 *  · prosperity rises with food, salt, trade and safety, and is dragged down by its own weight
 *    (corruption and decadence grow with wealth), so no region stays rich forever
 */
const geo = require('./geo');
const C = require('./common');
const { r2, num, clamp, newId, UserError, fmt } = require('../utils');

const LEVEL_MULT = [0, 1, 1.8, 2.5];

const goods = (state) => state.world.goods;
const good = (state, id) => state.world.goods.find((g) => g.id === id) || null;
const prosperityFactor = (p) => 0.75 + num(p) / 200; // 0.75 at 0, 1 at 50, 1.25 at 100

// ─────────── demand, targets, prices ───────────
function popDemand(state, r, g, mods, season = C.calendar(state).season) {
  const lux = num(g.lux) ? Math.max(0.2, 1 + num(g.lux) * (r.prosperity - 50) / 50) : 1;
  const winter = season === 3 ? num(g.winterDemand, 1) : 1;
  return Math.max(0, r.population * num(g.perPop) * lux * winter * C.mulFor(mods?.demand, g));
}
function workshopNeeds(state, r) {
  const need = {};
  for (const ws of r.workshops || []) {
    const t = state.world.workshopTypes.find((x) => x.id === ws.typeId);
    if (!t) continue;
    for (const [gid, q] of Object.entries(t.inputs || {})) need[gid] = (need[gid] || 0) + q * LEVEL_MULT[ws.level];
  }
  return need;
}
function armyNeeds(state, key) {
  let grain = 0;
  for (const a of state.world.armies) if (a.region === key && a.status !== 'disbanded') grain += armyMen(a) / 1000 * 6;
  return { grain };
}
const armyMen = (a) => Object.values(a.units || {}).reduce((s, n) => s + num(n), 0);

function targetsFor(state, key, mods) {
  const r = state.world.regions[key];
  const s = state.world.settings;
  const ws = workshopNeeds(state, r);
  const an = armyNeeds(state, key);
  const out = {};
  for (const g of goods(state)) {
    const d = popDemand(state, r, g, mods) + (ws[g.id] || 0) + (an[g.id] || 0);
    // Even a small market keeps some of everything on hand (worth about minStockValue Nyang), so players can trade there.
    out[g.id] = r2(Math.max(3, num(s.minStockValue, 300) / Math.max(1, g.basePrice), d * num(s.stockTurns, 5)));
  }
  return out;
}
function unitPrice(state, r, g, stock) {
  const s = state.world.settings;
  const T = num(r.targets?.[g.id], 10);
  const ratio = T / Math.max(0.5, stock);
  const mul = clamp(Math.pow(ratio, num(g.elasticity, 0.6)), num(s.minPriceMul, 0.35), num(s.maxPriceMul, 4));
  return g.basePrice * mul * num(r.priceMods?.[g.id], 1);
}
function updatePrices(state, key, mods) {
  const r = state.world.regions[key];
  r.targets = targetsFor(state, key, mods);
  r.priceMods = {};
  for (const g of goods(state)) r.priceMods[g.id] = r2(C.mulFor(mods?.price, g));
  for (const g of goods(state)) {
    const p = r2(unitPrice(state, r, g, num(r.stock[g.id])));
    r.prices[g.id] = p;
    const h = (r.priceHistory[g.id] ||= []);
    h.push(p);
    if (h.length > 30) h.splice(0, h.length - 30);
  }
}
/** Price index of a good in a region: local price ÷ base price. */
function priceIndex(state, key, goodId) {
  const r = state.world.regions[geo.marketOf(state, key)];
  const g = good(state, goodId);
  if (!r || !g || !r.prices) return 1;
  return num(r.prices[goodId], g.basePrice) / g.basePrice;
}

/** Fill missing stock/prices/coffers so a new market starts calm. */
function initMarkets(state, world = state.world, { onlyMissing = false, only = null } = {}) {
  const prev = state.world; state.world = world;
  try {
    for (const key of only || geo.marketKeys(state)) {
      const r = world.regions[key];
      if (!r || r.population === undefined) continue;
      if (onlyMissing && Object.keys(r.prices || {}).length) continue;
      const mods = C.emptyMods();
      r.targets = targetsFor(state, key, mods);
      for (const g of world.goods) {
        if (r.stock[g.id] === undefined) {
          const t = r.targets[g.id];
          const prod = num(r.production[g.id]);
          const d = popDemand(state, r, g, mods);
          // Producers start in surplus, importers start a little short.
          r.stock[g.id] = r2(prod > d ? t * 1.3 : t * (prod > 0 ? 0.95 : 0.8));
        }
      }
      if (!r.coffers) r.coffers = r2(r.population * num(world.settings.maxCoffersPerPop, 60) * 0.5);
      updatePrices(state, key, mods);
    }
  } finally {
    state.world = prev || world;
  }
}

// ─────────── workshops ───────────
function workshopType(state, id) { return state.world.workshopTypes.find((t) => t.id === id) || null; }
function runWorkshop(state, key, r, ws, mods, ledger) {
  const t = workshopType(state, ws.typeId);
  if (!t) return;
  const lv = LEVEL_MULT[ws.level] || 1;
  const pf = prosperityFactor(r.prosperity);
  let f = 1;
  for (const [gid, q] of Object.entries(t.inputs || {})) f = Math.min(f, num(r.stock[gid]) / Math.max(0.01, q * lv));
  f = clamp(f, 0, 1);
  // Don't run at a loss: if the outputs are worth less than the inputs plus wages, cut back to a quarter.
  if (f > 0 && (Object.keys(t.outputs || {}).length || (num(t.service) && Object.keys(t.inputs || {}).length))) {
    let estIn = num(t.upkeep) * 0.7; let estOut = num(t.service) * Math.min(1.6, Math.sqrt(Math.max(0, r.population) / 20)) * pf * mods.income;
    for (const [gid, q] of Object.entries(t.inputs || {})) estIn += q * num(r.prices[gid], good(state, gid)?.basePrice || 0);
    for (const [gid, q] of Object.entries(t.outputs || {})) estOut += q * pf * num(r.prices[gid], good(state, gid)?.basePrice || 0);
    if (estOut < estIn) { f = Math.min(f, 0.25); ws.throttled = true; } else ws.throttled = false;
  }
  let costIn = 0; let valueOut = 0;
  for (const [gid, q] of Object.entries(t.inputs || {})) {
    const g = good(state, gid); if (!g) continue;
    const used = q * lv * f;
    costIn += used * num(r.prices[gid], g.basePrice);
    r.stock[gid] = r2(num(r.stock[gid]) - used);
  }
  const outs = {};
  for (const [gid, q] of Object.entries(t.outputs || {})) {
    const g = good(state, gid); if (!g) continue;
    const made = q * lv * f * pf * C.mulFor(mods.production, g);
    outs[gid] = made;
    valueOut += made * num(r.prices[gid], g.basePrice);
  }
  // The market buys the output from its coffers (it can't buy what it can't pay for).
  const affordable = valueOut > 0 ? clamp((r.coffers + costIn) / valueOut, 0, 1) : 1;
  for (const [gid, made] of Object.entries(outs)) r.stock[gid] = r2(num(r.stock[gid]) + made * affordable);
  valueOut *= affordable;
  const service = num(t.service) ? num(t.service) * lv * Math.min(1.6, Math.sqrt(Math.max(0, r.population) / 20)) * pf * mods.income * (Object.keys(t.inputs || {}).length ? f : 1) : 0;
  const wages = num(t.upkeep) * lv * (0.3 + 0.7 * (Object.keys(t.inputs || {}).length ? f : 1)); // idle workers get a retainer
  r.coffers = r2(Math.max(0, r.coffers + costIn - valueOut - service + wages));
  const gross = valueOut + service - costIn - wages;
  const tax = gross > 0 ? gross * num(r.taxRate) / 100 * mods.tax : 0;
  let profit = r2(gross - tax);
  ledger.tax += tax;
  // Pay the owner. An owner who can't cover a loss only loses what they have.
  if (ws.owner.type === 'character') {
    const c = state.characters.find((x) => x.id === ws.owner.id);
    if (c) {
      if (profit < 0) profit = -Math.min(-profit, c.nyang);
      c.nyang = r2(Math.max(0, c.nyang + profit));
      ledger.players.push({ charId: c.id, ws: ws.id, profit });
    }
  } else if (ws.owner.type === 'faction') {
    const f2 = C.faction(state, ws.owner.id);
    if (f2) { if (profit < 0) profit = -Math.min(-profit, Math.max(0, f2.treasury)); f2.treasury = r2(f2.treasury + profit); }
  } else {
    r.coffers = r2(r.coffers + Math.max(0, profit)); // town-owned: profits stay in town
  }
  ws.lastRun = r2(f); ws.lastProfit = r2(profit); ws.totalProfit = r2(num(ws.totalProfit) + profit); ws.idle = f < 0.05;
  if (t.security) r.security = r2(clamp(r.security + num(t.security) * lv * 0.1, 0, 100));
}

function workshopSlots(state, r) {
  return num(state.world.settings.workshopSlotsBase, 2) + Math.floor(num(r.population) / 25) + Math.floor(num(r.prosperity) / 34);
}

// ─────────── the turn ───────────
/**
 * One economic turn for one market. Returns a small summary.
 * Order: modifiers → production → workshops → armies eat → households consume → spoilage → prices → society.
 */
function tickRegion(state, key, ledger) {
  const w = state.world;
  const s = w.settings;
  const r = w.regions[key];
  const cal = C.calendar(state);
  const mods = C.regionMods(state, key);
  const pf = prosperityFactor(r.prosperity);
  const sat = {};
  // Production
  // Producers respond to prices: they plant, mine and breed less when prices crash and more when they soar.
  for (const g of goods(state)) {
    const base = num(r.production[g.id]);
    if (!base) continue;
    const seasonal = Array.isArray(g.seasonal) ? num(g.seasonal[cal.season], 1) : 1;
    const idx = num(r.prices[g.id], g.basePrice) / g.basePrice / Math.max(0.1, num(r.priceMods?.[g.id], 1));
    const response = clamp(Math.pow(idx, num(s.supplyResponse, 0.4)), 0.55, 1.3);
    r.stock[g.id] = r2(num(r.stock[g.id]) + base * pf * seasonal * response * C.mulFor(mods.production, g));
  }
  // Workshops
  for (const ws of r.workshops || []) runWorkshop(state, key, r, ws, mods, ledger);
  // Armies standing here eat grain
  const an = armyNeeds(state, key);
  if (an.grain) {
    const eaten = Math.min(num(r.stock.grain), an.grain);
    r.stock.grain = r2(num(r.stock.grain) - eaten);
    r.last.armyFed = an.grain ? r2(eaten / an.grain) : 1;
  } else r.last.armyFed = 1;
  // Households
  let spent = 0;
  for (const g of goods(state)) {
    const d = popDemand(state, r, g, mods, cal.season);
    if (d <= 0) { sat[g.id] = 1; continue; }
    const have = num(r.stock[g.id]);
    const eaten = Math.min(have, d);
    r.stock[g.id] = r2(have - eaten);
    sat[g.id] = eaten / d;
    spent += eaten * num(r.prices[g.id], g.basePrice);
  }
  // Households buy what they consume from the merchants, plus a little base trade: that fills the coffers.
  const income = (spent * num(s.spendingToCoffers, 0.9) + r.population * num(s.householdIncome, 1) * pf) * mods.income;
  const taxes = income * num(r.taxRate) / 100 * mods.tax * (1 - num(r.corruption) / 200);
  r.coffers = r2(Math.min(r.population * num(s.maxCoffersPerPop, 60), Math.max(0, r.coffers + income - taxes + num(mods.coffers))));
  ledger.tax += taxes;
  // Spoilage
  for (const g of goods(state)) {
    // Gluts rot faster: anything above three times the target spoils at 5% a turn on top of normal spoilage.
    const over = num(r.stock[g.id]) > num(r.targets?.[g.id]) * 3 ? 0.05 : 0;
    const loss = clamp(num(g.perish) + over + C.addFor(mods.stockLoss, g), 0, 0.9);
    if (loss) r.stock[g.id] = r2(num(r.stock[g.id]) * (1 - loss));
  }
  updatePrices(state, key, mods);

  // ── society ──
  const food = (sat.grain ?? 1) * 0.8 + (sat.meat ?? 1) * 0.2;
  const staple = ((sat.salt ?? 1) + (sat.cloth ?? 1) + (sat.tea ?? 1)) / 3;
  const luxGoods = goods(state).filter((g) => g.category === 'luxury');
  const lux = luxGoods.length ? luxGoods.reduce((a, g) => a + (sat[g.id] ?? 1), 0) / luxGoods.length : 1;
  const trade = Math.min(1.5, 0.5 * Math.log10(1 + num(r.last.tradeValue) / Math.max(1, r.population)));
  const growth = 3 * (food - 0.85) + 1.5 * (staple - 0.8) + 0.8 * lux * (r.prosperity < 70 ? 1 : 0.4) + trade + (r.security - 50) / 25;
  const drag = Math.pow(r.prosperity / 100, 2) * 3 + r.corruption / 25 + r.unrest / 25;
  const noise = (Math.random() - 0.5) * 0.8;
  const dP = growth - drag + num(mods.prosperity) + noise;
  r.prosperity = r2(clamp(r.prosperity + dP, 0, 100));
  // Corruption creeps up with wealth and falls when times are hard (dynastic cycle).
  r.corruption = r2(clamp(r.corruption + 0.35 * (r.prosperity - 50) / 50 - 0.003 * r.corruption + num(mods.corruption), 0, 100));
  // Unrest: hunger, taxes, injustice; calms when fed and safe.
  r.unrest = r2(clamp(r.unrest + (1 - food) * 6 + (1 - staple) * 1.5 + (num(r.taxRate) - 12) / 8 + r.corruption / 60 - (r.security - 40) / 40 - 0.6 - 0.02 * r.unrest + num(mods.unrest), 0, 100));
  // Security drifts toward a target set by forts, garrisons and unrest.
  const garrison = w.armies.some((a) => a.region === key && a.factionId === r.controller && a.status !== 'disbanded') ? 12 : 0;
  const target = clamp(45 + num(r.fort) * 5 + garrison - r.unrest / 4, 5, 95);
  r.security = r2(clamp(r.security + (target - r.security) * 0.12 + num(mods.security), 0, 100));
  // Population grows with food and prosperity.
  // The land can only feed so many: growth slows as population passes its base (carrying capacity).
  const dPop = (food - 0.95) * 0.8 + (r.prosperity - 50) / 50 * 0.1 - 0.4 * Math.max(0, r.population / Math.max(1, num(r.basePop, r.population)) - 1) + num(mods.population);
  r.population = r2(Math.max(1, r.population * (1 + dPop / 100)));
  if (mods.fortGrowth) r.fort = r2(clamp(num(r.fort) + mods.fortGrowth, 0, 5));
  r.last = { ...r.last, food: r2(food), staple: r2(staple), lux: r2(lux), income: r2(income), taxes: r2(taxes), spent: r2(spent), dP: r2(dP), growth: r2(growth), drag: r2(drag), sources: mods.sources, notes: mods.notes || [], caravanRisk: r2(num(mods.caravanRisk)), tariff: r2(num(mods.tariff)), noGuild: num(mods.noGuildCaravans) > 0, tradeValue: 0, trade: r2(trade) };
  r.history.push({ t: w.turn, p: r.prosperity, u: r.unrest, s: r.security, f: r2(food) });
  if (r.history.length > 60) r.history.splice(0, r.history.length - 60);
  // Controller collects the taxes
  const f = C.faction(state, r.occupiedBy || r.controller);
  if (f) {
    f.treasury = r2(f.treasury + taxes);
    ledger.factionTax[f.id] = (ledger.factionTax[f.id] || 0) + taxes;
  }
  return { key, food, dP, mods };
}

// ─────────── local trade (peddlers) ───────────
/**
 * Every turn, small traders carry goods across each road between neighbouring markets, from where a good
 * is plentiful to where it is scarce, if the price gap covers the trip (5% per road). This spreads supply
 * smoothly over the map; the merchant caravans below handle big long-distance shipments.
 *   flow = rate × the amount that would make both markets equally stocked, paid by the buying market's coffers.
 */
function peddlerTrade(state) {
  const w = state.world;
  const g2 = geo.graph(state);
  const share = num(w.settings.peddlerRate, 0.5);
  let moved = 0;
  const seen = new Set();
  for (const [a, edges] of g2) {
    for (const [b, e] of edges) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ra = w.regions[a]; const rb = w.regions[b];
      if (!ra || !rb || embargoed(state, a, b)) continue;
      const cost = 1 + 0.05 * Math.max(1, e.cost / 120);
      for (const g of goods(state)) {
        const Ta = num(ra.targets[g.id], 3); const Tb = num(rb.targets[g.id], 3);
        const sa = num(ra.stock[g.id]) / Ta; const sb = num(rb.stock[g.id]) / Tb;
        let from = ra; let to = rb; let sf = sa; let st = sb;
        if (sb > sa) { from = rb; to = ra; sf = sb; st = sa; }
        if (sf < st * 1.15 + 0.05) continue;
        const pf = num(from.prices[g.id], g.basePrice); const pt = num(to.prices[g.id], g.basePrice);
        if (pt < pf * cost) continue;
        // Move part of the way toward equal scarcity on both sides (rate 0.5 = half way each turn).
        let q = share * (sf - st) / (1 / (from === ra ? Ta : Tb) + 1 / (from === ra ? Tb : Ta));
        q = Math.min(q, num(from.stock[g.id]) * 0.5);
        const pay = q * pf * cost;
        if (to.coffers <= 0) continue;
        if (pay > to.coffers) q = to.coffers / (pf * cost);
        if (!(q >= 0.05)) continue;
        const paid = q * pf * cost;
        from.stock[g.id] = r2(num(from.stock[g.id]) - q);
        to.stock[g.id] = r2(num(to.stock[g.id]) + q * (1 - Math.min(0.5, raidRisk(state, to.key) / 3)));
        to.coffers = r2(to.coffers - paid);
        from.coffers = r2(from.coffers + q * pf);
        from.last.tradeValue = r2(num(from.last.tradeValue) + q * pf);
        to.last.tradeValue = r2(num(to.last.tradeValue) + paid);
        moved += paid;
      }
    }
  }
  for (const k of geo.marketKeys(state)) { const r = w.regions[k]; for (const g of goods(state)) r.prices[g.id] = r2(unitPrice(state, r, g, num(r.stock[g.id]))); }
  return r2(moved);
}

// ─────────── merchant (NPC) caravans ───────────
const caravanTurns = (state, distance) => Math.max(1, Math.ceil(distance / 150));
function raidRisk(state, key, extra = 0) {
  const r = state.world.regions[geo.marketOf(state, key)];
  if (!r) return 0;
  return clamp(Math.max(0, 55 - r.security) / 300 + num(r.last?.caravanRisk) + extra, 0, 0.9);
}
function embargoed(state, a, b) {
  const fa = state.world.regions[a]?.controller; const fb = state.world.regions[b]?.controller;
  if (!fa || !fb || fa === fb) return false;
  return C.hasTreaty(state, fa, fb, 'embargo') || C.relation(state, fa, fb).war;
}
function dispatchNpcCaravans(state) {
  const w = state.world;
  const s = w.settings;
  const keys = geo.marketKeys(state);
  const guild = w.factions.find((f) => f.kind === 'guild' && f.active);
  const offers = [];
  for (const dest of keys) {
    const rd = w.regions[dest];
    if (rd.last?.noGuild) continue;
    const near = geo.within(state, dest, 4);
    for (const g of goods(state)) {
      const Td = num(rd.targets[g.id]);
      const sd = num(rd.stock[g.id]);
      if (sd >= Td * 0.6 || Td < 5) continue;
      let best = null;
      for (const [src, hops] of near) {
        if (src === dest || hops < 2) continue; // neighbours are served by peddlers
        const rs = w.regions[src];
        const surplus = num(rs.stock[g.id]) - num(rs.targets[g.id]) * 1.1;
        if (surplus <= 1) continue;
        if (embargoed(state, src, dest)) continue;
        const margin = num(rd.prices[g.id]) - num(rs.prices[g.id]) * (1 + 0.06 * hops);
        if (margin <= g.basePrice * 0.1) continue;
        const score = margin * Math.min(surplus, Td * 0.9 - sd) / hops;
        if (!best || score > best.score) best = { src, hops, surplus, margin, score };
      }
      if (best) offers.push({ dest, good: g, ...best });
    }
  }
  offers.sort((a, b) => b.score - a.score);
  const perNode = {};
  let sent = 0;
  for (const o of offers) {
    if (sent >= num(s.npcCaravansPerTurn, 14)) break;
    if ((perNode[o.dest] || 0) >= 2 || (perNode[`s:${o.src}`] || 0) >= 3) continue;
    const rs = w.regions[o.src]; const rd = w.regions[o.dest];
    const want = num(rd.targets[o.good.id]) * 0.9 - num(rd.stock[o.good.id]);
    const cap = num(s.caravanCapacity, 120) * 3 / Math.max(0.5, num(o.good.weight, 1));
    const budget = rd.coffers / Math.max(0.01, num(rd.prices[o.good.id]));
    const surplusNow = num(rs.stock[o.good.id]) - num(rs.targets[o.good.id]) * 1.1; // other caravans may have taken some already
    const qty = r2(Math.min(surplusNow, want, cap, budget));
    if (qty < 1) continue;
    const rt = geo.route(state, o.src, o.dest);
    if (!rt) continue;
    const buy = r2(qty * num(rs.prices[o.good.id]));
    rs.stock[o.good.id] = r2(num(rs.stock[o.good.id]) - qty);
    rs.coffers = r2(rs.coffers + buy);
    rs.last.tradeValue = r2(num(rs.last.tradeValue) + buy);
    w.caravans.push({ id: newId('cv-'), npc: true, owner: guild ? { type: 'faction', id: guild.id } : { type: 'region', id: o.dest }, from: o.src, to: o.dest, path: rt.path, good: o.good.id, qty, cost: buy, departTurn: w.turn, arriveTurn: w.turn + caravanTurns(state, rt.distance), status: 'travelling' });
    perNode[o.dest] = (perNode[o.dest] || 0) + 1; perNode[`s:${o.src}`] = (perNode[`s:${o.src}`] || 0) + 1;
    sent++;
  }
  return sent;
}
/** Resolve one caravan's journey: each region on the path can raid it. Returns share of cargo lost. */
function journeyLoss(state, cv, escort = 0) {
  let lost = 0; const raids = [];
  for (const k of cv.path.slice(1)) {
    const risk = raidRisk(state, k, -escort);
    if (Math.random() < risk) {
      const share = 0.3 + Math.random() * 0.5;
      lost = 1 - (1 - lost) * (1 - share);
      raids.push(k);
    }
  }
  return { lost: r2(lost), raids };
}
function banditsTake(state, key, value) {
  const b = state.world.factions.find((f) => f.kind === 'bandits' && f.active);
  if (b && value > 0) b.treasury = r2(b.treasury + value * 0.5);
}
function arriveNpcCaravans(state) {
  const w = state.world;
  const done = [];
  for (const cv of w.caravans) {
    if (!cv.npc || cv.status !== 'travelling' || cv.arriveTurn > w.turn) continue;
    const rd = w.regions[cv.to];
    if (!rd) { cv.status = 'lost'; continue; }
    const { lost, raids } = journeyLoss(state, cv);
    const qty = r2(cv.qty * (1 - lost));
    const g = good(state, cv.good);
    if (lost) { banditsTake(state, raids[0], cv.cost * lost); C.wlog(state, 'caravan', `🏴 A merchant caravan carrying ${g?.emoji || ''} ${g?.name || cv.good} was raided near **${geo.label(state, raids[0])}** (${Math.round(lost * 100)}% lost).`); }
    const price = num(rd.prices[cv.good], g?.basePrice || 1);
    const pay = r2(Math.min(rd.coffers, qty * price));
    rd.coffers = r2(rd.coffers - pay);
    rd.stock[cv.good] = r2(num(rd.stock[cv.good]) + qty);
    rd.last.tradeValue = r2(num(rd.last.tradeValue) + pay);
    // The guild keeps a share of the margin; the rest pays drivers, tolls and inns along the way.
    const profit = r2((pay - cv.cost) * num(w.settings.guildShare, 0.1));
    if (cv.owner?.type === 'faction') { const f = C.faction(state, cv.owner.id); if (f) f.treasury = r2(Math.max(0, f.treasury + profit)); }
    cv.status = lost >= 0.99 ? 'raided' : 'arrived'; cv.profit = profit;
    done.push(cv);
  }
  w.caravans = w.caravans.filter((cv) => cv.status === 'travelling' || (!cv.npc && cv.status !== 'archived'));
  return done;
}

// ─────────── players: location & travel ───────────
function locationOf(state, c) {
  if (c.location && geo.get(c.location)) return c.location;
  const f = C.factionOfChar(state, c);
  return (f && f.hq && geo.get(f.hq) && f.hq) || state.world.settings.startRegion || '河南';
}
function travelInfo(state, c, to) {
  const from = locationOf(state, c);
  const rt = geo.route(state, from, to);
  if (!rt) throw new UserError(`There is no road from ${geo.label(state, from)} to ${geo.label(state, to)}.`);
  const hours = r2(rt.distance / 100 * num(state.world.settings.travelHoursPer100, 1.5));
  return { from, to, ...rt, hours };
}
function startTravel(state, c, to) {
  if (c.travel && Date.parse(c.travel.arriveAt) > Date.now()) throw new UserError(`You are already travelling to **${geo.label(state, c.travel.to)}** (arrive <t:${Math.floor(Date.parse(c.travel.arriveAt) / 1000)}:R>).`);
  if (!geo.get(to)) throw new UserError('Unknown destination.');
  const info = travelInfo(state, c, to);
  if (info.hops === 0 && geo.marketOf(state, to) === geo.marketOf(state, info.from)) { c.location = to; c.travel = null; return { ...info, instant: true }; }
  const now = Date.now();
  c.travel = { from: info.from, to, path: info.path, departAt: new Date(now).toISOString(), arriveAt: new Date(now + info.hours * 3600000).toISOString() };
  if (info.hours <= 0) { c.location = to; c.travel = null; return { ...info, instant: true }; }
  return info;
}
/** Finish travels that have arrived. Returns characters that arrived. */
function settleTravel(state, now = Date.now()) {
  const arrived = [];
  for (const c of state.characters) {
    if (c.travel && Date.parse(c.travel.arriveAt) <= now) { c.location = c.travel.to; c.travel = null; arrived.push(c); }
  }
  return arrived;
}
const isTravelling = (c) => !!(c.travel && Date.parse(c.travel.arriveAt) > Date.now());
function requireAt(state, c) {
  if (isTravelling(c)) throw new UserError(`You are on the road to **${geo.label(state, c.travel.to)}** — you arrive <t:${Math.floor(Date.parse(c.travel.arriveAt) / 1000)}:R>.`);
  return geo.marketOf(state, locationOf(state, c));
}

// ─────────── players: market trade ───────────
function tariffFor(state, key, c) {
  const w = state.world;
  const r = w.regions[key];
  const f = C.factionOfChar(state, c);
  let t = num(w.settings.baseTariff, 3) + num(r.last?.tariff);
  if (f && r.controller) {
    if (f.id === r.controller) t = 0;
    else if (C.hasTreaty(state, f.id, r.controller, 'trade')) t = Math.min(t, 0);
    else if (C.hasTreaty(state, f.id, r.controller, 'embargo')) t *= 2;
    if (C.relation(state, f.id, r.controller).war) throw new UserError(`**${geo.label(state, key)}** is held by ${C.faction(state, r.controller)?.name}, who are at war with your faction. The market won't deal with you.`);
  }
  return Math.max(0, t);
}
/** Price for buying (side 'buy') or selling ('sell') qty units, walking the price as stock changes. */
function quote(state, key, goodId, qty, side, c) {
  const w = state.world;
  const r = w.regions[key];
  const g = good(state, goodId);
  if (!r || !g) throw new UserError('That good is not traded here.');
  qty = Math.floor(num(qty));
  if (qty < 1) throw new UserError('Quantity must be at least 1.');
  let stock = num(r.stock[goodId]);
  if (side === 'buy' && stock < qty) throw new UserError(`Only ${Math.floor(stock)} ${g.name} in the market.`);
  let total = 0;
  for (let i = 0; i < qty; i++) {
    if (side === 'buy') { total += unitPrice(state, r, g, stock); stock -= 1; } else { stock += 1; total += unitPrice(state, r, g, stock); }
  }
  const spread = num(w.settings.spread, 8) / 200;
  const tariff = c ? tariffFor(state, key, c) / 100 : 0;
  const gross = side === 'buy' ? total * (1 + spread) : total * (1 - spread);
  const tax = gross * tariff;
  const final = r2(side === 'buy' ? gross + tax : gross - tax);
  return { qty, total: final, each: r2(final / qty), tariff: r2(tariff * 100), tax: r2(tax), coffers: r.coffers };
}
function itemForGood(state, goodId) {
  const g = good(state, goodId);
  return state.items.find((i) => i.tradeGood === goodId) || (g?.itemId && state.items.find((i) => i.id === g.itemId)) || null;
}
function buyGood(state, c, goodId, qty) {
  const key = requireAt(state, c);
  const it = itemForGood(state, goodId);
  if (!it) throw new UserError('This good has no inventory item yet. Staff can create it in the dashboard (World → Economy → "Create good items").');
  const q = quote(state, key, goodId, qty, 'buy', c);
  if (c.nyang < q.total) throw new UserError(`You need ${fmt(q.total)} ${state.settings.currencyName} (you have ${fmt(c.nyang)}).`);
  const r = state.world.regions[key];
  c.nyang = r2(c.nyang - q.total);
  r.stock[goodId] = r2(num(r.stock[goodId]) - q.qty);
  r.coffers = r2(r.coffers + q.total - q.tax);
  payTariff(state, r, q.tax);
  c.inventory[it.id] = (c.inventory[it.id] || 0) + q.qty;
  r.last.tradeValue = r2(num(r.last.tradeValue) + q.total);
  refreshPrice(state, key, goodId);
  return { ...q, key, item: it };
}
function sellGood(state, c, goodId, qty) {
  const key = requireAt(state, c);
  const it = itemForGood(state, goodId);
  if (!it || (c.inventory[it.id] || 0) < qty) throw new UserError(`You don't have ${qty} ${good(state, goodId)?.name || goodId}.`);
  const r = state.world.regions[key];
  const q = quote(state, key, goodId, qty, 'sell', c);
  if (r.coffers < q.total) throw new UserError(`The merchants of ${geo.label(state, key)} only have ${fmt(r.coffers)} ${state.settings.currencyName} left to buy with this turn. Sell fewer, or try another market.`);
  c.inventory[it.id] -= q.qty;
  if (c.inventory[it.id] <= 0) delete c.inventory[it.id];
  c.nyang = r2(c.nyang + q.total);
  r.stock[goodId] = r2(num(r.stock[goodId]) + q.qty);
  r.coffers = r2(r.coffers - q.total - q.tax);
  payTariff(state, r, q.tax);
  r.last.tradeValue = r2(num(r.last.tradeValue) + q.total);
  refreshPrice(state, key, goodId);
  return { ...q, key, item: it };
}
function payTariff(state, r, tax) {
  const f = C.faction(state, r.occupiedBy || r.controller);
  if (f && tax > 0) f.treasury = r2(f.treasury + tax);
}
function refreshPrice(state, key, goodId) {
  const r = state.world.regions[key]; const g = good(state, goodId);
  r.prices[goodId] = r2(unitPrice(state, r, g, num(r.stock[goodId])));
}

// ─────────── players: caravans ───────────
function sendCaravan(state, c, to, goodId, qty, { escort = false, sell = true } = {}) {
  const w = state.world; const s = w.settings;
  const from = requireAt(state, c);
  const dest = geo.marketOf(state, to);
  if (dest === from) throw new UserError('Pick a different market.');
  const active = w.caravans.filter((x) => !x.npc && x.owner.id === c.id && x.status === 'travelling').length;
  if (active >= num(s.maxPlayerCaravans, 2)) throw new UserError(`You already have ${active} caravans on the road (max ${s.maxPlayerCaravans}).`);
  const g = good(state, goodId);
  const it = itemForGood(state, goodId);
  qty = Math.floor(num(qty));
  if (!g || !it) throw new UserError('Unknown good.');
  if (qty < 1 || (c.inventory[it.id] || 0) < qty) throw new UserError(`You don't have ${qty} ${g.name}.`);
  const cap = num(s.caravanCapacity, 120) / Math.max(0.5, num(g.weight, 1));
  if (qty > cap) throw new UserError(`A caravan carries at most ${Math.floor(cap)} ${g.name}.`);
  const rt = geo.route(state, from, dest);
  if (!rt) throw new UserError('No road there.');
  const value = qty * num(w.regions[from].prices[goodId], g.basePrice);
  const fee = r2(qty * 0.4 * rt.hops + (escort ? value * num(s.escortCost, 0.08) : 0));
  if (c.nyang < fee) throw new UserError(`Hiring the caravan${escort ? ' and an escort' : ''} costs ${fmt(fee)} ${state.settings.currencyName}.`);
  c.nyang = r2(c.nyang - fee);
  c.inventory[it.id] -= qty;
  if (c.inventory[it.id] <= 0) delete c.inventory[it.id];
  const hours = r2(rt.distance / 100 * num(s.caravanHoursPer100, 2));
  const cv = { id: newId('cv-'), npc: false, owner: { type: 'character', id: c.id }, ownerUserId: c.ownerId, from, to: dest, path: rt.path, good: goodId, qty, fee, escort: !!escort, sell, departAt: new Date().toISOString(), arriveAt: new Date(Date.now() + hours * 3600000).toISOString(), status: 'travelling', risk: r2(rt.path.slice(1).reduce((a, k) => 1 - (1 - a) * (1 - raidRisk(state, k, escort ? -0.15 : 0)), 0)) };
  w.caravans.push(cv);
  return { cv, hours, fee, route: rt };
}
/** Player caravans whose time has come. Returns results for notifications. */
function settlePlayerCaravans(state, now = Date.now()) {
  const w = state.world;
  const out = [];
  for (const cv of w.caravans) {
    if (cv.npc || cv.status !== 'travelling' || Date.parse(cv.arriveAt) > now) continue;
    const c = state.characters.find((x) => x.id === cv.owner.id);
    const g = good(state, cv.good);
    const it = itemForGood(state, cv.good);
    const { lost, raids } = journeyLoss(state, cv, cv.escort ? 0.15 : 0);
    const qty = Math.floor(cv.qty * (1 - lost));
    const rd = w.regions[cv.to];
    let earned = 0; let sold = 0; let kept = qty;
    if (lost) banditsTake(state, raids[0], qty * num(rd?.prices?.[cv.good], g?.basePrice || 1) * lost);
    if (c && rd && qty > 0 && cv.sell) {
      // Sell what the merchants can afford; the rest waits in the market's warehouse for you.
      let n = qty;
      while (n > 0) {
        const q = quote(state, cv.to, cv.good, n, 'sell', null);
        if (q.total <= rd.coffers) { earned = q.total; sold = n; break; }
        n = Math.floor(n * 0.7);
      }
      if (sold) {
        rd.stock[cv.good] = r2(num(rd.stock[cv.good]) + sold);
        rd.coffers = r2(rd.coffers - earned);
        rd.last.tradeValue = r2(num(rd.last.tradeValue) + earned);
        c.nyang = r2(c.nyang + earned);
        refreshPrice(state, cv.to, cv.good);
      }
      kept = qty - sold;
    }
    if (c && it && kept > 0) c.inventory[it.id] = (c.inventory[it.id] || 0) + kept;
    cv.status = 'arrived'; cv.result = { lost, raids, sold, earned: r2(earned), kept };
    out.push({ cv, c, g });
  }
  // keep a short history of player caravans
  const mine = w.caravans.filter((cv) => !cv.npc && cv.status !== 'travelling');
  if (mine.length > 100) { const drop = new Set(mine.slice(0, mine.length - 100).map((x) => x.id)); w.caravans = w.caravans.filter((cv) => !drop.has(cv.id)); }
  return out;
}

// ─────────── players: workshops ───────────
function ownedWorkshops(state, c) {
  const out = [];
  for (const [k, r] of Object.entries(state.world.regions)) for (const ws of r.workshops || []) if (ws.owner.type === 'character' && ws.owner.id === c.id) out.push({ key: k, ws });
  return out;
}
function buildWorkshop(state, c, typeId) {
  const key = requireAt(state, c);
  const r = state.world.regions[key];
  const t = workshopType(state, typeId);
  if (!t) throw new UserError('Unknown workshop.');
  if (ownedWorkshops(state, c).length >= num(state.world.settings.maxWorkshopsPerCharacter, 2)) throw new UserError(`You can own at most ${state.world.settings.maxWorkshopsPerCharacter} workshops.`);
  if ((r.workshops || []).length >= workshopSlots(state, r)) throw new UserError(`${geo.label(state, key)} has no free workshop plots (${workshopSlots(state, r)}). Plots grow with population and prosperity — or buy an existing workshop.`);
  if (t.requires?.terrains?.length && !t.requires.terrains.includes(r.terrain)) throw new UserError(`${t.name} needs ${t.requires.terrains.join(' / ')} land.`);
  if (t.requires?.anyProduction?.length && !t.requires.anyProduction.some((g) => num(r.production[g]) > 0)) throw new UserError(`${t.name} needs a region that produces ${t.requires.anyProduction.join(' or ')}.`);
  const cost = r2(t.cost * (0.7 + r.prosperity / 100 * 0.6));
  if (c.nyang < cost) throw new UserError(`Building a ${t.name} here costs ${fmt(cost)} ${state.settings.currencyName}.`);
  c.nyang = r2(c.nyang - cost);
  r.coffers = r2(r.coffers + cost * 0.5);
  const ws = { id: newId('ws-'), typeId, level: 1, owner: { type: 'character', id: c.id }, name: '', lastProfit: 0, lastRun: 1, totalProfit: 0, idle: false };
  r.workshops.push(ws);
  return { ws, key, cost };
}
function upgradeWorkshop(state, c, wsId) {
  const found = ownedWorkshops(state, c).find((x) => x.ws.id === wsId);
  if (!found) throw new UserError('That is not your workshop.');
  if (found.ws.level >= 3) throw new UserError('Already at the highest level.');
  const t = workshopType(state, found.ws.typeId);
  const cost = r2(t.cost * (found.ws.level === 1 ? 0.9 : 1.2));
  if (c.nyang < cost) throw new UserError(`Upgrading costs ${fmt(cost)} ${state.settings.currencyName}.`);
  c.nyang = r2(c.nyang - cost);
  found.ws.level += 1;
  return { ...found, cost };
}
function sellWorkshop(state, c, wsId) {
  const found = ownedWorkshops(state, c).find((x) => x.ws.id === wsId);
  if (!found) throw new UserError('That is not your workshop.');
  const t = workshopType(state, found.ws.typeId);
  const r = state.world.regions[found.key];
  const value = r2(t.cost * (found.ws.level === 1 ? 0.5 : found.ws.level === 2 ? 0.9 : 1.4) * (0.6 + r.prosperity / 100 * 0.6));
  const paid = r2(Math.min(value, r.coffers));
  r.coffers = r2(r.coffers - paid);
  c.nyang = r2(c.nyang + paid);
  found.ws.owner = { type: 'region', id: '' };
  return { ...found, paid };
}

// ─────────── shops (server shop + sect shops) ───────────
/** Dynamic price of an item for a buyer: items linked to a good move with that good's local price (bounded). */
function dynamicItemPrice(state, item, basePrice, c) {
  if (!item?.economy?.good || !num(item.economy.sensitivity) || !state.world?.settings?.enabled) return basePrice;
  const key = c ? geo.marketOf(state, locationOf(state, c)) : null;
  if (!key) return basePrice;
  const idx = priceIndex(state, key, item.economy.good);
  const max = num(state.world.settings.shopSwingMax, 25) / 100;
  const mult = clamp(1 + num(item.economy.sensitivity) * (idx - 1), 1 - max, 1 + max);
  return Math.max(1, Math.round(basePrice * mult));
}

/** How a sect shop treats a buyer: { tier, pct, allowed, reason } */
function shopTerms(state, f, c, entry) {
  const s = state.world.settings;
  const tiers = s.shopTiers || {};
  const buyerF = C.factionOfChar(state, c);
  const policyAccess = f.policies.map((p) => state.world.policies.find((x) => x.id === p.policyId)?.shopAccess).find(Boolean);
  const access = entry && entry.access !== 'inherit' ? entry.access : policyAccess || f.shop.access;
  let tier = 'neutral';
  if (buyerF && buyerF.id === f.id) tier = 'member';
  else if (buyerF) {
    const st = C.stance(state, f.id, buyerF.id);
    const allyTreaty = state.world.treaties.some((t) => t.parties.includes(f.id) && t.parties.includes(buyerF.id) && state.world.treatyTypes.find((x) => x.id === t.type)?.shopTier === 'ally');
    if (st === 'war') tier = 'war';
    else if (st === 'allied' || allyTreaty || st === 'friendly') tier = 'ally';
    else if (st === 'rival' || st === 'hostile') tier = 'rival';
    if (C.hasTreaty(state, f.id, buyerF.id, 'embargo')) tier = 'war';
  }
  const pct = tiers[tier];
  if (tier === 'war' || pct === null || pct === undefined) return { tier, pct: 0, allowed: false, reason: `${f.name} will not sell to enemies.` };
  if (access === 'members' && tier !== 'member') return { tier, pct, allowed: false, reason: `${f.name}'s gates are closed — members only.` };
  if (access === 'allies' && !['member', 'ally'].includes(tier)) return { tier, pct, allowed: false, reason: `${f.name} only sells to members and allies.` };
  return { tier, pct: num(pct), allowed: true, reason: '' };
}
function sectShopOffers(state, c) {
  const out = [];
  for (const f of state.world.factions) {
    if (!f.active || !f.shop.items.length) continue;
    for (const e of f.shop.items) {
      const it = state.items.find((i) => i.id === e.itemId);
      if (!it) continue;
      const base = e.price !== null ? num(e.price) : num(it.shop?.price);
      if (!(base > 0)) continue;
      const terms = shopTerms(state, f, c, e);
      let price = dynamicItemPrice(state, it, base, c);
      price = Math.max(1, Math.round(price * (1 + terms.pct / 100)));
      const sources = [{ scriptId: f.scriptId, type: 'faction', name: f.name }];
      if (f.scriptId) {
        const v = C.runHooks(state, sources, 'shopPrice', C.worldCtx(state, { faction: C.factionSummary(state, f), buyer: c ? { id: c.id, name: c.name, sect: c.sect } : null, item: { id: it.id, name: it.name } }), { price, allowed: terms.allowed, reason: terms.reason });
        if (v && typeof v === 'object') { price = Math.max(0, num(v.price, price)); terms.allowed = v.allowed !== false; terms.reason = v.reason || terms.reason; }
      }
      out.push({ key: `F.${f.id}.${it.id}`, faction: f, entry: e, it, price, base, ...terms, stock: num(e.stock, -1) });
    }
  }
  return out;
}
function buyFromSectShop(state, c, factionId, itemId, qty) {
  qty = Math.max(1, Math.floor(num(qty, 1)));
  const o = sectShopOffers(state, c).find((x) => x.faction.id === factionId && x.it.id === itemId);
  if (!o) throw new UserError('That item is not sold there.');
  if (!o.allowed) throw new UserError(o.reason);
  if (o.stock >= 0 && o.stock < qty) throw new UserError(`Only ${o.stock} left.`);
  const cost = r2(o.price * qty);
  if (c.nyang < cost) throw new UserError(`You need ${fmt(cost)} ${state.settings.currencyName}.`);
  c.nyang = r2(c.nyang - cost);
  o.faction.treasury = r2(o.faction.treasury + cost);
  if (o.stock >= 0) o.entry.stock = o.stock - qty;
  c.inventory[itemId] = (c.inventory[itemId] || 0) + qty;
  return { ...o, qty, cost };
}

module.exports = {
  LEVEL_MULT, goods, good, prosperityFactor, popDemand, targetsFor, unitPrice, updatePrices, priceIndex, initMarkets,
  workshopType, workshopSlots, tickRegion, peddlerTrade, dispatchNpcCaravans, arriveNpcCaravans, raidRisk, embargoed, armyMen,
  locationOf, travelInfo, startTravel, settleTravel, isTravelling, requireAt,
  tariffFor, quote, itemForGood, buyGood, sellGood, sendCaravan, settlePlayerCaravans,
  ownedWorkshops, buildWorkshop, upgradeWorkshop, sellWorkshop,
  dynamicItemPrice, shopTerms, sectShopOffers, buyFromSectShop, caravanTurns,
};
