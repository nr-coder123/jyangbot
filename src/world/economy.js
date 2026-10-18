'use strict';
/**
 * Regional economy, inspired by Bannerlord's supply-chain mods:
 *  · every market (province or special prefecture) has stock, production, demand and coffers
 *  · prices follow stock vs. what the market wants to hold:  price = base × (target ÷ stock)^elasticity
 *  · production buildings turn local inputs into outputs (supply chains); merchants move surplus to shortage
 *  · the "normal market": merchants trade across every border (paying the ruler a tariff) unless there is war or an
 *    embargo; free trade removes the tariff and lets the factions' own merchant houses trade (see realm.autoTrade)
 *  · coffers = the merchants' purse: households fill it, imports and purchases from players drain it
 *  · prosperity rises with food, salt, trade and safety, and is dragged down by its own weight,
 *    so a region settles where its land and trade can carry it; events and wars shake it
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
function buildingNeeds(state, r) {
  const need = {};
  for (const b of r.buildings || []) {
    if (b.status !== 'ready') continue;
    const t = (state.world.buildingTypes || []).find((x) => x.id === b.typeId);
    if (!t) continue;
    for (const [gid, q] of Object.entries(t.inputs || {})) need[gid] = (need[gid] || 0) + num(q) * (LEVEL_MULT[b.level] || 1);
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
  const ws = buildingNeeds(state, r);
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
  PRICE_GEN++;
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

// ─────────── production buildings ───────────
/**
 * A production building buys its inputs from the market, makes its outputs (× level × prosperity × half when damaged)
 * and sells them back; a service building (inns, escorts) earns from customers. The profit goes to the region's
 * ruler (or stays in the town's coffers when nobody rules it). It cuts back when the output is worth less than the inputs.
 */
function runBuilding(state, key, r, b, t, mods, ledger) {
  const lv = (LEVEL_MULT[b.level] || 1) * (b.hp < 50 ? 0.5 : 1);
  const pf = prosperityFactor(r.prosperity);
  const hasIn = Object.keys(t.inputs || {}).length;
  let f = 1;
  for (const [gid, q] of Object.entries(t.inputs || {})) f = Math.min(f, num(r.stock[gid]) / Math.max(0.01, num(q) * lv));
  f = clamp(f, 0, 1);
  if (f > 0 && (Object.keys(t.outputs || {}).length || (num(t.service) && hasIn))) {
    let estIn = num(t.upkeep) * 0.7; let estOut = num(t.service) * Math.min(1.6, Math.sqrt(Math.max(0, r.population) / 20)) * pf * mods.income;
    for (const [gid, q] of Object.entries(t.inputs || {})) estIn += num(q) * num(r.prices[gid], good(state, gid)?.basePrice || 0);
    for (const [gid, q] of Object.entries(t.outputs || {})) estOut += num(q) * pf * num(r.prices[gid], good(state, gid)?.basePrice || 0);
    if (estOut < estIn) f = Math.min(f, 0.25);
  }
  let costIn = 0; let valueOut = 0;
  for (const [gid, q] of Object.entries(t.inputs || {})) {
    const g = good(state, gid); if (!g) continue;
    const used = num(q) * lv * f;
    costIn += used * num(r.prices[gid], g.basePrice);
    r.stock[gid] = r2(num(r.stock[gid]) - used);
  }
  const outs = {};
  for (const [gid, q] of Object.entries(t.outputs || {})) {
    const g = good(state, gid); if (!g) continue;
    const made = num(q) * lv * f * pf * C.mulFor(mods.production, g);
    outs[gid] = made;
    valueOut += made * num(r.prices[gid], g.basePrice);
  }
  const affordable = valueOut > 0 ? clamp((r.coffers + costIn) / valueOut, 0, 1) : 1;
  for (const [gid, made] of Object.entries(outs)) r.stock[gid] = r2(num(r.stock[gid]) + made * affordable);
  valueOut *= affordable;
  const service = num(t.service) ? num(t.service) * lv * Math.min(1.6, Math.sqrt(Math.max(0, r.population) / 20)) * pf * mods.income * (hasIn ? f : 1) : 0;
  const wages = num(t.upkeep) * lv * (0.3 + 0.7 * (hasIn ? f : 1));
  r.coffers = r2(Math.max(0, r.coffers + costIn - valueOut - service + wages));
  // A ruler never loses more than an idle building's retainer in a bad turn.
  const profit = r2(Math.max(valueOut + service - costIn - wages, -num(t.upkeep) * 0.3 * lv));
  const owner = C.faction(state, r.controller);
  if (owner) {
    const p = profit < 0 ? -Math.min(-profit, Math.max(0, owner.treasury)) : profit;
    owner.treasury = r2(owner.treasury + p);
    ledger.buildings[owner.id] = r2((ledger.buildings[owner.id] || 0) + p);
  } else r.coffers = r2(r.coffers + Math.max(0, profit));
  // Value added to the region's economy (its GDP): what the building makes, less what it uses up.
  b.valueAdded = r2(Math.max(0, valueOut + service - costIn));
  b.lastRun = r2(f); b.lastProfit = profit;
}
const isProducer = (t) => !!(t && (Object.keys(t.outputs || {}).length || num(t.service)));

/** Taxes and tariffs go into the ruler's pending purse; the treasury receives it every `taxEveryTurns` turns. */
function collectTax(state, fid, amount, ledger) {
  const f = C.faction(state, fid);
  if (!f || !(amount > 0)) return;
  f.taxPending = r2(num(f.taxPending) + amount);
  if (ledger) ledger.factionTax[f.id] = r2((ledger.factionTax[f.id] || 0) + amount);
}

/** Can merchants carry goods from market a into market b, and what tariff do they pay to b's ruler? */
function border(state, a, b) {
  const fa = state.world.regions[a]?.controller || null; const fb = state.world.regions[b]?.controller || null;
  if (fa === fb) return { blocked: false, tariff: 0, payee: null };
  if (fa && fb && (C.atWar(state, fa, fb) || C.embargo(state, fa, fb))) return { blocked: true, tariff: 0, payee: null };
  if (!fb) return { blocked: false, tariff: 0, payee: null };
  if (fa && C.hasPerk(state, fa, fb, 'freeTrade')) return { blocked: false, tariff: 0, payee: null };
  return { blocked: false, tariff: num(state.world.settings.borderTariff, 5) / 100, payee: fb };
}

// ─────────── the turn ───────────
/**
 * One economic turn for one market. Returns a small summary.
 * Order: modifiers → production → production buildings → armies eat → households consume → spoilage → prices → society.
 */
function tickRegion(state, key, ledger) {
  const w = state.world;
  const s = w.settings;
  const r = w.regions[key];
  const cal = C.calendar(state);
  const mods = C.regionMods(state, key);
  const pf = prosperityFactor(r.prosperity);
  const sat = {};
  // GDP (Victoria 3 style): the value the region's economy creates this turn. Taxes are a share of it.
  let produced = 0;
  // Production
  // Producers respond to prices: they plant, mine and breed less when prices crash and more when they soar.
  for (const g of goods(state)) {
    const base = num(r.production[g.id]);
    if (!base) continue;
    const seasonal = Array.isArray(g.seasonal) ? num(g.seasonal[cal.season], 1) : 1;
    const idx = num(r.prices[g.id], g.basePrice) / g.basePrice / Math.max(0.1, num(r.priceMods?.[g.id], 1));
    const response = clamp(Math.pow(idx, num(s.supplyResponse, 0.4)), 0.55, 1.3);
    const made = base * pf * seasonal * response * C.mulFor(mods.production, g);
    r.stock[g.id] = r2(num(r.stock[g.id]) + made);
    produced += made * num(r.prices[g.id], g.basePrice);
  }
  // Production buildings
  for (const b of r.buildings || []) {
    if (b.status !== 'ready') continue;
    const t = (w.buildingTypes || []).find((x) => x.id === b.typeId);
    if (isProducer(t)) { runBuilding(state, key, r, b, t, mods, ledger); produced += num(b.valueAdded); }
  }
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
  // Taxes come from the circulation of the economy, not from a flat head count:
  //   GDP = value of what the land and its workshops produced + a share of the trade that passed through its market (last turn).
  const traded = num(r.last?.tradeValue) * num(s.gdpTradeShare, 0.25);
  const gdp = (produced + traded) * mods.income;
  const taxes = Math.min(Math.max(0, r.coffers + income), gdp * num(r.taxRate) / 100 * mods.tax);
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
  const drag = Math.pow(r.prosperity / 100, 2) * 5;
  const noise = (Math.random() - 0.5) * 0.8;
  const dP = growth - drag + num(mods.prosperity) + noise;
  r.prosperity = r2(clamp(r.prosperity + dP, 0, 100));
  // Security (bandits on the roads) drifts toward a target set by walls, garrisons and hunger.
  const garrison = w.armies.some((a) => a.region === key && a.factionId === r.controller && a.status !== 'disbanded') ? 12 : 0;
  const target = clamp(45 + C.wallsOf(state, key) * 5 + garrison - (1 - food) * 30, 5, 95);
  r.security = r2(clamp(r.security + (target - r.security) * 0.12 + num(mods.security), 0, 100));
  // Population grows with food and prosperity.
  // The land can only feed so many: growth slows as population passes its base (carrying capacity).
  const dPop = (food - 0.95) * 0.8 + (r.prosperity - 50) / 50 * 0.1 - 0.4 * Math.max(0, r.population / Math.max(1, num(r.basePop, r.population)) - 1) + num(mods.population);
  r.population = r2(Math.max(1, r.population * (1 + dPop / 100)));
  if (mods.fortGrowth) r.fort = r2(clamp(num(r.fort) + mods.fortGrowth, 0, Math.max(5, num(r.fort))));
  r.last = { ...r.last, food: r2(food), staple: r2(staple), lux: r2(lux), income: r2(income), taxes: r2(taxes), spent: r2(spent), gdp: r2(gdp), produced: r2(produced), traded: r2(traded), dP: r2(dP), growth: r2(growth), drag: r2(drag), sources: mods.sources, notes: mods.notes || [], caravanRisk: r2(num(mods.caravanRisk)), tariff: r2(num(mods.tariff)), noGuild: num(mods.noGuildCaravans) > 0, tradeValue: 0, trade: r2(trade) };
  r.history.push({ t: w.turn, p: r.prosperity, s: r.security, f: r2(food) });
  if (r.history.length > 60) r.history.splice(0, r.history.length - 60);
  // Controller (or occupier) collects the taxes
  collectTax(state, r.occupiedBy || r.controller, taxes, ledger);
  return { key, food, dP, mods };
}

// ─────────── local trade (peddlers) ───────────
/**
 * Every turn, small traders carry goods across each road between neighbouring markets, from where a good
 * is plentiful to where it is scarce, if the price gap covers the trip (5% per road). This spreads supply
 * smoothly over the map; the merchant caravans below handle big long-distance shipments.
 *   flow = rate × the amount that would make both markets equally stocked, paid by the buying market's coffers.
 */
function peddlerTrade(state, ledger = null) {
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
      const road = 1 + 0.05 * Math.max(1, e.cost / 120);
      for (const g of goods(state)) {
        const Ta = num(ra.targets[g.id], 3); const Tb = num(rb.targets[g.id], 3);
        const sa = num(ra.stock[g.id]) / Ta; const sb = num(rb.stock[g.id]) / Tb;
        let from = ra; let to = rb; let sf = sa; let st = sb;
        if (sb > sa) { from = rb; to = ra; sf = sb; st = sa; }
        if (sf < st * 1.15 + 0.05) continue;
        const bd = border(state, from.key, to.key);
        const cost = road + bd.tariff;
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
        if (bd.payee) collectTax(state, bd.payee, q * pf * bd.tariff, ledger);
        from.last.tradeValue = r2(num(from.last.tradeValue) + q * pf);
        to.last.tradeValue = r2(num(to.last.tradeValue) + paid);
        moved += paid;
      }
    }
  }
  for (const k of geo.marketKeys(state)) { const r = w.regions[k]; for (const g of goods(state)) r.prices[g.id] = r2(unitPrice(state, r, g, num(r.stock[g.id]))); }
  PRICE_GEN++;
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
  return border(state, a, b).blocked;
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
        const margin = num(rd.prices[g.id]) - num(rs.prices[g.id]) * (1 + 0.06 * hops + border(state, src, dest).tariff);
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
    const bd = border(state, o.src, o.dest);
    w.caravans.push({ id: newId('cv-'), npc: true, owner: guild ? { type: 'faction', id: guild.id } : { type: 'region', id: o.dest }, from: o.src, to: o.dest, path: rt.path, good: o.good.id, qty, cost: buy, tariff: bd.tariff, payee: bd.payee, departTurn: w.turn, arriveTurn: w.turn + caravanTurns(state, rt.distance), status: 'travelling' });
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
    if (cv.payee && cv.tariff) collectTax(state, cv.payee, pay * cv.tariff);
    // The guild keeps a share of the margin; the rest pays drivers, tolls and inns along the way.
    const profit = r2((pay - cv.cost) * num(w.settings.guildShare, 0.1));
    if (cv.owner?.type === 'faction') { const f = C.faction(state, cv.owner.id); if (f) f.treasury = r2(Math.max(0, f.treasury + profit)); }
    cv.status = lost >= 0.99 ? 'raided' : 'arrived'; cv.profit = profit;
    done.push(cv);
  }
  w.caravans = w.caravans.filter((cv) => cv.status === 'travelling' || (!cv.npc && cv.status !== 'archived' && !(cv.auto && w.turn - num(cv.arriveTurn) > 8)));
  return done;
}

// ─────────── where a character is (only used to pick which region /world shows first) ───────────
function locationOf(state, c) {
  if (c.location && geo.get(c.location)) return c.location;
  const f = C.factionOfChar(state, c);
  return (f && f.hq && geo.get(f.hq) && f.hq) || state.world.settings.startRegion || '河南';
}

// ─────────── market quotes (merchant houses and guild caravans) ───────────
/** Price for buying (side 'buy') or selling ('sell') qty units, walking the price as stock changes. */
function quote(state, key, goodId, qty, side) {
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
  const final = r2(side === 'buy' ? total * (1 + spread) : total * (1 - spread));
  return { qty, total: final, each: r2(final / qty), coffers: r.coffers };
}
function itemForGood(state, goodId) {
  const g = good(state, goodId);
  return state.items.find((i) => i.tradeGood === goodId) || (g?.itemId && state.items.find((i) => i.id === g.itemId)) || null;
}
function refreshPrice(state, key, goodId) {
  PRICE_GEN++;
  const r = state.world.regions[key]; const g = good(state, goodId);
  r.prices[goodId] = r2(unitPrice(state, r, g, num(r.stock[goodId])));
}

// ─────────── item prices (shop, sell-back, player market) ───────────
/**
 * Items follow the economy, but nothing depends on where a character posts.
 *   base      = the item's reference value (shop price, else its own reference value, else by rarity)
 *   mult(idx) = clamp(1 + sensitivity × (idx − 1), 1 − swing, 1 + swing)   idx = linked good's price ÷ its base price
 *   global    = base × mult(realm index)            — the good's average price over every market, weighted by people
 *   yours     = base × mult(your sect's index)      — over the markets your sect rules plus those of its free-trade partners
 *                                                    (a sect without land, or a character without a sect, pays the global price)
 *   cheapest  = the lowest of global and every sect's price — the cheapest anyone can buy it from the shop
 *   resale cap (player market) = cheapest for shop items, global × resaleCap% for everything else
 *   sell-back (to the shop)    = min(global, cheapest) × sell-back %
 * So whatever someone paid — or if the item was a gift — reselling it can never earn more than the cheapest honest source:
 * buying cheap through one's sect and reselling dear is impossible, and the shop always pays less than anyone pays it.
 * Raw materials (trade goods) belong to the economy alone: players can't trade, list or sell them.
 */
let PRICE_GEN = 0;
const bumpPrices = () => { PRICE_GEN++; };
let PCACHE = { gen: -1, map: new Map() };
function cached(key, fn) {
  if (PCACHE.gen !== PRICE_GEN) PCACHE = { gen: PRICE_GEN, map: new Map() };
  if (!PCACHE.map.has(key)) PCACHE.map.set(key, fn());
  return PCACHE.map.get(key);
}
function weightedIndex(state, keys, goodId) {
  let sum = 0; let wt = 0;
  for (const k of keys) {
    const r = state.world.regions[k]; if (!r) continue;
    const p = Math.max(1, num(r.population, 1));
    sum += priceIndex(state, k, goodId) * p; wt += p;
  }
  return wt ? sum / wt : null;
}
function realmPriceIndex(state, goodId) {
  return cached(`realm|${goodId}`, () => weightedIndex(state, geo.marketKeys(state), goodId) ?? 1);
}
/** The markets a sect buys through: its own and those of its free-trade partners (none → null). */
function sectMarkets(state, fid) {
  const w = state.world;
  const partners = new Set(w.factions.filter((o) => o.id !== fid && o.active && C.hasPerk(state, fid, o.id, 'freeTrade')).map((o) => o.id));
  const keys = geo.marketKeys(state).filter((k) => { const c = w.regions[k]?.controller; return c && (c === fid || partners.has(c)); });
  return keys.length ? keys : null;
}
function sectPriceIndex(state, fid, goodId) {
  const keys = fid ? sectMarkets(state, fid) : null;
  if (!keys) return realmPriceIndex(state, goodId);
  return cached(`sect|${goodId}|${keys.join(',')}`, () => weightedIndex(state, keys, goodId) ?? realmPriceIndex(state, goodId));
}
function realmPrice(state, goodId) {
  const g = good(state, goodId);
  return g ? r2(num(g.basePrice) * realmPriceIndex(state, goodId)) : 0;
}
const linkedGood = (state, item) => (item?.economy?.good && item.economy.good !== 'none' && good(state, item.economy.good) ? item.economy.good : null);
function goodMult(state, item, idx) {
  const sens = num(item?.economy?.sensitivity);
  if (!sens) return 1;
  const max = num(state.world.settings.shopSwingMax, 25) / 100;
  return clamp(1 + sens * (idx - 1), 1 - max, 1 + max);
}
/** Reference value of an item before the economy moves it. */
function itemBase(state, item) {
  if (num(item.shop?.price) > 0) return num(item.shop.price);
  if (num(item.economy?.base) > 0) return num(item.economy.base);
  const back = num(state.settings?.shopSellbackPercent, 50) / 100;
  if (item.sellPrice !== null && item.sellPrice !== undefined && num(item.sellPrice) > 0) return num(item.sellPrice) / Math.max(0.05, back);
  const byRarity = state.world?.settings?.itemValueByRarity || [50, 250, 1000];
  const i = Math.max(0, (state.rarities || []).findIndex((r) => r.name === item.rarity));
  return num(byRarity[Math.min(i, byRarity.length - 1)], 50);
}
/** Every price of one item for one character (c may be null). */
function itemQuote(state, item, c = null) {
  const settingsOn = !!state.world?.settings?.enabled;
  const back = num(state.settings?.shopSellbackPercent, 50) / 100;
  const inShop = !!item.shop?.enabled && num(item.shop?.price) > 0;
  const explicitSell = item.sellPrice !== null && item.sellPrice !== undefined;
  if (item.tradeGood) return { raw: true, base: 0, global: 0, yours: 0, cheapest: 0, resaleCap: 0, sellback: 0, good: item.tradeGood };
  if (!settingsOn) {
    const base = num(item.shop?.price);
    const sellback = explicitSell ? num(item.sellPrice) : inShop ? Math.floor(base * back) : 0;
    return { base, global: base, yours: base, cheapest: base, resaleCap: Infinity, sellback, good: null };
  }
  const base = itemBase(state, item);
  const gid = linkedGood(state, item);
  const at = (idx) => Math.max(1, Math.round(base * (gid ? goodMult(state, item, idx) : 1)));
  const global = at(gid ? realmPriceIndex(state, gid) : 1);
  const fid = c ? C.factionOfChar(state, c)?.id : null;
  const yours = gid ? at(sectPriceIndex(state, fid, gid)) : global;
  let cheapest = global;
  if (gid) for (const f of state.world.factions) if (f.active) cheapest = Math.min(cheapest, at(sectPriceIndex(state, f.id, gid)));
  const resaleCap = inShop ? cheapest : Math.max(1, Math.round(global * num(state.world.settings.resaleCap, 100) / 100));
  let sellback = 0;
  if (explicitSell) sellback = Math.round(num(item.sellPrice) * (gid ? goodMult(state, item, realmPriceIndex(state, gid)) : 1) * 100) / 100;
  else if (inShop) sellback = Math.floor(Math.min(global, cheapest) * back);
  if (inShop) sellback = Math.min(sellback, Math.floor(cheapest * Math.min(0.95, Math.max(back, 0.5))));
  return { base: r2(base), global, yours, cheapest, resaleCap, sellback: Math.max(0, sellback), good: gid };
}
/** Shop price of an item for members of one faction. */
function itemPriceForFaction(state, item, fid) {
  const base = itemBase(state, item); const gid = linkedGood(state, item);
  return Math.max(1, Math.round(base * (gid ? goodMult(state, item, sectPriceIndex(state, fid, gid)) : 1)));
}
/** Shop price of an item for a buyer (their sect's markets decide it). */
function dynamicItemPrice(state, item, basePrice, c = null) {
  if (!state.world?.settings?.enabled) return num(basePrice);
  return itemQuote(state, item, c).yours;
}

/** Pick the trade good an item's price should follow (by type, then by words in its name). */
const LINK_WORDS = [
  [/\bjade\b/i, 'jade'], [/pearl/i, 'pearls'], [/cinnabar/i, 'cinnabar'], [/spirit|lingzhi|ginseng|lotus/i, 'spiritherbs'], [/herb|root|leaf|flower|grass|moss/i, 'herbs'],
  [/silk/i, 'silk'], [/iron|steel|metal|\bore\b|bronze|blade|sword|sabre|saber|spear|armou?r/i, 'arms'], [/wood|timber|bamboo/i, 'timber'],
  [/horse|steed/i, 'horses'], [/fur|pelt|hide|leather/i, 'furs'], [/porcelain|\bjar\b|\bbowl\b/i, 'porcelain'], [/\btea\b/i, 'tea'], [/\bwine\b|liquor/i, 'wine'],
  [/\bsalt\b/i, 'salt'], [/spice|pepper/i, 'spices'], [/paper|scroll|book|manual|talisman|ink/i, 'paper'], [/elixir|\bpills?\b|pellet|\bdan\b|\bcore\b|essence/i, 'elixirs'],
  [/medicine|salve|balm|antidote|remedy|poultice/i, 'medicine'], [/poison|venom|toxin/i, 'herbs'],
];
const LINK_TYPES = { pill: 'elixirs', purification: 'medicine', poison: 'herbs', weapon: 'arms', manual: 'paper', treasure: 'jade' };
function pickGoodFor(state, item) {
  const has = (id) => !!good(state, id);
  const text = `${item.name || ''} ${item.description || ''}`;
  if (LINK_TYPES[item.type] && has(LINK_TYPES[item.type]) && item.type !== 'material' && item.type !== 'misc') return LINK_TYPES[item.type];
  for (const [re, id] of LINK_WORDS) if (re.test(item.name || '') && has(id)) return id;
  for (const [re, id] of LINK_WORDS) if (re.test(text) && has(id)) return id;
  const rare = Math.max(0, (state.rarities || []).findIndex((r) => r.name === item.rarity));
  return has(rare > 0 ? 'spiritherbs' : 'herbs') ? (rare > 0 ? 'spiritherbs' : 'herbs') : (goods(state)[0]?.id || '');
}
/** Give every sellable item without a linked good one (or all of them with overwrite). Returns how many changed. */
function autoLinkItems(state, { overwrite = false } = {}) {
  let n = 0;
  const sens = num(state.world?.settings?.autoLinkSensitivity, 0.5);
  for (const it of state.items || []) {
    if (it.tradeGood) continue;
    const sellable = it.shop?.enabled || (it.tradeable !== false && it.marketable !== false) || (it.sellPrice !== null && it.sellPrice !== undefined);
    if (!sellable) continue;
    if (!overwrite && it.economy?.good) continue;
    const gid = pickGoodFor(state, it);
    if (!gid) continue;
    it.economy = { ...(it.economy || {}), good: gid, sensitivity: num(it.economy?.sensitivity) > 0 ? num(it.economy.sensitivity) : sens };
    n++;
  }
  return n;
}

module.exports = {
  LEVEL_MULT, goods, good, prosperityFactor, popDemand, targetsFor, unitPrice, updatePrices, priceIndex, initMarkets,
  buildingNeeds, runBuilding, isProducer, collectTax, border, tickRegion, peddlerTrade, dispatchNpcCaravans, arriveNpcCaravans, raidRisk, embargoed, armyMen, journeyLoss, banditsTake,
  locationOf, quote, itemForGood, refreshPrice,
  dynamicItemPrice, realmPriceIndex, sectPriceIndex, sectMarkets, realmPrice, itemBase, itemQuote, itemPriceForFaction, pickGoodFor, autoLinkItems, bumpPrices, caravanTurns,
};
