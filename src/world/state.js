'use strict';
/** Creates and upgrades state.world. Everything stays editable in the dashboard. */
const geo = require('./geo');
const W = require('./defaults');
const { clone, num, arr, slug, isPlainObject, deepMerge, r2 } = require('../utils');

const FACTION_KINDS = ['sect', 'clan', 'palace', 'cult', 'court', 'guild', 'bandits', 'other'];
const PLAYABLE_KINDS = ['sect', 'clan', 'palace', 'cult', 'bandits'];

function kindOfSect(name) {
  if (/clan/i.test(name)) return 'clan';
  if (/palace/i.test(name)) return 'palace';
  if (/cult/i.test(name)) return 'cult';
  if (/stronghold|bandit/i.test(name)) return 'bandits';
  return 'sect';
}
const factionIdForSect = (name) => slug(name).replace(/^the-/, '');

function normalizeFaction(f = {}) {
  return {
    id: f.id || slug(f.name || 'faction'),
    name: String(f.name || 'Faction'),
    hanzi: f.hanzi || '',
    sect: f.sect || '', // linked sect name (members = characters of that sect)
    kind: FACTION_KINDS.includes(f.kind) ? f.kind : 'other',
    alignment: f.alignment || 'Neutral',
    color: f.color || '#888888',
    secondaryColor: f.secondaryColor || '',
    colorStyle: ['washed', 'vivid'].includes(f.colorStyle) ? f.colorStyle : '', // '' = the map's default
    icon: f.icon || '', // optional; the map never forces one
    hq: f.hq || '',
    npc: !!f.npc,
    tradeCharter: !!f.tradeCharter, // may run trade caravans even if not a guild
    embargoes: arr(f.embargoes).map(String), // factions whose merchants may not trade with this one's lands
    taxPending: r2(Math.max(0, num(f.taxPending))),
    active: f.active !== false,
    treasury: r2(num(f.treasury, 2000)),
    leaderCharId: f.leaderCharId || '',
    representatives: arr(f.representatives).map(String),
    // Rank of each representative (see settings.repRanks): what they may do on their own, with staff approval, or not at all.
    repRanks: isPlainObject(f.repRanks) ? Object.fromEntries(Object.entries(f.repRanks).map(([k, v]) => [String(k), String(v)])) : {},
    repRoleId: f.repRoleId || '',
    policies: arr(f.policies).filter((p) => p && p.policyId).map((p) => ({ policyId: p.policyId, region: p.region || '', since: num(p.since) })),
    // Stipends: a share of each turn's net income set aside and paid to members every season (see world/territory.js).
    stipendRate: Math.max(0, Math.min(100, num(f.stipendRate, 0))),
    stipendFund: r2(Math.max(0, num(f.stipendFund, 0))),
    lastStipend: isPlainObject(f.lastStipend) ? f.lastStipend : null,
    lastIncome: f.lastIncome || {},
    description: f.description || '',
    scriptId: f.scriptId || '',
  };
}

function normalizeRegion(key, r = {}) {
  const g = geo.get(key);
  const isProv = g?.kind === 'province';
  const out = {
    key,
    displayName: r.displayName || '',
    controller: r.controller || null,
    categoryId: r.categoryId || '',
    channelIds: arr(r.channelIds).map(String),
    announceChannelId: r.announceChannelId || '',
    special: isProv ? false : !!r.special,
    // Prefectures follow their province's ruler unless painted on their own.
    ownController: isProv ? false : !!r.ownController,
    notes: r.notes || '',
    scriptId: r.scriptId || '',
  };
  if (isProv || out.special) {
    Object.assign(out, {
      terrain: W.TERRAINS[r.terrain] ? r.terrain : 'plains',
      population: r2(Math.max(0, num(r.population, 10))),
      basePop: r2(Math.max(1, num(r.basePop, num(r.population, 10)))),
      fort: Math.max(0, Math.min(10, num(r.fort, 1))), // base walls 0–10 (City Walls buildings add on top)
      prosperity: r2(Math.max(0, Math.min(100, num(r.prosperity, 50)))),
      security: r2(Math.max(0, Math.min(100, num(r.security, 55)))),
      coffers: r2(Math.max(0, num(r.coffers, 0))),
      taxRate: Math.max(0, Math.min(60, num(r.taxRate, 10))),
      production: isPlainObject(r.production) ? Object.fromEntries(Object.entries(r.production).map(([k, v]) => [k, Math.max(0, num(v))])) : {},
      stock: isPlainObject(r.stock) ? Object.fromEntries(Object.entries(r.stock).map(([k, v]) => [k, Math.max(0, num(v))])) : {},
      prices: isPlainObject(r.prices) ? r.prices : {},
      targets: isPlainObject(r.targets) ? r.targets : {},
      priceMods: isPlainObject(r.priceMods) ? r.priceMods : {},
      priceHistory: isPlainObject(r.priceHistory) ? r.priceHistory : {},
      policies: arr(r.policies).filter((p) => p && p.policyId).map((p) => ({ policyId: p.policyId, factionId: p.factionId || '', since: num(p.since) })),
      buildings: arr(r.buildings).filter((b) => b && b.typeId).map(normalizeBuilding),
      occupiedBy: r.occupiedBy || null,
      occupiedSince: num(r.occupiedSince, 0),
      last: isPlainObject(r.last) ? r.last : {},
      history: arr(r.history).slice(-60),
    });
  }
  return out;
}

const WORLD_VERSION = 7;
/** Put the preset buildings into regions that don't have them yet. */
function seedBuildings(regions) {
  for (const [key, typeId, level] of W.START_BUILDINGS) {
    const r = regions[key];
    if (!r || !Array.isArray(r.buildings)) continue;
    const have = r.buildings.find((b) => b.typeId === typeId);
    if (have) { have.level = Math.max(num(have.level, 1), level); continue; }
    r.buildings.push(normalizeBuilding({ id: `bd-${slug(key)}-${typeId}`, typeId, level, factionId: r.controller || '', status: 'ready' }));
  }
}
const GOOD_NOTE = (g) => `-# **Trade good** — base price ${g.basePrice}. Sell it from your inventory at its average price across the realm (the same wherever you post), give it to anyone, or list it on the player market.`;
/** v6 → v7: players no longer trade with a province's market (no buying, selling, caravans or travel by channel).
 *  Player caravans still on the road bring their cargo home. */
function migrateV7(state, w) {
  for (const cv of arr(w.caravans)) {
    if (cv.npc || cv.owner?.type !== 'character' || cv.status !== 'travelling') continue;
    const c = (state.characters || []).find((x) => x.id === cv.owner.id);
    const it = (state.items || []).find((i) => i.tradeGood === cv.good);
    if (c && it) { c.inventory = c.inventory || {}; c.inventory[it.id] = num(c.inventory[it.id]) + num(cv.qty); }
    cv.status = 'archived';
  }
  w.caravans = arr(w.caravans).filter((cv) => cv.status !== 'archived' && !(cv.owner?.type === 'character'));
  for (const c of state.characters || []) { delete c.travel; delete c.worldTrade; }
  for (const it of state.items || []) {
    if (!it.tradeGood || typeof it.description !== 'string') continue;
    const i = it.description.indexOf('-# **Trade good** — bought and sold at regional markets');
    const g = arr(w.goods).find((x) => x.id === it.tradeGood);
    if (i >= 0 && g) { it.description = it.description.slice(0, i) + GOOD_NOTE(g); it.marketable = true; }
  }
  if (w.settings) for (const k of ['travelMode', 'kmPerPx', 'travelSpeeds', 'travelHoursPer100', 'caravanHoursPer100', 'maxPlayerCaravans', 'escortCost', 'maxTradePerTurn', 'playerMarketBuy', 'playerMarketSell', 'playerCaravans', 'baseTariff']) delete w.settings[k];
}
/** v5 → v6: the shop no longer depends on where a character posts (no local prices, sales tax or "open markets"). */
function migrateV6(state, w) {
  w.policies = arr(w.policies).map(W.cleanPolicy);
  if (w.settings) for (const k of ['localPrices', 'shopSalesTax', 'madeHereDiscount', 'shopTiers']) delete w.settings[k];
}
/** v4 → v5: sect shops are gone; City Walls can be raised to level 3. */
function migrateV5(state, w) {
  w.policies = arr(w.policies).map(W.cleanPolicy);
  const walls = arr(w.buildingTypes).find((t) => t.id === 'walls');
  if (walls && num(walls.maxLevel, 1) <= 1) { walls.maxLevel = 3; walls.description = W.BUILDING_TYPES.find((t) => t.id === 'walls').description; }
  if (w.settings) delete w.settings.shopTiers;
  for (const f of arr(w.factions)) delete f.shop;
}
/** v3 → v4 (on raw regions, before they are normalized): workshops become buildings; players are refunded what theirs cost. */
function migrateV4(state, w) {
  const oldTypes = arr(w.workshopTypes);
  for (const [k, r] of Object.entries(isPlainObject(w.regions) ? w.regions : {})) {
    const list = arr(r.workshops);
    if (!list.length) { delete r.workshops; continue; }
    r.buildings = arr(r.buildings);
    for (const ws of list) {
      if (ws.owner?.type === 'character') {
        const c = (state.characters || []).find((x) => x.id === ws.owner.id);
        const t = oldTypes.find((x) => x.id === ws.typeId);
        if (c && t) c.nyang = r2(num(c.nyang) + num(t.cost) * num(ws.level, 1));
      }
      const typeId = W.WORKSHOP_TO_BUILDING[ws.typeId];
      if (!typeId) continue;
      const have = r.buildings.find((b) => b.typeId === typeId);
      if (have) { have.level = Math.max(num(have.level, 1), num(ws.level, 1)); continue; }
      r.buildings.push({ id: ws.id || undefined, typeId, level: num(ws.level, 1), factionId: r.controller || '', status: 'ready', hp: 100 });
    }
    delete r.workshops;
  }
  delete w.workshopTypes;
  // New buildings join the list; renamed old ones go.
  const bt = arr(w.buildingTypes).filter((t) => !['smithies', 'alchemy-hall', 'inns'].includes(t.id));
  for (const d of W.BUILDING_TYPES) { const i = bt.findIndex((t) => t.id === d.id); if (i < 0) bt.push(clone(d)); else bt[i] = { ...clone(d), ...bt[i], inputs: bt[i].inputs || d.inputs, outputs: bt[i].outputs || d.outputs, maxLevel: bt[i].maxLevel || d.maxLevel, service: bt[i].service ?? d.service }; }
  w.buildingTypes = bt;
  // Pathfinder scouts and the disciples' quicker march.
  if (Array.isArray(w.unitTypes)) {
    if (!w.unitTypes.some((u) => u.id === 'scouts')) w.unitTypes.splice(Math.max(0, w.unitTypes.findIndex((u) => u.id === 'engineers')), 0, clone(W.UNIT_TYPES.find((u) => u.id === 'scouts')));
    const d = w.unitTypes.find((u) => u.id === 'disciples'); if (d && d.marchBonus === undefined) d.marchBonus = 0.25;
  }
  if (w.settings) delete w.settings.maxWorkshopsPerCharacter;
  w.needsBuildingSeed = true;
}
const DEFAULT_SPLIT = ['河南', '陕西', '四川', '湖北'];
// What version 1 preset (removed in version 2 — staff now decide everything). Used only to clean old saves.
const LEGACY_SEEDS = {"Wudang Sect":{"hq":"湖北/十堰","icon":"☯️","control":["湖北"]},"Shaolin Sect":{"hq":"河南/郑州","icon":"🪷","control":["河南"]},"Mount Hua Sect":{"hq":"陕西/渭南","icon":"🌸","control":["陕西"]},"Beggar Sect":{"hq":"湖南/岳阳","icon":"🥢","control":[]},"Jaegal Clan":{"hq":"山东/临沂","icon":"📜","control":["山东"]},"Tang Clan":{"hq":"四川/成都","icon":"🧪","control":["四川"]},"Peng Clan":{"hq":"河北/保定","icon":"🪓","control":["河北"]},"Namgoong Clan":{"hq":"安徽/合肥","icon":"🗡️","control":["安徽"]},"Moyong Clan":{"hq":"","icon":"🕯️","control":[]},"The 72 Strongholds":{"hq":"山西/长治","icon":"🏴","control":[]},"Ice Palace":{"hq":"黑龙江/黑河","icon":"❄️","control":["黑龙江"]},"Sun Palace":{"hq":"浙江/舟山","icon":"☀️","control":[]},"Sword Palace":{"hq":"新疆/伊犁","icon":"⚔️","control":["新疆"]},"Beast Palace":{"hq":"云南/西双版纳","icon":"🐅","control":["云南"]},"Hao Sect":{"hq":"贵州/遵义","icon":"🦂","control":["贵州"]},"Blood Cult":{"hq":"青海/海西","icon":"🩸","control":["青海"]},"Demon Cult":{"hq":"","icon":"👁️","control":[]}};

const LEGACY_WORKSHOPS = { '湖北/十堰': 'wudang-sect', '河南/郑州': 'shaolin-sect', '四川/成都': 'tang-clan', '陕西/渭南': 'mount-hua-sect', '云南/西双版纳': 'beast-palace' };

/**
 * v1 → v2: remove everything the old version preset and staff never touched — the Imperial Court and Merchant Guild
 * (if still untouched), seeded lands, seats, icons, relations — so the world starts as a blank canvas.
 */
function migrateV2(state, w) {
  const legacyCourt = (f) => f && f.npc && ((f.id === 'imperial-court' && f.kind === 'court') || (f.id === 'merchant-guild' && f.kind === 'guild'));
  const removed = new Set(w.factions.filter((f) => legacyCourt(f) && !w.armies.some((a) => a.factionId === f.id) && !arr(w.treaties).some((t) => t.parties.includes(f.id))).map((f) => f.id));
  const seededControl = {};
  for (const f of w.factions) {
    const seed = LEGACY_SEEDS[f.sect];
    if (!seed) continue;
    if (f.icon === seed.icon) f.icon = '';
    if (f.hq === seed.hq) { seededControl[seed.hq] = f.id; f.hq = ''; }
    for (const k of seed.control) seededControl[k] = f.id;
  }
  for (const [k, r] of Object.entries(w.regions)) {
    if (removed.has(r.controller) || (r.controller && seededControl[k] === r.controller)) r.controller = null;
    if (r.occupiedBy && removed.has(r.occupiedBy)) r.occupiedBy = null;
    for (const ws of r.workshops || []) if (ws.owner?.type === 'faction' && (removed.has(ws.owner.id) || (ws.typeId === 'alchemy' && LEGACY_WORKSHOPS[k] === ws.owner.id))) ws.owner = { type: 'region', id: '' };
  }
  w.factions = w.factions.filter((f) => !removed.has(f.id));
  for (const [k, rel] of Object.entries(w.relations || {})) {
    if (k.split('|').some((id) => removed.has(id))) { delete w.relations[k]; continue; }
    if (!rel.war) rel.value = 0;
  }
  for (const cv of w.caravans) if (cv.owner?.type === 'faction' && removed.has(cv.owner.id)) cv.owner = { type: 'region', id: cv.to };
  w.map.split = arr(w.map.split).length ? w.map.split : [...DEFAULT_SPLIT];
  // EU4-style battles: units get fire/shock pips, formations multipliers, terrains attacker penalty & width.
  w.unitTypes = arr(w.unitTypes).map((u) => {
    if (u.shockOff !== undefined) return u;
    const def = W.UNIT_TYPES.find((x) => x.id === u.id);
    if (def) return { ...def, ...u, power: def.power, fireOff: def.fireOff, fireDef: def.fireDef, shockOff: def.shockOff, shockDef: def.shockDef, morale: def.morale, emoji: u.emoji };
    return { ...u, fireOff: u.role === 'ranged' ? 3 : 0, fireDef: Math.round(num(u.defense) / 3), shockOff: Math.round(num(u.attack) / 2), shockDef: Math.round(num(u.defense) / 2), morale: 1 };
  });
  w.formations = arr(w.formations).map((f) => {
    if (f.shock !== undefined) return f;
    const def = W.FORMATIONS.find((x) => x.id === f.id);
    if (def) return { ...def, scriptId: f.scriptId || '', requires: f.requires || def.requires };
    return { id: f.id, name: f.name, hanzi: f.hanzi || '', emoji: '', fire: 1, shock: num(f.attack, 1), defense: num(f.defense, 1), morale: 1, maneuver: 0, width: 1, vsRole: f.vsRole || {}, requires: f.requires || {}, description: f.description || '', scriptId: f.scriptId || '' };
  });
  for (const [k, t] of Object.entries(w.terrains || {})) {
    const def = W.TERRAINS[k] || {};
    if (t.attackerPenalty === undefined) t.attackerPenalty = num(def.attackerPenalty, 0);
    if (t.width === undefined) t.width = num(def.width, 30);
    if (def.riverCrossing && t.riverCrossing === undefined) t.riverCrossing = true;
  }
  delete w.tactics;
  for (const b of w.battles) if (b.status === 'preparing') for (const k of ['A', 'D']) delete b.sides[k].plan;
}

function normalizeBuilding(b) {
  return { id: b.id || `bd-${Math.random().toString(36).slice(2, 8)}`, typeId: String(W.WORKSHOP_TO_BUILDING[b.typeId] && !['granary', 'walls'].includes(b.typeId) ? W.WORKSHOP_TO_BUILDING[b.typeId] : b.typeId), factionId: b.factionId || '', level: Math.max(1, Math.min(3, num(b.level, 1))), hp: r2(Math.max(0, Math.min(100, num(b.hp, 100)))), status: b.status === 'building' ? 'building' : 'ready', readyTurn: num(b.readyTurn), builtTurn: num(b.builtTurn), name: b.name || '', lastProfit: r2(num(b.lastProfit)), lastRun: r2(num(b.lastRun, 1)) };
}
function normalizeAlliance(a = {}) {
  return {
    id: a.id || `al-${Math.random().toString(36).slice(2, 8)}`,
    name: String(a.name || 'Alliance').slice(0, 80), hanzi: String(a.hanzi || '').slice(0, 20),
    color: /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : '#b3261e',
    members: [...new Set(arr(a.members).map(String))], leader: a.leader || '',
    terms: { ...W.ALLIANCE_TERMS, ...(isPlainObject(a.terms) ? Object.fromEntries(Object.entries(a.terms).filter(([k]) => k in W.ALLIANCE_TERMS).map(([k, v]) => [k, !!v])) : {}) },
    tribute: num(a.tribute, 0), // % of each member's taxes paid to the leader
    note: String(a.note || '').slice(0, 2000), effects: isPlainObject(a.effects) ? a.effects : {}, scriptId: a.scriptId || '',
    showOnMap: a.showOnMap !== false, foundedTurn: num(a.foundedTurn),
    // How it looks on the map (as in the Map Studio): border width and fill pattern.
    style: { width: Math.max(1, Math.min(12, num(a.style?.width, 5))), fill: ['none', 'hatched', 'dots'].includes(a.style?.fill) ? a.style.fill : 'hatched' },
  };
}
function normalizeAgreement(t = {}) {
  const perks = {};
  for (const p of W.PERKS) if (t.perks?.[p.id]) perks[p.id] = true;
  return {
    id: t.id || `ag-${Math.random().toString(36).slice(2, 8)}`, name: String(t.name || 'Agreement').slice(0, 80), parties: arr(t.parties).slice(0, 2).map(String), perks,
    tribute: t.tribute && t.tribute.payer && t.tribute.receiver ? { payer: t.tribute.payer, receiver: t.tribute.receiver, percent: Math.max(0, Math.min(100, num(t.tribute.percent))), fixed: Math.max(0, num(t.tribute.fixed)) } : null,
    note: String(t.note || '').slice(0, 2000), startTurn: num(t.startTurn), endTurn: t.endTurn ? num(t.endTurn) : null, effects: isPlainObject(t.effects) ? t.effects : {}, scriptId: t.scriptId || '',
  };
}
function normalizeWar(x = {}) {
  return { id: x.id || `wr-${Math.random().toString(36).slice(2, 8)}`, name: String(x.name || 'War').slice(0, 100), attackers: [...new Set(arr(x.attackers).map(String))], defenders: [...new Set(arr(x.defenders).map(String))], startTurn: num(x.startTurn), reason: String(x.reason || '').slice(0, 500) };
}

/** v2 → v3: relation numbers, treaty types, diplomacy actions, unrest and corruption are gone; wars, alliances, agreements, buildings and ranked representatives arrive. */
function migrateV3(state, w) {
  const wars = [];
  for (const [k, rel] of Object.entries(isPlainObject(w.relations) ? w.relations : {})) {
    if (!rel?.war) continue;
    const [a, b] = k.split('|');
    wars.push(normalizeWar({ name: `War of ${a} and ${b}`, attackers: [a], defenders: [b], startTurn: num(rel.since) }));
  }
  const map = { trade: ['freeTrade'], access: ['militaryAccess'], nap: ['nonAggression'], defensive: ['defensive', 'militaryAccess'], alliance: ['defensive', 'callToArms', 'militaryAccess', 'sharedShops', 'freeTrade'], brotherhood: ['nonAggression', 'sharedShops'], exchange: ['sharedShops'], venture: ['freeTrade'] };
  const agreements = [];
  for (const t of arr(w.treaties)) {
    if (t.type === 'marriage' || t.type === 'embargo' || t.type === 'truce') continue;
    const perks = Object.fromEntries((map[t.type] || []).map((x) => [x, true]));
    const tribute = t.payer && t.receiver ? { payer: t.payer, receiver: t.receiver, percent: num(t.terms?.tribute, t.type === 'vassal' ? 25 : 10), fixed: num(t.terms?.fixed) } : null;
    agreements.push(normalizeAgreement({ id: t.id, name: t.name, parties: t.parties, perks, tribute, note: t.note, startTurn: t.startTurn, endTurn: t.endTurn, effects: t.effects, scriptId: t.scriptId }));
  }
  w.wars = wars; w.agreements = agreements;
  for (const k of ['relations', 'treaties', 'treatyTypes', 'actions']) delete w[k];
  for (const k of Object.keys(w.cooldowns || {})) if (k.startsWith('dip|')) delete w.cooldowns[k];
  w.proposals = [];
  w.events = arr(w.events).filter((e) => !W.DROPPED_EVENTS.includes(e.id)).map(W.cleanEvent);
  w.policies = arr(w.policies).filter((p) => !W.DROPPED_POLICIES.includes(p.id)).map(W.cleanPolicy);
  w.activeEvents = arr(w.activeEvents).filter((e) => !W.DROPPED_EVENTS.includes(e.eventId));
  for (const f of arr(w.factions)) {
    f.policies = arr(f.policies).filter((p) => !W.DROPPED_POLICIES.includes(p.policyId));
    for (const id of arr(f.representatives)) if (!f.repRanks?.[id]) (f.repRanks ||= {})[id] = w.settings?.defaultRepRank || 'elder';
  }
  for (const r of Object.values(w.regions || {})) if (r.policies) r.policies = r.policies.filter((p) => !W.DROPPED_POLICIES.includes(p.policyId));
  if (w.settings) { w.settings.maxRepresentatives = Math.max(5, num(w.settings.maxRepresentatives, 5)); delete w.settings.rivalBelow; if (w.settings.shopTiers) delete w.settings.shopTiers.rival; }
}

const pairKey = (a, b) => [a, b].sort().join('|');


function seedRegions(state) {
  const regions = {};
  for (const p of geo.provinces()) {
    const seed = W.PROVINCES[p.key] || { terrain: 'plains', population: 10, fort: 1, production: {} };
    regions[p.key] = normalizeRegion(p.key, { ...clone(seed), prosperity: 50, security: 55, controller: null, taxRate: 10 });
  }
  const terrainOverride = { '湖北/十堰': 'mountains', '河南/郑州': 'mountains', '陕西/渭南': 'mountains', '湖南/岳阳': 'river', '山东/临沂': 'hills', '四川/成都': 'plains', '山西/长治': 'mountains', '黑龙江/黑河': 'forest', '浙江/舟山': 'coast', '新疆/伊犁': 'steppe', '云南/西双版纳': 'forest', '贵州/遵义': 'mountains', '青海/海西': 'desert', '河南/开封': 'river', '湖北/武汉': 'river', '江苏/扬州': 'river', '浙江/杭州': 'river', '广东/广州': 'coast', '甘肃/酒泉': 'desert', '江西/景德镇': 'hills' };
  for (const [key, share, note] of W.SPECIAL) {
    if (!geo.get(key)) continue;
    const prov = regions[geo.provinceOf(key)];
    const production = {};
    for (const [g, v] of Object.entries(prov.production)) { production[g] = r2(v * share); prov.production[g] = r2(v - production[g]); }
    const pop = r2(prov.population * share);
    prov.population = r2(prov.population - pop);
    regions[key] = normalizeRegion(key, { special: true, notes: note, terrain: terrainOverride[key] || prov.terrain, population: pop, fort: Math.min(5, prov.fort + 1), production, prosperity: 55, security: 60, controller: prov.controller, taxRate: 10 });
  }
  return regions;
}

function seedFactions(state) {
  const out = [];
  for (const s of state.sects) {
    const seed = W.FACTION_SEEDS[s.name] || {};
    out.push(normalizeFaction({
      id: factionIdForSect(s.name), name: s.name, sect: s.name, kind: kindOfSect(s.name), alignment: s.alignment || 'Neutral',
      color: seed.color, hanzi: seed.hanzi, icon: '', hq: '', active: true,
      treasury: 2500, description: s.description || '',
    }));
  }
  return out;
}

/** Make sure every trade good has an inventory item players can hold (ids good-<id>). Returns how many were created. */
function ensureGoodItems(state, world = state.world) {
  const defaults = require('../defaults');
  let n = 0;
  for (const g of world.goods) {
    const id = g.itemId || `good-${g.id}`;
    if (state.items.some((i) => i.tradeGood === g.id || i.id === id)) continue;
    if (state.items.length >= num(state.settings?.maxItems, 300)) break;
    state.items.push(defaults.normalizeItem({ id, name: state.items.some((i) => i.name.toLowerCase() === g.name.toLowerCase()) ? `${g.name} (cargo)` : g.name, rarity: state.rarities?.[0]?.name || 'Earthly', type: 'material', emoji: g.emoji, description: `${g.description || `${g.name}: bulk trade cargo.`}\n\n${GOOD_NOTE(g)}`, tradeable: true, marketable: true, inDropPool: false, shop: { enabled: false, price: 0, stock: -1 }, tradeGood: g.id }));
    n++;
  }
  return n;
}

/** Brand-new world for a save that has none. */
function createWorld(state) {
  const factions = seedFactions(state);
  const regions = seedRegions(state);
  // No land, seats, relations or treaties are preset: staff paint the map and decide everything.
  seedBuildings(regions);
  const world = {
    version: WORLD_VERSION,
    turn: 0,
    lastTurnAt: null,
    nextTurnAt: null,
    settings: clone(W.DEFAULT_WORLD_SETTINGS),
    map: { title: '武林乾坤全圖 · Great Murim Realm', subtitle: 'Provinces, Major Rivers & Martial Borders of the Central Plains', era: 'Jianwen Era', lang: 'english', layers: {}, landmarks: [], frontiers: [], split: [...DEFAULT_SPLIT] },
    goods: clone(W.GOODS),
    terrains: clone(W.TERRAINS),
    events: clone(W.EVENTS),
    policies: clone(W.POLICIES),
    buildingTypes: clone(W.BUILDING_TYPES),
    unitTypes: clone(W.UNIT_TYPES),
    formations: clone(W.FORMATIONS),
    factions,
    regions,
    routes: clone(W.ROUTES),
    wars: [],
    alliances: [],
    agreements: [],
    requests: [],
    cooldowns: {},
    activeEvents: [],
    pendingChains: [],
    caravans: [],
    armies: [],
    battles: [],
    proposals: [],
    takeovers: [],
    marriages: [],
    history: [],
    log: [],
  };
  // Seed stocks at target so prices start near base.
  require('./economy').initMarkets(state, world);
  if (Array.isArray(state.items)) ensureGoodItems(state, world);
  return world;
}

/** Upgrade / repair an existing world (called from store.migrate). */
function normalizeWorld(state) {
  if (!isPlainObject(state.world)) { state.world = createWorld(state); return state.world; }
  const w = state.world;
  w.version = num(w.version, 1);
  w.turn = num(w.turn);
  w.settings = deepMerge(W.DEFAULT_WORLD_SETTINGS, w.settings || {});
  w.map = { title: '', subtitle: '', era: '', lang: 'english', layers: {}, landmarks: [], frontiers: [], ...(w.map || {}) };
  w.map.landmarks = arr(w.map.landmarks); w.map.frontiers = arr(w.map.frontiers);
  w.map.split = Array.isArray(w.map.split) ? w.map.split.filter((k) => geo.isProvince(k)) : [...DEFAULT_SPLIT];
  for (const [k, def] of [['goods', W.GOODS], ['events', W.EVENTS], ['policies', W.POLICIES], ['buildingTypes', W.BUILDING_TYPES], ['unitTypes', W.UNIT_TYPES], ['formations', W.FORMATIONS], ['routes', W.ROUTES]]) {
    if (!Array.isArray(w[k])) w[k] = clone(def);
  }
  if (!isPlainObject(w.terrains)) w.terrains = clone(W.TERRAINS);
  for (const k of ['activeEvents', 'pendingChains', 'caravans', 'armies', 'battles', 'proposals', 'takeovers', 'marriages', 'history', 'log', 'wars', 'alliances', 'agreements', 'requests']) if (!Array.isArray(w[k])) w[k] = [];
  if (!isPlainObject(w.cooldowns)) w.cooldowns = {};
  w.factions = arr(w.factions).map(normalizeFaction);
  // Every sect has a faction.
  for (const s of state.sects || []) {
    if (!w.factions.some((f) => f.sect === s.name)) {
      const seed = W.FACTION_SEEDS[s.name] || {};
      w.factions.push(normalizeFaction({ id: factionIdForSect(s.name), name: s.name, sect: s.name, kind: kindOfSect(s.name), alignment: s.alignment, color: seed.color, hanzi: seed.hanzi, treasury: 2500, description: s.description }));
    }
  }
  if (w.version < 4 && w.version >= 1) migrateV4(state, w);
  const regions = {};
  for (const [k, r] of Object.entries(isPlainObject(w.regions) ? w.regions : {})) if (geo.get(k)) regions[k] = normalizeRegion(k, r);
  for (const p of geo.provinces()) if (!regions[p.key]) regions[p.key] = normalizeRegion(p.key, { ...(W.PROVINCES[p.key] || {}), controller: null });
  w.regions = regions;
  if (w.version < 2) { migrateV2(state, w); w.version = 2; }
  if (w.version < 3) { migrateV3(state, w); w.version = 3; }
  if (w.version < 4) { w.version = 4; }
  if (w.version < 5) { migrateV5(state, w); w.version = 5; }
  if (w.version < 6) { migrateV6(state, w); w.version = 6; }
  if (w.version < 7) { migrateV7(state, w); w.version = 7; }
  if (w.needsBuildingSeed) { seedBuildings(w.regions); delete w.needsBuildingSeed; }
  w.factions = w.factions.map(normalizeFaction);
  const fids = new Set(w.factions.map((f) => f.id));
  w.alliances = w.alliances.map(normalizeAlliance).map((a) => ({ ...a, members: a.members.filter((m) => fids.has(m)) }));
  w.agreements = w.agreements.map(normalizeAgreement).filter((t) => t.parties.length === 2 && t.parties.every((p) => fids.has(p)));
  w.wars = w.wars.map(normalizeWar).map((x) => ({ ...x, attackers: x.attackers.filter((m) => fids.has(m)), defenders: x.defenders.filter((m) => fids.has(m)) })).filter((x) => x.attackers.length && x.defenders.length);
  w.requests = w.requests.slice(0, 300);
  // Prefectures that follow their province always show its ruler.
  for (const r of Object.values(regions)) if (r.key.includes('/') && !r.ownController) r.controller = regions[geo.provinceOf(r.key)]?.controller || null;
  for (const r of Object.values(regions)) if (r.controller && !w.factions.some((f) => f.id === r.controller)) r.controller = null;
  w.takeovers = w.takeovers.slice(0, 200);
  require('./economy').initMarkets(state, w, { onlyMissing: true });
  return w;
}

/** Make a prefecture special (its own market) or not. Moves a share of the province's people and production. */
function setSpecial(state, key, on, share = 0.12) {
  const w = state.world;
  const g = geo.get(key);
  if (!g || g.kind !== 'prefecture') throw new Error('Only prefectures can be special.');
  const prov = w.regions[g.province];
  const cur = w.regions[key];
  if (on && !(cur && cur.special)) {
    const production = {};
    for (const [k, v] of Object.entries(prov.production)) { production[k] = r2(v * share); prov.production[k] = r2(v - production[k]); }
    const pop = r2(prov.population * share);
    prov.population = r2(prov.population - pop);
    w.regions[key] = normalizeRegion(key, { ...(cur || {}), special: true, ownController: !!cur?.ownController, terrain: prov.terrain, population: pop, fort: prov.fort, production, prosperity: prov.prosperity, security: prov.security, controller: cur?.controller || prov.controller, coffers: 0 });
    require('./economy').initMarkets(state, w, { only: [key] });
  } else if (!on && cur && cur.special) {
    prov.population = r2(prov.population + cur.population);
    for (const [k, v] of Object.entries(cur.production || {})) prov.production[k] = r2((prov.production[k] || 0) + v);
    for (const [k, v] of Object.entries(cur.stock || {})) prov.stock[k] = r2((prov.stock[k] || 0) + v);
    prov.coffers = r2(prov.coffers + cur.coffers);
    for (const b of cur.buildings || []) if (!prov.buildings.some((x) => x.typeId === b.typeId)) prov.buildings.push(b);
    w.regions[key] = normalizeRegion(key, { displayName: cur.displayName, controller: cur.controller, ownController: cur.ownController, categoryId: cur.categoryId, channelIds: cur.channelIds, notes: cur.notes, scriptId: cur.scriptId, special: false });
    for (const c of state.characters) if (c.location === key) c.location = g.province;
    for (const a of w.armies) if (a.region === key) a.region = g.province;
  }
  return w.regions[key];
}

module.exports = { normalizeBuilding, normalizeAlliance, normalizeAgreement, normalizeWar, WORLD_VERSION, DEFAULT_SPLIT, ensureGoodItems, normalizeFaction, normalizeRegion, createWorld, normalizeWorld, setSpecial, pairKey, factionIdForSect, kindOfSect, FACTION_KINDS, PLAYABLE_KINDS };
