'use strict';
/** Dashboard API for the world: map, regions, economy, events, politics, armies, balance. */
const path = require('path');
const fs = require('fs');
const store = require('../store');
const defaults = require('../defaults');
const W = require('../world');
const WS = require('../world/state');
const runner = require('../world/runner');
const { UserError, num, clone, arr, slug, norm, truncate, newId, isPlainObject, r2 } = require('../utils');

const { geo, economy: E, events: EV, politics: P, diplomacy: D, military: M, power, common: C, territory: T, realm: R } = W;
const MAPFILE = path.join(__dirname, '../world/mapdata.json');
const LISTS = ['goods', 'events', 'policies', 'buildingTypes', 'unitTypes', 'formations', 'routes'];

const w = () => store.state.world;
const region = (key) => { const r = w().regions[key]; if (!r) throw new UserError('Unknown region.'); return r; };
const faction = (id) => { const f = C.faction(store.state, id); if (!f) throw new UserError('Unknown faction.'); return f; };
const scriptOk = (id) => { if (id && !store.state.scripts.some((s) => s.id === id)) throw new UserError('That script does not exist.'); return id || ''; };

function cleanList(name, list) {
  list = arr(list);
  const ids = new Set();
  return list.map((x) => {
    if (name === 'routes') {
      if (!geo.get(x.a) || !geo.get(x.b)) throw new UserError(`Route ${x.a} ↔ ${x.b}: unknown region.`);
      return { a: x.a, b: x.b, kind: ['road', 'river', 'sea', 'pass'].includes(x.kind) ? x.kind : 'road', cost: x.cost ? num(x.cost) : undefined };
    }
    const id = String(x.id || slug(x.name || 'new')).trim();
    if (!id) throw new UserError('Every entry needs an id.');
    if (ids.has(id)) throw new UserError(`Duplicate id "${id}" in ${name}.`);
    ids.add(id);
    if (x.scriptId) scriptOk(x.scriptId);
    return { ...x, id, name: String(x.name || id) };
  });
}

function mount(app, { wrap, bot, diff }) {
  const log = (req, action, details) => store.log(req.actor, action, truncate(details, 1500));

  app.get('/api/world/mapdata', (req, res) => {
    const stat = fs.statSync(MAPFILE);
    const etag = `"${stat.size}-${stat.mtimeMs}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('json').send(fs.readFileSync(MAPFILE));
  });

  app.get('/api/world', wrap(async () => {
    const s = store.state;
    const world = w();
    return {
      world, calendar: C.calendar(s), markets: geo.marketKeys(s),
      characters: s.characters.filter((c) => c.status === 'active').map((c) => ({ id: c.id, name: c.name, sect: c.sect, ownerId: c.ownerId, ownerTag: c.ownerTag, realm: c.realm, location: c.location, travel: c.travel, spouseId: c.spouseId, champion: M.championPower(s, c), office: T.officeOf(s, c), pips: M.generalPips(s, c), nyang: c.nyang })),
      sects: s.sects.map((x) => ({ name: x.name, playable: x.playable, roleId: x.roleId })),
      items: s.items.map((i) => ({ id: i.id, name: i.name, type: i.type, rarity: i.rarity, price: i.shop?.price, tradeGood: i.tradeGood, economy: i.economy })),
      scripts: s.scripts.map((x) => ({ id: x.id, name: x.name })),
      realms: s.realms.map((r) => r.name),
      perks: W.defaults.PERKS, powers: W.defaults.POWERS, ranks: R.ranks(s), proposalKinds: D.KINDS,
      rev: store.revision,
    };
  }));

  app.get('/api/world/balance', wrap(async (req) => power.report(store.state, { includeNpc: req.query.npc === '1' ? true : req.query.npc === '0' ? false : undefined })));

  // ----- settings & map look -----
  app.put('/api/world/settings', wrap(async (req) => {
    const before = clone(w().settings);
    const next = { ...before, ...(req.body || {}) };
    for (const [k, v] of Object.entries(W.defaults.DEFAULT_WORLD_SETTINGS)) {
      if (typeof v === 'number') next[k] = num(next[k], v);
      if (typeof v === 'boolean') next[k] = !!next[k];
    }
    next.turnHours = Math.max(0.25, next.turnHours);
    next.turnsPerSeason = Math.max(1, Math.floor(next.turnsPerSeason));
    next.championRealmMult = arr(next.championRealmMult).map((x) => num(x, 1));
    delete next.shopTiers;
    next.localPrices = Object.fromEntries(Object.entries({ ...W.defaults.DEFAULT_WORLD_SETTINGS.localPrices, ...before.localPrices, ...(next.localPrices || {}) }).map(([k, v]) => [k, Math.max(-90, Math.min(500, num(v)))]));
    next.shopSalesTax = Math.max(0, Math.min(100, num(next.shopSalesTax)));
    next.powerWeights = Object.fromEntries(Object.entries({ ...before.powerWeights, ...(next.powerWeights || {}) }).map(([k, v]) => [k, Math.max(0, num(v))]));
    next.representativeRoleIds = arr(next.representativeRoleIds).map(String).filter(Boolean);
    next.travelMode = 'channel';
    next.realmWorth = arr(next.realmWorth).map((x) => Math.max(0, num(x, 1)));
    if (!next.realmWorth.length) next.realmWorth = clone(W.defaults.DEFAULT_WORLD_SETTINGS.realmWorth);
    next.taxEveryTurns = Math.max(1, Math.floor(next.taxEveryTurns));
    next.repRanks = arr(next.repRanks).filter((x) => x && x.id).map((x) => ({ id: slug(x.id), name: String(x.name || x.id).slice(0, 40), hanzi: String(x.hanzi || '').slice(0, 20), spendLimit: Math.max(0, num(x.spendLimit)), description: String(x.description || '').slice(0, 300), powers: Object.fromEntries(W.defaults.POWERS.map((p) => [p.id, ['free', 'staff', 'none'].includes(x.powers?.[p.id]) ? x.powers[p.id] : 'none'])) }));
    if (!next.repRanks.length) next.repRanks = clone(W.defaults.REP_RANKS);
    next.factionCaravans = ['guilds', 'all', 'none'].includes(next.factionCaravans) ? next.factionCaravans : 'guilds';
    next.travelSpeeds = arr(next.travelSpeeds).filter((x) => x && x.label).map((x) => ({ id: String(x.id || slug(x.label)), label: String(x.label).slice(0, 30), kmPerDay: Math.max(1, num(x.kmPerDay, 30)) }));
    if (!next.travelSpeeds.length) next.travelSpeeds = clone(W.defaults.DEFAULT_WORLD_SETTINGS.travelSpeeds);
    if (next.startRegion && !geo.get(next.startRegion)) throw new UserError('Unknown start region.');
    w().settings = next;
    if (before.turnHours !== next.turnHours && w().lastTurnAt) w().nextTurnAt = new Date(Date.parse(w().lastTurnAt) + next.turnHours * 3600000).toISOString();
    log(req, 'world.settings', diff(before, next));
    return { settings: next };
  }));
  app.put('/api/world/map', wrap(async (req) => {
    const b = req.body || {};
    const m = w().map;
    for (const k of ['title', 'subtitle', 'era', 'lang', 'colorStyle']) if (b[k] !== undefined) m[k] = String(b[k]).slice(0, 200);
    if (isPlainObject(b.layers)) m.layers = { ...m.layers, ...b.layers };
    if (Array.isArray(b.landmarks)) m.landmarks = b.landmarks.slice(0, 500).map((l) => ({ id: l.id || newId('lm-'), name: String(l.name || 'Landmark').slice(0, 80), hanzi: String(l.hanzi || '').slice(0, 40), type: String(l.type || 'sect_site'), xy: [num(l.xy?.[0]), num(l.xy?.[1])], region: l.region || '', factionId: l.factionId || '', notes: String(l.notes || '').slice(0, 1000) }));
    if (Array.isArray(b.frontiers)) m.frontiers = b.frontiers.slice(0, 200).map((f) => ({ id: f.id || newId('fl-'), name: String(f.name || 'Frontier').slice(0, 80), color: f.color || '#b3261e', style: ['solid', 'dashed', 'wall'].includes(f.style) ? f.style : 'dashed', points: arr(f.points).slice(0, 200).map((p) => [num(p[0]), num(p[1])]) }));
    log(req, 'world.map', 'map look/landmarks updated');
    return { map: m };
  }));

  // ----- regions -----
  app.put('/api/world/regions/:key', wrap(async (req) => {
    const key = decodeURIComponent(req.params.key);
    if (!geo.get(key)) throw new UserError('Unknown region.');
    const before = clone(w().regions[key] || {});
    const b = { ...(req.body || {}) };
    if (b.controller && !C.faction(store.state, b.controller)) throw new UserError('Unknown faction.');
    if (b.scriptId) scriptOk(b.scriptId);
    delete b.workshops;
    const newController = 'controller' in b ? (b.controller || null) : undefined;
    const follow = !!b.followProvince;
    delete b.controller; delete b.ownController; delete b.followProvince;
    const merged = WS.normalizeRegion(key, { ...before, ...b, special: before.special });
    w().regions[key] = merged;
    if (follow && key.includes('/')) {
      merged.ownController = false;
      if (T.isSplit(store.state, geo.provinceOf(key))) T.recomputeProvince(store.state, geo.provinceOf(key)); else T.syncChildren(store.state, geo.provinceOf(key));
    } else if (newController !== undefined && (newController !== T.controllerOf(store.state, key) || (key.includes('/') && !merged.ownController))) T.paint(store.state, [key], newController);
    if (merged.population !== undefined && (b.production || b.population)) E.updatePrices(store.state, key, C.regionMods(store.state, key));
    log(req, 'world.region', `${geo.fullLabel(store.state, key)}: ${diff(before, merged, ['prices', 'priceHistory', 'targets', 'priceMods', 'history', 'last', 'stock'])}`);
    return { region: merged };
  }));
  app.post('/api/world/regions/:key/special', wrap(async (req) => {
    const key = decodeURIComponent(req.params.key);
    const r = WS.setSpecial(store.state, key, !!req.body?.on, req.body?.share ? num(req.body.share) / 100 : undefined);
    log(req, 'world.special', `${geo.fullLabel(store.state, key)} ${req.body?.on ? 'is now a special prefecture (own market)' : 'is no longer special'}`);
    return { region: r };
  }));
  // Painting returns an undo snapshot; the dashboard keeps it for Undo/Redo.
  const controlOf = (keys) => keys.map((k) => ({ key: k, controller: w().regions[k]?.controller ?? null, ownController: !!w().regions[k]?.ownController, exists: !!w().regions[k] }));
  app.post('/api/world/paint', wrap(async (req) => {
    const keys = arr(req.body?.keys).filter((k) => geo.get(k)).slice(0, 2000);
    const fid = req.body?.controller || null;
    const before = T.paint(store.state, keys, fid, { log: false });
    log(req, 'world.paint', `${keys.slice(0, 30).map((k) => geo.label(store.state, k)).join(', ')}${keys.length > 30 ? ` (+${keys.length - 30})` : ''} → ${fid ? C.faction(store.state, fid).name : 'unclaimed'}`);
    return { before, changed: controlOf(before.map((x) => x.key)) };
  }));
  app.post('/api/world/paint/restore', wrap(async (req) => {
    const snap = arr(req.body?.snapshot).filter((x) => x && geo.get(x.key));
    const before = snap.map((x) => ({ key: x.key, existed: !!w().regions[x.key], controller: w().regions[x.key]?.controller ?? null, ownController: !!w().regions[x.key]?.ownController, occupiedBy: w().regions[x.key]?.occupiedBy || null }));
    T.restore(store.state, snap);
    log(req, 'world.paint', `undo/redo of ${snap.length} region(s)`);
    return { before, changed: controlOf(snap.map((x) => x.key)) };
  }));
  app.post('/api/world/split', wrap(async (req) => {
    const prov = req.body?.province;
    const split = T.setSplit(store.state, prov, !!req.body?.on);
    log(req, 'world.map', `${geo.label(store.state, prov)} ${req.body?.on ? 'split into prefectures' : 'shown whole'}`);
    return { split };
  }));
  app.post('/api/world/clear-territory', wrap(async (req) => {
    if (req.body?.confirm !== 'CLEAR') throw new UserError('Type CLEAR to confirm.');
    const keys = Object.keys(w().regions).filter((k) => w().regions[k].controller);
    const before = T.paint(store.state, keys.filter((k) => !k.includes('/')), null, { log: false });
    before.push(...T.paint(store.state, keys.filter((k) => k.includes('/') && w().regions[k]?.controller), null, { log: false }));
    for (const k of Object.keys(w().regions)) { const r = w().regions[k]; r.ownController = false; if ('occupiedBy' in r) r.occupiedBy = null; }
    log(req, 'world.paint', `cleared all territory (${keys.length} regions)`);
    return { before };
  }));
  // ----- takeovers -----
  app.post('/api/world/takeovers', wrap(async (req) => {
    const b = req.body || {};
    const by = { id: req.user.id, name: `${req.user.username} (dashboard)` };
    const t = b.approve === false ? T.requestTakeover(store.state, { regions: arr(b.regions), to: b.to || null, reason: b.reason, by, source: 'staff' }) : T.forceTakeover(store.state, { regions: arr(b.regions), to: b.to || null, reason: b.reason, by });
    log(req, 'world.takeover', `${t.regions.map((k) => geo.label(store.state, k)).join(', ')} → ${C.faction(store.state, t.to)?.name || 'unclaimed'} (${t.status})`);
    runner.step();
    return { takeover: t };
  }));
  app.post('/api/world/takeovers/:id/:action', wrap(async (req) => {
    const by = { id: req.user.id, name: `${req.user.username} (dashboard)` };
    const fn = { approve: T.approveTakeover, reject: T.rejectTakeover, revert: T.revertTakeover }[req.params.action];
    if (!fn) throw new UserError('Unknown action.');
    const t = fn(store.state, req.params.id, by);
    log(req, 'world.takeover', `${req.params.action}: ${t.regions.map((k) => geo.label(store.state, k)).join(', ')} → ${C.faction(store.state, t.to)?.name || 'unclaimed'}`);
    runner.step();
    return { takeover: t };
  }));
  app.delete('/api/world/takeovers/:id', wrap(async (req) => {
    w().takeovers = w().takeovers.filter((t) => t.id !== req.params.id);
    log(req, 'world.takeover', 'removed a takeover record');
    return { ok: true };
  }));

  // ----- offices & stipends -----
  app.put('/api/world/office', wrap(async (req) => {
    const c = store.state.characters.find((x) => x.id === req.body?.charId);
    if (!c) throw new UserError('Character not found.');
    const f = T.setOffice(store.state, c, req.body?.office || 'member');
    if (req.body?.rank && req.body.office === 'representative') { if (!R.rank(store.state, req.body.rank)) throw new UserError('Unknown rank.'); f.repRanks[c.id] = req.body.rank; }
    log(req, 'world.office', `${c.name} is now ${req.body?.office || 'member'} of ${f.name}`);
    if (bot.syncOffice) bot.syncOffice(c).catch(() => {});
    return { office: T.officeOf(store.state, c) };
  }));
  app.get('/api/world/stipends/:id', wrap(async (req) => {
    const f = faction(req.params.id);
    return { plan: T.stipendPlan(store.state, f, req.query.fund !== undefined ? num(req.query.fund) : undefined), last: f.lastStipend };
  }));
  app.post('/api/world/stipends/:id/pay', wrap(async (req) => {
    const f = faction(req.params.id);
    const plan = T.payStipends(store.state, f);
    if (!plan) throw new UserError('Nothing to pay (empty fund or no members).');
    log(req, 'world.stipend', `${f.name} paid ${plan.total} in stipends now`);
    runner.step();
    return { plan };
  }));

  // ----- lists (goods, buildings, events, policies, treaties, actions, troops, formations, tactics, routes) -----
  app.put('/api/world/list/:name', wrap(async (req) => {
    const name = req.params.name;
    if (!LISTS.includes(name)) throw new UserError('Unknown list.');
    const before = clone(w()[name]);
    w()[name] = cleanList(name, req.body);
    if (name === 'goods') for (const k of geo.marketKeys(store.state)) E.updatePrices(store.state, k, C.regionMods(store.state, k));
    log(req, `world.${name}`, `${before.length} → ${w()[name].length} entries`);
    return { list: w()[name] };
  }));
  app.put('/api/world/terrains', wrap(async (req) => {
    if (!isPlainObject(req.body)) throw new UserError('Expected an object.');
    w().terrains = req.body;
    log(req, 'world.terrains', 'updated');
    return { terrains: w().terrains };
  }));
  app.post('/api/world/goods/items', wrap(async (req) => {
    const n = WS.ensureGoodItems(store.state);
    log(req, 'world.goods', `created ${n} trade-good item(s)`);
    return { created: n };
  }));

  // ----- factions -----
  app.post('/api/world/factions', wrap(async (req) => {
    const f = WS.normalizeFaction({ ...(req.body || {}), id: req.body?.id || slug(req.body?.name || 'faction') });
    if (C.faction(store.state, f.id)) throw new UserError('A faction with that id exists.');
    w().factions.push(f);
    log(req, 'world.faction', `created ${f.name}`);
    return { faction: f };
  }));
  app.put('/api/world/factions/:id', wrap(async (req) => {
    const f = faction(req.params.id);
    const before = clone(f);
    const b = req.body || {};
    if (b.scriptId) scriptOk(b.scriptId);
    if (b.hq && !geo.get(b.hq)) throw new UserError('Unknown HQ region.');
    delete b.shop;
    const next = WS.normalizeFaction({ ...before, ...b, id: f.id, policies: b.policies ?? before.policies });
    Object.assign(f, next);
    log(req, 'world.faction', `${f.name}: ${diff(before, f, ['lastIncome'])}`);
    return { faction: f };
  }));
  app.delete('/api/world/factions/:id', wrap(async (req) => {
    const f = faction(req.params.id);
    if (f.sect && store.state.sects.some((s) => s.name === f.sect)) throw new UserError('This faction belongs to a sect. Delete the sect (Sects tab) or mark the faction inactive instead.');
    w().factions = w().factions.filter((x) => x.id !== f.id);
    for (const r of Object.values(w().regions)) { if (r.controller === f.id) r.controller = null; if (r.occupiedBy === f.id) r.occupiedBy = null; }
    w().agreements = w().agreements.filter((t) => !t.parties.includes(f.id));
    w().armies = w().armies.filter((a) => a.factionId !== f.id);
    for (const al of [...w().alliances]) if (al.members.includes(f.id)) D.removeMember(store.state, al.id, f.id, { silent: true });
    w().wars = w().wars.map((x) => ({ ...x, attackers: x.attackers.filter((m) => m !== f.id), defenders: x.defenders.filter((m) => m !== f.id) })).filter((x) => x.attackers.length && x.defenders.length);
    log(req, 'world.faction', `deleted ${f.name}`);
    return { ok: true };
  }));
  app.post('/api/world/factions/:id/policies', wrap(async (req) => {
    const f = faction(req.params.id);
    const def = P.adoptPolicy(store.state, f, req.body?.policyId, req.body?.region || '', { free: !!req.body?.free });
    log(req, 'world.policy', `${f.name} adopted ${def.name}${req.body?.region ? ` in ${geo.label(store.state, req.body.region)}` : ''}`);
    return { ok: true };
  }));
  app.delete('/api/world/factions/:id/policies/:policyId', wrap(async (req) => {
    const f = faction(req.params.id);
    P.revokePolicy(store.state, f, req.params.policyId, req.query.region || '', { force: true });
    log(req, 'world.policy', `${f.name} revoked ${req.params.policyId}`);
    return { ok: true };
  }));

  // ----- wars, alliances, agreements, proposals, requests -----
  const staffBy = (req) => ({ kind: 'staff', name: `${req.user.username} (dashboard)`, userId: req.user.id });
  app.post('/api/world/wars', wrap(async (req) => {
    const b = req.body || {};
    const x = D.declareWar(store.state, b.attacker, b.defender, { reason: b.reason || '', name: b.name || '', force: true });
    // Extra factions ticked by staff join; allies called in by their pacts stay.
    if (Array.isArray(b.attackers)) x.attackers = [...new Set([...x.attackers, ...b.attackers.filter((id) => C.faction(store.state, id) && !x.defenders.includes(id))])];
    if (Array.isArray(b.defenders)) x.defenders = [...new Set([...x.defenders, ...b.defenders.filter((id) => C.faction(store.state, id) && !x.attackers.includes(id))])];
    log(req, 'world.war', `${x.name}: ${x.attackers.map((id) => C.faction(store.state, id)?.name).join(', ')} vs ${x.defenders.map((id) => C.faction(store.state, id)?.name).join(', ')}`);
    runner.step();
    return { war: x };
  }));
  app.put('/api/world/wars/:id', wrap(async (req) => {
    const x = D.war(store.state, req.params.id);
    const b = req.body || {};
    if (b.name !== undefined) x.name = String(b.name).slice(0, 100);
    if (b.reason !== undefined) x.reason = String(b.reason).slice(0, 500);
    for (const k of ['attackers', 'defenders']) if (Array.isArray(b[k])) x[k] = [...new Set(b[k].filter((id) => C.faction(store.state, id)))];
    if (!x.attackers.length || !x.defenders.length) throw new UserError('Each side needs at least one faction.');
    log(req, 'world.war', `edited ${x.name}`);
    return { war: x };
  }));
  app.post('/api/world/wars/:id/peace', wrap(async (req) => {
    const x = D.makePeace(store.state, req.params.id, { note: req.body?.note || '', factionId: req.body?.factionId || null });
    log(req, 'world.war', `peace: ${x.name}`);
    runner.step();
    return { ok: true };
  }));
  const allianceBody = (b) => ({ name: b.name, hanzi: b.hanzi, color: b.color, terms: isPlainObject(b.terms) ? b.terms : undefined, note: b.note, tribute: b.tribute, effects: isPlainObject(b.effects) ? b.effects : undefined, scriptId: b.scriptId === undefined ? undefined : b.scriptId ? scriptOk(b.scriptId) : '', style: b.style, showOnMap: b.showOnMap });
  app.post('/api/world/alliances', wrap(async (req) => {
    const b = req.body || {};
    const a = D.createAlliance(store.state, { ...allianceBody(b), members: arr(b.members).filter((id) => C.faction(store.state, id)), leader: b.leader });
    Object.assign(a, WS.normalizeAlliance({ ...a, ...allianceBody(b), members: a.members, leader: b.leader || a.leader }));
    log(req, 'world.alliance', `founded ${a.name}`);
    runner.step();
    return { alliance: a };
  }));
  app.put('/api/world/alliances/:id', wrap(async (req) => {
    const a = D.alliance(store.state, req.params.id);
    const b = req.body || {};
    if (Array.isArray(b.members)) {
      const want = new Set(b.members.filter((id) => C.faction(store.state, id)));
      for (const m of [...a.members]) if (!want.has(m)) D.removeMember(store.state, a.id, m, { silent: true });
      for (const m of want) if (!a.members.includes(m)) D.addMember(store.state, a.id, m, { silent: true });
    }
    const live = store.state.world.alliances.find((x) => x.id === a.id);
    if (live) Object.assign(live, WS.normalizeAlliance({ ...live, ...Object.fromEntries(Object.entries(allianceBody(b)).filter(([, v]) => v !== undefined)), leader: b.leader ?? live.leader, members: live.members }));
    log(req, 'world.alliance', `edited ${a.name}`);
    return { alliance: live || null };
  }));
  app.delete('/api/world/alliances/:id', wrap(async (req) => {
    const a = D.dissolveAlliance(store.state, req.params.id);
    log(req, 'world.alliance', `dissolved ${a.name}`);
    runner.step();
    return { ok: true };
  }));
  const agreementBody = (b) => {
    if (b.scriptId) scriptOk(b.scriptId);
    const tribute = b.tribute && b.tribute.payer && b.tribute.receiver ? b.tribute : null;
    return { name: b.name, parties: arr(b.parties), perks: isPlainObject(b.perks) ? b.perks : {}, tribute, note: b.note || '', effects: isPlainObject(b.effects) ? b.effects : {}, scriptId: b.scriptId || '' };
  };
  app.post('/api/world/agreements', wrap(async (req) => {
    const b = req.body || {};
    const t = D.makeAgreement(store.state, { ...agreementBody(b), duration: num(b.duration) });
    log(req, 'world.agreement', `${t.name}: ${t.parties.map((p) => C.faction(store.state, p).name).join(' & ')}`);
    runner.step();
    return { agreement: t };
  }));
  app.put('/api/world/agreements/:id', wrap(async (req) => {
    const i = w().agreements.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new UserError('Agreement not found.');
    const b = req.body || {};
    const cur = w().agreements[i];
    w().agreements[i] = WS.normalizeAgreement({ ...cur, ...agreementBody({ ...cur, ...b }), id: cur.id, startTurn: cur.startTurn, endTurn: b.endTurn === '' || b.endTurn === null ? null : b.endTurn !== undefined ? num(b.endTurn) : cur.endTurn });
    log(req, 'world.agreement', `edited ${cur.name}`);
    return { agreement: w().agreements[i] };
  }));
  app.delete('/api/world/agreements/:id', wrap(async (req) => {
    const t = D.endAgreement(store.state, req.params.id, 'was dissolved by staff');
    log(req, 'world.agreement', `ended ${t.name}`);
    runner.step();
    return { ok: true };
  }));
  app.post('/api/world/proposals/:id/:answer', wrap(async (req) => {
    const p = D.respond(store.state, req.params.id, req.params.answer === 'approve', staffBy(req));
    log(req, 'world.diplomacy', `staff ${req.params.answer} ${p.kind} → ${p.status}`);
    if (bot.postProposal) bot.postProposal(p).catch(() => {});
    runner.step();
    return { proposal: p };
  }));
  app.post('/api/world/requests/:id/:answer', wrap(async (req) => {
    const by = { name: `${req.user.username} (dashboard)` };
    const q = req.params.answer === 'approve' ? R.approveRequest(store.state, req.params.id, by) : R.rejectRequest(store.state, req.params.id, by, req.body?.reason || '');
    log(req, 'world.request', `${req.params.answer}: ${C.faction(store.state, q.factionId)?.name} — ${q.summary}`);
    if (bot.postRequest) bot.postRequest(q).catch(() => {});
    runner.step();
    return { request: q };
  }));
  app.delete('/api/world/requests/:id', wrap(async (req) => {
    w().requests = w().requests.filter((x) => x.id !== req.params.id);
    return { ok: true };
  }));
  app.post('/api/world/marriages', wrap(async (req) => {
    const m = D.marry(store.state, req.body?.a, req.body?.b);
    log(req, 'world.diplomacy', `marriage recorded`);
    runner.step();
    return { marriage: m };
  }));
  app.delete('/api/world/marriages/:charId', wrap(async (req) => {
    D.divorce(store.state, req.params.charId);
    log(req, 'world.diplomacy', 'marriage dissolved');
    return { ok: true };
  }));

  // ----- buildings -----
  app.post('/api/world/regions/:key/buildings', wrap(async (req) => {
    const key = geo.marketOf(store.state, decodeURIComponent(req.params.key));
    const r = region(key);
    const b0 = req.body || {};
    let b;
    if (!b0.factionId && !r.controller) {
      // Staff placing a building in unclaimed land: it belongs to the town until someone takes the region.
      const t = R.buildingType(store.state, b0.typeId);
      if (!t) throw new UserError('Unknown building.');
      if (r.buildings.some((x) => x.typeId === t.id)) throw new UserError(`${geo.label(store.state, key)} already has a ${t.name}.`);
      b = WS.normalizeBuilding({ typeId: t.id, factionId: '', level: 1, hp: 100, status: 'ready', readyTurn: w().turn, builtTurn: w().turn });
      r.buildings.push(b);
    } else b = R.startBuilding(store.state, faction(b0.factionId || r.controller), key, b0.typeId, { free: b0.free !== false });
    if (b0.level) { const t = R.buildingType(store.state, b.typeId); b.level = Math.max(1, Math.min(num(t?.maxLevel, 1), num(b0.level))); }
    if (b0.ready) { b.status = 'ready'; b.readyTurn = w().turn; }
    log(req, 'world.build', `${R.buildingType(store.state, b.typeId)?.name} in ${geo.label(store.state, key)} (${b0.free !== false ? 'free' : 'paid'})`);
    return { building: b };
  }));
  app.put('/api/world/regions/:key/buildings/:id', wrap(async (req) => {
    const key = geo.marketOf(store.state, decodeURIComponent(req.params.key));
    const r = region(key);
    const b = r.buildings.find((x) => x.id === req.params.id);
    if (!b) throw new UserError('Building not found.');
    if (req.body?.hp !== undefined) b.hp = Math.max(0, Math.min(100, num(req.body.hp)));
    if (req.body?.level !== undefined) { const t = R.buildingType(store.state, b.typeId); b.level = Math.max(1, Math.min(num(t?.maxLevel, 1), num(req.body.level))); }
    if (req.body?.status) { b.status = req.body.status === 'building' ? 'building' : 'ready'; if (b.status === 'ready') b.readyTurn = Math.min(b.readyTurn, w().turn); }
    log(req, 'world.build', `edited a building in ${geo.label(store.state, key)}`);
    return { building: b };
  }));
  app.delete('/api/world/regions/:key/buildings/:id', wrap(async (req) => {
    const key = geo.marketOf(store.state, decodeURIComponent(req.params.key));
    R.demolishBuilding(store.state, null, key, req.params.id);
    log(req, 'world.build', `removed a building in ${geo.label(store.state, key)}`);
    return { ok: true };
  }));

  // ----- events -----
  app.post('/api/world/events/force', wrap(async (req) => {
    const b = req.body || {};
    const key = geo.marketOf(store.state, b.region);
    const ae = EV.startEvent(store.state, b.eventId, key, { forced: true, by: req.user.username, duration: num(b.duration) || undefined, regions: arr(b.regions).length ? arr(b.regions) : undefined });
    if (!ae) throw new UserError('A custom script cancelled the event.');
    log(req, 'world.event', `forced: ${ae.text}`);
    runner.step();
    return { event: ae };
  }));
  app.delete('/api/world/active-events/:id', wrap(async (req) => {
    const ae = EV.endEvent(store.state, req.params.id, 'was ended by staff');
    if (!ae) throw new UserError('Not found.');
    log(req, 'world.event', `ended ${ae.eventId}`);
    return { ok: true };
  }));

  // ----- turns -----
  app.post('/api/world/turn', wrap(async (req) => {
    const out = await runner.advance(num(req.body?.count, 1), req.actor);
    return { turns: out };
  }));
  app.post('/api/world/reset', wrap(async (req) => {
    if (req.body?.confirm !== 'RESET') throw new UserError('Type RESET to confirm.');
    await store.createBackup('Safety copy before world reset', req.actor, true);
    for (const c of store.state.characters) { c.location = ''; c.travel = null; }
    store.state.world = WS.createWorld(store.state);
    log(req, 'world.reset', 'The world was reset to its defaults (backup created first).');
    return { ok: true };
  }));

  // ----- armies & battles -----
  app.post('/api/world/armies', wrap(async (req) => {
    const b = req.body || {};
    const f = faction(b.factionId);
    const key = geo.marketOf(store.state, b.region);
    if (!w().regions[key]) throw new UserError('Unknown region.');
    const units = Object.fromEntries(Object.entries(b.units || {}).map(([k, v]) => [k, Math.max(0, Math.floor(num(v)))]).filter(([k, v]) => v > 0 && M.unitType(store.state, k)));
    const a = { id: newId('ar-'), name: String(b.name || `${f.name} Army`), factionId: f.id, region: key, units, commanderId: b.commanderId || '', champions: arr(b.champions), morale: num(b.morale, 70), supply: num(b.supply, 100), formationId: b.formationId || 'square', status: 'garrison', march: null, createdTurn: w().turn, scriptId: scriptOk(b.scriptId) };
    w().armies.push(a);
    log(req, 'world.army', `created ${a.name} in ${geo.label(store.state, key)} (${M.men(a)} men)`);
    return { army: a };
  }));
  app.put('/api/world/armies/:id', wrap(async (req) => {
    const a = M.army(store.state, req.params.id);
    if (!a) throw new UserError('Army not found.');
    const b = req.body || {};
    if (b.scriptId !== undefined) a.scriptId = scriptOk(b.scriptId);
    for (const k of ['name', 'commanderId', 'formationId']) if (b[k] !== undefined) a[k] = b[k];
    for (const k of ['morale', 'supply']) if (b[k] !== undefined) a[k] = Math.max(0, Math.min(100, num(b[k])));
    if (b.region) { a.region = geo.marketOf(store.state, b.region); a.march = null; if (a.status === 'marching') a.status = 'garrison'; }
    if (b.units) a.units = Object.fromEntries(Object.entries(b.units).map(([k, v]) => [k, Math.max(0, Math.floor(num(v)))]).filter(([k, v]) => v > 0));
    if (Array.isArray(b.champions)) a.champions = b.champions;
    if (b.factionId) faction(b.factionId) && (a.factionId = b.factionId);
    log(req, 'world.army', `edited ${a.name}`);
    return { army: a };
  }));
  app.post('/api/world/armies/:id/march', wrap(async (req) => {
    const a = M.army(store.state, req.params.id);
    if (!a) throw new UserError('Army not found.');
    const rt = M.marchTo(store.state, a, geo.marketOf(store.state, req.body?.to));
    log(req, 'world.army', `${a.name} marches to ${geo.label(store.state, req.body?.to)}`);
    return { route: rt };
  }));
  app.delete('/api/world/armies/:id', wrap(async (req) => {
    const a = M.army(store.state, req.params.id);
    if (!a) throw new UserError('Army not found.');
    w().armies = w().armies.filter((x) => x.id !== a.id);
    log(req, 'world.army', `disbanded ${a.name}`);
    return { ok: true };
  }));
  app.post('/api/world/battles', wrap(async (req) => {
    const b = req.body || {};
    const att = arr(b.attackers).filter((id) => M.army(store.state, id)); const def = arr(b.defenders).filter((id) => M.army(store.state, id));
    if (!att.length || !def.length) throw new UserError('Pick at least one army on each side.');
    const bt = M.openBattle(store.state, geo.marketOf(store.state, b.region || M.army(store.state, def[0]).region), att, def, { hours: b.hours !== undefined ? num(b.hours) : undefined, by: req.user.username });
    log(req, 'world.battle', `opened the Battle of ${geo.label(store.state, bt.region)}`);
    runner.step();
    return { battle: bt };
  }));
  app.post('/api/world/battles/:id/duel', wrap(async (req) => {
    const b = M.battle(store.state, req.params.id);
    const text = M.recordDuel(store.state, b, req.body?.winner, req.body?.loser, req.body?.note || '', req.user.username);
    log(req, 'world.duel', text);
    return { battle: b, text };
  }));
  app.post('/api/world/battles/:id/plan', wrap(async (req) => {
    const b = M.battle(store.state, req.params.id);
    M.setPlan(store.state, b, req.body?.side === 'D' ? 'D' : 'A', { formationId: req.body?.formationId, commanderId: req.body?.commanderId });
    if (Array.isArray(req.body?.champions)) b.sides[req.body.side === 'D' ? 'D' : 'A'].champions = req.body.champions;
    log(req, 'world.battle', `plan updated (${req.body?.side})`);
    return { battle: b };
  }));
  app.post('/api/world/battles/:id/resolve', wrap(async (req) => {
    const b = M.battle(store.state, req.params.id);
    b.resolveAt = new Date().toISOString();
    await runner.step();
    log(req, 'world.battle', `resolved the Battle of ${geo.label(store.state, b.region)} now`);
    return { battle: b };
  }));
  app.post('/api/world/simulate', wrap(async (req) => M.simulate(store.state, req.body || {}, Math.max(10, Math.min(1000, num(req.body?.runs, 200))))));

  // ----- Discord categories -----
  app.post('/api/world/discord/link-categories', wrap(async (req) => {
    const info = bot.getDiscordInfo();
    const cats = info.guilds.flatMap((g) => g.categories || []);
    if (!cats.length) throw new UserError('No categories found — is the bot online and in your server?');
    let n = 0;
    for (const p of geo.provinces()) {
      const r = w().regions[p.key];
      if (r.categoryId && !req.body?.overwrite) continue;
      const hit = cats.find((c) => { const nm = norm(c.name).replace(/[^a-z一-鿿]/g, ''); return nm.includes(norm(p.name).replace(/[^a-z]/g, '')) || c.name.includes(p.hanzi) || (r.displayName && nm.includes(norm(r.displayName).replace(/[^a-z]/g, ''))); });
      if (hit) { r.categoryId = hit.id; n++; }
    }
    log(req, 'world.discord', `linked ${n} province categories by name`);
    return { linked: n };
  }));
  app.post('/api/world/discord/create-categories', wrap(async (req) => {
    if (!bot.createCategories) throw new UserError('The bot is offline.');
    const missing = geo.provinces().filter((p) => !w().regions[p.key].categoryId);
    const lang = w().map.lang || 'english';
    const made = await bot.createCategories(missing.map((p) => ({ key: p.key, name: geo.label(store.state, p.key, lang === 'hanzi' ? 'both' : lang) })));
    for (const m of made) w().regions[m.key].categoryId = m.id;
    log(req, 'world.discord', `created ${made.length} categories`);
    return { created: made.length };
  }));

  // ----- Murim Map Studio import -----
  app.post('/api/world/import-myumyu', wrap(async (req) => {
    const p = req.body?.project || req.body;
    if (!isPlainObject(p) || !isPlainObject(p.provinces)) throw new UserError('That does not look like a Murim Map Studio project (no provinces).');
    const st = store.state;
    const map = new Map();
    let createdF = 0; let painted = 0; let lms = 0;
    for (const f of arr(p.factions)) {
      let mine = st.world.factions.find((x) => norm(x.name) === norm(f.name) || (x.hanzi && x.hanzi === f.hanzi));
      if (!mine && req.body?.createFactions !== false) {
        mine = WS.normalizeFaction({ id: slug(f.name), name: f.name, hanzi: f.hanzi, color: f.color, secondaryColor: f.secondaryColor, kind: /court/i.test(f.alignment) ? 'court' : /merchant/i.test(f.alignment) ? 'guild' : /rogue/i.test(f.alignment) ? 'bandits' : 'other', alignment: f.alignment, description: f.description || '' });
        if (C.faction(st, mine.id)) mine.id = `${mine.id}-${newId()}`;
        st.world.factions.push(mine); createdF++;
      } else if (mine && req.body?.colors !== false) { mine.color = f.color || mine.color; if (f.secondaryColor) mine.secondaryColor = f.secondaryColor; if (f.hanzi && !mine.hanzi) mine.hanzi = f.hanzi; }
      if (mine) map.set(f.id, mine.id);
    }
    if (Array.isArray(p.subdividedRegions)) st.world.map.split = [...new Set(p.subdividedRegions.filter((k) => geo.isProvince(k)))];
    const entries = Object.entries(p.provinces).map(([key, ps]) => {
      let k = key;
      if (!geo.get(k)) { const sub = geo.prefectures().find((x) => x.hanzi === key); k = sub ? sub.key : null; }
      return [k, ps];
    }).filter(([k]) => k).sort((a, b) => a[0].includes('/') - b[0].includes('/')); // provinces first
    for (const [k, ps] of entries) {
      const isPref = k.includes('/');
      if (ps.factionId !== undefined && (!isPref || T.isSplit(st, geo.provinceOf(k)))) { T.paint(st, [k], ps.factionId ? map.get(ps.factionId) || null : null, { log: false }); painted++; }
      const r = st.world.regions[k] || (st.world.regions[k] = WS.normalizeRegion(k, { controller: T.controllerOf(st, k) }));
      if (ps.customDisplayName) r.displayName = ps.customDisplayName;
      if (ps.notes) r.notes = ps.notes;
    }
    if (Array.isArray(p.landmarks) || Array.isArray(p.customPins)) {
      const W0 = 1400; const H0 = 920; const S0 = 1100; const C0 = [104, 36];
      const rad = (d) => (d * Math.PI) / 180; const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
      const proj = ([lon, lat]) => [r2(W0 / 2 + S0 * (rad(lon) - rad(C0[0]))), r2(H0 / 2 - S0 * (merc(lat) - merc(C0[1])))];
      for (const l of [...arr(p.landmarks), ...arr(p.customPins)]) {
        if (!Array.isArray(l.coordinates)) continue;
        st.world.map.landmarks.push({ id: newId('lm-'), name: l.name || l.title || 'Landmark', hanzi: l.hanzi || '', type: l.type || l.category || 'sect_site', xy: proj(l.coordinates), region: '', factionId: map.get(l.factionId) || '', notes: l.description || l.notes || '' });
        lms++;
      }
    }
    if (Array.isArray(p.frontierLines)) {
      const W0 = 1400; const H0 = 920; const S0 = 1100; const C0 = [104, 36];
      const rad = (d) => (d * Math.PI) / 180; const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
      for (const f of p.frontierLines) st.world.map.frontiers.push({ id: newId('fl-'), name: f.name || 'Frontier', color: f.color || '#b3261e', style: f.style === 'solid' ? 'solid' : f.style === 'wall' ? 'wall' : 'dashed', points: arr(f.points).map(([lon, lat]) => [r2(W0 / 2 + S0 * (rad(lon) - rad(C0[0]))), r2(H0 / 2 - S0 * (merc(lat) - merc(C0[1])))]) });
    }
    if (p.title) st.world.map.title = p.title;
    if (p.subtitle) st.world.map.subtitle = p.subtitle;
    if (p.era) st.world.map.era = p.era;
    // Alliances: their members are the factions ruling the alliance's provinces (or its leader).
    for (const al of arr(p.alliances)) {
      const members = [...new Set([map.get(al.leaderFactionId), ...arr(al.memberProvinces).map((k) => T.controllerOf(st, k))].filter(Boolean))];
      if (!members.length || st.world.alliances.some((x) => x.name === al.name)) continue;
      const a = D.createAlliance(st, { name: al.name || 'Alliance', hanzi: al.hanzi || '', color: al.color, members, leader: map.get(al.leaderFactionId) || members[0], note: al.notes || '' });
      a.style = { width: num(al.strokeWidth, 5), fill: ['none', 'hatched', 'dots'].includes(al.fillPattern) ? al.fillPattern : 'hatched' };
    }
    log(req, 'world.import', `Murim Map Studio: ${createdF} new faction(s), ${painted} region(s) painted, ${lms} landmark(s)`);
    return { factions: createdF, painted, landmarks: lms };
  }));
}

module.exports = { mount };
