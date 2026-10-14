'use strict';
/* Jianghu dashboard — plain JavaScript single-page app talking to /api */

// ---------- tiny helpers ----------
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Math.round(Number(n) * 100) / 100);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const plain = (s) => String(s ?? '').replace(/\*\*|__|\*|`/g, '');
const getP = (o, p) => p.split('.').reduce((a, k) => (a === null || a === undefined ? undefined : a[k]), o);
function setP(o, p, v) {
  const ks = p.split('.');
  let a = o;
  ks.slice(0, -1).forEach((k) => { if (typeof a[k] !== 'object' || a[k] === null) a[k] = {}; a = a[k]; });
  a[ks[ks.length - 1]] = v;
}
function deepMerge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? deepMerge(out[k], v) : v;
  return out;
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new Error('Please log in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, bad = false) {
  const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, msg);
  $('#toast').append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}
const run = (fn) => async (...a) => {
  try { await fn(...a); } catch (e) { toast(e.message, true); }
};

// ---------- modal ----------
function openModal(title, body, actions = []) {
  $('#modalTitle').textContent = title;
  $('#modalBody').replaceChildren(body);
  $('#modalActions').replaceChildren(...actions);
  $('#modal').classList.remove('hidden');
}
const closeModal = () => $('#modal').classList.add('hidden');
$('#modalClose').onclick = closeModal;
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });

// ---------- state ----------
let D = null;
let DISCORD = { guilds: [] };
let current = location.hash.slice(1) || 'overview';
const TABS = [
  ['overview', 'Overview'], ['characters', 'Characters'], ['applications', 'Applications'], ['items', 'Items'], ['recipes', 'Crafting'],
  ['drops', 'Drop Rates'], ['realms', 'Realms & Qi Bars'], ['combat', 'Stat Comparison'], ['sects', 'Sects'], ['traits', 'Special Traits'],
  ['scripts', 'Custom Code'], ['commands', 'Commands'], ['messages', 'Messages'], ['settings', 'Settings'], ['changelog', 'Changelog'],
  ['backups', 'Save & Backups'], ['accounts', 'Accounts'],
];

async function load() {
  D = await api('/data');
  try { DISCORD = await api('/discord'); } catch { DISCORD = { guilds: [] }; }
  buildDatalists();
  $('#whoami').textContent = `Signed in as ${D.me.username}${D.me.isAdmin ? ' (admin)' : ''}`;
  $('#saveState').textContent = D.server.lastSavedAt ? `Saved ${new Date(D.server.lastSavedAt).toLocaleTimeString()} · ${D.server.storage}` : '';
}

function buildDatalists() {
  const dl = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));
  const T = D.settings.titles;
  $('#datalists').replaceChildren(
    dl('dl-items', D.items.map((i) => i.name)),
    dl('dl-traits', D.traits.map((t) => t.name)),
    dl('dl-sects', D.sects.map((s) => s.name)),
    dl('dl-prefix', T.prefixes), dl('dl-stem', T.stems), dl('dl-suffix', T.suffixes),
    dl('dl-elements', D.settings.elements),
  );
}

const channels = () => DISCORD.guilds.flatMap((g) => g.channels.map((c) => [c.id, `${DISCORD.guilds.length > 1 ? `${g.name} › ` : ''}#${c.name}`]));
const roles = () => DISCORD.guilds.flatMap((g) => g.roles.map((r) => [r.id, `${DISCORD.guilds.length > 1 ? `${g.name} › ` : ''}@${r.name}`]));
const refLabel = (ref) => (ref && typeof ref === 'object' ? ref.name || ref.id : ref);
const rarity = (name) => D.rarities.find((r) => r.name === name) || { color: '#888', emoji: '⬜', name };
const itemName = (id) => D.items.find((i) => i.id === id)?.name || id;

// ---------- generic form builder ----------
/*
 field: { k: 'path.to.value', label, t: text|number|textarea|code|check|select|lines|color|channel|roles, opts, list, help, wide, show:[types] }
 or { section: 'Title', show:[...] }
*/
function buildForm(fields, values) {
  const inputs = [];
  const nodes = fields.map((f) => {
    if (f.section) {
      const n = h('h4', { class: 'section' }, f.section);
      n._show = f.show;
      return n;
    }
    const v = getP(values, f.k);
    let inp;
    switch (f.t) {
      case 'textarea': inp = h('textarea', { rows: f.rows || 4 }); inp.value = v ?? ''; break;
      case 'code': inp = h('textarea', { rows: f.rows || 20, class: 'code', spellcheck: 'false' }); inp.value = v ?? ''; break;
      case 'number': inp = h('input', { type: 'number', step: f.step || 'any', placeholder: f.nullable ? '∞ (empty)' : '' }); inp.value = v ?? ''; break;
      case 'check': inp = h('input', { type: 'checkbox' }); inp.checked = !!v; break;
      case 'color': inp = h('input', { type: 'color' }); inp.value = v || '#888888'; break;
      case 'select': {
        const opts = typeof f.opts === 'function' ? f.opts() : f.opts;
        inp = h('select', {}, opts.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return h('option', { value: val }, lab); }));
        inp.value = v ?? '';
        break;
      }
      case 'lines': inp = h('textarea', { rows: f.rows || 3, placeholder: 'one per line' }); inp.value = (Array.isArray(v) ? v : v ? [v] : []).map(refLabel).join('\n'); break;
      case 'channel': {
        const list = channels();
        if (list.length) { inp = h('select', {}, h('option', { value: '' }, '— none —'), list.map(([id, n]) => h('option', { value: id }, n))); if (v && !list.some(([id]) => id === v)) inp.append(h('option', { value: v }, v)); }
        else inp = h('input', { placeholder: 'Channel ID' });
        inp.value = v || '';
        break;
      }
      case 'channels': {
        const list = channels();
        const cur = Array.isArray(v) ? v : [];
        if (list.length) {
          inp = h('select', { multiple: true }, list.map(([id, n]) => h('option', { value: id }, n)));
          cur.filter((id) => !list.some(([x]) => x === id)).forEach((id) => inp.append(h('option', { value: id }, id)));
          [...inp.options].forEach((o) => (o.selected = cur.includes(o.value)));
        } else { inp = h('input', { placeholder: 'Channel IDs, comma separated' }); inp.value = cur.join(', '); }
        break;
      }
      case 'roles': {
        const list = roles();
        const cur = Array.isArray(v) ? v : [];
        if (list.length) {
          inp = h('select', { multiple: true }, list.map(([id, n]) => h('option', { value: id }, n)));
          cur.filter((id) => !list.some(([x]) => x === id)).forEach((id) => inp.append(h('option', { value: id }, id)));
          [...inp.options].forEach((o) => (o.selected = cur.includes(o.value)));
        } else { inp = h('input', { placeholder: 'Role IDs, comma separated' }); inp.value = cur.join(', '); }
        break;
      }
      case 'role': {
        const list = roles();
        if (list.length) { inp = h('select', {}, h('option', { value: '' }, '— none —'), list.map(([id, n]) => h('option', { value: id }, n))); }
        else inp = h('input', { placeholder: 'Role ID' });
        inp.value = v || '';
        break;
      }
      default: inp = h('input', { type: 'text' }); inp.value = v ?? '';
    }
    if (f.list) inp.setAttribute('list', f.list);
    inputs.push([f, inp]);
    const n = h('label', { class: `field${f.t === 'check' ? ' check' : ''}${f.wide || ['code', 'textarea'].includes(f.t) ? ' wide' : ''}` }, h('span', {}, f.label), inp, f.help ? h('small', {}, f.help) : null);
    n._show = f.show;
    return n;
  });
  const el = h('div', { class: 'form' }, nodes);
  const read = () => {
    const out = {};
    for (const [f, inp] of inputs) {
      let v;
      switch (f.t) {
        case 'number': v = inp.value === '' ? (f.nullable ? null : 0) : Number(inp.value); break;
        case 'check': v = inp.checked; break;
        case 'lines': v = inp.value.split('\n').map((s) => s.trim()).filter(Boolean); break;
        case 'roles': case 'channels': v = inp.multiple ? [...inp.selectedOptions].map((o) => o.value) : inp.value.split(/[\s,]+/).filter(Boolean); break;
        default: v = inp.value;
      }
      setP(out, f.k, v);
    }
    return out;
  };
  const filter = (type) => nodes.forEach((n) => n.classList.toggle('hidden', !!(n._show && !n._show.includes(type))));
  const input = (k) => inputs.find(([f]) => f.k === k)?.[1];
  return { el, read, filter, input };
}

function table(columns, rows, onClick) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c[0])))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', { class: onClick ? 'click' : '', onclick: onClick ? () => onClick(r) : null }, columns.map((c) => h('td', {}, c[1](r)))))
      : h('tr', {}, h('td', { colspan: columns.length, class: 'muted' }, 'Nothing here yet.'))),
  ));
}

// ---------- navigation ----------
function renderNav() {
  const pending = D.applications.filter((a) => a.status === 'pending').length;
  $('#nav').replaceChildren(...TABS.map(([id, label]) => h('button', {
    class: id === current ? 'active' : '',
    onclick: () => { current = id; location.hash = id; $('.sidebar').classList.remove('open'); render(); },
  }, label, id === 'applications' && pending ? h('span', { class: 'badge' }, pending) : null)));
}

async function render() {
  renderNav();
  const label = TABS.find(([id]) => id === current)?.[1] || 'Overview';
  $('#viewTitle').textContent = label;
  const view = $('#view');
  view.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    const fn = VIEWS[current] || VIEWS.overview;
    const content = await fn();
    view.replaceChildren(...[content].flat());
  } catch (e) {
    view.replaceChildren(h('div', { class: 'card warn bad' }, e.message));
  }
}
async function refresh() { await load(); await render(); }

// ---------- views ----------
const VIEWS = {};

function recentCard() {
  const box = h('div', {}, 'Loading…');
  api('/changelog?limit=8').then((r) => box.replaceChildren(table([['When', (e) => new Date(e.at).toLocaleString()], ['Who', (e) => `${e.actor} (${e.source})`], ['What', (e) => e.action], ['Details', (e) => e.details]], r.entries))).catch((e) => box.replaceChildren(e.message));
  return h('div', { class: 'card' }, h('h3', {}, 'Recent changes'), box);
}

VIEWS.overview = () => {
  const s = D.server;
  const warnings = [];
  if (D.me.defaultPassword) warnings.push(['bad', 'You are using the default admin password "jianghu". Change it in Accounts, or set ADMIN_PASSWORD on Render.']);
  if (s.storage === 'file') warnings.push(['', 'Data is stored in a local file. On Render this is wiped on every deploy/restart unless you attach a Disk — set MONGODB_URI (free MongoDB Atlas) to keep data safe. Download backups regularly either way.']);
  if (!s.bot.online) warnings.push(['bad', `Bot offline: ${s.bot.error || 'not connected yet'}`]);
  else if (s.bot.error) warnings.push(['', s.bot.error]);
  if (s.saveError) warnings.push(['bad', `Last save failed: ${s.saveError}`]);
  const pending = D.applications.filter((a) => a.status === 'pending').length;
  const stat = (label, value, sub) => h('div', { class: 'stat' }, h('span', { class: 'muted' }, label), h('b', {}, value), sub ? h('small', { class: 'muted' }, sub) : null);
  return [
    ...warnings.map(([cls, msg]) => h('div', { class: `card warn ${cls}` }, msg)),
    h('div', { class: 'grid' },
      stat('Bot', s.bot.online ? '● Online' : '○ Offline', s.bot.tag || ''),
      stat('Characters', D.characters.filter((c) => c.status === 'active').length, `${D.characters.length} total`),
      stat('Pending applications', pending),
      stat('Items', `${D.items.length} / ${D.settings.maxItems}`, `${D.items.filter((i) => i.inDropPool).length} in drop pool · ${D.items.filter((i) => i.shop.enabled).length} in shop`),
      stat('Market listings', D.market.length),
      stat('Storage', s.storage, s.lastSavedAt ? `saved ${new Date(s.lastSavedAt).toLocaleString()}` : ''),
    ),
    h('div', { class: 'card' }, h('h3', {}, 'Quick actions'), h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', onclick: run(async () => { await api('/save', { method: 'POST', body: {} }); toast('Saved.'); await refresh(); }) }, '💾 Save now'),
      h('button', { class: 'btn', onclick: run(async () => { await api('/backups', { method: 'POST', body: { label: 'Manual backup' } }); toast('Backup created.'); }) }, '🗄️ Create backup'),
      h('a', { class: 'btn', href: '/api/export' }, '⬇️ Download full save'),
    )),
    recentCard(),
  ].filter(Boolean);
};

// ----- characters -----
VIEWS.characters = () => {
  const search = h('input', { placeholder: 'Search name, owner, sect…', class: 'grow' });
  const status = h('select', {}, h('option', { value: 'active' }, 'Active'), h('option', { value: 'retired' }, 'Retired'), h('option', { value: '' }, 'All'));
  const wrap = h('div');
  const draw = () => {
    const q = search.value.toLowerCase();
    const list = D.characters.filter((c) => (!status.value || c.status === status.value) && (!q || `${c.name} ${c.ownerTag} ${c.ownerId} ${c.sect}`.toLowerCase().includes(q)));
    wrap.replaceChildren(table([
      ['Name', (c) => h('strong', {}, c.name)],
      ['Owner', (c) => `${c.ownerTag || ''} (${c.ownerId})`],
      ['Realm', (c) => D.realms[c.realm]?.name || c.realm],
      ['Sect', (c) => c.sect || 'Rogue'],
      ['Stats', (c) => fmt(c.stats.strength + c.stats.endurance + c.stats.mobility)],
      ['Qi', (c) => fmt(c.stats.qi)],
      ['Unspent', (c) => `${fmt(c.pools.normal)} / ${fmt(c.pools.flex)}`],
      ['Impurity', (c) => fmt(c.impurity)],
      [D.settings.currencyName, (c) => fmt(c.nyang)],
      ['Approved by', (c) => `${c.approvedBy?.name || '—'}${c.approvedAt ? ` · ${new Date(c.approvedAt).toLocaleDateString()}` : ''}`],
    ], list, editCharacter));
  };
  search.oninput = draw;
  status.onchange = draw;
  draw();
  return [
    h('div', { class: 'toolbar' }, search, status, h('button', { class: 'btn primary', onclick: newCharacter }, '+ New character')),
    h('p', { class: 'muted small' }, 'Every approved character, who owns it and who approved it. Click a row to edit the full sheet. "Unspent" = stat points / flexible points (Qi allowed).'),
    wrap,
  ];
};

function newCharacter() {
  const f = buildForm([
    { k: 'name', label: 'Character name' },
    { k: 'ownerId', label: 'Owner Discord user ID', help: 'Right-click the user in Discord → Copy User ID (Developer Mode)' },
    { k: 'ownerTag', label: 'Owner username' },
    { k: 'sect', label: 'Sect', list: 'dl-sects' },
    { k: 'docLink', label: 'Document link', wide: true },
  ], {});
  openModal('New character', f.el, [
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => { await api('/characters', { method: 'POST', body: f.read() }); closeModal(); toast('Character created.'); await refresh(); }) }, 'Create'),
  ]);
}

function editCharacter(c) {
  const fields = [
    { section: 'Identity' },
    { k: 'name', label: 'Name' }, { k: 'ownerId', label: 'Owner Discord ID' }, { k: 'ownerTag', label: 'Owner username' },
    { k: 'sect', label: 'Sect (empty = Rogue)', list: 'dl-sects' }, { k: 'gender', label: 'Gender' },
    { k: 'status', label: 'Status', t: 'select', opts: ['active', 'retired'] },
    { k: 'docLink', label: 'Document link', wide: true },
    { section: 'Titles' },
    { k: 'titles.prefix', label: 'Prefix', list: 'dl-prefix' }, { k: 'titles.stem', label: 'Stem', list: 'dl-stem' }, { k: 'titles.suffix', label: 'Suffix', list: 'dl-suffix' },
    { section: 'Realm & stats' },
    { k: 'realm', label: 'Realm', t: 'select', opts: () => D.realms.map((r, i) => [i, r.name]) },
    { k: 'stats.strength', label: 'Strength', t: 'number' }, { k: 'stats.endurance', label: 'Endurance', t: 'number' }, { k: 'stats.mobility', label: 'Mobility', t: 'number' }, { k: 'stats.qi', label: 'Qi', t: 'number' },
    { k: 'pools.normal', label: 'Unspent stat points (no Qi)', t: 'number' }, { k: 'pools.flex', label: 'Unspent flexible points (Qi ok)', t: 'number' },
    { k: 'bonusQiBars', label: 'Bonus Qi Bars', t: 'number', step: '0.5' }, { k: 'impurity', label: 'Impurity', t: 'number' },
    { k: 'burstApplied', label: 'Meridians already burst (since last reset)', t: 'check' }, { k: 'breakthroughBonus', label: 'Stored breakthrough bonus %', t: 'number' },
    { section: 'Wallet' },
    { k: 'nyang', label: D.settings.currencyName, t: 'number' }, { k: 'rolls', label: 'Drop rolls', t: 'number' },
    { section: 'Traits, cultivation & martial arts (one per line — names that match an item/trait link to it)' },
    { k: 'traits', label: 'Special traits', t: 'lines' },
    { k: 'cultivationMethods', label: `Cultivation methods (max ${D.settings.maxCultivationMethods})`, t: 'lines' },
    { k: 'qiCore', label: 'Qi Core', list: 'dl-items' },
    { k: 'martialArts.core', label: 'Core arts', t: 'lines' }, { k: 'martialArts.special', label: 'Special arts', t: 'lines' },
    { k: 'martialArts.forbidden', label: 'Forbidden/Heavenly arts', t: 'lines' }, { k: 'martialArts.generic', label: 'Generic arts', t: 'lines' },
    { k: 'notes', label: 'Staff notes', t: 'textarea' },
  ];
  const vals = clone(c);
  vals.qiCore = refLabel(c.qiCore) || '';
  const f = buildForm(fields, vals);

  // inventory editor
  const inv = Object.entries(c.inventory).map(([id, q]) => ({ id, q }));
  const invWrap = h('div');
  const drawInv = () => invWrap.replaceChildren(
    h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, inv.map((row, idx) => h('tr', {},
      h('td', {}, `${rarity(D.items.find((i) => i.id === row.id)?.rarity).emoji} ${itemName(row.id)}`),
      h('td', {}, (() => { const n = h('input', { type: 'number', min: 0, value: row.q, style: 'width:90px' }); n.oninput = () => (row.q = Number(n.value)); return n; })()),
      h('td', {}, h('button', { class: 'btn small danger', onclick: () => { inv.splice(idx, 1); drawInv(); } }, 'Remove')),
    ))))),
    (() => {
      const sel = h('input', { list: 'dl-items', placeholder: 'Item name…' });
      const qty = h('input', { type: 'number', value: 1, style: 'width:90px' });
      return h('div', { class: 'toolbar', style: 'margin-top:8px' }, sel, qty, h('button', { class: 'btn small', onclick: () => {
        const it = D.items.find((i) => i.name.toLowerCase() === sel.value.trim().toLowerCase());
        if (!it) return toast('Pick an existing item name.', true);
        const ex = inv.find((r) => r.id === it.id);
        if (ex) ex.q += Number(qty.value) || 1; else inv.push({ id: it.id, q: Number(qty.value) || 1 });
        drawInv();
      } }, 'Add item'));
    })(),
  );
  drawInv();

  // quick grant + live sheet
  const gMode = h('select', {}, h('option', { value: 'give' }, 'Give'), h('option', { value: 'take' }, 'Take'));
  const gType = h('select');
  const gStat = h('select', { class: 'hidden' }, ['strength', 'endurance', 'mobility', 'qi'].map((k) => h('option', { value: k }, k)));
  const gRefund = h('label', { class: 'field check hidden' }, h('input', { type: 'checkbox' }), h('span', {}, 'Refund as unspent points'));
  const fillTypes = () => {
    const list = gMode.value === 'take' ? D.constants.TAKE_TYPES : D.constants.GRANT_TYPES;
    gType.replaceChildren(...list.map((t) => h('option', { value: t }, t)));
    syncStat();
  };
  const syncStat = () => { const st = gMode.value === 'take' && gType.value === 'stat'; gStat.classList.toggle('hidden', !st); gRefund.classList.toggle('hidden', !st); };
  gMode.onchange = fillTypes;
  gType.onchange = syncStat;
  fillTypes();
  const gAmt = h('input', { type: 'number', value: 25, style: 'width:100px' });
  const gReason = h('input', { placeholder: 'Reason (changelog)' });
  const sheet = h('div', { class: 'sheet-preview muted' }, 'Loading sheet…');
  const loadSheet = () => api(`/characters/${c.id}/sheet`).then((r) => {
    const sh = r.sheet;
    sheet.replaceChildren(h('div', { class: 'kv' },
      h('span', { class: 'muted' }, 'Title'), h('span', {}, r.title),
      h('span', { class: 'muted' }, 'Effective'), h('span', {}, `STR ${fmt(sh.effStats.strength)} · END ${fmt(sh.effStats.endurance)} · MOB ${fmt(sh.effStats.mobility)} · Qi ${fmt(sh.effStats.qi)} · Qi Bars ${fmt(sh.qiBars.total)}`),
      h('span', { class: 'muted' }, 'Caps'), h('span', {}, `Stats soft ${fmt(sh.caps.soft)} / hard ${fmt(sh.caps.hard)} · Qi soft ${fmt(sh.caps.softQi)} / hard ${fmt(sh.caps.hardQi)}`),
      h('span', { class: 'muted' }, 'Absorption'), h('span', {}, `General ${fmt(sh.absorption.general)}% · ${Object.entries(sh.absorption.byElement).map(([k, v]) => `${k} ${v}%`).join(', ') || 'no affinities'}`),
      h('span', { class: 'muted' }, 'Effects'), h('span', {}, plain([...sh.capLines, ...sh.drawbacks, ...sh.notes, ...sh.scriptErrors.map((e) => `⚠️ ${e}`)].join('\n')) || '—'),
    ));
  }).catch((e) => sheet.replaceChildren(e.message));
  loadSheet();

  const body = h('div', { style: 'display:grid;gap:14px' },
    h('div', { class: 'card' }, h('h3', {}, 'Live sheet'), sheet),
    h('div', { class: 'card' }, h('h3', {}, 'Give / take'), h('div', { class: 'toolbar' }, gMode, gType, gStat, gAmt, gReason, gRefund, h('button', { class: 'btn primary small', onclick: run(async () => {
      const r = await api(`/characters/${c.id}/grant`, { method: 'POST', body: { mode: gMode.value, type: gType.value, stat: gStat.value, refund: gRefund.querySelector('input').checked, amount: Number(gAmt.value), reason: gReason.value } });
      toast(plain(r.lines.join(' ')));
      Object.assign(c, r.character);
      closeModal();
      await load();
      editCharacter(D.characters.find((x) => x.id === c.id));
    }) }, 'Apply')), h('small', { class: 'muted' }, 'all = stat points (no Qi) · allqi = flexible points (Qi ok) · qi = Breakthrough (resets impurity) · stat = lower a stat (refund = respec). Soft/hard caps are applied automatically. Dashboard changes do not post a report in Discord.')),
    f.el,
    h('h4', { class: 'section' }, 'Inventory'),
    invWrap,
  );
  openModal(`${c.name}`, body, [
    h('button', { class: 'btn danger left', onclick: run(async () => {
      if (!confirm(`Delete ${c.name} permanently? (Retiring keeps the record.)`)) return;
      await api(`/characters/${c.id}`, { method: 'DELETE' }); closeModal(); toast('Deleted.'); await refresh();
    }) }, 'Delete'),
    h('button', { class: 'btn', onclick: closeModal }, 'Close'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const data = f.read();
      data.realm = Number(data.realm);
      data.inventory = Object.fromEntries(inv.filter((r) => r.q > 0).map((r) => [r.id, r.q]));
      await api(`/characters/${c.id}`, { method: 'PUT', body: data });
      toast('Character saved.');
      closeModal();
      await refresh();
    }) }, 'Save'),
  ]);
}

// ----- applications -----
VIEWS.applications = () => {
  const pending = D.applications.filter((a) => a.status === 'pending');
  const done = D.applications.filter((a) => a.status !== 'pending').slice(0, 100);
  const act = (a, action) => run(async () => {
    const body = action === 'reject' ? { reason: prompt('Reason (optional):') || '' } : {};
    await api(`/applications/${a.id}/${action}`, { method: 'POST', body });
    toast(action === 'approve' ? 'Approved — remember to give Discord roles (or approve from Discord to do it automatically).' : 'Rejected.');
    await refresh();
  });
  return [
    h('p', { class: 'muted' }, 'Players submit with /submit. Approving in Discord (the buttons in the submissions channel, or /approve) also gives the base roles automatically.'),
    h('div', { class: 'card' }, h('h3', {}, `Pending (${pending.length})`), table([
      ['Character', (a) => h('strong', {}, a.name)], ['Player', (a) => `${a.userTag} (${a.userId})`], ['Sect', (a) => a.sect || 'Rogue'],
      ['Document', (a) => h('a', { href: a.docLink, target: '_blank', rel: 'noopener' }, 'open')], ['Submitted', (a) => new Date(a.createdAt).toLocaleString()],
      ['', (a) => h('div', { class: 'toolbar' }, h('button', { class: 'btn small primary', onclick: act(a, 'approve') }, 'Approve'), h('button', { class: 'btn small danger', onclick: act(a, 'reject') }, 'Reject'))],
    ], pending)),
    h('div', { class: 'card' }, h('h3', {}, 'History'), table([
      ['Character', (a) => a.name], ['Player', (a) => a.userTag], ['Status', (a) => h('span', { class: `pill ${a.status === 'approved' ? 'ok' : 'bad'}` }, a.status)],
      ['By', (a) => a.decidedBy || '—'], ['When', (a) => (a.decidedAt ? new Date(a.decidedAt).toLocaleString() : '—')], ['Reason', (a) => a.reason || ''],
    ], done)),
  ];
};

// ----- items -----
VIEWS.items = () => {
  const search = h('input', { placeholder: 'Search items…', class: 'grow' });
  const fr = h('select', {}, h('option', { value: '' }, 'All rarities'), D.rarities.map((r) => h('option', { value: r.name }, r.name)));
  const ft = h('select', {}, h('option', { value: '' }, 'All types'), D.constants.ITEM_TYPES.map((t) => h('option', { value: t }, t)));
  const wrap = h('div');
  const draw = () => {
    const q = search.value.toLowerCase();
    const list = D.items.filter((i) => (!fr.value || i.rarity === fr.value) && (!ft.value || i.type === ft.value) && (!q || `${i.name} ${i.description}`.toLowerCase().includes(q)));
    wrap.replaceChildren(table([
      ['', (i) => i.emoji || rarity(i.rarity).emoji],
      ['Name', (i) => h('strong', {}, i.name)],
      ['Rarity', (i) => h('span', {}, h('span', { class: 'dot', style: `background:${rarity(i.rarity).color}` }), i.rarity)],
      ['Type', (i) => i.type + (i.type === 'manual' ? ` · ${i.manual.category}` : '')],
      ['Drop pool', (i) => (i.inDropPool ? `✓ weight ${i.dropWeight}` : '—')],
      ['Shop', (i) => (i.shop.enabled ? `${fmt(i.shop.price)}${i.shop.stock >= 0 ? ` (${i.shop.stock})` : ''}` : '—')],
      ['Tradeable', (i) => (i.tradeable ? '✓' : '✗')],
      ['Custom code', (i) => (i.scriptId ? D.scripts.find((s) => s.id === i.scriptId)?.name || i.scriptId : '')],
    ], list, (i) => editItem(i)));
  };
  [search, fr, ft].forEach((x) => (x.oninput = draw));
  draw();
  return [
    h('div', { class: 'toolbar' }, search, fr, ft, h('span', { class: 'grow' }), h('span', { class: 'muted' }, `${D.items.length} / ${D.settings.maxItems} items`), h('button', { class: 'btn primary', onclick: () => editItem(null) }, '+ New item')),
    wrap,
  ];
};

function editItem(item, prefill = null) {
  const isNew = !item;
  const it = item ? clone(item) : prefill ? clone(prefill) : { name: '', rarity: D.rarities[0]?.name, type: 'pill', description: '', tradeable: true, inDropPool: true, dropWeight: 1, shop: { enabled: false, price: 0, stock: -1 }, manual: { category: 'generic' }, cultivation: { absorption: 0, affinities: {} }, pill: { yieldType: 'qi', yieldAmount: 0, impurity: 0, element: '', breakthroughBonus: 0 }, poison: { tier: 1, impurity: 10 }, purification: { tier: 1 }, scriptId: '' };
  const els = ['', ...D.settings.elements];
  const tiers = [[1, 'T1 (Earthly)'], [2, 'T2 (Heavenly)'], [3, 'T3 (Immortal)']];
  const fields = [
    { k: 'name', label: 'Name' },
    { k: 'rarity', label: 'Rarity', t: 'select', opts: () => D.rarities.map((r) => r.name) },
    { k: 'type', label: 'Type', t: 'select', opts: D.constants.ITEM_TYPES },
    { k: 'emoji', label: 'Emoji (optional)' },
    { k: 'description', label: 'Description (Discord markdown works)', t: 'textarea', rows: 8 },
    { section: 'Drops & trading' },
    { k: 'inDropPool', label: 'Can drop from drop rolls', t: 'check' },
    { k: 'dropWeight', label: 'Drop weight inside its rarity', t: 'number', help: '2 = twice as likely as a weight-1 item of the same rarity' },
    { k: 'tradeable', label: 'Tradeable between players', t: 'check' },
    { k: 'shop.enabled', label: 'Sold in the shop', t: 'check' },
    { k: 'shop.price', label: `Shop price (${D.settings.currencyName})`, t: 'number' },
    { k: 'shop.stock', label: 'Shop stock (-1 = unlimited)', t: 'number' },
    { k: 'sellPrice', label: 'Shop buy-back price (empty = auto)', t: 'number', nullable: true },
    { section: 'Martial art manual', show: ['manual'] },
    { k: 'manual.category', label: 'Category', t: 'select', opts: [['generic', 'Generic (limit 3)'], ['core', 'Core (limit 1)'], ['special', 'Special (limit 1)'], ['forbidden', 'Forbidden/Heavenly (limit 1)']], show: ['manual'] },
    { k: 'manual.replacesCore', label: 'Replaces the Core art when learned', t: 'check', show: ['manual'] },
    { k: 'manual.shareable', label: 'Can be shared', t: 'check', show: ['manual'] },
    { k: 'manual.shareLimit', label: 'Share limit (0 = none)', t: 'number', show: ['manual'] },
    { section: 'Absorption (cultivation method / qi core)', show: ['cultivation', 'core'] },
    { k: 'cultivation.absorption', label: 'General absorption rate %', t: 'number', show: ['cultivation', 'core'], help: 'Applies to every pill' },
    ...D.settings.elements.map((e) => ({ k: `cultivation.affinities.${e}`, label: `${e} affinity %`, t: 'number', show: ['cultivation', 'core'], help: 'negative = worse with that element' })),
    { section: 'Pill / elixir', show: ['pill'] },
    { k: 'pill.yieldType', label: 'Yield gives', t: 'select', opts: [['none', 'Nothing'], ['qi', 'Qi'], ['strength', 'Strength'], ['endurance', 'Endurance'], ['mobility', 'Mobility'], ['points', 'Stat points to spend (no Qi)'], ['flex', 'Flexible points (Qi ok)']], show: ['pill'] },
    { k: 'pill.yieldAmount', label: 'Yield amount (raw)', t: 'number', show: ['pill'], help: 'Multiplied by the consumer\'s absorption: raw × (1 + rate%)' },
    { k: 'pill.impurity', label: 'Impurity', t: 'number', show: ['pill'] },
    { k: 'pill.element', label: 'Affinity / element', t: 'select', opts: els.map((e) => [e, e || 'None']), show: ['pill'] },
    { k: 'pill.breakthroughBonus', label: 'Realm Breakthrough bonus %', t: 'number', show: ['pill'], help: 'Stored until the next Realm Breakthrough attempt (/menu → Realm)' },
    { section: 'Poison', show: ['poison'] },
    { k: 'poison.tier', label: 'Tier', t: 'select', opts: tiers, show: ['poison'] },
    { k: 'poison.element', label: 'Affinity', t: 'select', opts: els.map((e) => [e, e || 'None']), show: ['poison'] },
    { k: 'poison.impurity', label: 'Impurity on hit', t: 'number', show: ['poison'] },
    { k: 'poison.repeatable', label: '[REPEATABLE] — stacks', t: 'check', show: ['poison'] },
    { k: 'poison.triggersBurst', label: 'Can trigger the 100-impurity meridian burst', t: 'check', show: ['poison'] },
    { k: 'poison.debuff', label: 'Debuff (numerical)', wide: true, show: ['poison'] },
    { k: 'poison.gimmick', label: 'Gimmick (narrative)', wide: true, show: ['poison'] },
    { k: 'poison.activation', label: 'Activation (break skin / consumed / inhaled…)', wide: true, show: ['poison'] },
    { section: 'Purification', show: ['purification'] },
    { k: 'purification.tier', label: 'Tier', t: 'select', opts: tiers, show: ['purification'] },
    { k: 'purification.element', label: 'Affinity', t: 'select', opts: els.map((e) => [e, e || 'None']), show: ['purification'] },
    { k: 'purification.gimmick', label: 'Gimmick', wide: true, show: ['purification'] },
    { section: 'Custom code' },
    { k: 'scriptId', label: 'Script (runs while known / when consumed)', t: 'select', opts: () => [['', '— none —'], ...D.scripts.map((s) => [s.id, s.name])], help: 'Write scripts in the Custom Code tab' },
  ];
  const f = buildForm(fields, it);
  const typeSel = f.input('type');
  f.filter(it.type);
  typeSel.onchange = () => f.filter(typeSel.value);
  openModal(isNew ? 'New item' : `Edit ${item.name}`, f.el, [
    !isNew ? h('button', { class: 'btn danger left', onclick: run(async () => {
      if (!confirm(`Delete ${item.name}? It is removed from every inventory.`)) return;
      await api(`/items/${item.id}`, { method: 'DELETE' }); closeModal(); toast('Item deleted.'); await refresh();
    }) }, 'Delete') : null,
    !isNew ? h('button', { class: 'btn', onclick: () => { const copy = clone(item); delete copy.id; copy.name += ' (copy)'; closeModal(); editItem(null, copy); } }, 'Duplicate') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const data = deepMerge(it, f.read());
      data.cultivation.affinities = f.read().cultivation?.affinities || {};
      if (isNew) await api('/items', { method: 'POST', body: data });
      else await api(`/items/${item.id}`, { method: 'PUT', body: data });
      toast('Item saved.');
      closeModal();
      await refresh();
    }) }, 'Save'),
  ].filter(Boolean));
}
// ----- drop rates -----
VIEWS.drops = () => {
  const rows = clone(D.rarities);
  const wrap = h('div');
  const draw = () => {
    const total = rows.reduce((a, r) => a + (Number(r.chance) || 0), 0) || 1;
    wrap.replaceChildren(table([
      ['Name', (r) => inputFor(r, 'name')],
      ['Chance (weight)', (r) => inputFor(r, 'chance', 'number')],
      ['= %', (r) => `${fmt(((Number(r.chance) || 0) / total) * 100)}%`],
      ['Color', (r) => inputFor(r, 'color', 'color')],
      ['Emoji', (r) => inputFor(r, 'emoji')],
      ['Items in pool', (r) => D.items.filter((i) => i.inDropPool && i.rarity === r.name).length],
      ['', (r) => h('button', { class: 'btn small danger', onclick: () => { rows.splice(rows.indexOf(r), 1); draw(); } }, 'Remove')],
    ], rows));
  };
  const inputFor = (r, k, type = 'text') => { const i = h('input', { type, value: r[k] ?? '' }); i.onchange = () => { r[k] = type === 'number' ? Number(i.value) : i.value; draw(); }; return i; };
  draw();
  return [
    h('p', { class: 'muted' }, 'Each drop roll (/menu → Inventory → Roll) first picks a rarity with these chances (they don\'t need to add up to 100 — they are weights), then picks an item of that rarity from the drop pool by its drop weight. Sect bonuses (Sects tab) are added on top.'),
    wrap,
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn', onclick: () => { rows.push({ name: 'New rarity', chance: 0, color: '#888888', emoji: '⬜' }); draw(); } }, '+ Add rarity'),
      h('button', { class: 'btn primary', onclick: run(async () => { await api('/rarities', { method: 'PUT', body: rows }); toast('Drop rates saved.'); await refresh(); }) }, 'Save drop rates'),
    ),
  ];
};

// ----- realms -----
VIEWS.realms = () => {
  const rows = clone(D.realms);
  const wrap = h('div');
  const cols = [['name', 'Realm', 'text'], ['qiBars', 'Qi Bars', 'number'], ['reqStats', 'Req. stats', 'number'], ['reqQi', 'Req. Qi', 'number'], ['softCapStats', 'Soft cap stats', 'number'], ['softCapQi', 'Soft cap Qi', 'number'], ['hardCapStats', 'Hard cap stats', 'number'], ['hardCapQi', 'Hard cap Qi', 'number'], ['breakthroughChance', 'Breakthrough %', 'number']];
  const draw = () => wrap.replaceChildren(table([
    ['#', (r) => rows.indexOf(r) + 1],
    ...cols.map(([k, label, type]) => [label, (r) => { const i = h('input', { type, value: r[k] ?? '', placeholder: type === 'number' ? '∞' : '', style: k === 'name' ? 'min-width:150px' : '' }); i.onchange = () => (r[k] = type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value); return i; }]),
    ['', (r) => h('div', { class: 'toolbar' },
      h('button', { class: 'btn small', onclick: () => { const i = rows.indexOf(r); if (i > 0) { rows.splice(i, 1); rows.splice(i - 1, 0, r); draw(); } } }, '↑'),
      h('button', { class: 'btn small', onclick: () => { const i = rows.indexOf(r); if (i < rows.length - 1) { rows.splice(i, 1); rows.splice(i + 1, 0, r); draw(); } } }, '↓'),
      h('button', { class: 'btn small danger', onclick: () => { rows.splice(rows.indexOf(r), 1); draw(); } }, '✕'))],
  ], rows));
  draw();
  return [
    h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0' }, 'Req. = needed to ENTER this realm. "Stats" = Strength + Endurance + Mobility (Qi never counts). Soft cap: past it, stat points are worth ', h('b', {}, `${D.settings.softCapGainMultiplier * 100}%`), ' (Qi is not reduced). Hard cap: nothing more can be gained until a Realm Breakthrough. Breakthrough % = chance to advance to the NEXT realm. Leave a cap empty for no cap.')),
    wrap,
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn', onclick: () => { rows.push({ name: 'New realm', qiBars: 0, reqStats: 0, reqQi: 0, softCapStats: null, softCapQi: null, hardCapStats: null, hardCapQi: null, breakthroughChance: 0 }); draw(); } }, '+ Add realm'),
      h('button', { class: 'btn primary', onclick: run(async () => { await api('/realms', { method: 'PUT', body: rows }); toast('Realms saved.'); await refresh(); }) }, 'Save realms'),
    ),
    qiBarCard(),
  ];
};

function qiBarCard() {
  const rows = clone(D.settings.qiBarBonuses || []);
  const wrap = h('div');
  const draw = () => wrap.replaceChildren(table([
    ['Qi at least', (r) => { const i = h('input', { type: 'number', value: r.minQi }); i.onchange = () => (r.minQi = Number(i.value)); return i; }],
    ['Extra Qi Bars', (r) => { const i = h('input', { type: 'number', step: '0.5', value: r.bars }); i.onchange = () => (r.bars = Number(i.value)); return i; }],
    ['', (r) => h('button', { class: 'btn small danger', onclick: () => { rows.splice(rows.indexOf(r), 1); draw(); } }, '✕')],
  ], rows));
  draw();
  return h('div', { class: 'card' }, h('h3', {}, 'Qi Bars from Qi'),
    h('p', { class: 'muted' }, "Added on top of the realm's Qi Bars. The highest row the character's Qi reaches is used (e.g. 150 Qi → +2)."),
    wrap,
    h('div', { class: 'toolbar', style: 'margin-top:8px' },
      h('button', { class: 'btn', onclick: () => { rows.push({ minQi: 0, bars: 0 }); draw(); } }, '+ Add row'),
      h('button', { class: 'btn primary', onclick: run(async () => { await api('/settings', { method: 'PUT', body: { ...D.settings, qiBarBonuses: rows } }); toast('Qi Bar table saved.'); await refresh(); }) }, 'Save Qi Bar table')));
}

// ----- sects -----
VIEWS.sects = () => {
  const rows = clone(D.sects);
  const wrap = h('div', { style: 'display:grid;gap:12px' });
  const forms = [];
  const draw = () => {
    forms.length = 0;
    wrap.replaceChildren(...rows.map((s, idx) => {
      const f = buildForm([
        { k: 'name', label: 'Name' }, { k: 'titleName', label: 'Title form ("Mount Hua\'s …")' },
        { k: 'alignment', label: 'Alignment', t: 'select', opts: ['Orthodox', 'Unorthodox', 'Neutral', 'Other'] },
        { k: 'playable', label: 'Players can choose it', t: 'check' },
        { k: 'roleId', label: 'Discord role given on approval', t: 'role' },
        ...D.rarities.map((r) => ({ k: `rarityBonus.${r.name}`, label: `${r.name} drop bonus (weight)`, t: 'number' })),
        { k: 'description', label: 'Description', t: 'textarea', rows: 2 },
      ], s);
      forms.push([s, f]);
      return h('div', { class: 'card' }, f.el, h('div', { class: 'toolbar', style: 'margin-top:8px' }, h('button', { class: 'btn small danger', onclick: () => { collect(); rows.splice(idx, 1); draw(); } }, 'Remove sect')));
    }));
  };
  const collect = () => forms.forEach(([s, f]) => Object.assign(s, deepMerge(s, f.read())));
  draw();
  return [
    h('p', { class: 'muted' }, 'Sects/clans players can pick. Non-playable ones (Beggar Sect, Moyong, Demon Cult) can only be set by staff. Drop bonuses are added to the rarity weights on drop rolls (e.g. The 72 Strongholds).'),
    wrap,
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn', onclick: () => { collect(); rows.push({ name: 'New sect', titleName: '', alignment: 'Orthodox', playable: true, roleId: '', rarityBonus: {}, description: '' }); draw(); } }, '+ Add sect'),
      h('button', { class: 'btn primary', onclick: run(async () => { collect(); await api('/sects', { method: 'PUT', body: rows }); toast('Sects saved.'); await refresh(); }) }, 'Save sects'),
    ),
  ];
};

// ----- traits -----
VIEWS.traits = () => {
  const card = (t) => {
    const f = buildForm([
      { k: 'name', label: 'Name' },
      { k: 'scriptId', label: 'Custom code', t: 'select', opts: () => [['', '— none —'], ...D.scripts.map((s) => [s.id, s.name])] },
      { k: 'description', label: 'Description', t: 'textarea', rows: 2 },
    ], t || {});
    return h('div', { class: 'card' }, f.el, h('div', { class: 'toolbar', style: 'margin-top:8px' },
      t ? h('button', { class: 'btn small danger', onclick: run(async () => { if (!confirm(`Delete ${t.name}?`)) return; await api(`/traits/${t.id}`, { method: 'DELETE' }); toast('Deleted.'); await refresh(); }) }, 'Delete') : null,
      h('button', { class: 'btn small primary', onclick: run(async () => {
        if (t) await api(`/traits/${t.id}`, { method: 'PUT', body: f.read() });
        else await api('/traits', { method: 'POST', body: f.read() });
        toast('Trait saved.'); await refresh();
      }) }, t ? 'Save' : 'Create trait'),
    ));
  };
  return [
    h('p', { class: 'muted' }, 'Special traits that can be put on stat sheets. Attach custom code for traits with real mechanics (e.g. No Meridians, Heavenly Martial Meridian).'),
    ...D.traits.map(card),
    h('h4', { class: 'section' }, 'New trait'),
    card(null),
  ];
};

// ----- scripts -----
VIEWS.scripts = () => {
  let sel = D.scripts[0] || null;
  const listEl = h('div', { class: 'list' });
  const editor = h('div', { style: 'display:grid;gap:12px' });
  const drawList = () => listEl.replaceChildren(
    h('button', { class: 'btn primary small', onclick: () => { sel = null; drawList(); drawEditor(); } }, '+ New script'),
    ...D.scripts.map((s) => h('button', { class: `btn small ${sel && sel.id === s.id ? 'active' : ''}`, onclick: () => { sel = s; drawList(); drawEditor(); } }, `${s.enabled === false ? '⏸ ' : ''}${s.name}`)),
  );
  const drawEditor = () => {
    const template = D.scripts.find((s) => s.id === 'template');
    const s = sel || { name: '', description: '', code: template ? template.code : 'hooks.effects = (ctx, fx) => fx;\n', enabled: true };
    const f = buildForm([
      { k: 'name', label: 'Name' }, { k: 'description', label: 'Description' }, { k: 'enabled', label: 'Enabled', t: 'check' },
      { k: 'code', label: 'Code (JavaScript)', t: 'code' },
    ], s);
    const usedBy = sel ? [...D.items.filter((i) => i.scriptId === sel.id).map((i) => `item: ${i.name}`), ...D.traits.filter((t) => t.scriptId === sel.id).map((t) => `trait: ${t.name}`)] : [];
    const charSel = h('select', {}, h('option', { value: '' }, 'Test dummy (40/40/40, 30 Qi)'), D.characters.map((c) => h('option', { value: c.id }, c.name)));
    const imp = h('input', { type: 'number', placeholder: 'impurity (blank = keep)', style: 'width:180px' });
    const amt = h('input', { type: 'number', value: 10, style: 'width:120px', title: 'Qi / yield amount' });
    const out = h('pre', { class: 'out' }, 'Run a test to see what each hook returns.');
    editor.replaceChildren(
      h('div', { class: 'card' }, f.el, h('p', { class: 'muted small' }, usedBy.length ? `Used by: ${usedBy.join(', ')}` : 'Not attached to anything yet — pick it in an item (Items tab) or a trait (Special Traits tab).'),
        h('div', { class: 'toolbar' },
          sel ? h('button', { class: 'btn danger', onclick: run(async () => { if (!confirm(`Delete script ${sel.name}?`)) return; await api(`/scripts/${sel.id}`, { method: 'DELETE' }); toast('Deleted.'); sel = null; await load(); render(); }) }, 'Delete') : null,
          h('span', { class: 'grow' }),
          h('button', { class: 'btn primary', onclick: run(async () => {
            const body = f.read();
            const r = sel ? await api(`/scripts/${sel.id}`, { method: 'PUT', body }) : await api('/scripts', { method: 'POST', body });
            toast('Script saved.');
            await load();
            sel = D.scripts.find((x) => x.id === r.script.id);
            drawList(); drawEditor();
          }) }, 'Save'),
        )),
      h('div', { class: 'card' }, h('h3', {}, 'Test'), h('div', { class: 'toolbar' }, charSel, imp, amt, h('button', { class: 'btn', onclick: run(async () => {
        const r = await api('/scripts/test', { method: 'POST', body: { code: f.read().code, characterId: charSel.value, impurity: imp.value, amount: amt.value } });
        out.textContent = r.error || JSON.stringify(r, null, 2);
      }) }, '▶ Run test')), out),
      h('div', { class: 'card' }, h('h3', {}, 'How custom code works'), h('div', { class: 'muted', html: `
        <p>Attach a script to an <b>item</b> (cultivation method, qi core, martial art manual, pill) or a <b>special trait</b>. It runs automatically for every character who knows that item / has that trait — no need to edit the bot's files.</p>
        <p>A script sets functions on <code>hooks</code>:</p>
        <ul>
          <li><code>hooks.effects(ctx, fx)</code> — change the sheet: <code>fx.qiRegenDisabled</code>, <code>fx.statMultiplier</code> (0.75 = −25%), <code>fx.preventMeridianBurst</code>, <code>fx.tempStats.endurance += 3</code>, <code>fx.tempQiBars</code>, <code>fx.qiBarBonus</code>, <code>fx.qiBarsOverride</code>, <code>fx.notes.push('text')</code>. Return <code>fx</code>.</li>
          <li><code>hooks.qiGain(ctx, amount)</code> — return how much Qi is really gained.</li>
          <li><code>hooks.breakthroughChance(ctx, chance)</code> — return the Realm Breakthrough %.</li>
          <li><code>hooks.consume(ctx, result)</code> — change a pill's result (<code>yieldAmount</code>, <code>impurity</code>, <code>notes</code>…). <code>ctx.extra.item</code> is the pill.</li>
        </ul>
        <p><code>ctx.character</code> has name, sect, realm, stats, impurity, traits, cultivationMethods, qiCore, martialArts. Scripts get a copy of the data, run with a short time limit, and cannot change the database directly. See the "Template (copy me)" and "Three Hearts Cultivation" scripts for examples.</p>` })),
    );
  };
  drawList();
  drawEditor();
  return h('div', { class: 'split' }, listEl, editor);
};

// ----- settings -----
VIEWS.settings = () => {
  const s = D.settings;
  const f = buildForm([
    { section: 'General' },
    { k: 'currencyName', label: 'Currency name' }, { k: 'currencyEmoji', label: 'Currency emoji' },
    { k: 'maxItems', label: 'Max items', t: 'number' }, { k: 'maxCharactersPerUser', label: 'Max active characters per player (0 = unlimited)', t: 'number' },
    { section: 'New characters' },
    { k: 'startingFlexPoints', label: 'Starting points (usable in any stat, incl. Qi)', t: 'number' },
    { k: 'startingNyang', label: 'Starting Nyang', t: 'number' }, { k: 'startingRolls', label: 'Starting drop rolls', t: 'number' },
    { k: 'defaultCultivationMethods', label: 'Default cultivation methods', t: 'lines' }, { k: 'defaultQiCore', label: 'Default Qi Core', list: 'dl-items' },
    { section: 'Stats' },
    { k: 'maxSingleStatPercent', label: 'Max % of stat points in one stat', t: 'number' },
    { k: 'allocationWindowMinutes', label: 'Stat typing window (minutes)', t: 'number' },
    { k: 'softCapGainMultiplier', label: 'Gain multiplier past soft cap (0.5 = −50%)', t: 'number', step: '0.05' },
    { k: 'discardPointsPastHardCap', label: 'Discard rewards that go past the hard cap', t: 'check' },
    { k: 'maxCultivationMethods', label: 'Max cultivation methods', t: 'number' },
    { k: 'martialArtLimits.generic', label: 'Generic art limit', t: 'number' }, { k: 'martialArtLimits.core', label: 'Core art limit', t: 'number' },
    { k: 'martialArtLimits.special', label: 'Special art limit', t: 'number' }, { k: 'martialArtLimits.forbidden', label: 'Forbidden/Heavenly limit', t: 'number' },
    { section: 'Impurity' },
    { k: 'impurity.noRegenAt', label: 'No Qi regen at', t: 'number' }, { k: 'impurity.debuffAt', label: 'Stat debuff at', t: 'number' },
    { k: 'impurity.debuffPercent', label: 'Stat debuff %', t: 'number' }, { k: 'impurity.burstAt', label: 'Meridian burst at', t: 'number' },
    { k: 'impurity.burstPercent', label: 'Burst permanent loss %', t: 'number' },
    { k: 'monthlyImpurityReset', label: 'Reset everyone\'s impurity monthly', t: 'check' },
    { k: 'staffQiResetsImpurity', label: 'Receiving Qi from staff/points resets impurity', t: 'check' },
    { k: 'pillQiResetsImpurity', label: 'Qi from pills also resets impurity', t: 'check' },
    { section: 'Realm Breakthrough' },
    { k: 'breakthroughCooldownHours', label: 'Cooldown between attempts (hours)', t: 'number' },
    { k: 'breakthroughFailureImpurity', label: 'Impurity gained on failure', t: 'number' },
    { section: 'Economy' },
    { k: 'shopSellbackPercent', label: 'Shop buy-back % of price', t: 'number' }, { k: 'marketFeePercent', label: 'Player market fee %', t: 'number' },
    { k: 'tradeExpiryMinutes', label: 'Trade offers expire after (min)', t: 'number' },
    { section: 'Discord' },
    { k: 'channels.submissions', label: 'Character submissions channel', t: 'channel' },
    { k: 'channels.progress', label: 'Progress submissions channel', t: 'channel' },
    { k: 'channels.announcements', label: 'Announcements channel (approvals, reports, breakthroughs)', t: 'channel' },
    { k: 'channels.log', label: 'Changelog channel (optional)', t: 'channel' },
    { k: 'staffRoleIds', label: 'Staff roles', t: 'roles', help: 'Used by commands set to "Staff" (Commands tab). Members with Manage Server always count as staff. Ctrl/Cmd-click for several.' },
    { k: 'approvedRoleIds', label: 'Roles given when a character is approved', t: 'roles' },
    { section: 'Elements & titles' },
    { k: 'elements', label: 'Elements / affinities', t: 'lines', rows: 7 },
    { k: 'titles.prefixes', label: 'Prefixes', t: 'lines', rows: 8 }, { k: 'titles.stems', label: 'Stems', t: 'lines', rows: 8 }, { k: 'titles.suffixes', label: 'Suffixes', t: 'lines', rows: 8 },
    { section: '/menu' },
    { k: 'menuPublicByDefault', label: '/menu is visible to everyone by default (otherwise only to the player)', t: 'check' },
    { k: 'announceRolls', label: 'Announce drop rolls in the channel', t: 'check' },
    { k: 'announceCrafting', label: 'Announce crafting results', t: 'check' },
    { k: 'announceBreakthroughs', label: 'Announce Realm Breakthroughs', t: 'check' },
    { section: 'Backups & log' },
    { k: 'autoBackupHours', label: 'Automatic backup every (hours, 0 = off)', t: 'number' }, { k: 'maxBackups', label: 'Backups to keep', t: 'number' },
    { k: 'maxChangelog', label: 'Changelog entries to keep', t: 'number' },
  ], s);
  return [
    !DISCORD.guilds.length ? h('div', { class: 'card warn' }, 'The bot is offline, so channels/roles are shown as plain IDs. Start the bot to pick them from lists.') : null,
    h('div', { class: 'card' }, f.el),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: run(async () => { await api('/settings', { method: 'PUT', body: deepMerge(s, f.read()) }); toast('Settings saved.'); await refresh(); }) }, 'Save settings')),
  ].filter(Boolean);
};

// ----- changelog -----
VIEWS.changelog = () => {
  const q = h('input', { placeholder: 'Filter by person, action, character…' });
  const wrap = h('div');
  let offset = 0;
  const limit = 100;
  const pager = h('div', { class: 'toolbar' });
  const draw = run(async () => {
    const r = await api(`/changelog?q=${encodeURIComponent(q.value)}&offset=${offset}&limit=${limit}`);
    wrap.replaceChildren(table([
      ['When', (e) => new Date(e.at).toLocaleString()],
      ['Who', (e) => h('span', {}, e.actor, ' ', h('span', { class: 'pill' }, e.source))],
      ['Action', (e) => h('code', {}, e.action)],
      ['Details', (e) => e.details],
    ], r.entries));
    pager.replaceChildren(
      h('button', { class: 'btn small', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - limit); draw(); } }, '← Newer'),
      h('span', { class: 'muted' }, `${r.total ? offset + 1 : 0}–${Math.min(offset + limit, r.total)} of ${r.total}`),
      h('button', { class: 'btn small', disabled: offset + limit >= r.total, onclick: () => { offset += limit; draw(); } }, 'Older →'),
    );
  });
  let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => { offset = 0; draw(); }, 250); };
  draw();
  return [h('div', { class: 'toolbar' }, q), wrap, pager];
};

// ----- backups -----
VIEWS.backups = async () => {
  const { backups } = await api('/backups');
  const label = h('input', { placeholder: 'Backup label (optional)' });
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  return [
    h('div', { class: 'card' }, h('h3', {}, 'Save & load'), h('p', { class: 'muted' }, 'Everything saves automatically a second after each change. "Reload" throws away unsaved memory and loads what is in storage.'), h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', onclick: run(async () => { await api('/save', { method: 'POST', body: {} }); toast('Saved.'); await refresh(); }) }, '💾 Save now'),
      h('button', { class: 'btn', onclick: run(async () => { if (!confirm('Reload everything from storage?')) return; await api('/reload', { method: 'POST', body: {} }); toast('Reloaded.'); await refresh(); }) }, '↻ Reload from storage'),
      h('a', { class: 'btn', href: '/api/export' }, '⬇️ Download full save (.json)'),
    )),
    h('div', { class: 'card' }, h('h3', {}, 'Import a save'), h('p', { class: 'muted' }, 'Replaces ALL game data with the uploaded file (dashboard logins are kept). A safety backup is made first.'), h('div', { class: 'toolbar' }, file,
      h('button', { class: 'btn danger', onclick: run(async () => {
        const fl = file.files[0];
        if (!fl) return toast('Choose a .json file first.', true);
        const data = JSON.parse(await fl.text());
        if (!confirm(`Import ${fl.name}? This replaces all current data.`)) return;
        await api('/import', { method: 'POST', body: data });
        toast('Imported.'); await refresh();
      }) }, 'Import'))),
    h('div', { class: 'card' }, h('h3', {}, 'Backups'), h('div', { class: 'toolbar', style: 'margin-bottom:10px' }, label, h('button', { class: 'btn primary', onclick: run(async () => { await api('/backups', { method: 'POST', body: { label: label.value } }); toast('Backup created.'); render(); }) }, '+ Create backup')),
      table([
        ['Label', (b) => h('span', {}, b.label, b.auto ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'auto') : null)],
        ['Created', (b) => new Date(b.createdAt).toLocaleString()], ['By', (b) => b.createdBy], ['Size', (b) => `${Math.round(b.size / 1024)} KB`],
        ['', (b) => h('div', { class: 'toolbar' },
          h('a', { class: 'btn small', href: `/api/backups/${b.id}/download` }, 'Download'),
          h('button', { class: 'btn small', onclick: run(async () => { if (!confirm(`Restore "${b.label}"? Current data is replaced (a safety backup is made first).`)) return; await api(`/backups/${b.id}/restore`, { method: 'POST', body: {} }); toast('Restored.'); await refresh(); }) }, 'Restore'),
          h('button', { class: 'btn small danger', onclick: run(async () => { if (!confirm('Delete this backup?')) return; await api(`/backups/${b.id}`, { method: 'DELETE' }); toast('Deleted.'); render(); }) }, 'Delete'))],
      ], backups)),
  ];
};

// ----- accounts -----
VIEWS.accounts = async () => {
  const { accounts } = await api('/accounts');
  const cur = h('input', { type: 'password', placeholder: 'Current password' });
  const nw = h('input', { type: 'password', placeholder: 'New password (6+ characters)' });
  const nu = h('input', { placeholder: 'Username' });
  const np = h('input', { type: 'password', placeholder: 'Password' });
  const na = h('input', { type: 'checkbox' });
  return [
    h('div', { class: 'card' }, h('h3', {}, 'Change my password'), h('div', { class: 'toolbar' }, cur, nw, h('button', { class: 'btn primary', onclick: run(async () => { await api('/accounts/password', { method: 'PUT', body: { current: cur.value, next: nw.value } }); toast('Password changed.'); cur.value = nw.value = ''; await refresh(); }) }, 'Change'))),
    h('div', { class: 'card' }, h('h3', {}, 'Dashboard accounts'), h('p', { class: 'muted' }, 'Give each editor their own login so the changelog shows who changed what. Anyone who knows a username + password can edit everything; admins can also restore backups and manage accounts.'),
      table([
        ['Username', (a) => a.username], ['Role', (a) => (a.isAdmin ? 'admin' : 'editor')], ['Created', (a) => new Date(a.createdAt).toLocaleDateString()],
        ['', (a) => (D.me.isAdmin ? h('div', { class: 'toolbar' },
          h('button', { class: 'btn small', onclick: run(async () => { const p = prompt(`New password for ${a.username}:`); if (!p) return; await api('/accounts/password', { method: 'PUT', body: { accountId: a.id, next: p } }); toast('Password reset.'); }) }, 'Reset password'),
          h('button', { class: 'btn small danger', onclick: run(async () => { if (!confirm(`Delete ${a.username}?`)) return; await api(`/accounts/${a.id}`, { method: 'DELETE' }); toast('Deleted.'); render(); }) }, 'Delete')) : '')],
      ], accounts),
      D.me.isAdmin ? h('div', { class: 'toolbar', style: 'margin-top:10px' }, nu, np, h('label', { class: 'field check' }, na, h('span', {}, 'Admin')), h('button', { class: 'btn primary', onclick: run(async () => { await api('/accounts', { method: 'POST', body: { username: nu.value, password: np.value, isAdmin: na.checked } }); toast('Account created.'); render(); }) }, '+ Add account')) : null),
  ];
};

// ----- crafting recipes -----
VIEWS.recipes = () => {
  const name = (id) => D.items.find((i) => i.id === id)?.name || '⚠️ missing item';
  const list = (rows) => rows.map((x) => `${x.qty}× ${name(x.itemId)}`).join(' + ');
  return [
    h('div', { class: 'toolbar' }, h('p', { class: 'muted grow', style: 'margin:0' }, 'Players craft from /menu → ⚒️ Craft. A recipe turns input items (+ optional Nyang) into output items.'), h('button', { class: 'btn primary', onclick: () => editRecipe(null) }, '+ New recipe')),
    table([
      ['Recipe', (r) => h('strong', {}, r.name)],
      ['Needs', (r) => `${list(r.inputs)}${r.nyangCost ? ` + ${fmt(r.nyangCost)} ${D.settings.currencyName}` : ''}`],
      ['Makes', (r) => list(r.outputs)],
      ['Chance', (r) => `${fmt(r.successChance)}%`],
      ['Min realm', (r) => D.realms[r.minRealm]?.name || '—'],
      ['On', (r) => (r.enabled ? '✓' : '✗')],
    ], D.recipes, editRecipe),
  ];
};

function rowsEditor(rows, label) {
  const wrap = h('div');
  const draw = () => wrap.replaceChildren(
    h('div', { class: 'section', style: 'font-size:16px' }, label),
    ...rows.map((r, idx) => {
      const it = h('input', { list: 'dl-items', placeholder: 'Item name', value: D.items.find((i) => i.id === r.itemId)?.name || '' });
      it.onchange = () => { const f = D.items.find((i) => i.name.toLowerCase() === it.value.trim().toLowerCase()); r.itemId = f ? f.id : ''; it.style.borderColor = f ? '' : 'var(--bad)'; };
      const q = h('input', { type: 'number', min: 1, value: r.qty, style: 'max-width:90px' });
      q.oninput = () => (r.qty = Number(q.value));
      return h('div', { class: 'toolbar', style: 'margin:4px 0' }, it, q, h('button', { class: 'btn small danger', onclick: () => { rows.splice(idx, 1); draw(); } }, '✕'));
    }),
    h('button', { class: 'btn small', onclick: () => { rows.push({ itemId: '', qty: 1 }); draw(); } }, '+ Add item'),
  );
  draw();
  return wrap;
}

function editRecipe(r) {
  const isNew = !r;
  const v = r ? clone(r) : { name: '', description: '', inputs: [{ itemId: '', qty: 1 }], outputs: [{ itemId: '', qty: 1 }], nyangCost: 0, successChance: 100, consumeOnFail: true, minRealm: 0, enabled: true };
  const f = buildForm([
    { k: 'name', label: 'Recipe name' },
    { k: 'nyangCost', label: `Cost in ${D.settings.currencyName}`, t: 'number' },
    { k: 'successChance', label: 'Success chance %', t: 'number' },
    { k: 'minRealm', label: 'Minimum realm', t: 'select', opts: () => D.realms.map((x, i) => [i, x.name]) },
    { k: 'consumeOnFail', label: 'Materials are lost on failure', t: 'check' },
    { k: 'enabled', label: 'Enabled', t: 'check' },
    { k: 'description', label: 'Description (shown to players)', t: 'textarea', rows: 2 },
  ], v);
  openModal(isNew ? 'New recipe' : `Edit ${r.name}`, h('div', { style: 'display:grid;gap:10px' }, f.el, rowsEditor(v.inputs, 'Needs (inputs)'), rowsEditor(v.outputs, 'Makes (outputs)')), [
    !isNew ? h('button', { class: 'btn danger left', onclick: run(async () => { if (!confirm(`Delete ${r.name}?`)) return; await api(`/recipes/${r.id}`, { method: 'DELETE' }); closeModal(); toast('Deleted.'); await refresh(); }) }, 'Delete') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const body = { ...v, ...f.read(), inputs: v.inputs.filter((x) => x.itemId), outputs: v.outputs.filter((x) => x.itemId) };
      body.minRealm = Number(body.minRealm);
      if (isNew) await api('/recipes', { method: 'POST', body }); else await api(`/recipes/${r.id}`, { method: 'PUT', body });
      closeModal(); toast('Recipe saved.'); await refresh();
    }) }, 'Save'),
  ].filter(Boolean));
}

// ----- stat comparison tables -----
VIEWS.combat = () => {
  const data = clone(D.combat);
  const tableFor = (key, title, help) => {
    const rows = data[key];
    const wrap = h('div');
    const inp = (r, k, type = 'text', w) => { const i = h('input', { type, value: r[k] ?? '', style: w ? `max-width:${w}px` : '' }); i.onchange = () => (r[k] = type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value); return i; };
    const draw = () => wrap.replaceChildren(table([
      ['From diff.', (r) => inp(r, 'min', 'number', 80)],
      ['Shown as', (r) => inp(r, 'label', 'text', 120)],
      ['Tier', (r) => inp(r, 'tier', 'text', 60)],
      ['Name', (r) => inp(r, 'name', 'text', 160)],
      ['Needs +Realm Tiers', (r) => inp(r, 'reqRT', 'number', 70)],
      ['What happens', (r) => { const t = h('textarea', { rows: 2, style: 'min-width:280px' }); t.value = r.desc || ''; t.onchange = () => (r.desc = t.value); return t; }],
      ['', (r) => h('button', { class: 'btn small danger', onclick: () => { rows.splice(rows.indexOf(r), 1); draw(); } }, '✕')],
    ], rows));
    draw();
    return h('div', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted' }, help), wrap,
      h('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => { rows.push({ min: 0, label: '', tier: '', name: 'New row', reqRT: 0, desc: '' }); draw(); } }, '+ Add row'));
  };
  const notes = buildForm([{ k: 'damageNote', label: 'Damage note (hit areas)', t: 'textarea', rows: 2 }, { k: 'clashNote', label: 'Clash note', t: 'textarea', rows: 2 }], data);
  return [
    h('p', { class: 'muted' }, 'Used by /compare. Each row starts at "From diff." (empty = everything below the next row). A row that needs Realm Tiers is only reached when the attacker / faster character is that many realms above the other; otherwise the result is capped one row lower.'),
    tableFor('damage', 'Damage — Strength vs Endurance', 'Difference = attacker Strength − defender Endurance.'),
    tableFor('clash', 'Clash — Strength vs Strength', 'Difference = how much stronger the winner is.'),
    tableFor('mobility', 'Speed — Mobility vs Mobility', 'Difference = how much faster the faster character is.'),
    h('div', { class: 'card' }, notes.el),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: run(async () => { await api('/combat', { method: 'PUT', body: { ...data, ...notes.read() } }); toast('Comparison tables saved.'); await refresh(); }) }, 'Save tables')),
  ];
};

// ----- commands & permissions -----
VIEWS.commands = async () => {
  const { commands, online } = await api('/commands');
  const accessOpts = (sub) => [...(sub ? [['inherit', 'Same as the command']] : []), ['everyone', 'Everyone'], ['staff', 'Staff (staff roles + Manage Server)'], ['roles', 'Only these roles']];
  const ruleForm = (key, rule, sub) => {
    const f = buildForm([
      { k: 'enabled', label: 'Enabled', t: 'check' },
      ...(!sub ? [{ k: 'hidden', label: 'Hide from members without Manage Server in Discord', t: 'check' }] : []),
      { k: 'access', label: 'Who can use it', t: 'select', opts: accessOpts(sub) },
      { k: 'roleIds', label: 'Roles (when "Only these roles")', t: 'roles' },
      { k: 'channelIds', label: 'Only in these channels (none selected = anywhere)', t: 'channels' },
      { k: 'description', label: 'Custom description in Discord (empty = default)' },
    ], rule);
    const save = h('button', { class: 'btn primary small', onclick: run(async () => {
      const r = await api(`/commands/${encodeURIComponent(key)}`, { method: 'PUT', body: f.read() });
      toast(r.synced ? `/${key} saved and updated in Discord.` : `/${key} saved. Discord updates when the bot is online (or press Sync).`);
    }) }, 'Save');
    return h('div', { style: 'display:grid;gap:8px' }, f.el, h('div', {}, save));
  };
  return [
    h('div', { class: 'card' }, h('div', { class: 'toolbar' },
      h('p', { class: 'muted grow', style: 'margin:0' }, 'Every slash command the bot has. Choose who can use each one, limit it to channels, rename its description or turn it off. Members with Manage Server can always use enabled commands. "Hide" removes it from the slash menu of members without Manage Server (Discord also lets you allow extra roles per command in Server Settings → Integrations).'),
      h('button', { class: 'btn', disabled: !online, onclick: run(async () => { const r = await api('/commands/sync', { method: 'POST', body: {} }); toast(`Synced ${r.count} commands with Discord.`); }) }, '↻ Sync to Discord'))),
    ...commands.map((c) => {
      const badge = c.rule.enabled === false ? 'off' : c.rule.access === 'everyone' ? 'everyone' : c.rule.access === 'staff' ? 'staff' : 'roles';
      return h('details', { class: 'card cmd' },
        h('summary', {},
          h('strong', { class: 'cmd-name' }, `/${c.name}`),
          h('span', { class: `pill ${badge === 'off' ? 'bad' : ''}` }, badge),
          c.rule.hidden ? h('span', { class: 'pill' }, 'hidden') : null,
          c.rule.channelIds?.length ? h('span', { class: 'pill' }, `${c.rule.channelIds.length} channel(s)`) : null,
          h('span', { class: 'muted cmd-desc' }, c.rule.description || c.description),
          c.subcommands.length ? h('span', { class: 'muted small' }, c.subcommands.map((x) => x.name).join(' · ')) : null),
        h('div', { style: 'padding-top:10px' },
          c.options.length ? h('p', { class: 'muted small', style: 'margin:0 0 8px' }, `Options: ${c.options.map((o) => `${o.name}${o.required ? '' : ' (optional)'}`).join(', ')}`) : null,
          ruleForm(c.name, c.rule, false),
          ...c.subcommands.map((x) => h('div', { class: 'card', style: 'margin-top:8px;background:var(--panel-2)' },
            h('strong', {}, `/${c.name} ${x.name}`), h('p', { class: 'muted small', style: 'margin:2px 0 8px' }, `${x.description}${x.options.length ? ` · ${x.options.map((o) => `${o.name}${o.required ? '' : '?'}`).join(', ')}` : ''}`),
            ruleForm(`${c.name} ${x.name}`, c.subRules[x.name], true)))));
    }),
  ];
};

// ----- messages (templates) with a Discord-style preview -----
const SAMPLE = {
  player: '<@100000000000000001>', staff: '<@100000000000000002>', character: 'Chung Myung', summary: '+50 Stat Points', details: 'Spendable on Strength / Endurance / Mobility.',
  reason: 'Won the duel at Mount Hua', sect: 'Mount Hua Sect', document: 'https://docs.google.com/…', id: 'A1b2c3d4', points: '50', roles: 'Roles: <@&100000000000000003>',
  link: 'https://discord.com/channels/…', breakthrough: '🌟 **Breakthrough requested (Qi)**', from: '1st Rate', realm: 'Expert', chance: '75', roll: '42.1',
  item: 'Plum Blossom Sword Manual', rarity: 'Heavenly', emoji: '🟦', description: 'A sword style known for fluid and precise attacks.', recipe: 'Qi Gathering Pill', items: '1× Qi Gathering Pill',
};
const MENTION_NAMES = { '100000000000000001': 'PlayerOne', '100000000000000002': 'StaffMember', '100000000000000003': 'Disciple' };

function mdToHtml(text) {
  if (!text) return '';
  const blocks = [];
  let s = esc(text);
  s = s.replace(/```(?:[a-z]*\n)?([\s\S]*?)```/g, (m, code) => { blocks.push(`<pre class="d-code">${code}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, (m, code) => { blocks.push(`<code class="d-inline">${code}</code>`); return `\u0000${blocks.length - 1}\u0000`; });
  const inline = (t) => t
    .replace(/&lt;@&amp;(\d+)&gt;/g, (m, id) => `<span class="d-mention">@${MENTION_NAMES[id] || 'role'}</span>`)
    .replace(/&lt;@!?(\d+)&gt;/g, (m, id) => `<span class="d-mention">@${MENTION_NAMES[id] || 'user'}</span>`)
    .replace(/&lt;#(\d+)&gt;/g, () => '<span class="d-mention">#channel</span>')
    .replace(/&lt;t:(\d+)(?::\w)?&gt;/g, (m, ts) => `<span class="d-inline">${new Date(Number(ts) * 1000).toLocaleString()}</span>`)
    .replace(/&lt;a?:(\w+):(\d+)&gt;/g, (m, n, id) => `<img class="d-emoji" alt=":${n}:" src="https://cdn.discordapp.com/emojis/${id}.webp?size=44">`)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="d-spoiler">$1</span>');
  const out = s.split('\n').map((line) => {
    let m;
    if ((m = line.match(/^### (.*)/))) return `<div class="d-h3">${inline(m[1])}</div>`;
    if ((m = line.match(/^## (.*)/))) return `<div class="d-h2">${inline(m[1])}</div>`;
    if ((m = line.match(/^# (.*)/))) return `<div class="d-h1">${inline(m[1])}</div>`;
    if ((m = line.match(/^-# (.*)/))) return `<div class="d-sub">${inline(m[1])}</div>`;
    if ((m = line.match(/^&gt; (.*)/))) return `<div class="d-quote">${inline(m[1])}</div>`;
    if ((m = line.match(/^\s*[-*] (.*)/))) return `<div class="d-li">• ${inline(m[1])}</div>`;
    return `<div class="d-line">${inline(line) || '&nbsp;'}</div>`;
  }).join('');
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
}

function fillSample(str, vars = SAMPLE) {
  return String(str ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function discordPreview(msg, { sample = true } = {}) {
  const F = (t) => (sample ? fillSample(t) : t || '');
  const bot = DISCORD.botUser || { name: 'Jianghu Bot', avatar: '' };
  const colorHex = (c) => (c === undefined || c === null || c === '' ? '#1e1f22' : `#${Number(c).toString(16).padStart(6, '0')}`);
  const embeds = (msg.embeds || []).map((e) => {
    const fields = e.fields || [];
    return h('div', { class: 'd-embed', style: `border-left-color:${colorHex(e.color)}` },
      h('div', { class: 'd-embed-body' },
        e.author?.name ? h('div', { class: 'd-author' }, e.author.icon_url ? h('img', { src: F(e.author.icon_url) }) : null, F(e.author.name)) : null,
        e.title ? h('div', { class: 'd-title', html: mdToHtml(F(e.title)) }) : null,
        e.description ? h('div', { class: 'd-desc', html: mdToHtml(F(e.description)) }) : null,
        fields.length ? h('div', { class: 'd-fields' }, fields.map((fl) => h('div', { class: `d-field${fl.inline ? ' inline' : ''}` }, h('div', { class: 'd-fname', html: mdToHtml(F(fl.name)) }), h('div', { class: 'd-fvalue', html: mdToHtml(F(fl.value)) })))) : null,
        e.image?.url ? h('img', { class: 'd-image', src: F(e.image.url) }) : null,
        (e.footer?.text || e.timestamp) ? h('div', { class: 'd-footer' }, e.footer?.icon_url ? h('img', { src: F(e.footer.icon_url) }) : null, [F(e.footer?.text), e.timestamp ? new Date().toLocaleString() : ''].filter(Boolean).join(' • ')) : null),
      e.thumbnail?.url ? h('img', { class: 'd-thumb', src: F(e.thumbnail.url) }) : null);
  });
  return h('div', { class: 'discord' }, h('div', { class: 'd-msg' },
    bot.avatar ? h('img', { class: 'd-avatar', src: bot.avatar }) : h('div', { class: 'd-avatar' }, '☯'),
    h('div', { class: 'd-main' },
      h('div', { class: 'd-head' }, h('span', { class: 'd-name' }, bot.name), h('span', { class: 'd-app' }, 'APP'), h('span', { class: 'd-time' }, 'Today at 12:00')),
      msg.content ? h('div', { class: 'd-content', html: mdToHtml(F(msg.content)) }) : null,
      ...embeds)));
}

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

VIEWS.messages = async () => {
  const { templates } = await api('/templates');
  let sel = templates[0];
  const listEl = h('div', { class: 'list' });
  const editorEl = h('div', { class: 'msg-editor' });
  const drawList = () => listEl.replaceChildren(...templates.map((t) => h('button', { class: `btn small ${sel.key === t.key ? 'active' : ''}`, onclick: () => { sel = t; drawList(); drawEditor(); } }, `${t.custom ? '✎ ' : ''}${t.label}`)));
  const drawEditor = () => {
    const msg = clone(sel.value);
    if (!msg.embeds) msg.embeds = [];
    const preview = h('div');
    const refresh = () => preview.replaceChildren(discordPreview(msg));
    let lastFocus = null;
    const bind = (el, get, set) => { el.value = get() ?? ''; el.oninput = () => { set(el.value); refresh(); }; el.onfocus = () => (lastFocus = el); return el; };
    const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
    const text = (obj, key, ph) => bind(h('input', { placeholder: ph || '' }), () => obj[key], (v) => (obj[key] = v || undefined));
    const area = (obj, key, rows = 3) => bind(h('textarea', { rows }), () => obj[key], (v) => (obj[key] = v || undefined));
    const embedsWrap = h('div', { style: 'display:grid;gap:12px' });
    const drawEmbeds = () => embedsWrap.replaceChildren(...msg.embeds.map((e, idx) => {
      e.author = e.author || {}; e.footer = e.footer || {}; e.thumbnail = e.thumbnail || {}; e.image = e.image || {}; e.fields = e.fields || [];
      const color = h('input', { type: 'color', style: 'width:48px;flex:none', value: e.color !== undefined && e.color !== null ? `#${Number(e.color).toString(16).padStart(6, '0')}` : '#1e1f22' });
      color.oninput = () => { e.color = parseInt(color.value.slice(1), 16); refresh(); };
      const fieldsWrap = h('div');
      const drawFields = () => fieldsWrap.replaceChildren(...e.fields.map((fl, fi) => {
        const inl = h('input', { type: 'checkbox' });
        inl.checked = !!fl.inline;
        inl.onchange = () => { fl.inline = inl.checked; refresh(); };
        return h('div', { class: 'toolbar', style: 'margin:4px 0' }, text(fl, 'name', 'Field name'), text(fl, 'value', 'Field value'), h('label', { class: 'field check' }, inl, h('span', {}, 'inline')), h('button', { class: 'btn small danger', onclick: () => { e.fields.splice(fi, 1); drawFields(); refresh(); } }, '✕'));
      }), h('button', { class: 'btn small', onclick: () => { e.fields.push({ name: 'Name', value: 'Value', inline: false }); drawFields(); refresh(); } }, '+ Field'));
      drawFields();
      return h('div', { class: 'card', style: 'background:var(--panel-2)' },
        h('div', { class: 'toolbar' }, h('strong', { class: 'grow' }, `Embed ${idx + 1}`), h('label', { class: 'field check' }, color, h('span', {}, 'Color')),
          h('button', { class: 'btn small danger', onclick: () => { msg.embeds.splice(idx, 1); drawEmbeds(); refresh(); } }, 'Remove embed')),
        h('div', { class: 'form' },
          field('Author', text(e.author, 'name')), field('Author icon URL', text(e.author, 'icon_url')),
          field('Title', text(e, 'title')), field('Title link (URL)', text(e, 'url')),
          h('label', { class: 'field wide' }, h('span', {}, 'Description'), area(e, 'description', 6)),
          field('Thumbnail URL', text(e.thumbnail, 'url')), field('Image URL', text(e.image, 'url')),
          field('Footer', text(e.footer, 'text')), field('Footer icon URL', text(e.footer, 'icon_url')),
          (() => { const ts = h('input', { type: 'checkbox' }); ts.checked = !!e.timestamp; ts.onchange = () => { e.timestamp = ts.checked ? new Date().toISOString() : undefined; refresh(); }; return h('label', { class: 'field check' }, ts, h('span', {}, 'Timestamp')); })()),
        h('div', { class: 'section', style: 'font-size:15px' }, 'Fields'), fieldsWrap);
    }), msg.embeds.length < 10 ? h('button', { class: 'btn small', onclick: () => { msg.embeds.push({ description: 'New embed' }); drawEmbeds(); refresh(); } }, '+ Add embed') : null);
    drawEmbeds();
    const chips = h('div', { class: 'toolbar' }, h('span', { class: 'muted small' }, 'Placeholders (click to insert):'), ...sel.placeholders.map((p) => h('button', { class: 'btn small', onclick: () => {
      const el = lastFocus;
      const token = `{${p}}`;
      if (!el) { navigator.clipboard?.writeText(token); return toast(`Copied ${token}`); }
      const at = el.selectionStart ?? el.value.length;
      el.value = el.value.slice(0, at) + token + el.value.slice(el.selectionEnd ?? at);
      el.dispatchEvent(new Event('input'));
      el.focus();
    } }, `{${p}}`)));
    const clean = () => {
      const strip = (o) => { for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) { strip(o[k]); if (!Object.keys(o[k]).length) delete o[k]; } else if (o[k] === undefined || o[k] === '') delete o[k]; } return o; };
      return { content: msg.content || '', embeds: msg.embeds.map((e) => strip(clone({ ...e, fields: (e.fields || []).filter((f) => f.name || f.value) }))).map((e) => { if (e.fields && !e.fields.length) delete e.fields; return e; }) };
    };
    const testCh = h('select', {}, h('option', { value: '' }, 'Send a test to…'), channels().map(([id, n]) => h('option', { value: id }, n)));
    editorEl.replaceChildren(
      h('div', { style: 'display:grid;gap:12px;align-content:start' },
        h('div', { class: 'card' },
          h('h3', {}, sel.label), chips,
          h('label', { class: 'field', style: 'margin-top:8px' }, h('span', {}, 'Message text (outside the embed)'), area(msg, 'content', 2)),
        ),
        embedsWrap,
        h('div', { class: 'toolbar' },
          h('button', { class: 'btn primary', onclick: run(async () => { const r = await api(`/templates/${sel.key}`, { method: 'PUT', body: clean() }); sel.value = r.value; sel.custom = true; toast('Message saved.'); drawList(); }) }, 'Save'),
          h('button', { class: 'btn', onclick: run(async () => { if (!confirm('Reset this message to the default look?')) return; const r = await api(`/templates/${sel.key}`, { method: 'DELETE' }); sel.value = r.value; sel.custom = false; drawList(); drawEditor(); toast('Reset to default.'); }) }, 'Reset to default'),
          h('button', { class: 'btn', onclick: () => window.open(`https://discohook.app/?data=${b64url(JSON.stringify({ messages: [{ data: clean() }] }))}`, '_blank', 'noopener') }, 'Open in Discohook ↗'),
          h('button', { class: 'btn', onclick: () => {
            const ta = h('textarea', { rows: 14, class: 'code', placeholder: 'Paste JSON from Discohook (JSON Data Editor) or a message/embed JSON' });
            openModal('Import from Discohook', h('div', { style: 'display:grid;gap:8px' }, h('p', { class: 'muted' }, 'In Discohook open the "JSON Data Editor", copy everything and paste it here. Your {placeholders} are kept.'), ta), [
              h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
              h('button', { class: 'btn primary', onclick: run(async () => {
                let obj = JSON.parse(ta.value);
                if (Array.isArray(obj.messages)) obj = obj.messages[0]?.data || {};
                if (!obj.embeds && (obj.title || obj.description)) obj = { embeds: [obj] };
                sel.value = { content: obj.content || '', embeds: obj.embeds || [] };
                closeModal(); drawEditor(); toast('Imported — press Save to keep it.');
              }) }, 'Import'),
            ]);
          } }, 'Import JSON'),
          h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(JSON.stringify(clean(), null, 2)); toast('JSON copied.'); } }, 'Copy JSON'),
          channels().length ? testCh : null,
          channels().length ? h('button', { class: 'btn', onclick: run(async () => { if (!testCh.value) return toast('Pick a channel first.', true); await api(`/templates/${sel.key}/test`, { method: 'POST', body: { channelId: testCh.value, vars: SAMPLE } }); toast('Test sent (save first to send your latest changes).'); }) }, 'Send test') : null,
        )),
      h('div', { class: 'preview-col' }, h('div', { class: 'muted small', style: 'margin-bottom:6px' }, 'Live preview (sample values)'), preview),
    );
    refresh();
  };
  drawList();
  drawEditor();
  return [
    h('p', { class: 'muted' }, 'Every announcement the bot posts. Edit the look here (or design it in Discohook and import the JSON). {placeholders} are filled in when the bot sends the message.'),
    h('div', { class: 'split' }, listEl, editorEl),
  ];
};

// ---------- boot ----------
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('#loginError').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
    await start();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});
$('#logout').onclick = async () => { await api('/logout', { method: 'POST', body: {} }).catch(() => {}); showLogin(); };
$('#menuBtn').onclick = () => $('.sidebar').classList.toggle('open');
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== current) { current = id; render(); } });

async function start() {
  try {
    await load();
  } catch {
    return showLogin();
  }
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  render();
}
start();
