'use strict';
/**
 * Holds the whole game state in memory and persists it as one JSON document,
 * either to MongoDB (MONGODB_URI) or to data/db.json. Also handles backups and the changelog.
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const config = require('./config');
const defaults = require('./defaults');
const { newId, clone, deepMerge, truncate, isPlainObject } = require('./utils');
const { hashPassword } = require('./dashboard/auth');

class FileBackend {
  constructor(dir) {
    this.kind = 'file';
    this.file = path.join(dir, 'db.json');
    this.bdir = path.join(dir, 'backups');
    this.index = path.join(this.bdir, 'index.json');
    fs.mkdirSync(this.bdir, { recursive: true });
  }
  async connect() {}
  async load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  async save(json) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, this.file);
  }
  readIndex() {
    try {
      return JSON.parse(fs.readFileSync(this.index, 'utf8'));
    } catch {
      return [];
    }
  }
  async listBackups() {
    return this.readIndex();
  }
  async putBackup(meta, json) {
    fs.writeFileSync(path.join(this.bdir, `${meta.id}.json`), json);
    const idx = this.readIndex();
    idx.unshift(meta);
    fs.writeFileSync(this.index, JSON.stringify(idx, null, 2));
  }
  async getBackup(id) {
    if (!/^[\w-]+$/.test(id)) return null;
    try {
      return fs.readFileSync(path.join(this.bdir, `${id}.json`), 'utf8');
    } catch {
      return null;
    }
  }
  async deleteBackup(id) {
    if (!/^[\w-]+$/.test(id)) return;
    try {
      fs.unlinkSync(path.join(this.bdir, `${id}.json`));
    } catch {}
    fs.writeFileSync(this.index, JSON.stringify(this.readIndex().filter((b) => b.id !== id), null, 2));
  }
}

class MongoBackend {
  constructor(uri, dbName) {
    this.kind = 'mongodb';
    this.uri = uri;
    this.dbName = dbName;
  }
  async connect() {
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    const db = this.client.db(this.dbName);
    this.col = db.collection('state');
    this.bcol = db.collection('backups');
  }
  // The state is stored as a JSON string so any key (item ids, element names...) is safe.
  async load() {
    const doc = await this.col.findOne({ _id: 'main' });
    return doc ? JSON.parse(doc.json) : null;
  }
  async save(json) {
    await this.col.updateOne({ _id: 'main' }, { $set: { json, updatedAt: new Date() } }, { upsert: true });
  }
  async listBackups() {
    const rows = await this.bcol.find({}, { projection: { json: 0 } }).sort({ createdAt: -1 }).toArray();
    return rows.map(({ _id, ...m }) => ({ id: _id, ...m }));
  }
  async putBackup(meta, json) {
    const { id, ...rest } = meta;
    await this.bcol.insertOne({ _id: id, ...rest, json });
  }
  async getBackup(id) {
    const doc = await this.bcol.findOne({ _id: id });
    return doc ? doc.json : null;
  }
  async deleteBackup(id) {
    await this.bcol.deleteOne({ _id: id });
  }
}

/**
 * Version 2: martial arts, cultivation methods and qi cores moved out of items into state.arts.
 * Manuals stay items and point at the art they teach (manual.artId). Qi cores are no longer items.
 */
function migrateArts(s, data, d) {
  const arts = Array.isArray(data.arts) ? data.arts.map((a) => defaults.normalizeArt(a)) : d.arts.map((a) => ({ ...a }));
  const upsert = (art) => {
    const i = arts.findIndex((a) => a.id === art.id || a.name.toLowerCase() === art.name.toLowerCase());
    if (i >= 0) arts[i] = art;
    else arts.push(art);
  };
  const removed = new Set();
  for (const it of s.items) {
    const legacy = it.type === 'cultivation' || it.type === 'core' || (it.type === 'manual' && !it.manual?.artId);
    if (!legacy) continue;
    const kind = it.type === 'cultivation' ? 'cultivation' : it.type === 'core' ? 'qicore' : it.manual?.category || 'generic';
    const cult = it.cultivation || {};
    upsert(defaults.normalizeArt({
      id: it.id, name: it.name, kind, description: it.description,
      replacesCore: it.manual?.replacesCore, shareable: it.manual?.shareable, shareLimit: it.manual?.shareLimit,
      absorption: cult.absorption, affinities: cult.affinities, impurityReduction: cult.impurityReduction, scriptId: it.scriptId,
    }));
    if (it.type === 'core') removed.add(it.id);
    else {
      it.type = 'manual';
      it.manual = { artId: it.id };
      it.scriptId = '';
    }
  }
  if (removed.size) {
    s.items = s.items.filter((i) => !removed.has(i.id));
    for (const c of s.characters || []) for (const id of removed) if (c.inventory) delete c.inventory[id];
    s.market = (s.market || []).filter((l) => !removed.has(l.itemId));
  }
  for (const a of arts) if (a.description) a.description = a.description.replace('__Does not disable Qi regeneration.__', '__Does not reduce yields by 50%.__');
  s.arts = arts;
  // Sects: default core art + join Nyang fields.
  s.sects = s.sects.map((x) => ({ coreArtId: x.name === 'Mount Hua Sect' && !('coreArtId' in x) && arts.some((a) => a.id === 'plum-blossom-sword') ? 'plum-blossom-sword' : '', joinNyang: 0, ...x }));
  // Impurity 50 used to block Qi regen; it now reduces pill yields.
  const oldImp = data.settings?.impurity;
  if (oldImp && oldImp.noRegenAt !== undefined && oldImp.yieldPenaltyAt === undefined) s.settings.impurity.yieldPenaltyAt = oldImp.noRegenAt;
  delete s.settings.impurity.noRegenAt;
  for (const sc of s.scripts) {
    if (typeof sc.code === 'string' && sc.code.includes('fx.qiRegenDisabled = false;')) {
      sc.code = sc.code.replace('fx.qiRegenDisabled = false;', 'fx.yieldMultiplier = 1;').replace('Qi regeneration is NOT disabled.', 'pill yields are NOT reduced.');
    }
  }
  s.version = 2;
}

function migrate(data) {
  const d = defaults.createDefaultState();
  if (!isPlainObject(data)) { require('./world/state').normalizeWorld(d); return d; }
  const s = { ...d, ...data };
  s.settings = deepMerge(d.settings, data.settings || {});
  for (const k of ['rarities', 'realms', 'sects', 'traits', 'scripts', 'items', 'arts', 'characters', 'recipes', 'applications', 'progress', 'trades', 'market', 'changelog', 'dashboardUsers']) {
    if (!Array.isArray(s[k])) s[k] = d[k];
  }
  s.users = isPlainObject(s.users) ? s.users : {};
  s.templates = isPlainObject(s.templates) ? s.templates : {};
  // Walls are no longer capped at 5.
  for (const [k, t] of Object.entries(s.templates)) { const j = JSON.stringify(t); if (j.includes('{fort}/5') || j.includes('"name":"Policies","value":"{policies}"')) s.templates[k] = JSON.parse(j.split('{fort}/5').join('{fort}').split('"name":"Policies","value":"{policies}"').join('"name":"Decrees","value":"{decrees}"')); }
  s.commandAccess = isPlainObject(s.commandAccess) ? s.commandAccess : {};
  s.combat = isPlainObject(s.combat) ? { ...d.combat, ...s.combat } : d.combat;
  s.recipes = s.recipes.map((r) => defaults.normalizeRecipe(r));
  s.meta = { ...d.meta, ...(data.meta || {}) };
  migrateArts(s, data, d);
  s.items = s.items.map((i) => defaults.normalizeItem(i));
  // Old saves: titles were prefix/stem/suffix; without a prefix the sect name was used ("Mount Hua's Rising Dragon").
  for (const c of s.characters) {
    if (typeof c.title !== 'string' && c.titles && (c.titles.prefix || c.titles.stem || c.titles.suffix)) {
      const core = [c.titles.stem, c.titles.suffix].filter(Boolean).join(' ');
      const sect = s.sects.find((x) => x.name === c.sect);
      c.title = c.titles.prefix ? [c.titles.prefix, core].filter(Boolean).join(' ') : `${sect ? `${sect.titleName || sect.name}'s` : 'Rogue'} ${core}`.trim();
    }
    delete c.titles;
  }
  s.characters = s.characters.map((c) => defaults.normalizeCharacter(c));
  // Character refs to martial arts / cultivation methods / qi cores point at the arts library.
  const byId = new Map(s.arts.map((a) => [a.id, a]));
  const byName = new Map(s.arts.map((a) => [a.name.toLowerCase(), a]));
  const fix = (r) => {
    if (!r) return r;
    if (r.id && byId.has(r.id)) return { id: r.id, name: byId.get(r.id).name };
    const a = byName.get(String(r.name || '').toLowerCase());
    return a ? { id: a.id, name: a.name } : { name: r.name || r.id };
  };
  for (const c of s.characters) {
    c.cultivationMethods = c.cultivationMethods.map(fix).filter(Boolean);
    c.qiCore = fix(c.qiCore);
    for (const k of Object.keys(c.martialArts)) c.martialArts[k] = c.martialArts[k].map(fix).filter(Boolean);
  }
  // Old saves: make sure the Default Weapon exists.
  if (s.settings.defaultWeaponId === defaults.DEFAULT_WEAPON_ID && !s.items.some((i) => i.id === defaults.DEFAULT_WEAPON_ID)) {
    s.items.unshift(defaults.defaultWeaponItem());
    for (const c of s.characters) if (!c.inventory[defaults.DEFAULT_WEAPON_ID]) c.inventory[defaults.DEFAULT_WEAPON_ID] = 1;
  }
  // The world (map, economy, politics, war). Created on first load; repaired on every load.
  require('./world/state').normalizeWorld(s);
  return s;
}

/** Remove things that should never leave the server inside a backup/export. */
function exportable(state) {
  const s = clone(state);
  delete s.dashboardUsers;
  return s;
}

class Store extends EventEmitter {
  constructor() {
    super();
    this.state = null;
    this.backend = null;
    this.timer = null;
    this.lastSavedAt = null;
    this.lastError = null;
    this.revision = 0;
  }

  async init() {
    this.backend = config.mongoUri ? new MongoBackend(config.mongoUri, config.mongoDb) : new FileBackend(config.dataDir);
    await this.backend.connect();
    const data = await this.backend.load();
    this.state = migrate(data);
    this.ensureAdmin();
    await this.save();
    console.log(`[store] loaded (${this.backend.kind}) — ${this.state.items.length} items, ${this.state.characters.length} characters`);
  }

  ensureAdmin() {
    const users = this.state.dashboardUsers;
    const existing = users.find((u) => u.username.toLowerCase() === config.adminUsername.toLowerCase());
    if (!existing && !users.some((u) => u.isAdmin)) {
      users.push({ id: newId('u-'), username: config.adminUsername, hash: hashPassword(config.adminPassword), isAdmin: true, createdAt: new Date().toISOString() });
    } else if (existing && config.adminReset) {
      existing.hash = hashPassword(config.adminPassword);
      existing.isAdmin = true;
      console.log('[store] ADMIN_RESET: admin password reset from ADMIN_PASSWORD');
    }
  }

  markDirty() {
    this.revision = (this.revision || 0) + 1;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save().catch((e) => console.error('[store] save failed', e)), 1500);
  }

  async save() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      await this.backend.save(JSON.stringify(this.state));
      this.lastSavedAt = new Date().toISOString();
      this.lastError = null;
    } catch (e) {
      this.lastError = e.message;
      throw e;
    }
  }

  /** Record an edit. actor = { id, name, source: 'discord' | 'dashboard' | 'system' } */
  log(actor, action, details = '') {
    this.revision = (this.revision || 0) + 1;
    const entry = {
      id: newId('log-'),
      at: new Date().toISOString(),
      actor: actor?.name || 'system',
      actorId: actor?.id || null,
      source: actor?.source || 'system',
      action,
      details: truncate(details, 2000),
    };
    this.state.changelog.unshift(entry);
    const max = Number(this.state.settings.maxChangelog) || 5000;
    if (this.state.changelog.length > max) this.state.changelog.length = max;
    this.markDirty();
    this.emit('log', entry);
    return entry;
  }

  async listBackups() {
    return this.backend.listBackups();
  }

  async createBackup(label, actor, auto = false) {
    await this.save();
    const json = JSON.stringify(exportable(this.state));
    const stamp = new Date().toISOString();
    const meta = { id: `bk-${stamp.replace(/[^0-9]/g, '').slice(0, 14)}-${newId()}`, label: label || (auto ? 'Automatic backup' : 'Manual backup'), createdAt: stamp, createdBy: actor?.name || 'system', size: json.length, auto: !!auto };
    await this.backend.putBackup(meta, json);
    await this.pruneBackups();
    if (!auto) this.log(actor, 'backup.create', `${meta.label} (${meta.id})`);
    return meta;
  }

  async pruneBackups() {
    const max = Number(this.state.settings.maxBackups) || 30;
    const list = await this.backend.listBackups();
    if (list.length <= max) return;
    const sorted = [...list].sort((a, b) => (a.auto === b.auto ? a.createdAt.localeCompare(b.createdAt) : a.auto ? -1 : 1));
    for (const b of sorted.slice(0, list.length - max)) await this.backend.deleteBackup(b.id);
  }

  async getBackupJson(id) {
    return this.backend.getBackup(id);
  }

  async deleteBackup(id, actor) {
    await this.backend.deleteBackup(id);
    this.log(actor, 'backup.delete', id);
  }

  async restoreBackup(id, actor) {
    const json = await this.backend.getBackup(id);
    if (!json) throw new Error('Backup not found');
    await this.createBackup(`Safety copy before restoring ${id}`, actor, true);
    await this.replaceState(JSON.parse(json), actor, 'backup.restore', id);
  }

  async importState(data, actor) {
    if (!isPlainObject(data) || !Array.isArray(data.items) || !Array.isArray(data.characters)) throw new Error('That file does not look like a bot save (missing items/characters).');
    await this.createBackup('Safety copy before import', actor, true);
    await this.replaceState(data, actor, 'data.import', `${data.items.length} items, ${data.characters.length} characters`);
  }

  /** Reload from the database (discarding unsaved memory changes). */
  async reload(actor) {
    const data = await this.backend.load();
    await this.replaceState(data, actor, 'data.reload', 'Reloaded from storage');
  }

  async replaceState(data, actor, action, details) {
    const accounts = this.state.dashboardUsers;
    const log = this.state.changelog;
    this.state = migrate(data);
    this.revision = (this.revision || 0) + 1;
    this.state.dashboardUsers = accounts; // never lose dashboard logins by restoring
    if (!this.state.changelog.length) this.state.changelog = log;
    this.ensureAdmin();
    this.log(actor, action, details);
    await this.save();
    this.emit('replaced');
  }

  exportState() {
    return exportable(this.state);
  }
}

module.exports = new Store();
module.exports.migrate = migrate;
