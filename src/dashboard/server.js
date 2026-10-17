'use strict';
/** Web dashboard: login + JSON API + static single-page app in ./public */
const path = require('path');
const express = require('express');
const store = require('../store');
const config = require('../config');
const defaults = require('../defaults');
const auth = require('./auth');
const scripts = require('../engine/scripts');
const effects = require('../engine/effects');
const chars = require('../engine/characters');
const { grant, take, GRANT_TYPES, TAKE_TYPES } = require('../engine/grants');
const templates = require('../engine/templates');
const ui = require('../engine/ui');
const { UserError, newId, slug, norm, num, numOrNull, clone, truncate, arr } = require('../utils');

const COOKIE = 'jh_session';
const failures = new Map(); // ip -> { count, until }

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function short(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return truncate(s === undefined ? '∅' : s, 80);
}
/** "field: old → new; field2: ..." for the changelog. */
function diff(before, after, skip = ['updatedAt', 'createdAt']) {
  if (!before) return 'created';
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const k of keys) {
    if (skip.includes(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(`${k}: ${short(before[k])} → ${short(after[k])}`);
  }
  return out.join('; ') || 'no changes';
}

// ---------- sanitizers ----------
function sanitizeItem(body, existing) {
  const st = store.state;
  const it = defaults.normalizeItem({ ...(existing || {}), ...body, id: existing ? existing.id : body.id || undefined });
  it.name = String(it.name || '').trim();
  if (!it.name) throw new UserError('Item name is required.');
  if (!st.rarities.some((r) => r.name === it.rarity)) throw new UserError(`Unknown rarity "${it.rarity}".`);
  if (st.items.some((x) => x.id !== it.id && norm(x.name) === norm(it.name))) throw new UserError(`An item named "${it.name}" already exists.`);
  if (it.scriptId && !st.scripts.some((s) => s.id === it.scriptId)) throw new UserError('Selected script does not exist.');
  it.dropWeight = Math.max(0, num(it.dropWeight, 1));
  it.shop = { enabled: !!it.shop.enabled, price: Math.max(0, num(it.shop.price)), stock: Math.floor(num(it.shop.stock, -1)) };
  if (it.type === 'manual' && it.manual.artId) {
    const art = (st.arts || []).find((a) => a.id === it.manual.artId);
    if (!art) throw new UserError('The art this manual teaches no longer exists.');
    if (art.kind === 'qicore') throw new UserError("Qi Cores can't be taught by manuals.");
  }
  it.pill.yieldType = defaults.YIELD_TYPES.includes(it.pill.yieldType) ? it.pill.yieldType : 'none';
  for (const k of ['yieldAmount', 'impurity', 'breakthroughBonus']) it.pill[k] = num(it.pill[k]);
  for (const k of ['keepOnFail', 'tolerance']) it.pill[k] = Math.max(0, Math.min(100, num(it.pill[k])));
  it.pill.monthlyLimit = Math.max(0, Math.floor(num(it.pill.monthlyLimit)));
  it.pill.realmFalloff = Math.max(0, Math.min(100, num(it.pill.realmFalloff, 50)));
  it.pill.peakRealm = it.pill.peakRealm === '' || it.pill.peakRealm === null || it.pill.peakRealm === undefined ? null : Math.max(0, Math.floor(num(it.pill.peakRealm)));
  it.poison.tier = Math.min(3, Math.max(1, Math.floor(num(it.poison.tier, 1))));
  it.poison.impurity = num(it.poison.impurity);
  it.purification.tier = Math.min(3, Math.max(1, Math.floor(num(it.purification.tier, 1))));
  it.marketable = it.marketable !== false;
  for (const k of defaults.BONUS_KEYS) it.bonuses[k] = num(it.bonuses[k]);
  if (it.id === st.settings.defaultWeaponId && it.type !== 'weapon') throw new UserError('The Default Weapon must stay a weapon (change the default weapon in Settings first).');
  it.updatedAt = new Date().toISOString();
  return it;
}

function sanitizeCharacter(body, existing) {
  const st = store.state;
  const c = defaults.normalizeCharacter({ ...(existing || {}), ...body, id: existing ? existing.id : undefined });
  const refs = (v, kind) => arr(Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => chars.resolveRef(st, x, kind)).filter(Boolean);
  c.traits = refs(body.traits ?? existing?.traits, 'trait');
  c.cultivationMethods = refs(body.cultivationMethods ?? existing?.cultivationMethods);
  c.qiCore = chars.resolveRef(st, body.qiCore ?? existing?.qiCore);
  for (const k of defaults.MANUAL_CATEGORIES) c.martialArts[k] = refs(body.martialArts?.[k] ?? existing?.martialArts?.[k]);
  for (const k of ['strength', 'endurance', 'mobility', 'qi']) c.stats[k] = num(c.stats[k]);
  for (const k of ['normal', 'flex']) c.pools[k] = num(c.pools[k]);
  c.realm = Math.max(0, Math.min(st.realms.length - 1, Math.floor(num(c.realm))));
  c.inventory = Object.fromEntries(Object.entries(c.inventory || {}).map(([k, v]) => [k, Math.floor(num(v))]).filter(([k, v]) => v > 0 && st.items.some((i) => i.id === k)));
  c.title = String(c.title || '').trim();
  if (c.weaponId && !st.items.some((i) => i.id === c.weaponId && i.type === 'weapon')) c.weaponId = '';
  if (!c.name) throw new UserError('Name is required.');
  if (!c.ownerId) throw new UserError('Owner Discord ID is required.');
  return c;
}

function sanitizeRealm(r) {
  if (!String(r.name || '').trim()) throw new UserError('Every realm needs a name.');
  return {
    name: String(r.name).trim(),
    qiBars: num(r.qiBars),
    reqStats: num(r.reqStats),
    reqQi: num(r.reqQi),
    softCapStats: numOrNull(r.softCapStats),
    softCapQi: numOrNull(r.softCapQi),
    hardCapStats: numOrNull(r.hardCapStats),
    hardCapQi: numOrNull(r.hardCapQi),
    breakthroughChance: Math.max(0, Math.min(100, num(r.breakthroughChance))),
  };
}

// ---------- server ----------
function create(bot) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (req, res) => res.json({ ok: true, bot: bot.status.online }));
  // Always serve the latest dashboard files (phones otherwise keep an old copy of app.js for days).
  const BUILD = Date.now().toString(36);
  const indexHtml = () => require('fs').readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace(/(app\.js|world\.js|style\.css)"/g, `$1?v=${BUILD}"`);
  const sendIndex = (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(indexHtml());
  };
  app.get(['/', '/index.html'], sendIndex);
  app.use(express.static(path.join(__dirname, 'public'), { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      const user = e instanceof UserError;
      if (!user) console.error('[dashboard]', e);
      res.status(user ? 400 : 500).json({ error: e.message || 'Server error' });
    }
  };

  // ----- auth -----
  app.post('/api/login', wrap(async (req, res) => {
    const ip = req.ip;
    const f = failures.get(ip);
    if (f && f.count >= 10 && f.until > Date.now()) throw new UserError('Too many failed logins. Try again in 15 minutes.');
    const { username, password } = req.body || {};
    const u = store.state.dashboardUsers.find((x) => norm(x.username) === norm(username));
    if (!u || !auth.verifyPassword(password, u.hash)) {
      const n = (f && f.until > Date.now() ? f.count : 0) + 1;
      failures.set(ip, { count: n, until: Date.now() + 15 * 60000 });
      throw new UserError('Wrong username or password.');
    }
    failures.delete(ip);
    const token = auth.signSession({ uid: u.id });
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}`);
    return { ok: true, username: u.username };
  }));

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    const s = auth.readSession(parseCookies(req)[COOKIE]);
    const u = s && store.state.dashboardUsers.find((x) => x.id === s.uid);
    if (!u) return res.status(401).json({ error: 'Not logged in' });
    req.user = u;
    req.actor = { id: u.id, name: u.username, source: 'dashboard' };
    next();
  });
  const adminOnly = (req) => {
    if (!req.user.isAdmin) throw new UserError('Only dashboard admins can do this.');
  };

  // ----- data -----
  app.get('/api/data', wrap(async (req) => {
    const s = store.state;
    const defaultPw = req.user.isAdmin && !config.adminPasswordFromEnv && auth.verifyPassword('jianghu', req.user.hash);
    return {
      me: { username: req.user.username, isAdmin: !!req.user.isAdmin, defaultPassword: defaultPw },
      settings: s.settings, rarities: s.rarities, realms: s.realms, sects: s.sects, traits: s.traits, arts: s.arts, scripts: s.scripts, rev: store.revision,
      items: s.items, characters: s.characters, applications: s.applications.slice(0, 300), progress: s.progress.slice(0, 100),
      market: s.market, meta: s.meta, goods: (s.world?.goods || []).map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, basePrice: g.basePrice })),
      constants: { ART_KINDS: defaults.ART_KINDS, ART_KIND_LABEL: defaults.ART_KIND_LABEL, WEAPON_GRADES: defaults.WEAPON_GRADES, BONUS_KEYS: defaults.BONUS_KEYS, ITEM_TYPES: defaults.ITEM_TYPES, MANUAL_CATEGORIES: defaults.MANUAL_CATEGORIES, YIELD_TYPES: defaults.YIELD_TYPES, GRANT_TYPES, TAKE_TYPES, HOOKS: scripts.HOOKS },
      recipes: s.recipes, combat: s.combat,
      server: { storage: store.backend.kind, lastSavedAt: store.lastSavedAt, saveError: store.lastError, bot: bot.status, publicUrl: config.publicUrl },
    };
  }));

  app.get('/api/discord', wrap(async () => bot.getDiscordInfo()));

  // ----- settings & tables -----
  app.put('/api/settings', wrap(async (req) => {
    const before = clone(store.state.settings);
    const next = { ...before, ...(req.body || {}) };
    for (const k of ['startingFlexPoints', 'startingNyang', 'startingRolls', 'maxSingleStatPercent', 'allocationWindowMinutes', 'maxItems', 'maxCharactersPerUser', 'softCapGainMultiplier', 'breakthroughCooldownHours', 'breakthroughFailureImpurity', 'maxBreakthroughBonus', 'maxCultivationMethods', 'shopSellbackPercent', 'marketFeePercent', 'tradeExpiryMinutes', 'autoBackupHours', 'maxBackups', 'maxChangelog']) next[k] = num(next[k], before[k]);
    for (const k of Object.keys(before.impurity)) next.impurity[k] = num(next.impurity?.[k], before.impurity[k]);
    next.rating = Object.fromEntries(Object.entries(before.rating || defaults.DEFAULT_SETTINGS.rating).map(([k, v]) => [k, Math.max(0, num(next.rating?.[k], v))]));
    for (const k of Object.keys(before.martialArtLimits)) next.martialArtLimits[k] = num(next.martialArtLimits?.[k], before.martialArtLimits[k]);
    next.elements = arr(next.elements).map((e) => String(e).trim()).filter(Boolean);
    next.staffRoleIds = arr(next.staffRoleIds).map(String).filter(Boolean);
    next.approvedRoleIds = arr(next.approvedRoleIds).map(String).filter(Boolean);
    next.defaultCultivationMethods = arr(next.defaultCultivationMethods).map((e) => String(e).trim()).filter(Boolean);
    next.qiBarBonuses = arr(next.qiBarBonuses).map((r) => ({ minQi: num(r.minQi), bars: num(r.bars) })).filter((r) => r.minQi > 0 || r.bars > 0).sort((a, b) => a.minQi - b.minQi);
    store.state.settings = next;
    store.log(req.actor, 'settings.update', diff(before, next));
    return { settings: next };
  }));

  app.put('/api/rarities', wrap(async (req) => {
    const st = store.state;
    const list = arr(req.body).map((r) => ({ name: String(r.name || '').trim(), chance: Math.max(0, num(r.chance)), color: r.color || '#888888', emoji: r.emoji || '⬜' }));
    if (!list.length || list.some((r) => !r.name)) throw new UserError('Every rarity needs a name.');
    if (new Set(list.map((r) => norm(r.name))).size !== list.length) throw new UserError('Rarity names must be unique.');
    const before = clone(st.rarities);
    // Renames (same position) carry over to items and sect bonuses.
    before.forEach((old, idx) => {
      const nw = list[idx];
      if (nw && old.name !== nw.name) {
        st.items.forEach((it) => { if (it.rarity === old.name) it.rarity = nw.name; });
        st.sects.forEach((s) => { if (s.rarityBonus && old.name in s.rarityBonus) { s.rarityBonus[nw.name] = s.rarityBonus[old.name]; delete s.rarityBonus[old.name]; } });
      }
    });
    const orphan = st.items.filter((it) => !list.some((r) => r.name === it.rarity));
    if (orphan.length) throw new UserError(`${orphan.length} item(s) still use a rarity you removed (e.g. ${orphan[0].name}). Change them first.`);
    st.rarities = list;
    store.log(req.actor, 'rarities.update', list.map((r) => `${r.name} ${r.chance}`).join(', '));
    return { rarities: list };
  }));

  app.put('/api/realms', wrap(async (req) => {
    const list = arr(req.body).map(sanitizeRealm);
    if (!list.length) throw new UserError('At least one realm is required.');
    const before = store.state.realms;
    store.state.realms = list;
    for (const c of store.state.characters) c.realm = Math.min(c.realm, list.length - 1);
    store.log(req.actor, 'realms.update', list.map((r, i) => (JSON.stringify(r) !== JSON.stringify(before[i]) ? `${r.name}: ${diff(before[i], r)}` : null)).filter(Boolean).join(' | ') || 'reordered/no changes');
    return { realms: list };
  }));

  app.put('/api/sects', wrap(async (req) => {
    const list = arr(req.body).map((s) => ({
      id: s.id || slug(s.name),
      name: String(s.name || '').trim(),
      alignment: s.alignment || '',
      titleName: String(s.titleName || s.name || '').trim(),
      description: s.description || '',
      playable: s.playable !== false,
      roleId: String(s.roleId || ''),
      rarityBonus: Object.fromEntries(Object.entries(s.rarityBonus || {}).map(([k, v]) => [k, num(v)]).filter(([, v]) => v)),
      coreArtId: (store.state.arts || []).some((a) => a.id === s.coreArtId) ? s.coreArtId : '',
      joinNyang: Math.max(0, num(s.joinNyang)),
    }));
    if (list.some((s) => !s.name)) throw new UserError('Every sect needs a name.');
    // Renamed sects (same id) keep their world faction.
    const beforeSects = store.state.sects;
    for (const s of list) {
      const old = beforeSects.find((x) => (x.id || slug(x.name)) === s.id);
      if (old && old.name !== s.name) for (const f of store.state.world?.factions || []) if (f.sect === old.name) { f.sect = s.name; if (f.name === old.name) f.name = s.name; }
    }
    store.state.sects = list;
    require('../world/state').normalizeWorld(store.state); // new sects get a faction
    store.log(req.actor, 'sects.update', `${list.length} sects saved`);
    return { sects: list };
  }));

  // ----- items -----
  app.post('/api/items', wrap(async (req) => {
    const st = store.state;
    if (st.items.length >= num(st.settings.maxItems, 300)) throw new UserError(`Item limit reached (${st.settings.maxItems}). Raise it in Settings or delete items.`);
    const it = sanitizeItem(req.body || {});
    if (st.items.some((x) => x.id === it.id)) it.id = newId('it-');
    st.items.push(it);
    store.log(req.actor, 'item.create', `${it.name} (${it.rarity} ${it.type})`);
    return { item: it };
  }));
  app.put('/api/items/:id', wrap(async (req) => {
    const st = store.state;
    const idx = st.items.findIndex((x) => x.id === req.params.id);
    if (idx < 0) throw new UserError('Item not found.');
    const before = st.items[idx];
    const it = sanitizeItem(req.body || {}, before);
    st.items[idx] = it;
    store.log(req.actor, 'item.update', `${it.name}: ${diff(before, it)}`);
    return { item: it };
  }));
  app.delete('/api/items/:id', wrap(async (req) => {
    const st = store.state;
    const it = st.items.find((x) => x.id === req.params.id);
    if (!it) throw new UserError('Item not found.');
    if (it.id === st.settings.defaultWeaponId) throw new UserError('This is the Default Weapon everyone falls back to. Pick another default weapon in Settings before deleting it.');
    st.items = st.items.filter((x) => x !== it);
    for (const c of st.characters) if (c.weaponId === it.id) c.weaponId = '';
    for (const c of st.characters) delete c.inventory[it.id];
    st.market = st.market.filter((l) => l.itemId !== it.id);
    store.log(req.actor, 'item.delete', it.name);
    return { ok: true };
  }));

  // ----- items export / import -----
  // Export: the items (all, or ?ids=a,b,c) plus the arts their manuals teach and the custom code they use.
  app.get('/api/items/export', wrap(async (req, res) => {
    const st = store.state;
    const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
    const items = ids.length ? st.items.filter((i) => ids.includes(i.id)) : st.items;
    const artIds = new Set(items.map((i) => i.manual?.artId).filter(Boolean));
    const arts = (st.arts || []).filter((a) => artIds.has(a.id));
    const scriptIds = new Set([...items, ...arts].map((x) => x.scriptId).filter(Boolean));
    const itemIds = new Set(items.map((i) => i.id));
    const recipes = (st.recipes || []).filter((r) => [...r.inputs, ...r.outputs].every((x) => itemIds.has(x.itemId)));
    const out = {
      format: 'jianghu-items', version: 1, exportedAt: new Date().toISOString(),
      items: clone(items), arts: clone(arts), scripts: clone(st.scripts.filter((x) => scriptIds.has(x.id))), recipes: clone(recipes),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="jianghu-items-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(out, null, 2));
  }));

  /**
   * Import items (+ arts, scripts). Accepts an export file, a full save file, or a plain array of items.
   * Existing entries are matched by id, then by name: mode 'update' overwrites them, 'skip' leaves them alone.
   * dryRun = only report what would happen.
   */
  app.post('/api/items/import', wrap(async (req) => {
    const st = store.state;
    let data = req.body?.data;
    const mode = req.body?.mode === 'skip' ? 'skip' : 'update';
    const dryRun = !!req.body?.dryRun;
    if (Array.isArray(data)) data = { items: data };
    if (!data || !Array.isArray(data.items)) throw new UserError('That file has no "items" list.');
    const report = { created: [], updated: [], skipped: [], errors: [], arts: 0, scripts: 0 };
    const work = clone({ items: st.items, arts: st.arts, scripts: st.scripts });
    const match = (list, x) => list.findIndex((y) => (x.id && y.id === x.id) || norm(y.name) === norm(x.name));
    for (const sc of Array.isArray(data.scripts) ? data.scripts : []) {
      if (!sc || !sc.name || typeof sc.code !== 'string') continue;
      const err = scripts.checkSyntax(sc.code);
      if (err) { report.errors.push(`Script "${sc.name}": ${err}`); continue; }
      const idx = match(work.scripts, sc);
      const clean = { id: sc.id || slug(sc.name), name: String(sc.name).trim(), description: sc.description || '', code: sc.code, enabled: sc.enabled !== false };
      if (idx >= 0) { if (mode === 'update') { work.scripts[idx] = { ...clean, id: work.scripts[idx].id }; report.scripts++; } } else { work.scripts.push(clean); report.scripts++; }
    }
    const artIdMap = {};
    for (const a of Array.isArray(data.arts) ? data.arts : []) {
      if (!a || !a.name) continue;
      const art = defaults.normalizeArt(a);
      if (art.scriptId && !work.scripts.some((x) => x.id === art.scriptId)) art.scriptId = '';
      const idx = match(work.arts, art);
      if (idx >= 0) { artIdMap[a.id] = work.arts[idx].id; if (mode === 'update') { work.arts[idx] = { ...art, id: work.arts[idx].id }; report.arts++; } } else { work.arts.push(art); artIdMap[a.id] = art.id; report.arts++; }
    }
    // Validate items against the new arts/scripts.
    const saved = { arts: st.arts, scripts: st.scripts, items: st.items };
    st.arts = work.arts; st.scripts = work.scripts; st.items = work.items;
    try {
      for (const raw of data.items) {
        if (!raw || !raw.name) continue;
        const body = clone(raw);
        if (body.manual?.artId && artIdMap[body.manual.artId]) body.manual.artId = artIdMap[body.manual.artId];
        if (body.scriptId && !st.scripts.some((x) => x.id === body.scriptId)) body.scriptId = '';
        if (body.rarity && !st.rarities.some((r) => r.name === body.rarity)) { report.errors.push(`${body.name}: unknown rarity "${body.rarity}" (add it in Drop Rates first)`); continue; }
        const idx = match(st.items, body);
        try {
          if (idx >= 0) {
            if (mode === 'skip') { report.skipped.push(body.name); continue; }
            const it = sanitizeItem({ ...body, id: st.items[idx].id }, st.items[idx]);
            st.items[idx] = it;
            report.updated.push(it.name);
          } else {
            if (st.items.length >= num(st.settings.maxItems, 300)) { report.errors.push(`${body.name}: item limit (${st.settings.maxItems}) reached`); continue; }
            if (st.items.some((x) => x.id === body.id)) delete body.id;
            const it = sanitizeItem(body);
            st.items.push(it);
            report.created.push(it.name);
          }
        } catch (e) {
          report.errors.push(`${body.name}: ${e.message}`);
        }
      }
    } finally {
      if (dryRun) { report._restore = saved; }
    }
    // Recipes: only those whose items all exist after the import. Items are looked up by imported id, then by name.
    report.recipes = 0;
    const importedById = Object.fromEntries((data.items || []).filter((x) => x && x.id).map((x) => [x.id, x.name]));
    const findItemId = (id) => (st.items.find((i) => i.id === id) || st.items.find((i) => norm(i.name) === norm(importedById[id] || '')))?.id;
    const recipesBefore = st.recipes;
    st.recipes = clone(st.recipes);
    for (const r of Array.isArray(data.recipes) ? data.recipes : []) {
      if (!r || !r.name) continue;
      const map = (rows) => (rows || []).map((x) => ({ itemId: findItemId(x.itemId), qty: x.qty }));
      const rec = defaults.normalizeRecipe({ ...r, id: undefined, inputs: map(r.inputs), outputs: map(r.outputs) });
      if (rec.inputs.length !== (r.inputs || []).length || rec.outputs.length !== (r.outputs || []).length || !rec.inputs.length || !rec.outputs.length) { report.errors.push(`Recipe "${r.name}": uses an item that isn't there`); continue; }
      const idx = st.recipes.findIndex((x) => norm(x.name) === norm(rec.name));
      if (idx >= 0) { if (mode === 'update') { st.recipes[idx] = { ...rec, id: st.recipes[idx].id }; report.recipes++; } } else { st.recipes.push(rec); report.recipes++; }
    }
    if (dryRun) {
      st.recipes = recipesBefore;
      st.arts = report._restore.arts; st.scripts = report._restore.scripts; st.items = report._restore.items;
    }
    delete report._restore;
    if (!dryRun) {
      store.log(req.actor, 'items.import', `${report.created.length} created, ${report.updated.length} updated, ${report.skipped.length} skipped, ${report.arts} arts, ${report.scripts} scripts, ${report.recipes} recipes${report.errors.length ? `, ${report.errors.length} error(s)` : ''}`);
      store.markDirty();
    }
    return { dryRun, ...report };
  }));

  // ----- traits & scripts -----
  // ----- arts library: martial arts, cultivation methods, qi cores -----
  const artBody = (b, existing) => {
    const st = store.state;
    const a = defaults.normalizeArt({ ...(existing || {}), ...b, id: existing ? existing.id : slug(b.name || '') });
    if (!a.name) throw new UserError('Name is required.');
    if (a.scriptId && !st.scripts.some((x) => x.id === a.scriptId)) throw new UserError('Selected script does not exist.');
    if (st.arts.some((x) => x.id !== a.id && norm(x.name) === norm(a.name))) throw new UserError(`"${a.name}" already exists.`);
    return a;
  };
  /** Keep the name stored on character references in step with the library. */
  const renameRefs = (id, name) => {
    for (const c of store.state.characters) {
      const fix = (r) => (r && r.id === id ? { id, name } : r);
      c.cultivationMethods = c.cultivationMethods.map(fix);
      c.qiCore = fix(c.qiCore);
      for (const k of Object.keys(c.martialArts)) c.martialArts[k] = c.martialArts[k].map(fix);
    }
  };
  app.post('/api/arts', wrap(async (req) => {
    const st = store.state;
    const a = artBody(req.body || {});
    if (st.arts.some((x) => x.id === a.id)) a.id = `${a.id}-${newId()}`;
    st.arts.push(a);
    store.log(req.actor, 'art.create', `${a.name} (${defaults.ART_KIND_LABEL[a.kind]})`);
    return { art: a };
  }));
  app.put('/api/arts/:id', wrap(async (req) => {
    const st = store.state;
    const idx = st.arts.findIndex((x) => x.id === req.params.id);
    if (idx < 0) throw new UserError('Not found.');
    const before = st.arts[idx];
    const a = artBody(req.body || {}, before);
    st.arts[idx] = a;
    if (before.name !== a.name) renameRefs(a.id, a.name);
    store.log(req.actor, 'art.update', `${a.name}: ${diff(before, a)}`);
    return { art: a };
  }));
  app.delete('/api/arts/:id', wrap(async (req) => {
    const st = store.state;
    const a = st.arts.find((x) => x.id === req.params.id);
    if (!a) throw new UserError('Not found.');
    const users = st.characters.filter((c) => c.qiCore?.id === a.id || c.cultivationMethods.some((r) => r.id === a.id) || Object.values(c.martialArts).some((l) => l.some((r) => r.id === a.id)));
    const manuals = st.items.filter((i) => i.manual?.artId === a.id);
    if (users.length || manuals.length) throw new UserError(`Still used by ${users.length} character(s) and ${manuals.length} manual(s)${users.length ? ` (e.g. ${users[0].name})` : manuals.length ? ` (e.g. ${manuals[0].name})` : ''}. Remove it from them first.`);
    st.arts = st.arts.filter((x) => x !== a);
    st.sects.forEach((x) => { if (x.coreArtId === a.id) x.coreArtId = ''; });
    store.log(req.actor, 'art.delete', a.name);
    return { ok: true };
  }));

  // Dashboard auto-refresh: a number that changes whenever anything changes.
  app.get('/api/rev', (req, res) => res.json({ rev: store.revision, savedAt: store.lastSavedAt }));

  app.post('/api/traits', wrap(async (req) => {
    const b = req.body || {};
    if (!String(b.name || '').trim()) throw new UserError('Name is required.');
    const t = { id: slug(b.name), name: b.name.trim(), description: b.description || '', scriptId: b.scriptId || '' };
    if (store.state.traits.some((x) => x.id === t.id)) t.id = `${t.id}-${newId()}`;
    store.state.traits.push(t);
    store.log(req.actor, 'trait.create', t.name);
    return { trait: t };
  }));
  app.put('/api/traits/:id', wrap(async (req) => {
    const t = store.state.traits.find((x) => x.id === req.params.id);
    if (!t) throw new UserError('Trait not found.');
    const before = clone(t);
    Object.assign(t, { name: String(req.body.name || t.name).trim(), description: req.body.description ?? t.description, scriptId: req.body.scriptId ?? t.scriptId });
    store.log(req.actor, 'trait.update', `${t.name}: ${diff(before, t)}`);
    return { trait: t };
  }));
  app.delete('/api/traits/:id', wrap(async (req) => {
    const t = store.state.traits.find((x) => x.id === req.params.id);
    if (!t) throw new UserError('Trait not found.');
    store.state.traits = store.state.traits.filter((x) => x !== t);
    store.log(req.actor, 'trait.delete', t.name);
    return { ok: true };
  }));

  app.post('/api/scripts', wrap(async (req) => {
    const b = req.body || {};
    if (!String(b.name || '').trim()) throw new UserError('Name is required.');
    const err = scripts.checkSyntax(b.code || '');
    if (err) throw new UserError(`Syntax error: ${err}`);
    const s = { id: slug(b.id || b.name), name: b.name.trim(), description: b.description || '', code: b.code || '', enabled: b.enabled !== false };
    if (store.state.scripts.some((x) => x.id === s.id)) s.id = `${s.id}-${newId()}`;
    store.state.scripts.push(s);
    store.log(req.actor, 'script.create', s.name);
    return { script: s };
  }));
  app.put('/api/scripts/:id', wrap(async (req) => {
    const s = store.state.scripts.find((x) => x.id === req.params.id);
    if (!s) throw new UserError('Script not found.');
    const b = req.body || {};
    if (b.code !== undefined) {
      const err = scripts.checkSyntax(b.code);
      if (err) throw new UserError(`Syntax error: ${err}`);
    }
    const before = clone(s);
    Object.assign(s, { name: String(b.name || s.name).trim(), description: b.description ?? s.description, code: b.code ?? s.code, enabled: b.enabled ?? s.enabled });
    store.log(req.actor, 'script.update', `${s.name}${before.code !== s.code ? ' (code changed)' : ''}${before.enabled !== s.enabled ? ` enabled=${s.enabled}` : ''}`);
    return { script: s };
  }));
  app.delete('/api/scripts/:id', wrap(async (req) => {
    const st = store.state;
    const s = st.scripts.find((x) => x.id === req.params.id);
    if (!s) throw new UserError('Script not found.');
    st.scripts = st.scripts.filter((x) => x !== s);
    st.items.forEach((i) => { if (i.scriptId === s.id) i.scriptId = ''; });
    st.traits.forEach((t) => { if (t.scriptId === s.id) t.scriptId = ''; });
    (st.arts || []).forEach((a) => { if (a.scriptId === s.id) a.scriptId = ''; });
    store.log(req.actor, 'script.delete', s.name);
    return { ok: true };
  }));
  // Test a script (unsaved code allowed) against a character at a chosen impurity.
  app.post('/api/scripts/test', wrap(async (req) => {
    const st = store.state;
    const { code, characterId, impurity, amount } = req.body || {};
    const err = scripts.checkSyntax(code || '');
    if (err) return { error: `Syntax error: ${err}` };
    let c = st.characters.find((x) => x.id === characterId);
    c = defaults.normalizeCharacter(clone(c || { name: 'Test Dummy', ownerId: 'test', stats: { strength: 40, endurance: 40, mobility: 40, qi: 30 } }));
    if (impurity !== '' && impurity !== undefined && impurity !== null) c.impurity = num(impurity);
    const script = { id: 'test', name: 'test', code };
    const ctx = scripts.buildContext(st, c, { type: 'test', name: 'Dashboard test' }, {});
    const out = {};
    const run = (hook, arg) => {
      try {
        const r = scripts.runHook(script, hook, ctx, arg);
        out[hook] = r.has ? r.value : '(hook not defined)';
      } catch (e) {
        out[hook] = `ERROR: ${e.message}`;
      }
    };
    run('effects', effects.baseFx(st, c));
    run('qiGain', num(amount, 10));
    run('breakthroughChance', num(st.realms[c.realm]?.breakthroughChance, 50));
    run('consume', { yieldType: 'qi', yieldAmount: num(amount, 10), impurity: 10, breakthroughBonus: 0, rate: 0, notes: [] });
    return { character: c.name, impurity: c.impurity, results: out, ctx };
  }));

  // ----- characters -----
  app.get('/api/characters/:id/sheet', wrap(async (req) => {
    const c = store.state.characters.find((x) => x.id === req.params.id);
    if (!c) throw new UserError('Character not found.');
    const sh = effects.compute(store.state, c);
    return { title: chars.titleString(store.state, c), sheet: sh, preview: require('../bot/panels').sheet(c) };
  }));
  app.post('/api/characters', wrap(async (req) => {
    const st = store.state;
    const b = req.body || {};
    const c = chars.createCharacter(st, { ownerId: String(b.ownerId || '').trim(), ownerTag: b.ownerTag || '', name: b.name, sect: b.sect, docLink: b.docLink, approvedBy: { id: req.user.id, name: `${req.user.username} (dashboard)` } });
    store.log(req.actor, 'character.create', `${c.name} for ${c.ownerTag || c.ownerId}`);
    return { character: c };
  }));
  app.put('/api/characters/:id', wrap(async (req) => {
    const st = store.state;
    const idx = st.characters.findIndex((x) => x.id === req.params.id);
    if (idx < 0) throw new UserError('Character not found.');
    const before = st.characters[idx];
    const c = sanitizeCharacter(req.body || {}, before);
    let sectNote = '';
    if ((before.sect || '') !== (c.sect || '')) {
      const r = chars.setSect(st, c, c.sect); // sect core art + join Nyang
      const roles = await bot.applySectRoles(c.ownerId, c.sect).catch(() => ({ ok: false }));
      sectNote = [r.coreArt && `core art ${r.coreArt}`, r.nyang && `+${r.nyang} ${st.settings.currencyName}`, roles.ok ? 'Discord sect role updated' : 'Discord role not changed (bot offline or no sect role linked)'].filter(Boolean).join(', ');
    }
    st.characters[idx] = c;
    store.log(req.actor, 'character.update', `${c.name}: ${diff(before, c)}${sectNote ? ` · ${sectNote}` : ''}`);
    return { character: c, sectNote };
  }));
  app.post('/api/characters/:id/grant', wrap(async (req) => {
    const c = store.state.characters.find((x) => x.id === req.params.id);
    if (!c) throw new UserError('Character not found.');
    const isTake = req.body.mode === 'take';
    const r = isTake
      ? take(store.state, c, req.body.type, req.body.amount, { stat: req.body.stat, refund: !!req.body.refund })
      : grant(store.state, c, req.body.type, req.body.amount);
    store.log(req.actor, `${isTake ? 'take' : 'give'}.${req.body.type}`, `${c.name}: ${r.summary}${req.body.reason ? ` — ${req.body.reason}` : ''}`);
    return { character: c, lines: [r.summary, ...r.lines] };
  }));
  app.delete('/api/characters/:id', wrap(async (req) => {
    const st = store.state;
    const c = st.characters.find((x) => x.id === req.params.id);
    if (!c) throw new UserError('Character not found.');
    st.characters = st.characters.filter((x) => x !== c);
    st.market.filter((l) => l.sellerCharId === c.id).forEach((l) => (st.market = st.market.filter((x) => x !== l)));
    store.log(req.actor, 'character.delete', `${c.name} (owner ${c.ownerTag || c.ownerId})`);
    return { ok: true };
  }));

  // ----- applications -----
  app.post('/api/applications/:id/:action', wrap(async (req) => {
    const st = store.state;
    const a = st.applications.find((x) => x.id === req.params.id);
    if (!a || a.status !== 'pending') throw new UserError('Application is not pending.');
    if (req.params.action === 'approve') {
      const c = chars.createCharacter(st, { ownerId: a.userId, ownerTag: a.userTag, name: a.name, sect: a.sect, docLink: a.docLink, approvedBy: { id: req.user.id, name: `${req.user.username} (dashboard)` } });
      Object.assign(a, { status: 'approved', characterId: c.id, decidedBy: req.user.username, decidedAt: new Date().toISOString() });
      store.log(req.actor, 'character.approve', `${c.name} — owner ${a.userTag} (roles must be given in Discord)`);
    } else if (req.params.action === 'reject') {
      Object.assign(a, { status: 'rejected', reason: req.body?.reason || '', decidedBy: req.user.username, decidedAt: new Date().toISOString() });
      store.log(req.actor, 'application.reject', `${a.name} by ${a.userTag}`);
    } else throw new UserError('Unknown action.');
    return { application: a };
  }));


  // ----- recipes (crafting) -----
  const recipeBody = (b, existing) => {
    const r = defaults.normalizeRecipe({ ...(existing || {}), ...b, id: existing ? existing.id : undefined });
    if (!r.name) throw new UserError('Recipe name is required.');
    if (!r.inputs.length) throw new UserError('Add at least one input item.');
    if (!r.outputs.length) throw new UserError('Add at least one output item.');
    for (const x of [...r.inputs, ...r.outputs]) if (!store.state.items.some((i) => i.id === x.itemId)) throw new UserError('A recipe uses an item that does not exist.');
    return r;
  };
  app.post('/api/recipes', wrap(async (req) => {
    const r = recipeBody(req.body || {});
    store.state.recipes.push(r);
    store.log(req.actor, 'recipe.create', r.name);
    return { recipe: r };
  }));
  app.put('/api/recipes/:id', wrap(async (req) => {
    const st = store.state;
    const idx = st.recipes.findIndex((x) => x.id === req.params.id);
    if (idx < 0) throw new UserError('Recipe not found.');
    const before = st.recipes[idx];
    const r = recipeBody(req.body || {}, before);
    st.recipes[idx] = r;
    store.log(req.actor, 'recipe.update', `${r.name}: ${diff(before, r)}`);
    return { recipe: r };
  }));
  app.delete('/api/recipes/:id', wrap(async (req) => {
    const r = store.state.recipes.find((x) => x.id === req.params.id);
    if (!r) throw new UserError('Recipe not found.');
    store.state.recipes = store.state.recipes.filter((x) => x !== r);
    store.log(req.actor, 'recipe.delete', r.name);
    return { ok: true };
  }));

  // ----- combat tables (/compare) -----
  app.put('/api/combat', wrap(async (req) => {
    const b = req.body || {};
    const rows = (list) => arr(list).map((r) => ({ min: numOrNull(r.min), label: String(r.label || ''), tier: String(r.tier || ''), name: String(r.name || '').trim(), reqRT: Math.max(0, Math.floor(num(r.reqRT))), desc: String(r.desc || '') })).filter((r) => r.name);
    const next = { damage: rows(b.damage), clash: rows(b.clash), mobility: rows(b.mobility), damageNote: String(b.damageNote || ''), clashNote: String(b.clashNote || '') };
    for (const k of ['damage', 'clash', 'mobility']) if (!next[k].length) throw new UserError(`The ${k} table needs at least one row.`);
    store.state.combat = next;
    store.log(req.actor, 'combat.update', 'Stat comparison tables saved');
    return { combat: next };
  }));

  // ----- message templates -----
  app.get('/api/templates', wrap(async () => ({
    templates: Object.entries(templates.DEFS).map(([key, d]) => ({
      key, label: d.label, group: d.group, help: d.help || '', placeholders: d.placeholders, sample: d.sample || {}, buttons: d.buttons || [],
      value: templates.get(store.state, key), custom: !!store.state.templates[key], default: d.default,
    })),
    ui: uiConfig(),
  })));

  // ----- emojis & buttons -----
  function uiConfig() {
    const st = store.state;
    return {
      emojis: Object.entries(ui.EMOJIS).map(([key, [def, label]]) => ({ key, label, default: def, value: ui.emojis(st)[key] })),
      buttons: Object.entries(ui.BUTTONS).map(([key, [label, emoji, where]]) => ({ key, where, default: { label, emoji }, value: { label: st.settings.ui?.buttons?.[key]?.label ?? label, emoji: st.settings.ui?.buttons?.[key]?.emoji ?? emoji } })),
      statShort: Object.entries(ui.STAT_SHORT).map(([key, def]) => ({ key, default: def, value: st.settings.ui?.statShort?.[key] ?? def })),
    };
  }
  app.get('/api/ui', wrap(async () => uiConfig()));
  app.put('/api/ui', wrap(async (req) => {
    const b = req.body || {};
    const clean = (v) => String(v ?? '').trim().slice(0, 80);
    const next = { emojis: {}, buttons: {}, statShort: {} };
    for (const [k, v] of Object.entries(b.emojis || {})) if (ui.EMOJIS[k]) next.emojis[k] = clean(v);
    for (const [k, v] of Object.entries(b.buttons || {})) if (ui.BUTTONS[k]) next.buttons[k] = { label: clean(v?.label), emoji: clean(v?.emoji) };
    for (const [k, v] of Object.entries(b.statShort || {})) if (ui.STAT_SHORT[k]) next.statShort[k] = clean(v) || ui.STAT_SHORT[k];
    for (const [k, v] of Object.entries(next.buttons)) if (!v.label && !v.emoji) throw new UserError(`The "${k}" button needs a label or an emoji.`);
    store.state.settings.ui = next;
    // The currency emoji follows the Nyang emoji.
    if (next.emojis.nyang !== undefined) store.state.settings.currencyEmoji = next.emojis.nyang;
    store.log(req.actor, 'ui.update', 'Emojis & buttons saved');
    return uiConfig();
  }));
  app.put('/api/templates/:key', wrap(async (req) => {
    if (!templates.DEFS[req.params.key]) throw new UserError('Unknown template.');
    const t = templates.normalizeImport(req.body || {});
    if (!t.content.trim() && !t.embeds.length) throw new UserError('A message needs text or at least one embed.');
    store.state.templates[req.params.key] = t;
    store.log(req.actor, 'template.update', templates.DEFS[req.params.key].label);
    return { value: t };
  }));
  app.delete('/api/templates/:key', wrap(async (req) => {
    delete store.state.templates[req.params.key];
    store.log(req.actor, 'template.reset', templates.DEFS[req.params.key]?.label || req.params.key);
    store.markDirty();
    return { value: templates.get(store.state, req.params.key) };
  }));
  app.post('/api/templates/:key/test', wrap(async (req) => {
    if (!bot.status.online) throw new UserError('The bot is offline.');
    if (!req.body?.channelId) throw new UserError('Pick a channel to send the test to.');
    await bot.sendTest(req.body.channelId, templates.render(store.state, req.params.key, req.body.vars || {}));
    return { ok: true };
  }));

  // ----- commands & permissions -----
  app.get('/api/commands', wrap(async () => ({ commands: bot.catalog(), online: bot.status.online })));
  app.put('/api/commands/:key', wrap(async (req) => {
    const key = String(req.params.key).replace(/\s+/g, ' ').trim();
    const [name, sub] = key.split(' ');
    const cmd = bot.catalog().find((c) => c.name === name);
    if (!cmd || (sub && !cmd.subcommands.some((s) => s.name === sub))) throw new UserError('Unknown command.');
    const b = req.body || {};
    const access = ['everyone', 'staff', 'roles', ...(sub ? ['inherit'] : [])].includes(b.access) ? b.access : sub ? 'inherit' : 'everyone';
    const rule = {
      enabled: b.enabled !== false,
      access,
      roleIds: arr(b.roleIds).map(String).filter(Boolean),
      channelIds: arr(b.channelIds).map(String).filter(Boolean),
      description: truncate(String(b.description || '').trim(), 100),
    };
    if (!sub) rule.hidden = !!b.hidden;
    const before = store.state.commandAccess[key];
    store.state.commandAccess[key] = rule;
    store.log(req.actor, 'command.update', `/${key}: ${diff(before || {}, rule)}`);
    let synced = false;
    if (bot.status.online) {
      try { await bot.registerCommands(); synced = true; } catch (e) { console.warn('[dashboard] sync failed', e.message); }
    }
    return { rule, synced };
  }));
  app.post('/api/commands/sync', wrap(async () => ({ count: await bot.registerCommands() })));

  // ----- changelog -----
  app.get('/api/changelog', wrap(async (req) => {
    const q = norm(req.query.q);
    const list = store.state.changelog.filter((e) => !q || norm(`${e.actor} ${e.action} ${e.details} ${e.source}`).includes(q));
    const offset = Math.max(0, num(req.query.offset));
    const limit = Math.min(500, Math.max(1, num(req.query.limit, 100)));
    return { total: list.length, entries: list.slice(offset, offset + limit) };
  }));

  // ----- save / load / backups -----
  app.post('/api/save', wrap(async (req) => {
    await store.save();
    store.log(req.actor, 'data.save', 'Manual save');
    return { lastSavedAt: store.lastSavedAt };
  }));
  app.post('/api/reload', wrap(async (req) => {
    adminOnly(req);
    await store.reload(req.actor);
    return { ok: true };
  }));
  app.get('/api/backups', wrap(async () => ({ backups: await store.listBackups() })));
  app.post('/api/backups', wrap(async (req) => ({ backup: await store.createBackup(req.body?.label, req.actor) })));
  app.post('/api/backups/:id/restore', wrap(async (req) => {
    adminOnly(req);
    await store.restoreBackup(req.params.id, req.actor);
    return { ok: true };
  }));
  app.delete('/api/backups/:id', wrap(async (req) => {
    adminOnly(req);
    await store.deleteBackup(req.params.id, req.actor);
    return { ok: true };
  }));
  app.get('/api/backups/:id/download', wrap(async (req, res) => {
    const json = await store.getBackupJson(req.params.id);
    if (!json) throw new UserError('Backup not found.');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.json"`);
    res.send(json);
  }));
  app.get('/api/export', wrap(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="jianghu-save-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(store.exportState(), null, 2));
  }));
  app.post('/api/import', wrap(async (req) => {
    adminOnly(req);
    await store.importState(req.body, req.actor);
    return { ok: true };
  }));

  // ----- dashboard accounts -----
  app.get('/api/accounts', wrap(async () => ({ accounts: store.state.dashboardUsers.map(({ hash, ...u }) => u) })));
  app.post('/api/accounts', wrap(async (req) => {
    adminOnly(req);
    const { username, password, isAdmin } = req.body || {};
    if (!String(username || '').trim() || String(password || '').length < 6) throw new UserError('Username required and password must be at least 6 characters.');
    if (store.state.dashboardUsers.some((u) => norm(u.username) === norm(username))) throw new UserError('That username is taken.');
    const u = { id: newId('u-'), username: username.trim(), hash: auth.hashPassword(password), isAdmin: !!isAdmin, createdAt: new Date().toISOString() };
    store.state.dashboardUsers.push(u);
    store.log(req.actor, 'account.create', `${u.username}${u.isAdmin ? ' (admin)' : ''}`);
    return { ok: true };
  }));
  app.delete('/api/accounts/:id', wrap(async (req) => {
    adminOnly(req);
    const users = store.state.dashboardUsers;
    const u = users.find((x) => x.id === req.params.id);
    if (!u) throw new UserError('Account not found.');
    if (u.id === req.user.id) throw new UserError("You can't delete your own account.");
    if (u.isAdmin && users.filter((x) => x.isAdmin).length <= 1) throw new UserError("Can't delete the last admin.");
    store.state.dashboardUsers = users.filter((x) => x !== u);
    store.log(req.actor, 'account.delete', u.username);
    return { ok: true };
  }));
  app.put('/api/accounts/password', wrap(async (req) => {
    const { current, next, accountId } = req.body || {};
    let target = req.user;
    if (accountId && accountId !== req.user.id) {
      adminOnly(req);
      target = store.state.dashboardUsers.find((x) => x.id === accountId);
      if (!target) throw new UserError('Account not found.');
    } else if (!auth.verifyPassword(current, req.user.hash)) throw new UserError('Current password is wrong.');
    if (String(next || '').length < 6) throw new UserError('New password must be at least 6 characters.');
    target.hash = auth.hashPassword(next);
    store.log(req.actor, 'account.password', target.username);
    return { ok: true };
  }));

  require('./world-api').mount(app, { wrap, bot, diff });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

module.exports = { create };
