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
    active: f.active !== false,
    treasury: r2(num(f.treasury, 2000)),
    influence: r2(num(f.influence, 60)),
    reputation: num(f.reputation, 50), // 0-100 trustworthiness (falls when treaties are broken)
    leaderCharId: f.leaderCharId || '',
    representatives: arr(f.representatives).map(String),
    repRoleId: f.repRoleId || '',
    policies: arr(f.policies).filter((p) => p && p.policyId).map((p) => ({ policyId: p.policyId, region: p.region || '', since: num(p.since) })),
    shop: {
      access: ['everyone', 'allies', 'members'].includes(f.shop?.access) ? f.shop.access : 'everyone',
      items: arr(f.shop?.items).filter((x) => x && x.itemId).map((x) => ({ itemId: x.itemId, price: x.price === null || x.price === undefined || x.price === '' ? null : num(x.price), stock: num(x.stock, -1), restock: num(x.restock, 0), access: ['inherit', 'everyone', 'allies', 'members'].includes(x.access) ? x.access : 'inherit' })),
    },
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
      fort: Math.max(0, Math.min(5, num(r.fort, 1))),
      prosperity: r2(Math.max(0, Math.min(100, num(r.prosperity, 50)))),
      security: r2(Math.max(0, Math.min(100, num(r.security, 55)))),
      unrest: r2(Math.max(0, Math.min(100, num(r.unrest, 10)))),
      corruption: r2(Math.max(0, Math.min(100, num(r.corruption, 15)))),
      coffers: r2(Math.max(0, num(r.coffers, 0))),
      taxRate: Math.max(0, Math.min(60, num(r.taxRate, 10))),
      production: isPlainObject(r.production) ? Object.fromEntries(Object.entries(r.production).map(([k, v]) => [k, Math.max(0, num(v))])) : {},
      stock: isPlainObject(r.stock) ? Object.fromEntries(Object.entries(r.stock).map(([k, v]) => [k, Math.max(0, num(v))])) : {},
      prices: isPlainObject(r.prices) ? r.prices : {},
      targets: isPlainObject(r.targets) ? r.targets : {},
      priceMods: isPlainObject(r.priceMods) ? r.priceMods : {},
      priceHistory: isPlainObject(r.priceHistory) ? r.priceHistory : {},
      workshops: arr(r.workshops).filter((w) => w && w.typeId).map((w) => ({ id: w.id || `ws-${Math.random().toString(36).slice(2, 8)}`, typeId: w.typeId, level: Math.max(1, Math.min(3, num(w.level, 1))), owner: w.owner && w.owner.type ? { type: w.owner.type, id: String(w.owner.id || '') } : { type: 'region', id: '' }, name: w.name || '', lastProfit: num(w.lastProfit), lastRun: num(w.lastRun, 1), totalProfit: num(w.totalProfit), idle: !!w.idle })),
      policies: arr(r.policies).filter((p) => p && p.policyId).map((p) => ({ policyId: p.policyId, factionId: p.factionId || '', since: num(p.since) })),
      occupiedBy: r.occupiedBy || null,
      occupiedSince: num(r.occupiedSince, 0),
      last: isPlainObject(r.last) ? r.last : {},
      history: arr(r.history).slice(-60),
    });
  }
  return out;
}

const WORLD_VERSION = 2;
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
  const removed = new Set(w.factions.filter((f) => legacyCourt(f) && !w.armies.some((a) => a.factionId === f.id) && !w.treaties.some((t) => t.parties.includes(f.id))).map((f) => f.id));
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
  for (const [k, rel] of Object.entries(w.relations)) {
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

const pairKey = (a, b) => [a, b].sort().join('|');


function seedRegions(state) {
  const regions = {};
  for (const p of geo.provinces()) {
    const seed = W.PROVINCES[p.key] || { terrain: 'plains', population: 10, fort: 1, production: {} };
    regions[p.key] = normalizeRegion(p.key, { ...clone(seed), prosperity: 50, security: 55, unrest: 10, corruption: 15, controller: null, taxRate: 10 });
  }
  const terrainOverride = { '湖北/十堰': 'mountains', '河南/郑州': 'mountains', '陕西/渭南': 'mountains', '湖南/岳阳': 'river', '山东/临沂': 'hills', '四川/成都': 'plains', '山西/长治': 'mountains', '黑龙江/黑河': 'forest', '浙江/舟山': 'coast', '新疆/伊犁': 'steppe', '云南/西双版纳': 'forest', '贵州/遵义': 'mountains', '青海/海西': 'desert', '河南/开封': 'river', '湖北/武汉': 'river', '江苏/扬州': 'river', '浙江/杭州': 'river', '广东/广州': 'coast', '甘肃/酒泉': 'desert', '江西/景德镇': 'hills' };
  for (const [key, share, note] of W.SPECIAL) {
    if (!geo.get(key)) continue;
    const prov = regions[geo.provinceOf(key)];
    const production = {};
    for (const [g, v] of Object.entries(prov.production)) { production[g] = r2(v * share); prov.production[g] = r2(v - production[g]); }
    const pop = r2(prov.population * share);
    prov.population = r2(prov.population - pop);
    regions[key] = normalizeRegion(key, { special: true, notes: note, terrain: terrainOverride[key] || prov.terrain, population: pop, fort: Math.min(5, prov.fort + 1), production, prosperity: 55, security: 60, unrest: 8, corruption: 15, controller: prov.controller, taxRate: 10 });
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
      treasury: 2500, influence: 60, description: s.description || '',
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
    state.items.push(defaults.normalizeItem({ id, name: state.items.some((i) => i.name.toLowerCase() === g.name.toLowerCase()) ? `${g.name} (cargo)` : g.name, rarity: state.rarities?.[0]?.name || 'Earthly', type: 'material', emoji: g.emoji, description: `${g.description || `${g.name}: bulk trade cargo.`}\n\n-# **Trade good** — bought and sold at regional markets (\`/world\` → Market). Base price ${g.basePrice}; its worth depends on where you are.`, tradeable: true, marketable: false, inDropPool: false, shop: { enabled: false, price: 0, stock: -1 }, tradeGood: g.id }));
    n++;
  }
  return n;
}

/** Brand-new world for a save that has none. */
function createWorld(state) {
  const factions = seedFactions(state);
  const regions = seedRegions(state);
  // No land, seats, relations or treaties are preset: staff paint the map and decide everything.
  for (const [key, typeId, level] of W.START_WORKSHOPS) {
    const r = regions[key];
    if (!r || !r.workshops) continue;
    r.workshops.push({ id: `ws-${slug(key)}-${typeId}-${r.workshops.length}`, typeId, level, owner: { type: 'region', id: '' }, lastProfit: 0, lastRun: 1, totalProfit: 0, idle: false, name: '' });
  }
  const relations = {};
  for (let i = 0; i < factions.length; i++) for (let j = i + 1; j < factions.length; j++) relations[pairKey(factions[i].id, factions[j].id)] = { value: 0, war: false, since: 0 };
  const world = {
    version: WORLD_VERSION,
    turn: 0,
    lastTurnAt: null,
    nextTurnAt: null,
    settings: clone(W.DEFAULT_WORLD_SETTINGS),
    map: { title: '武林乾坤全圖 · Great Murim Realm', subtitle: 'Provinces, Major Rivers & Martial Borders of the Central Plains', era: 'Jianwen Era', lang: 'english', layers: {}, landmarks: [], frontiers: [], split: [...DEFAULT_SPLIT] },
    goods: clone(W.GOODS),
    workshopTypes: clone(W.WORKSHOP_TYPES),
    terrains: clone(W.TERRAINS),
    events: clone(W.EVENTS),
    policies: clone(W.POLICIES),
    treatyTypes: clone(W.TREATY_TYPES),
    actions: clone(W.DIPLOMACY_ACTIONS),
    unitTypes: clone(W.UNIT_TYPES),
    formations: clone(W.FORMATIONS),
    factions,
    regions,
    routes: clone(W.ROUTES),
    relations,
    treaties: [],
    activeEvents: [],
    cooldowns: {},
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
  for (const [k, def] of [['goods', W.GOODS], ['workshopTypes', W.WORKSHOP_TYPES], ['events', W.EVENTS], ['policies', W.POLICIES], ['treatyTypes', W.TREATY_TYPES], ['actions', W.DIPLOMACY_ACTIONS], ['unitTypes', W.UNIT_TYPES], ['formations', W.FORMATIONS], ['routes', W.ROUTES]]) {
    if (!Array.isArray(w[k])) w[k] = clone(def);
  }
  if (!isPlainObject(w.terrains)) w.terrains = clone(W.TERRAINS);
  for (const k of ['treaties', 'activeEvents', 'pendingChains', 'caravans', 'armies', 'battles', 'proposals', 'takeovers', 'marriages', 'history', 'log']) if (!Array.isArray(w[k])) w[k] = [];
  if (!isPlainObject(w.cooldowns)) w.cooldowns = {};
  if (!isPlainObject(w.relations)) w.relations = {};
  w.factions = arr(w.factions).map(normalizeFaction);
  // Every sect has a faction.
  for (const s of state.sects || []) {
    if (!w.factions.some((f) => f.sect === s.name)) {
      const seed = W.FACTION_SEEDS[s.name] || {};
      w.factions.push(normalizeFaction({ id: factionIdForSect(s.name), name: s.name, sect: s.name, kind: kindOfSect(s.name), alignment: s.alignment, color: seed.color, hanzi: seed.hanzi, treasury: 2500, description: s.description }));
    }
  }
  const regions = {};
  for (const [k, r] of Object.entries(isPlainObject(w.regions) ? w.regions : {})) if (geo.get(k)) regions[k] = normalizeRegion(k, r);
  for (const p of geo.provinces()) if (!regions[p.key]) regions[p.key] = normalizeRegion(p.key, { ...(W.PROVINCES[p.key] || {}), controller: null });
  w.regions = regions;
  if (w.version < 2) { migrateV2(state, w); w.version = 2; }
  // Prefectures that follow their province always show its ruler.
  for (const r of Object.values(regions)) if (r.key.includes('/') && !r.ownController) r.controller = regions[geo.provinceOf(r.key)]?.controller || null;
  for (const r of Object.values(regions)) if (r.controller && !w.factions.some((f) => f.id === r.controller)) r.controller = null;
  w.takeovers = w.takeovers.slice(0, 200);
  for (let i = 0; i < w.factions.length; i++) for (let j = i + 1; j < w.factions.length; j++) {
    const k = pairKey(w.factions[i].id, w.factions[j].id);
    if (!w.relations[k]) w.relations[k] = { value: 0, war: false, since: 0 };
  }
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
    w.regions[key] = normalizeRegion(key, { ...(cur || {}), special: true, ownController: !!cur?.ownController, terrain: prov.terrain, population: pop, fort: prov.fort, production, prosperity: prov.prosperity, security: prov.security, unrest: prov.unrest, corruption: prov.corruption, controller: cur?.controller || prov.controller, coffers: 0 });
    require('./economy').initMarkets(state, w, { only: [key] });
  } else if (!on && cur && cur.special) {
    prov.population = r2(prov.population + cur.population);
    for (const [k, v] of Object.entries(cur.production || {})) prov.production[k] = r2((prov.production[k] || 0) + v);
    for (const [k, v] of Object.entries(cur.stock || {})) prov.stock[k] = r2((prov.stock[k] || 0) + v);
    prov.coffers = r2(prov.coffers + cur.coffers);
    for (const ws of cur.workshops || []) prov.workshops.push(ws);
    w.regions[key] = normalizeRegion(key, { displayName: cur.displayName, controller: cur.controller, ownController: cur.ownController, categoryId: cur.categoryId, channelIds: cur.channelIds, notes: cur.notes, scriptId: cur.scriptId, special: false });
    for (const c of state.characters) if (c.location === key) c.location = g.province;
    for (const a of w.armies) if (a.region === key) a.region = g.province;
  }
  return w.regions[key];
}

module.exports = { WORLD_VERSION, DEFAULT_SPLIT, ensureGoodItems, normalizeFaction, normalizeRegion, createWorld, normalizeWorld, setSpecial, pairKey, factionIdForSect, kindOfSect, FACTION_KINDS, PLAYABLE_KINDS };
