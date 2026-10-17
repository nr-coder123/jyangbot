'use strict';
/* World tabs: Map, Economy, Events, Politics, War, Balance. Uses helpers from app.js (h, api, run, toast, openModal, buildForm, table, VIEWS, D, DISCORD). */

let WD = null; // /api/world
let MAPDATA = null; // /api/world/mapdata (geometry, cached by the browser)
let WSEL = null; // selected region key on the map
const SVGNS = 'http://www.w3.org/2000/svg';

TABS.splice(TABS.findIndex(([id]) => id === 'sects') + 1, 0, ['map', '🗺️ Map'], ['economy', 'Economy'], ['events', 'Events'], ['politics', 'Politics'], ['war', 'War'], ['balance', 'Balance']);

async function loadWorld() {
  const [w, m] = await Promise.all([api('/world'), MAPDATA ? Promise.resolve(MAPDATA) : api('/world/mapdata')]);
  WD = w; MAPDATA = m;
  if (!MAPDATA.byKey) {
    MAPDATA.byKey = new Map();
    for (const p of MAPDATA.provinces) MAPDATA.byKey.set(p.key, { ...p, kind: 'province' });
    for (const p of MAPDATA.prefectures) MAPDATA.byKey.set(p.key, { ...p, kind: 'prefecture' });
  }
  return WD;
}
const W_ = () => WD.world;
const geoOf = (key) => MAPDATA?.byKey.get(key);
const provinceOf = (key) => (key && key.includes('/') ? key.split('/')[0] : key);
const isMarket = (key) => !key.includes('/') || !!W_().regions[key]?.special;
const marketOf = (key) => (key && isMarket(key) ? key : provinceOf(key));
function rname(key, lang = W_().map.lang || 'english') {
  const r = W_().regions[key]; const g = geoOf(key);
  if (r?.displayName) return r.displayName;
  if (!g) return key || '—';
  if (lang === 'hanzi') return g.hanzi;
  if (lang === 'both') return `${g.name} ${g.hanzi}`;
  if (lang === 'historical' && g.historicalName) return g.historicalName;
  return g.name;
}
const rfull = (key) => (key && key.includes('/') ? `${rname(key)}, ${rname(provinceOf(key))}` : rname(key));
const fac = (id) => W_().factions.find((f) => f.id === id);
const facName = (id) => (id ? `${fac(id)?.icon || ''} ${fac(id)?.name || id}`.trim() : '—');
const goodOf = (id) => W_().goods.find((g) => g.id === id);
const charName = (id) => WD.characters.find((c) => c.id === id)?.name || id || '—';
const relKey = (a, b) => [a, b].sort().join('|');
const relOf = (a, b) => (a === b ? { value: 100 } : W_().relations[relKey(a, b)] || { value: 0, war: false });
const calText = () => WD.calendar?.text || '';
const fmtN = (n) => (n === null || n === undefined ? '—' : Math.round(Number(n)).toLocaleString('en-US'));
function sv(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
function sparkSvg(values, w = 120, hgt = 28, color = '#d9a441') {
  if (!values?.length) return h('span', { class: 'muted small' }, '—');
  const lo = Math.min(...values); const hi = Math.max(...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${hgt - 2 - ((v - lo) / Math.max(1e-9, hi - lo)) * (hgt - 4)}`).join(' ');
  const el = sv('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}` }, sv('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 1.6 }));
  return el;
}
function jsonField(label, value, rows = 6, help = '') {
  const t = h('textarea', { rows, class: 'code', spellcheck: 'false' });
  t.value = JSON.stringify(value ?? {}, null, 2);
  const wrap = h('label', { class: 'field wide' }, h('span', {}, label), t, help ? h('small', {}, help) : null);
  wrap.read = () => { try { return t.value.trim() ? JSON.parse(t.value) : {}; } catch (e) { throw new Error(`${label}: ${e.message}`); } };
  return wrap;
}
function select(opts, value, attrs = {}) {
  const s = h('select', attrs, opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v }, l); }));
  s.value = value ?? '';
  return s;
}
const factionOpts = (none = '— none —') => [['', none], ...W_().factions.map((f) => [f.id, `${f.icon || ''} ${f.name}${f.active ? '' : ' (inactive)'}`])];
const marketOpts = () => WD.markets.map((k) => [k, rfull(k)]).sort((a, b) => a[1].localeCompare(b[1]));
const scriptOpts = () => [['', '— none —'], ...WD.scripts.map((s) => [s.id, s.name])];
const categoryOpts = () => [['', '— none —'], ...DISCORD.guilds.flatMap((g) => (g.categories || []).map((c) => [c.id, `📁 ${c.name}`]))];
function ramp(t, reverse = false) {
  t = Math.max(0, Math.min(1, t)); if (reverse) t = 1 - t;
  const stops = [[0, [178, 52, 40]], [0.5, [214, 170, 70]], [1, [76, 150, 86]]];
  let a = stops[0]; let b = stops[2];
  for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
  const c = a[1].map((x, i) => Math.round(x + (b[1][i] - x) * u));
  return `rgb(${c.join(',')})`;
}
function priceRamp(idx) {
  const t = Math.max(-1, Math.min(1, Math.log2(Math.max(0.01, idx)) / 1.5));
  if (t >= 0) { const c = [240 - 50 * t, 225 - 160 * t, 200 - 160 * t]; return `rgb(${c.map(Math.round).join(',')})`; }
  const u = -t; const c = [240 - 170 * u, 225 - 90 * u, 200 + 30 * u]; return `rgb(${c.map(Math.round).join(',')})`;
}
const TERRAIN_COLOR = { plains: '#d9c98f', hills: '#b9b07a', mountains: '#9c8a6b', river: '#9fc0b5', coast: '#c7d6c0', forest: '#7f9e6a', steppe: '#cdbf7a', desert: '#e3cf9b', highland: '#b7a993' };

// ════════════════════════════════════════ MAP ════════════════════════════════════════
const MAPV = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('jh_map') || '{}'); } catch {}
  return {
    tool: 'inspect', overlay: saved.overlay || 'political', good: saved.good || 'grain', relF: saved.relF || '', paintF: '',
    layers: { prefectures: true, rivers: true, mountains: true, labels: true, landmarks: true, armies: true, caravans: true, events: true, routes: false, hq: true, ...(saved.layers || {}) },
    vb: { x: 0, y: 0, w: 1400, h: 920 }, frontier: null,
  };
})();
const saveMapPrefs = () => { try { localStorage.setItem('jh_map', JSON.stringify({ overlay: MAPV.overlay, good: MAPV.good, relF: MAPV.relF, layers: MAPV.layers })); } catch {} };

function regionValue(key) {
  const w = W_();
  const r = w.regions[marketOf(key)];
  if (!r) return null;
  switch (MAPV.overlay) {
    case 'prosperity': return ramp(r.prosperity / 100);
    case 'security': return ramp(r.security / 100);
    case 'unrest': return ramp(r.unrest / 100, true);
    case 'corruption': return ramp(r.corruption / 60, true);
    case 'food': return ramp(((r.last?.food ?? 1) - 0.5) / 0.5);
    case 'price': { const g = goodOf(MAPV.good); return g ? priceRamp((r.prices?.[g.id] || g.basePrice) / g.basePrice) : '#ccc'; }
    case 'terrain': return TERRAIN_COLOR[r.terrain] || '#ccc';
    case 'events': return w.activeEvents.some((e) => e.regions.includes(marketOf(key))) ? '#e08a3c' : '#d8ccb0';
    case 'relations': {
      const ctl = w.regions[key]?.controller ?? r.controller;
      if (!MAPV.relF || !ctl) return '#d8ccb0';
      if (ctl === MAPV.relF) return '#d9a441';
      const rel = relOf(MAPV.relF, ctl);
      return rel.war ? '#7a1010' : ramp((rel.value + 100) / 200);
    }
    default: {
      const own = w.regions[key]?.controller;
      const ctl = own !== undefined && own !== null ? own : w.regions[provinceOf(key)]?.controller;
      const f = fac(ctl);
      return f ? f.color : '#d8ccb0';
    }
  }
}

function legendFor() {
  const o = MAPV.overlay;
  const box = (c, t) => h('span', { class: 'small', style: 'display:inline-flex;align-items:center;gap:4px;margin-right:10px' }, h('span', { class: 'dot', style: `background:${c}` }), t);
  if (o === 'political') {
    const used = new Set(Object.values(W_().regions).map((r) => r.controller).filter(Boolean));
    return W_().factions.filter((f) => used.has(f.id)).map((f) => box(f.color, f.name));
  }
  if (o === 'price') return [box(priceRamp(0.4), 'cheap'), box(priceRamp(1), 'base price'), box(priceRamp(2.5), 'dear')];
  if (o === 'terrain') return Object.entries(TERRAIN_COLOR).map(([k, c]) => box(c, W_().terrains[k]?.label || k));
  if (o === 'relations') return [box('#d9a441', 'this faction'), box(ramp(1), 'friendly'), box(ramp(0.5), 'neutral'), box(ramp(0), 'hostile'), box('#7a1010', 'at war')];
  if (o === 'events') return [box('#e08a3c', 'event in progress')];
  const rev = o === 'unrest' || o === 'corruption';
  return [box(ramp(rev ? 1 : 0), 'low'), box(ramp(0.5), 'mid'), box(ramp(rev ? 0 : 1), 'high')];
}

function buildMapSvg(onPick) {
  const w = W_();
  const vb = MAPV.vb;
  const svg = sv('svg', { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, class: 'wmap', xmlns: SVGNS, 'font-family': 'Cormorant Garamond, Georgia, serif' });
  const defs = sv('defs', {},
    sv('filter', { id: 'parchment', x: '0', y: '0', width: '100%', height: '100%' },
      sv('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.035', numOctaves: '3', result: 'n' }),
      sv('feDiffuseLighting', { in: 'n', 'lighting-color': '#f4ecd8', surfaceScale: '1', result: 'l' }, sv('feDistantLight', { azimuth: '45', elevation: '60' })),
      sv('feBlend', { mode: 'multiply', in: 'SourceGraphic', in2: 'l', result: 'b' }),
      sv('feComposite', { operator: 'in', in: 'b', in2: 'SourceGraphic' })),
    sv('pattern', { id: 'hatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#300', 'stroke-width': 3, opacity: 0.45 })),
    sv('pattern', { id: 'waves', width: 40, height: 20, patternUnits: 'userSpaceOnUse' }, sv('path', { d: 'M0 10 Q10 5 20 10 T40 10', fill: 'none', stroke: '#3c6e8f', 'stroke-width': 0.8, opacity: 0.25 })),
    sv('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, sv('path', { d: 'M0 0 L10 5 L0 10 z', fill: '#7a1010' })),
  );
  svg.append(defs);
  svg.append(sv('rect', { x: -2000, y: -2000, width: 5400, height: 4920, fill: '#a9c2c6' }), sv('rect', { x: -2000, y: -2000, width: 5400, height: 4920, fill: 'url(#waves)' }));
  const land = sv('g', { filter: 'url(#parchment)' });
  const provG = sv('g', {});
  for (const p of MAPDATA.provinces) {
    const r = w.regions[p.key];
    const path = sv('path', { d: p.d, fill: regionValue(p.key), stroke: '#3b2f22', 'stroke-width': 1.1, 'stroke-linejoin': 'round', 'fill-rule': 'evenodd', class: 'wreg', 'data-key': p.key, opacity: MAPV.overlay === 'political' ? 0.82 : 0.92 });
    path.append(sv('title', {}, `${rname(p.key)} (${p.hanzi})${r?.controller ? ` — ${fac(r.controller)?.name}` : ''}`));
    provG.append(path);
    if (r?.occupiedBy) provG.append(sv('path', { d: p.d, fill: 'url(#hatch)', 'pointer-events': 'none' }));
  }
  land.append(provG);
  svg.append(land);
  // prefectures
  const prefG = sv('g', {});
  const pickPref = MAPV.tool === 'special' || MAPV.tool === 'pref';
  for (const p of MAPDATA.prefectures) {
    const r = w.regions[p.key];
    const special = !!r?.special;
    const ownCtl = r && r.controller && r.controller !== w.regions[p.province]?.controller;
    const show = MAPV.layers.prefectures || special || ownCtl || pickPref;
    if (!show) continue;
    const fill = special || (ownCtl && MAPV.overlay === 'political') ? regionValue(p.key) : pickPref ? 'rgba(255,255,255,0.01)' : 'none';
    const el = sv('path', { d: p.d, fill, stroke: special ? '#8a5a00' : '#5a4a36', 'stroke-width': special ? 1.6 : 0.35, 'stroke-dasharray': special ? null : '2 2', opacity: special ? 0.95 : 0.8, class: pickPref ? 'wreg' : '', 'data-key': p.key, 'pointer-events': pickPref || special ? 'auto' : 'none' });
    el.append(sv('title', {}, `${rname(p.key)} (${p.hanzi}), ${rname(p.province)}${special ? ' — ★ special' : ''}`));
    prefG.append(el);
  }
  svg.append(prefG);
  // rivers
  if (MAPV.layers.rivers) {
    const g = sv('g', { 'pointer-events': 'none' });
    for (const rv of MAPDATA.rivers) {
      g.append(sv('path', { d: rv.d, fill: 'none', stroke: rv.color || '#3f78a8', 'stroke-width': rv.width * 0.9, opacity: 0.75, 'stroke-linecap': 'round' }));
      if (MAPV.layers.labels && rv.type === 'major') g.append(sv('text', { x: rv.label[0], y: rv.label[1], 'font-size': 10, fill: '#24557d', 'font-style': 'italic', 'text-anchor': 'middle' }, rv.name));
    }
    svg.append(g);
  }
  // trade routes (graph edges)
  if (MAPV.layers.routes) {
    const g = sv('g', { 'pointer-events': 'none' });
    const seen = new Set();
    for (const p of MAPDATA.provinces) for (const n of p.neighbors || []) { const k = [p.key, n].sort().join('|'); if (seen.has(k)) continue; seen.add(k); const b = geoOf(n); g.append(sv('line', { x1: p.c[0], y1: p.c[1], x2: b.c[0], y2: b.c[1], stroke: '#6b5434', 'stroke-width': 0.8, 'stroke-dasharray': '3 3', opacity: 0.6 })); }
    for (const r of w.routes || []) { const a = geoOf(r.a); const b = geoOf(r.b); if (a && b) g.append(sv('line', { x1: a.c[0], y1: a.c[1], x2: b.c[0], y2: b.c[1], stroke: r.kind === 'sea' ? '#1f4f78' : '#6b5434', 'stroke-width': 1.2, 'stroke-dasharray': '6 3', opacity: 0.8 })); }
    svg.append(g);
  }
  // mountains
  if (MAPV.layers.mountains) {
    const g = sv('g', { 'pointer-events': 'none' });
    for (const m of MAPDATA.mountains) {
      g.append(sv('path', { d: `M${m.xy[0] - 5} ${m.xy[1] + 4} L${m.xy[0]} ${m.xy[1] - 5} L${m.xy[0] + 5} ${m.xy[1] + 4} Z`, fill: m.type === 'pass' ? '#7a5c3a' : '#5b4630', stroke: '#2b2017', 'stroke-width': 0.6 }));
      if (MAPV.layers.labels && vb.w < 900) g.append(sv('text', { x: m.xy[0] + 7, y: m.xy[1] + 3, 'font-size': 8, fill: '#3b2a1a' }, m.name.replace(/\s*\(.*\)/, '')));
    }
    svg.append(g);
  }
  // caravans
  if (MAPV.layers.caravans) {
    const g = sv('g', { 'pointer-events': 'none' });
    for (const cv of (w.caravans || []).filter((x) => x.status === 'travelling').slice(0, 120)) {
      const pts = (cv.path || []).map((k) => geoOf(k)?.c).filter(Boolean);
      if (pts.length < 2) continue;
      g.append(sv('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: cv.npc ? '#8a6d2b' : '#b3261e', 'stroke-width': cv.npc ? 1 : 2, 'stroke-dasharray': cv.npc ? '2 3' : '5 3', opacity: cv.npc ? 0.6 : 0.9 }));
    }
    svg.append(g);
  }
  // special prefecture stars + labels
  const labG = sv('g', { 'pointer-events': 'none' });
  for (const [k, r] of Object.entries(w.regions)) {
    if (!r.special) continue;
    const g0 = geoOf(k); if (!g0) continue;
    labG.append(sv('text', { x: g0.c[0], y: g0.c[1] + 3, 'font-size': 9, 'text-anchor': 'middle', fill: '#6b3d00' }, '★'));
    if (MAPV.layers.labels && vb.w < 1000) labG.append(sv('text', { x: g0.c[0], y: g0.c[1] + 13, 'font-size': (11 * Math.max(0.35, vb.w / 1400)).toFixed(1), 'text-anchor': 'middle', fill: '#4a2c00', 'font-weight': 700 }, rname(k)));
  }
  if (MAPV.layers.labels) {
    for (const p of MAPDATA.provinces) {
      // Bigger provinces get bigger names; names shrink a little as you zoom in so they stay readable.
      const fs = Math.max(11, Math.min(26, Math.sqrt(p.area) / 6)) * Math.max(0.3, Math.min(1.1, vb.w / 1400));
      labG.append(sv('text', { x: p.c[0], y: p.c[1] - 6, 'font-size': fs.toFixed(1), 'text-anchor': 'middle', fill: '#22180f', 'font-weight': 700, stroke: '#f3ead6', 'stroke-width': 2.4, 'paint-order': 'stroke', opacity: 0.9 }, rname(p.key)));
    }
  }
  svg.append(labG);
  // HQs
  if (MAPV.layers.hq) {
    const g = sv('g', { 'pointer-events': 'none' });
    for (const f of w.factions) { if (!f.hq || !f.active) continue; const g0 = geoOf(f.hq); if (!g0) continue; g.append(sv('circle', { cx: g0.c[0] + 9, cy: g0.c[1] - 9, r: 7, fill: f.color, stroke: '#1c1208', 'stroke-width': 1 }), sv('text', { x: g0.c[0] + 9, y: g0.c[1] - 6, 'font-size': 9, 'text-anchor': 'middle' }, f.icon || '◆')); }
    svg.append(g);
  }
  // landmarks
  if (MAPV.layers.landmarks) {
    const g = sv('g', {});
    for (const l of w.map.landmarks || []) {
      const el = sv('g', { class: 'wlm', 'data-lm': l.id, style: 'cursor:pointer' }, sv('circle', { cx: l.xy[0], cy: l.xy[1], r: 4, fill: fac(l.factionId)?.color || '#7a1010', stroke: '#fff', 'stroke-width': 1 }), sv('text', { x: l.xy[0] + 6, y: l.xy[1] + 3, 'font-size': 8, fill: '#2a1a10', stroke: '#f3ead6', 'stroke-width': 2, 'paint-order': 'stroke' }, l.name), sv('title', {}, `${l.name}${l.hanzi ? ` (${l.hanzi})` : ''}${l.notes ? ` — ${l.notes}` : ''}`));
      g.append(el);
    }
    svg.append(g);
  }
  // frontiers
  for (const fl of w.map.frontiers || []) svg.append(sv('polyline', { points: fl.points.map((p) => p.join(',')).join(' '), fill: 'none', stroke: fl.color, 'stroke-width': fl.style === 'wall' ? 3.5 : 2, 'stroke-dasharray': fl.style === 'dashed' ? '6 4' : null, 'pointer-events': 'none', opacity: 0.9 }));
  if (MAPV.frontier?.length) svg.append(sv('polyline', { points: MAPV.frontier.map((p) => p.join(',')).join(' '), fill: 'none', stroke: '#b3261e', 'stroke-width': 2, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
  // events
  if (MAPV.layers.events) {
    const g = sv('g', { 'pointer-events': 'none' });
    const byRegion = {};
    for (const ae of w.activeEvents) for (const k of ae.regions) (byRegion[k] ||= []).push(ae);
    for (const [k, list] of Object.entries(byRegion)) { const g0 = geoOf(k); if (!g0) continue; g.append(sv('text', { x: g0.c[0] - 14, y: g0.c[1] + 12, 'font-size': 11 }, list.slice(0, 3).map((ae) => w.events.find((e) => e.id === ae.eventId)?.emoji || '•').join(''))); }
    svg.append(g);
  }
  // armies & battles
  if (MAPV.layers.armies) {
    const g = sv('g', { 'pointer-events': 'none' });
    const byRegion = {};
    for (const a of w.armies) if (a.status !== 'disbanded') (byRegion[a.region] ||= []).push(a);
    for (const [k, list] of Object.entries(byRegion)) {
      const g0 = geoOf(k); if (!g0) continue;
      list.forEach((a, i) => {
        const men = Object.values(a.units).reduce((s, n) => s + n, 0);
        const x = g0.c[0] + 10 + i * 4; const y = g0.c[1] + 4 + i * 11;
        g.append(sv('rect', { x: x - 2, y: y - 8, width: 34, height: 10, rx: 2, fill: fac(a.factionId)?.color || '#555', stroke: '#111', 'stroke-width': 0.6 }), sv('text', { x: x + 15, y: y, 'font-size': 7.5, 'text-anchor': 'middle', fill: '#fff', 'font-family': 'IBM Plex Sans, sans-serif' }, `⚔ ${men >= 1000 ? `${Math.round(men / 100) / 10}k` : men}`));
        if (a.march) { const pts = a.march.path.slice(a.march.step).map((kk) => geoOf(kk)?.c).filter(Boolean); if (pts.length > 1) g.append(sv('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: '#7a1010', 'stroke-width': 1.8, 'marker-end': 'url(#arrow)', opacity: 0.85 })); }
      });
    }
    for (const b of w.battles.filter((x) => x.status === 'preparing')) { const g0 = geoOf(b.region); if (g0) g.append(sv('text', { x: g0.c[0] - 4, y: g0.c[1] - 14, 'font-size': 16 }, '🔥')); }
    svg.append(g);
  }
  // selection outline
  if (WSEL && geoOf(WSEL)) svg.append(sv('path', { d: geoOf(WSEL).d, fill: 'none', stroke: '#b3261e', 'stroke-width': 3, 'pointer-events': 'none' }));
  // title cartouche
  svg.append(sv('g', { 'pointer-events': 'none' }, sv('text', { x: 40, y: 60, 'font-size': 30, fill: '#2a1a10', 'font-weight': 700, stroke: '#f3ead6', 'stroke-width': 3, 'paint-order': 'stroke' }, w.map.title || ''), sv('text', { x: 42, y: 82, 'font-size': 14, fill: '#3b2a1a', stroke: '#f3ead6', 'stroke-width': 2, 'paint-order': 'stroke' }, [w.map.subtitle, w.map.era, calText()].filter(Boolean).join(' · '))));
  wireMap(svg, onPick);
  return svg;
}

function wireMap(svg, onPick) {
  const toMap = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
  let drag = null; const pointers = new Map(); let pinch = null; let painting = null;
  const setVB = () => svg.setAttribute('viewBox', `${MAPV.vb.x} ${MAPV.vb.y} ${MAPV.vb.w} ${MAPV.vb.h}`);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toMap(e); const k = e.deltaY < 0 ? 0.85 : 1.18;
    const vb = MAPV.vb; const nw = Math.max(120, Math.min(2800, vb.w * k)); const s = nw / vb.w;
    MAPV.vb = { x: p.x - (p.x - vb.x) * s, y: p.y - (p.y - vb.y) * s, w: nw, h: vb.h * s };
    setVB();
  }, { passive: false });
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), vb: { ...MAPV.vb } }; drag = null; return; }
    const key = e.target.getAttribute?.('data-key');
    if ((MAPV.tool === 'paint' || MAPV.tool === 'erase') && key) { painting = new Set([key]); paintPreview(svg, key); svg.setPointerCapture?.(e.pointerId); return; }
    drag = { x: e.clientX, y: e.clientY, vb: { ...MAPV.vb }, moved: false, key, lm: e.target.closest?.('[data-lm]')?.getAttribute('data-lm') };
    svg.setPointerCapture?.(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = pinch.d / Math.max(1, d); const vb = pinch.vb; const cx = vb.x + vb.w / 2; const cy = vb.y + vb.h / 2;
      const nw = Math.max(120, Math.min(2800, vb.w * s)); const nh = vb.h * (nw / vb.w);
      MAPV.vb = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh }; setVB(); return;
    }
    if (painting) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const key = el?.getAttribute?.('data-key');
      if (key && !painting.has(key)) { painting.add(key); paintPreview(svg, key); }
      return;
    }
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    const dx = (e.clientX - drag.x) * (MAPV.vb.w / r.width); const dy = (e.clientY - drag.y) * (MAPV.vb.h / r.height);
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    if (drag.moved) { MAPV.vb = { ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy }; setVB(); }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (painting) { const keys = [...painting]; painting = null; onPick({ paint: keys }); return; }
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) return;
    const p = toMap(e);
    if (d.lm) return onPick({ landmark: d.lm });
    onPick({ key: d.key, xy: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10], dbl: e.detail >= 2 });
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; painting = null; pinch = null; });
}
function paintPreview(svg, key) {
  const color = MAPV.tool === 'erase' ? '#d8ccb0' : fac(MAPV.paintF)?.color || '#d8ccb0';
  svg.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((el) => el.setAttribute('fill', color));
}

VIEWS.map = async () => {
  await loadWorld();
  const w = W_();
  const holder = h('div', { class: 'wmap-holder' });
  const drawer = h('div', { class: 'wdrawer card' });
  const legend = h('div', { class: 'toolbar', style: 'gap:2px' });
  const redraw = () => { holder.replaceChildren(buildMapSvg(onPick)); legend.replaceChildren(...legendFor()); };
  const drawDrawer = () => drawer.replaceChildren(...(WSEL ? regionDrawer(WSEL, async () => { await loadWorld(); redraw(); drawDrawer(); }) : [h('h3', {}, 'Map'), h('p', { class: 'muted' }, 'Click a province to see and edit it. Use the tools above to paint who rules where, mark special prefectures, or place landmarks.'), mapHelp()]));
  async function onPick(ev) {
    try {
      if (ev.paint) {
        const ctl = MAPV.tool === 'erase' ? null : MAPV.paintF || null;
        await api('/world/paint', { method: 'POST', body: { keys: ev.paint, controller: ctl } });
        for (const k of ev.paint) { w.regions[k] = w.regions[k] || { key: k }; w.regions[k].controller = ctl; }
        redraw(); return;
      }
      if (ev.landmark) return editLandmark(w.map.landmarks.find((l) => l.id === ev.landmark), async () => { await loadWorld(); redraw(); });
      if (MAPV.tool === 'landmark') return editLandmark({ name: '', hanzi: '', type: 'sect_site', xy: ev.xy, region: ev.key || '', factionId: '', notes: '' }, async () => { await loadWorld(); redraw(); });
      if (MAPV.tool === 'frontier') {
        MAPV.frontier = [...(MAPV.frontier || []), ev.xy];
        redraw(); return;
      }
      if (MAPV.tool === 'special' && ev.key && ev.key.includes('/')) {
        const on = !w.regions[ev.key]?.special;
        if (!confirm(on ? `Make ${rfull(ev.key)} a special prefecture? It becomes its own market and takes a share of ${rname(provinceOf(ev.key))}'s people and production.` : `Make ${rfull(ev.key)} ordinary again? Its market merges back into ${rname(provinceOf(ev.key))}.`)) return;
        await api(`/world/regions/${encodeURIComponent(ev.key)}/special`, { method: 'POST', body: { on } });
        toast(on ? `★ ${rname(ev.key)} is special.` : `${rname(ev.key)} is ordinary again.`);
        WSEL = ev.key; await loadWorld(); redraw(); drawDrawer(); return;
      }
      if (ev.key) { WSEL = ev.key; redraw(); drawDrawer(); }
    } catch (e) { toast(e.message, true); }
  }
  const tools = [['inspect', '🔍 Inspect'], ['pref', '🗺️ Pick prefectures'], ['paint', '🖌️ Paint ruler'], ['erase', '🧽 Erase'], ['special', '★ Special prefecture'], ['landmark', '📍 Landmark'], ['frontier', '〰️ Frontier line']];
  const toolBar = h('div', { class: 'toolbar' }, tools.map(([id, label]) => h('button', { class: `btn small${MAPV.tool === id ? ' primary' : ''}`, onclick: () => { MAPV.tool = id; if (id !== 'frontier') MAPV.frontier = null; render(); } }, label)));
  const paintSel = select(factionOpts('— pick a faction —'), MAPV.paintF);
  paintSel.onchange = () => (MAPV.paintF = paintSel.value);
  const overlaySel = select([['political', 'Political (who rules)'], ['prosperity', 'Prosperity'], ['food', 'Food supply'], ['security', 'Security'], ['unrest', 'Unrest'], ['corruption', 'Corruption'], ['price', 'Price of…'], ['relations', 'Relations of…'], ['events', 'Events'], ['terrain', 'Terrain']], MAPV.overlay);
  const goodSel = select(w.goods.map((g) => [g.id, `${g.emoji} ${g.name}`]), MAPV.good);
  const relSel = select(factionOpts('— faction —'), MAPV.relF);
  overlaySel.onchange = () => { MAPV.overlay = overlaySel.value; saveMapPrefs(); render(); };
  goodSel.onchange = () => { MAPV.good = goodSel.value; saveMapPrefs(); redraw(); };
  relSel.onchange = () => { MAPV.relF = relSel.value; saveMapPrefs(); redraw(); };
  const layerBox = h('details', { class: 'wlayers' }, h('summary', { class: 'btn small' }, '🗂️ Layers'), h('div', { class: 'card', style: 'position:absolute;z-index:6;display:grid;gap:4px;min-width:180px' },
    Object.entries({ prefectures: 'Prefecture borders', rivers: 'Rivers', mountains: 'Peaks & passes', labels: 'Names', landmarks: 'Landmarks', hq: 'Sect HQs', armies: 'Armies & battles', caravans: 'Caravans', events: 'Event icons', routes: 'Trade routes' }).map(([k, label]) => {
      const c = h('input', { type: 'checkbox' }); c.checked = !!MAPV.layers[k]; c.onchange = () => { MAPV.layers[k] = c.checked; saveMapPrefs(); redraw(); };
      return h('label', { class: 'field check' }, c, h('span', {}, label));
    })));
  const langSel = select([['english', 'English names'], ['hanzi', '漢字'], ['both', 'Both'], ['historical', 'Historical']], w.map.lang || 'english');
  langSel.onchange = run(async () => { await api('/world/map', { method: 'PUT', body: { lang: langSel.value } }); await loadWorld(); redraw(); });
  const zoom = (k) => { const vb = MAPV.vb; const nw = Math.max(120, Math.min(2800, vb.w * k)); const nh = vb.h * (nw / vb.w); MAPV.vb = { x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh }; redraw(); };
  const frontierBar = MAPV.tool === 'frontier' ? h('div', { class: 'toolbar card' }, h('span', { class: 'muted' }, `Click points on the map (${(MAPV.frontier || []).length} so far).`),
    h('button', { class: 'btn small primary', onclick: run(async () => {
      if ((MAPV.frontier || []).length < 2) throw new Error('Click at least two points.');
      const name = prompt('Name of this frontier / wall?', 'Frontier'); if (name === null) return;
      await api('/world/map', { method: 'PUT', body: { frontiers: [...w.map.frontiers, { name, color: '#b3261e', style: 'dashed', points: MAPV.frontier }] } });
      MAPV.frontier = null; toast('Frontier saved.'); render();
    }) }, 'Save line'), h('button', { class: 'btn small', onclick: () => { MAPV.frontier = null; redraw(); } }, 'Clear'),
    w.map.frontiers.length ? h('button', { class: 'btn small danger', onclick: run(async () => { if (!confirm('Delete every frontier line?')) return; await api('/world/map', { method: 'PUT', body: { frontiers: [] } }); render(); }) }, 'Delete all lines') : null) : null;
  redraw(); drawDrawer();
  return [
    h('div', { class: 'card' },
      toolBar,
      h('div', { class: 'toolbar', style: 'margin-top:8px' },
        MAPV.tool === 'paint' ? paintSel : null,
        overlaySel, MAPV.overlay === 'price' ? goodSel : null, MAPV.overlay === 'relations' ? relSel : null, langSel, layerBox,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small', onclick: () => zoom(0.75) }, '＋'), h('button', { class: 'btn small', onclick: () => zoom(1.33) }, '－'), h('button', { class: 'btn small', onclick: () => { MAPV.vb = { x: 0, y: 0, w: 1400, h: 920 }; redraw(); } }, 'Reset view'),
        h('button', { class: 'btn small', onclick: () => exportMap('svg') }, '⬇ SVG'), h('button', { class: 'btn small', onclick: () => exportMap('png') }, '⬇ PNG'),
        h('button', { class: 'btn small', onclick: mapSettings }, '⚙️ Map & Discord'),
      ),
      h('div', { style: 'margin-top:6px' }, legend),
    ),
    frontierBar,
    h('div', { class: 'wmap-wrap' }, h('div', { class: 'card', style: 'padding:6px' }, holder), drawer),
  ].filter(Boolean);
};

function mapHelp() {
  const w = W_();
  return h('div', { class: 'ref' },
    h('p', {}, h('b', {}, calText())),
    h('p', { class: 'muted small' }, `Turn ${w.turn} · next turn ${w.nextTurnAt ? new Date(w.nextTurnAt).toLocaleString() : '—'}${w.settings.paused ? ' · ⏸ paused' : ''}`),
    h('details', {}, h('summary', {}, 'How the map works'),
      h('p', {}, 'Every province is a region with its own market. Mark a few prefectures as ★ special to give them their own market too (a share of the province\'s people and production moves there) — use them for sect seats, great cities and passes.'),
      h('p', {}, 'Link each province to its Discord category (⚙️ Map & Discord → Auto-link). Special prefectures can be linked to their own channels. Players see the region of the channel they use /world in.'),
      h('p', {}, 'Paint ruler sets the controlling faction: they collect the taxes and can adopt policies there. A prefecture can have its own ruler (pick prefectures, then set the ruler in the panel).'),
      h('p', {}, 'Mouse wheel / pinch to zoom, drag to move.')));
}

async function exportMap(kind) {
  const svg = $('.wmap');
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute('viewBox', '0 0 1400 920'); clone.setAttribute('width', 2800); clone.setAttribute('height', 1840);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const name = (W_().map.title || 'murim-map').replace(/[^\w一-鿿]+/g, '-');
  if (kind === 'svg') { const a = h('a', { href: URL.createObjectURL(blob), download: `${name}.svg` }); a.click(); return; }
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = 2800; c.height = 1840; c.getContext('2d').drawImage(img, 0, 0); c.toBlob((b) => { const a = h('a', { href: URL.createObjectURL(b), download: `${name}.png` }); a.click(); }); };
  img.src = URL.createObjectURL(blob);
}

function mapSettings() {
  const w = W_();
  const f = buildForm([{ k: 'title', label: 'Map title', wide: true }, { k: 'subtitle', label: 'Subtitle', wide: true }, { k: 'era', label: 'Era' }], w.map);
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const cats = DISCORD.guilds.flatMap((g) => g.categories || []);
  const linked = MAPDATA.provinces.filter((p) => w.regions[p.key]?.categoryId).length;
  openModal('Map & Discord', h('div', { style: 'display:grid;gap:14px' },
    f.el,
    h('div', { class: 'card' }, h('h3', {}, 'Discord categories'),
      h('p', { class: 'muted' }, `${linked} of ${MAPDATA.provinces.length} provinces are linked to a category. ${cats.length ? `${cats.length} categories found in your server.` : 'The bot is offline or sees no categories.'}`),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: run(async () => { const r = await api('/world/discord/link-categories', { method: 'POST', body: {} }); toast(`Linked ${r.linked} province(s) by name.`); await loadWorld(); }) }, '🔗 Auto-link by name'),
        h('button', { class: 'btn', onclick: run(async () => { if (!confirm(`Create a Discord category for each of the ${MAPDATA.provinces.length - linked} unlinked provinces?`)) return; const r = await api('/world/discord/create-categories', { method: 'POST', body: {} }); toast(`Created ${r.created} categories.`); await loadWorld(); }) }, '➕ Create missing categories')),
      h('p', { class: 'muted small' }, 'Auto-link matches a category whose name contains the province\'s English name or 漢字 (e.g. "Henan 河南", "🏯 HENAN"). You can also set each one by clicking the province.')),
    h('div', { class: 'card' }, h('h3', {}, 'Import from Murim Map Studio'),
      h('p', { class: 'muted' }, 'Load a project you exported from the Murim Map Studio (myumyu). Factions are matched by name (new ones are created), provinces are painted, landmarks, frontier lines and the title come along, and alliances become Defensive Alliances.'),
      h('div', { class: 'toolbar' }, file, h('button', { class: 'btn', onclick: run(async () => {
        if (!file.files[0]) throw new Error('Pick the exported .json first.');
        const project = JSON.parse(await file.files[0].text());
        const r = await api('/world/import-myumyu', { method: 'POST', body: { project } });
        toast(`Imported: ${r.factions} new faction(s), ${r.painted} region(s), ${r.landmarks} landmark(s).`);
        closeModal(); render();
      }) }, '⬆ Import'))),
  ), [h('button', { class: 'btn', onclick: closeModal }, 'Close'), h('button', { class: 'btn primary', onclick: run(async () => { await api('/world/map', { method: 'PUT', body: f.read() }); toast('Saved.'); closeModal(); render(); }) }, 'Save')]);
}

function editLandmark(l, done) {
  const f = buildForm([
    { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字' },
    { k: 'type', label: 'Type', t: 'select', opts: [['sect_site', 'Sect site'], ['sacred_peak', 'Sacred peak'], ['fortress', 'Fortress'], ['pass', 'Pass'], ['ancient_city', 'Ancient city'], ['water_gate', 'Water gate'], ['secret_realm', 'Secret place'], ['battlefield', 'Battlefield'], ['ancient_tomb', 'Ancient tomb'], ['city', 'City']] },
    { k: 'factionId', label: 'Belongs to', t: 'select', opts: factionOpts() },
    { k: 'notes', label: 'Notes', t: 'textarea', wide: true },
  ], l);
  const list = () => W_().map.landmarks.filter((x) => x.id !== l.id);
  openModal(l.id ? `📍 ${l.name}` : '📍 New landmark', f.el, [
    l.id ? h('button', { class: 'btn danger left', onclick: run(async () => { await api('/world/map', { method: 'PUT', body: { landmarks: list() } }); closeModal(); done(); }) }, 'Delete') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => { const v = { ...l, ...f.read() }; if (!v.name) throw new Error('Name it first.'); await api('/world/map', { method: 'PUT', body: { landmarks: [...list(), v] } }); closeModal(); done(); }) }, 'Save'),
  ].filter(Boolean));
}

/** Side panel for one region. */
function regionDrawer(key, reload) {
  const w = W_();
  const g = geoOf(key);
  const market = marketOf(key);
  const r = w.regions[key] || { key, controller: null, channelIds: [] };
  const isM = isMarket(key);
  const mr = w.regions[market];
  const out = [];
  out.push(h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `${rname(key)} ${g?.hanzi || ''}`), h('button', { class: 'btn small ghost', onclick: () => { WSEL = null; render(); } }, '✕')));
  out.push(h('p', { class: 'muted small', style: 'margin:0' }, [key.includes('/') ? `Prefecture of ${rname(provinceOf(key))}` : g?.historicalName || '', r.special ? ' · ★ special (own market)' : !isM ? ` · served by the ${rname(market)} market` : ''].join('')));
  if (g?.description) out.push(h('p', { class: 'small' }, r.notes || g.description));
  if (mr) {
    const f = fac(mr.controller);
    out.push(h('div', { class: 'kv small' },
      h('span', { class: 'muted' }, 'Ruler'), h('span', {}, facName(r.controller ?? mr.controller), mr.occupiedBy ? ` · 🏴 occupied by ${facName(mr.occupiedBy)}` : ''),
      h('span', { class: 'muted' }, 'Prosperity'), h('span', {}, h('b', {}, fmt(mr.prosperity)), ` (${mr.last?.dP >= 0 ? '+' : ''}${fmt(mr.last?.dP)}/turn) `, sparkSvg((mr.history || []).map((x) => x.p), 90, 18)),
      h('span', { class: 'muted' }, 'Food · staples'), h('span', {}, `${Math.round((mr.last?.food ?? 1) * 100)}% · ${Math.round((mr.last?.staple ?? 1) * 100)}%`),
      h('span', { class: 'muted' }, 'Security · unrest'), h('span', {}, `${fmt(mr.security)} · ${fmt(mr.unrest)}`),
      h('span', { class: 'muted' }, 'Corruption'), h('span', {}, fmt(mr.corruption)),
      h('span', { class: 'muted' }, 'People'), h('span', {}, `${fmt(mr.population)}k households (base ${fmt(mr.basePop)})`),
      h('span', { class: 'muted' }, 'Coffers'), h('span', {}, `${fmtN(mr.coffers)} · taxes ${fmt(mr.last?.taxes)}/turn to ${f?.name || 'no one'}`),
      h('span', { class: 'muted' }, 'Effects'), h('span', {}, (mr.last?.sources || []).join(', ') || '—'),
    ));
    const events = w.activeEvents.filter((e) => e.regions.includes(market));
    if (events.length) out.push(h('div', {}, h('b', {}, 'Events'), ...events.map((ae) => { const ev = w.events.find((x) => x.id === ae.eventId); return h('div', { class: 'toolbar small' }, h('span', { class: 'grow' }, `${ev?.emoji || ''} ${ev?.name || ae.eventId} — ends turn ${ae.endTurn}`), h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/active-events/${ae.id}`, { method: 'DELETE' }); reload(); }) }, 'End')); })));
  }
  // editor
  const tabs = h('div', { class: 'toolbar' });
  const body = h('div');
  const show = (name) => { [...tabs.children].forEach((b) => b.classList.toggle('primary', b.dataset.t === name)); body.replaceChildren(...(SECTIONS[name] ? SECTIONS[name]() : [])); };
  const SECTIONS = {
    edit: () => {
      const fields = [
        { k: 'displayName', label: 'Custom name', help: 'Leave empty to use the map name' },
        { k: 'controller', label: 'Ruled by', t: 'select', opts: () => factionOpts(key.includes('/') && !r.special ? '— same as the province —' : '— no one —') },
        !key.includes('/') ? { k: 'categoryId', label: 'Discord category', t: categoryOpts().length > 1 ? 'select' : 'text', opts: categoryOpts } : null,
        { k: 'channelIds', label: 'Discord channels in this region', t: 'channels', help: key.includes('/') ? 'Channels for this prefecture (e.g. #luoyang-market)' : 'Extra channels that belong here (the category already counts)' },
        { k: 'announceChannelId', label: 'Post this region\'s events in', t: 'channel' },
        { k: 'notes', label: 'Notes / description', t: 'textarea', wide: true },
        isM ? { k: 'scriptId', label: 'Custom code', t: 'select', opts: scriptOpts, help: 'regionTick hook: change this region\'s modifiers every turn' } : null,
        isM ? { section: 'Land & people' } : null,
        isM ? { k: 'terrain', label: 'Terrain', t: 'select', opts: Object.entries(w.terrains).map(([k, t]) => [k, `${t.emoji} ${t.label}`]) } : null,
        isM ? { k: 'population', label: 'Population (k households)', t: 'number' } : null,
        isM ? { k: 'basePop', label: 'Land supports (base pop.)', t: 'number' } : null,
        isM ? { k: 'fort', label: 'Walls / forts (0–5)', t: 'number' } : null,
        isM ? { k: 'taxRate', label: 'Tax rate %', t: 'number' } : null,
        isM ? { k: 'prosperity', label: 'Prosperity', t: 'number' } : null,
        isM ? { k: 'security', label: 'Security', t: 'number' } : null,
        isM ? { k: 'unrest', label: 'Unrest', t: 'number' } : null,
        isM ? { k: 'corruption', label: 'Corruption', t: 'number' } : null,
        isM ? { k: 'coffers', label: 'Coffers', t: 'number' } : null,
      ].filter(Boolean);
      const f = buildForm(fields, r);
      return [f.el, h('div', { class: 'toolbar', style: 'margin-top:8px' },
        key.includes('/') ? h('button', { class: 'btn', onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(key)}/special`, { method: 'POST', body: { on: !r.special } }); toast('Done.'); reload(); }) }, r.special ? 'Make ordinary' : '★ Make special') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: run(async () => { const v = f.read(); if (v.controller === '') v.controller = null; await api(`/world/regions/${encodeURIComponent(key)}`, { method: 'PUT', body: v }); toast('Saved.'); reload(); }) }, 'Save'))];
    },
    market: () => {
      if (!mr) return [h('p', { class: 'muted' }, 'No market.')];
      const prod = {}; const inputs = {};
      const rows = w.goods.map((gd) => {
        const i = h('input', { type: 'number', step: 'any', value: mr.production?.[gd.id] || '', style: 'width:64px', placeholder: '0' });
        inputs[gd.id] = i;
        const idx = (mr.prices?.[gd.id] || gd.basePrice) / gd.basePrice;
        return h('tr', {}, h('td', {}, `${gd.emoji} ${gd.name}`), h('td', { style: `color:${idx > 1.3 ? '#e57368' : idx < 0.75 ? '#7fbf8a' : ''}` }, fmt(mr.prices?.[gd.id])), h('td', {}, sparkSvg(mr.priceHistory?.[gd.id], 60, 16)), h('td', {}, `${fmtN(mr.stock?.[gd.id])} / ${fmtN(mr.targets?.[gd.id])}`), h('td', {}, i));
      });
      void prod;
      return [
        h('p', { class: 'muted small' }, `Market of ${rname(market)} — price · trend · stock / what it wants to hold · production per turn (at prosperity 50).`),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Good', 'Price', 'Trend', 'Stock', 'Makes'].map((x) => h('th', {}, x)))), h('tbody', {}, rows))),
        h('div', { class: 'toolbar', style: 'margin-top:8px' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: run(async () => {
          const production = {}; for (const [k, i] of Object.entries(inputs)) if (Number(i.value) > 0) production[k] = Number(i.value);
          await api(`/world/regions/${encodeURIComponent(market)}`, { method: 'PUT', body: { production } }); toast('Production saved.'); reload();
        }) }, 'Save production')),
      ];
    },
    workshops: () => {
      if (!mr) return [];
      const list = clone(mr.workshops || []);
      const wrap = h('div');
      const draw = () => wrap.replaceChildren(table([
        ['Workshop', (x) => { const s = select(w.workshopTypes.map((t) => [t.id, `${t.emoji} ${t.name}`]), x.typeId); s.onchange = () => (x.typeId = s.value); return s; }],
        ['Lv', (x) => { const i = h('input', { type: 'number', min: 1, max: 3, value: x.level, style: 'width:48px' }); i.onchange = () => (x.level = Number(i.value)); return i; }],
        ['Owner', (x) => { const s = select([['region|', 'the town'], ...w.factions.map((f) => [`faction|${f.id}`, f.name]), ...WD.characters.map((c) => [`character|${c.id}`, `👤 ${c.name}`])], `${x.owner.type}|${x.owner.id}`); s.onchange = () => { const [t, id] = s.value.split('|'); x.owner = { type: t, id }; }; return s; }],
        ['Last turn', (x) => `${fmt(x.lastProfit)}${x.throttled ? ' ⚠️' : ''}`],
        ['', (x) => h('button', { class: 'btn small danger', onclick: () => { list.splice(list.indexOf(x), 1); draw(); } }, '✕')],
      ], list));
      draw();
      return [wrap, h('div', { class: 'toolbar', style: 'margin-top:8px' },
        h('button', { class: 'btn', onclick: () => { list.push({ typeId: w.workshopTypes[0].id, level: 1, owner: { type: 'region', id: '' } }); draw(); } }, '+ Add'),
        h('span', { class: 'grow' }), h('span', { class: 'muted small' }, `${list.length} of ~${2 + Math.floor((mr.population || 0) / 25) + Math.floor((mr.prosperity || 0) / 34)} plots`),
        h('button', { class: 'btn primary', onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(market)}`, { method: 'PUT', body: { workshops: list } }); toast('Saved.'); reload(); }) }, 'Save'))];
    },
    event: () => {
      const evSel = select(w.events.map((e) => [e.id, `${e.emoji} ${e.name}`]));
      const dur = h('input', { type: 'number', placeholder: 'default', style: 'width:90px' });
      return [h('p', { class: 'muted small' }, `Start an event in ${rname(market)} right now (it is announced like a random one).`), h('div', { class: 'toolbar' }, evSel, dur, h('button', { class: 'btn primary', onclick: run(async () => { const r2 = await api('/world/events/force', { method: 'POST', body: { eventId: evSel.value, region: market, duration: dur.value ? Number(dur.value) : undefined } }); toast(r2.event.text.replace(/\*/g, '')); reload(); }) }, 'Force event'))];
    },
    people: () => {
      const here = WD.characters.filter((c) => marketOf(c.location || '') === market);
      const armies = w.armies.filter((a) => a.region === market);
      return [h('p', {}, h('b', {}, 'Characters here: '), here.map((c) => c.name).join(', ') || '—'), h('p', {}, h('b', {}, 'Armies: '), armies.map((a) => `${a.name} (${facName(a.factionId)}, ${fmtN(Object.values(a.units).reduce((s, n) => s + n, 0))} men)`).join('; ') || '—')];
    },
  };
  const names = [['edit', 'Edit'], ...(mr ? [['market', 'Market'], ['workshops', 'Workshops'], ['event', 'Force event'], ['people', 'Who\'s here']] : [])];
  for (const [id, label] of names) tabs.append(h('button', { class: 'btn small', 'data-t': id, onclick: () => show(id) }, label));
  out.push(tabs, body);
  setTimeout(() => show('edit'), 0);
  return out;
}

// ════════════════════════════════════════ ECONOMY ════════════════════════════════════════
VIEWS.economy = async () => {
  await loadWorld();
  const w = W_();
  const markets = WD.markets.map((k) => ({ k, r: w.regions[k] })).filter((x) => x.r);
  const goodSel = select(w.goods.map((g) => [g.id, `${g.emoji} ${g.name}`]), MAPV.good);
  const matrix = h('div');
  const drawMatrix = () => {
    const g = goodOf(goodSel.value); MAPV.good = g.id;
    const rows = markets.map((x) => ({ ...x, p: x.r.prices?.[g.id] || g.basePrice })).sort((a, b) => b.p - a.p);
    matrix.replaceChildren(table([
      ['Market', (x) => rfull(x.k)], ['Price', (x) => h('b', { style: `color:${x.p / g.basePrice > 1.3 ? '#e57368' : x.p / g.basePrice < 0.75 ? '#7fbf8a' : ''}` }, fmt(x.p))],
      ['× base', (x) => `${fmt(x.p / g.basePrice)}×`], ['Trend', (x) => sparkSvg(x.r.priceHistory?.[g.id], 80, 18)],
      ['Stock / wants', (x) => `${fmtN(x.r.stock?.[g.id])} / ${fmtN(x.r.targets?.[g.id])}`], ['Makes / turn', (x) => fmt(x.r.production?.[g.id] || 0)],
    ], rows, (x) => { WSEL = x.k; location.hash = 'map'; }));
  };
  goodSel.onchange = drawMatrix; drawMatrix();
  const shortage = (r) => { let best = null; for (const g of w.goods) { const ratio = (r.stock?.[g.id] || 0) / Math.max(1, r.targets?.[g.id] || 1); if (!best || ratio < best.ratio) best = { g, ratio }; } return best; };
  const surplus = (r) => { let best = null; for (const g of w.goods) { const ratio = (r.stock?.[g.id] || 0) / Math.max(1, r.targets?.[g.id] || 1); if (!best || ratio > best.ratio) best = { g, ratio }; } return best; };
  const caravans = (w.caravans || []).filter((c) => c.status === 'travelling');
  return [
    worldStatusCard(),
    h('div', { class: 'card' }, h('h3', {}, 'Markets'), table([
      ['Market', (x) => h('b', {}, rfull(x.k))], ['Ruler', (x) => facName(x.r.controller)], ['Prosperity', (x) => h('span', {}, fmt(x.r.prosperity), ' ', sparkSvg((x.r.history || []).map((y) => y.p), 60, 14))],
      ['Δ/turn', (x) => fmt(x.r.last?.dP)], ['Food', (x) => `${Math.round((x.r.last?.food ?? 1) * 100)}%`], ['People', (x) => fmt(x.r.population)], ['Unrest', (x) => fmt(x.r.unrest)], ['Corruption', (x) => fmt(x.r.corruption)],
      ['Coffers', (x) => fmtN(x.r.coffers)], ['Scarcest', (x) => { const s = shortage(x.r); return s ? `${s.g.emoji} ${s.g.name} (${Math.round(s.ratio * 100)}%)` : '—'; }], ['Glut', (x) => { const s = surplus(x.r); return s ? `${s.g.emoji} ${s.g.name} (${Math.round(s.ratio * 100)}%)` : '—'; }],
    ], markets.sort((a, b) => b.r.prosperity - a.r.prosperity), (x) => { WSEL = x.k; location.hash = 'map'; })),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, 'Prices across the realm'), goodSel), h('div', { style: 'margin-top:8px' }, matrix)),
    h('div', { class: 'card' }, h('h3', {}, `Caravans on the road (${caravans.length})`), table([
      ['Owner', (c) => (c.npc ? '💰 Merchant Guild' : `👤 ${charName(c.owner.id)}`)], ['Cargo', (c) => `${fmt(c.qty)} ${goodOf(c.good)?.emoji || ''} ${goodOf(c.good)?.name || c.good}`],
      ['From → to', (c) => `${rname(c.from)} → ${rname(c.to)}`], ['Arrives', (c) => (c.npc ? `turn ${c.arriveTurn}` : new Date(c.arriveAt).toLocaleString())],
    ], caravans.slice(0, 80))),
    listEditorCard('Trade goods', 'goods', [
      { k: 'id', label: 'Id', help: 'Never change after players own it' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' },
      { k: 'category', label: 'Category', t: 'select', opts: ['food', 'staple', 'raw', 'refined', 'medicine', 'military', 'luxury', 'rare'] },
      { k: 'basePrice', label: 'Base price', t: 'number' }, { k: 'perPop', label: 'Eaten per pop / turn', t: 'number', step: 0.001 },
      { k: 'elasticity', label: 'Price elasticity', t: 'number', step: 0.05, help: 'How hard the price reacts to shortages' }, { k: 'lux', label: 'Luxury (0–1)', t: 'number', step: 0.1, help: 'Demand rises with prosperity' },
      { k: 'perish', label: 'Spoils / turn (0–1)', t: 'number', step: 0.005 }, { k: 'weight', label: 'Weight (caravans)', t: 'number' }, { k: 'winterDemand', label: 'Winter demand ×', t: 'number', step: 0.1 },
      { k: 'itemId', label: 'Item id for players' }, { k: 'description', label: 'Description', t: 'textarea', wide: true },
    ], (g) => `${g.emoji} ${g.name} — base ${g.basePrice} · ${g.category}`, { extra: h('button', { class: 'btn', onclick: run(async () => { const r = await api('/world/goods/items', { method: 'POST', body: {} }); toast(`Created ${r.created} trade-good item(s).`); await refresh(); }) }, '🎒 Create missing good items'), json: [['seasonal', 'Seasonal production (spring, summer, autumn, winter multipliers) or null']] }),
    listEditorCard('Workshop types', 'workshopTypes', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' }, { k: 'cost', label: 'Build cost', t: 'number' }, { k: 'upkeep', label: 'Wages / turn', t: 'number' },
      { k: 'service', label: 'Service income (pop 20)', t: 'number', help: 'Teahouses, escort agencies…' }, { k: 'security', label: '+ Security', t: 'number' }, { k: 'caravanRisk', label: 'Caravan risk ±', t: 'number', step: 0.01 },
      { k: 'description', label: 'Description', t: 'textarea', wide: true },
    ], (t) => `${t.emoji} ${t.name} — ${Object.entries(t.inputs || {}).map(([g, q]) => `${q} ${goodOf(g)?.name || g}`).join(' + ') || '—'} → ${t.service ? 'coin' : Object.entries(t.outputs || {}).map(([g, q]) => `${q} ${goodOf(g)?.name || g}`).join(' + ')}`, { json: [['inputs', 'Inputs per turn { goodId: qty }'], ['outputs', 'Outputs per turn { goodId: qty }'], ['requires', 'Requirements { terrains: [...], anyProduction: [goodIds] }']] }),
    economyFormulas(),
  ];
};

function economyFormulas() {
  return h('div', { class: 'card ref' }, h('h3', {}, 'How the economy works'),
    h('details', {}, h('summary', {}, 'Prices, supply and demand'),
      h('p', {}, h('code', {}, 'price = base × (target ÷ stock)^elasticity'), ' — clamped between ×', W_().settings.minPriceMul, ' and ×', W_().settings.maxPriceMul, ', then × event/policy modifiers.'),
      h('p', {}, h('code', {}, 'target = (people × eaten per pop × luxury factor × winter + workshop inputs + armies) × stock turns'), ` (stock turns = ${W_().settings.stockTurns}).`),
      h('p', {}, 'Producers answer prices: production × (price ÷ base)^', W_().settings.supplyResponse, ' (between ×0.55 and ×1.3). Gluts above 3× the target rot 5% a turn.')),
    h('details', {}, h('summary', {}, 'Trade: peddlers, caravans, players'),
      h('p', {}, 'Every turn peddlers move goods along each road from where a good is plentiful to where it is scarce, if the price gap pays for the trip (5% per road). The Merchant Guild sends up to ', W_().settings.npcCaravansPerTurn, ' big caravans to markets 2–4 roads away; it keeps ', Math.round(W_().settings.guildShare * 100), '% of the margin.'),
      h('p', {}, `Players buy and sell at the market where their character stands (each unit moves the price), pay a ${W_().settings.spread}% spread and a tariff (${W_().settings.baseTariff}% base, 0 in their own faction's land or with a Trade Agreement). The market can only pay out what is in its coffers.`)),
    h('details', {}, h('summary', {}, 'Coffers and taxes'),
      h('p', {}, h('code', {}, 'coffers += (household spending × 0.9 + people × household income × prosperity factor) × income modifiers − taxes')),
      h('p', {}, h('code', {}, 'taxes = that income × tax rate × tax modifiers × (1 − corruption ÷ 200)'), ' — paid to the ruling (or occupying) faction. Factions pay ', W_().settings.adminCost, '% of their treasury each turn in retainers, so nobody hoards forever.')),
    h('details', {}, h('summary', {}, 'Prosperity (and why it never lasts)'),
      h('p', {}, h('code', {}, 'growth = 3×(food − 0.85) + 1.5×(staples − 0.8) + 0.8×luxuries + trade + (security − 50) ÷ 25')),
      h('p', {}, h('code', {}, 'drag = 3×(prosperity ÷ 100)² + corruption ÷ 25 + unrest ÷ 25')),
      h('p', {}, 'Δ prosperity = growth − drag + events + policies (± a little luck). Corruption grows while a region is rich (+0.35 per turn at prosperity 100) and fades slowly, so golden ages rot from within; famine, war and revolts knock regions down, and the cycle starts again.'),
      h('p', {}, 'Production and workshop output scale with prosperity (×0.75 at 0, ×1 at 50, ×1.25 at 100). Population grows with food and prosperity but the land only feeds so many (its base population).')),
    h('details', {}, h('summary', {}, 'Workshops'),
      h('p', {}, 'A workshop buys its inputs from its market and sells its output back every turn; profit goes to its owner (player, faction or the town). It cuts back to 25% when the output is worth less than the inputs plus wages. Players can own up to ', W_().settings.maxWorkshopsPerCharacter, '.')),
  );
}

function worldStatusCard() {
  const w = W_();
  const s = w.settings;
  const n = h('input', { type: 'number', value: 1, min: 1, max: 50, style: 'width:70px' });
  return h('div', { class: 'card' },
    h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `🗓️ ${calText()}`),
      h('span', { class: 'muted' }, `Turn ${w.turn} · every ${s.turnHours} h · next ${w.nextTurnAt ? new Date(w.nextTurnAt).toLocaleString() : '—'}`),
      n, h('button', { class: 'btn', onclick: run(async () => { const r = await api('/world/turn', { method: 'POST', body: { count: Number(n.value) || 1 } }); toast(`Now turn ${r.turns[r.turns.length - 1].turn}.`); render(); }) }, '⏭ Advance'),
      h('button', { class: 'btn', onclick: run(async () => { await api('/world/settings', { method: 'PUT', body: { paused: !s.paused } }); render(); }) }, s.paused ? '▶ Resume' : '⏸ Pause'),
      h('button', { class: 'btn', onclick: worldSettings }, '⚙️ World settings')),
    w.scriptErrors?.length ? h('p', { class: 'bad small' }, `Custom code errors: ${w.scriptErrors.slice(0, 3).join(' · ')}`) : null);
}

function worldSettings() {
  const s = W_().settings;
  const f = buildForm([
    { section: 'Time' },
    { k: 'enabled', label: 'World is on', t: 'check' }, { k: 'paused', label: 'Paused (no turns)', t: 'check' },
    { k: 'turnHours', label: 'Real hours per turn', t: 'number' }, { k: 'turnsPerSeason', label: 'Turns per season', t: 'number' },
    { k: 'startYear', label: 'Starting year', t: 'number' }, { k: 'eraName', label: 'Calendar name' }, { k: 'postTurnSummary', label: 'Post a line in the world channel every turn', t: 'check' },
    { section: 'Economy' },
    { k: 'stockTurns', label: 'Stock turns (target)', t: 'number' }, { k: 'minPriceMul', label: 'Min price ×', t: 'number', step: 0.05 }, { k: 'maxPriceMul', label: 'Max price ×', t: 'number', step: 0.1 },
    { k: 'supplyResponse', label: 'Producers react to price', t: 'number', step: 0.05 }, { k: 'spread', label: 'Buy/sell spread %', t: 'number' }, { k: 'baseTariff', label: 'Base tariff %', t: 'number' },
    { k: 'householdIncome', label: 'Household income / pop', t: 'number', step: 0.1 }, { k: 'spendingToCoffers', label: 'Spending → coffers', t: 'number', step: 0.05 }, { k: 'maxCoffersPerPop', label: 'Max coffers per pop', t: 'number' },
    { k: 'peddlerRate', label: 'Peddler trade rate', t: 'number', step: 0.05 }, { k: 'npcCaravansPerTurn', label: 'Merchant caravans / turn', t: 'number' }, { k: 'guildShare', label: 'Guild keeps (0–1)', t: 'number', step: 0.05 },
    { k: 'adminCost', label: 'Treasury upkeep % / turn', t: 'number', step: 0.1 },
    { k: 'shopSwingMax', label: 'Max shop price swing %', t: 'number', help: 'Items linked to a good never move more than this' },
    { section: 'Players' },
    { k: 'startRegion', label: 'Where new characters start', t: 'select', opts: marketOpts }, { k: 'travelHoursPer100', label: 'Travel hours per 100 map px', t: 'number', step: 0.1, help: 'Henan→Hubei ≈ 80 px · Beijing→Guangdong ≈ 500 px' },
    { k: 'caravanHoursPer100', label: 'Caravan hours per 100 px', t: 'number', step: 0.1 }, { k: 'maxPlayerCaravans', label: 'Caravans per character', t: 'number' }, { k: 'caravanCapacity', label: 'Caravan capacity', t: 'number' },
    { k: 'escortCost', label: 'Escort cost (share of cargo)', t: 'number', step: 0.01 }, { k: 'maxWorkshopsPerCharacter', label: 'Workshops per character', t: 'number' }, { k: 'workshopSlotsBase', label: 'Workshop plots (base)', t: 'number' },
    { k: 'shopTiers.member', label: 'Sect shop: members %', t: 'number' }, { k: 'shopTiers.ally', label: 'Sect shop: allies %', t: 'number' }, { k: 'shopTiers.neutral', label: 'Sect shop: outsiders %', t: 'number' }, { k: 'shopTiers.rival', label: 'Sect shop: rivals %', t: 'number' }, { k: 'rivalBelow', label: 'Rival below relation', t: 'number' },
    { k: 'underdogBonus', label: 'Join bonus for recommended sects', t: 'number', help: 'Extra Nyang for new characters joining a sect the Balance tab recommends' },
    { k: 'representativeRoleIds', label: 'Representative roles (any sect)', t: 'roles', help: 'Members with these roles count as their sect\'s representatives' },
    { section: 'Events' },
    { k: 'eventRate', label: 'Event rate ×', t: 'number', step: 0.1 }, { k: 'maxNewEventsPerTurn', label: 'Max new events / turn', t: 'number' },
    { section: 'War' },
    { k: 'battlePrepHours', label: 'Battle preparation (h)', t: 'number', help: 'Time for RP duels and plans before a battle is fought' }, { k: 'battleRounds', label: 'Rounds per battle', t: 'number' },
    { k: 'duelMomentum', label: 'Momentum per duel won', t: 'number', step: 0.01 }, { k: 'maxMomentum', label: 'Max momentum', t: 'number', step: 0.01 },
    { k: 'championScale', label: 'Champion power ×', t: 'number', step: 0.1 }, { k: 'autoConquest', label: 'Occupied regions change hands automatically', t: 'check' }, { k: 'occupationTurns', label: 'Turns of occupation to conquer', t: 'number' },
    { section: 'Balance' },
    { k: 'powerWeights.military', label: 'Weight: military', t: 'number', step: 0.05 }, { k: 'powerWeights.economy', label: 'Weight: economy', t: 'number', step: 0.05 }, { k: 'powerWeights.politics', label: 'Weight: politics', t: 'number', step: 0.05 }, { k: 'powerWeights.cultivation', label: 'Weight: cultivation', t: 'number', step: 0.05 },
    { k: 'includeNpcInBalance', label: 'Count NPC factions (Court, Guild) in Balance', t: 'check' },
  ], s);
  const champ = h('input', { value: (s.championRealmMult || []).join(', ') });
  openModal('World settings', h('div', { style: 'display:grid;gap:12px' }, f.el, h('label', { class: 'field wide' }, h('span', {}, 'Champion multiplier per realm (3rd Rate first)'), champ),
    h('div', { class: 'card warn bad' }, h('b', {}, 'Reset the world'), h('p', { class: 'small' }, 'Rebuilds every region, faction, market and event from the defaults. A backup is made first.'),
      h('button', { class: 'btn danger', onclick: run(async () => { const c = prompt('Type RESET to rebuild the world from scratch.'); if (c !== 'RESET') return; await api('/world/reset', { method: 'POST', body: { confirm: 'RESET' } }); toast('World reset.'); closeModal(); render(); }) }, 'Reset world…'))),
  [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: run(async () => { const v = deepMerge(s, f.read()); v.championRealmMult = champ.value.split(/[,\s]+/).filter(Boolean).map(Number); await api('/world/settings', { method: 'PUT', body: v }); toast('Saved.'); closeModal(); render(); }) }, 'Save')]);
}

/** A card listing one world list with add / edit (form + JSON for nested parts) / delete. */
function listEditorCard(title, listName, fields, line, { json = [], extra = null, help = '' } = {}) {
  const list = () => W_()[listName];
  const save = async (next) => { await api(`/world/list/${listName}`, { method: 'PUT', body: next }); await loadWorld(); toast('Saved.'); render(); };
  const edit = (entry, idx) => {
    const f = buildForm(fields, entry || {});
    const jf = json.map(([k, label, rows]) => [k, jsonField(label, entry?.[k] ?? (k === 'seasonal' ? null : {}), rows || 4)]);
    openModal(entry ? `${entry.emoji || ''} ${entry.name}` : `New — ${title}`, h('div', { style: 'display:grid;gap:10px' }, f.el, ...jf.map(([, el]) => el), help ? h('p', { class: 'muted small' }, help) : null), [
      entry ? h('button', { class: 'btn danger left', onclick: run(async () => { if (!confirm(`Delete ${entry.name}?`)) return; const next = clone(list()); next.splice(idx, 1); await save(next); closeModal(); }) }, 'Delete') : null,
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: run(async () => {
        const v = { ...(entry ? clone(entry) : {}), ...f.read() };
        for (const [k, el] of jf) v[k] = el.read();
        const next = clone(list());
        if (entry) next[idx] = v; else next.push(v);
        await save(next); closeModal();
      }) }, 'Save'),
    ].filter(Boolean));
  };
  return h('div', { class: 'card' },
    h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `${title} (${list().length})`), extra, h('button', { class: 'btn', onclick: () => edit(null) }, '+ Add')),
    h('div', { class: 'list', style: 'margin-top:8px' }, list().map((e, idx) => h('button', { class: 'btn ghost small', onclick: () => edit(e, idx) }, line(e)))),
  );
}

// ════════════════════════════════════════ EVENTS ════════════════════════════════════════
VIEWS.events = async () => {
  await loadWorld();
  const w = W_();
  const evSel = select(w.events.map((e) => [e.id, `${e.emoji} ${e.name}`]));
  const regSel = select(marketOpts());
  const dur = h('input', { type: 'number', placeholder: 'turns (default)', style: 'width:130px' });
  const effHelp = 'Per-turn effects. Keys: prosperity, security, unrest, corruption, population (%), production / demand / price / stockLoss ({ goodId | category | "*": multiplier }), caravanRisk, income, tax, tariff, coffers, supply, attrition, recruitCost.';
  return [
    worldStatusCard(),
    h('div', { class: 'card' }, h('h3', {}, 'Force an event'), h('div', { class: 'toolbar' }, evSel, regSel, dur, h('button', { class: 'btn primary', onclick: run(async () => { const r = await api('/world/events/force', { method: 'POST', body: { eventId: evSel.value, region: regSel.value, duration: dur.value ? Number(dur.value) : undefined } }); toast(r.event.text.replace(/\*/g, '')); render(); }) }, '⚡ Start now')),
      h('p', { class: 'muted small' }, 'Also from Discord: /admin event. Province-wide and neighbour events spread by themselves according to their scope.')),
    h('div', { class: 'card' }, h('h3', {}, `Happening now (${w.activeEvents.length})`), table([
      ['Event', (ae) => { const ev = w.events.find((e) => e.id === ae.eventId); return `${ev?.emoji || ''} ${ev?.name || ae.eventId}${ae.forced ? ' (forced)' : ''}`; }],
      ['Where', (ae) => ae.regions.map((k) => rname(k)).join(', ')], ['Turns', (ae) => `${ae.startTurn} → ${ae.endTurn}`],
      ['', (ae) => h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/active-events/${ae.id}`, { method: 'DELETE' }); render(); }) }, 'End')],
    ], w.activeEvents)),
    listEditorCard('Event templates', 'events', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' }, { k: 'enabled', label: 'Can happen', t: 'check' },
      { k: 'category', label: 'Category', t: 'select', opts: ['disaster', 'blessing', 'economic', 'political', 'social', 'military'] },
      { k: 'scope', label: 'Hits', t: 'select', opts: [['region', 'One region'], ['province', 'The whole province'], ['neighbors', 'Its neighbours'], ['faction', 'All of the ruler\'s land'], ['global', 'Everywhere']] },
      { k: 'weight', label: 'Weight (chance)', t: 'number', step: 0.05 }, { k: 'cooldown', label: 'Cooldown (turns)', t: 'number' },
      { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'announcement', label: 'Announcement ({region} {province} {turns} {controller})', t: 'textarea', wide: true },
      { k: 'scriptId', label: 'Custom code (eventStart / regionTick)', t: 'select', opts: scriptOpts },
    ], (e) => `${e.enabled === false ? '⏸ ' : ''}${e.emoji} ${e.name} — ${e.category} · weight ${e.weight}`, {
      json: [['duration', 'Duration [min, max] turns', 2], ['conditions', 'Conditions { seasons:[0-3], terrains:[...], minProsperity, maxProsperity, minUnrest, maxSecurity, minCorruption, minPopulation, requiresProduction, shortage, north, controllerKinds }', 5], ['effects', 'Effects per turn', 6], ['onStart', 'Once, when it starts (stock: { grain: -0.3 } = lose 30%)', 4], ['chain', 'Chain [{ eventId, chance (0-1), delay (turns) }]', 4], ['spread', 'Spread { chance, maxRegions } or null', 2]],
      help: effHelp,
    }),
    worldLogCard(),
  ];
};

function worldLogCard(kinds) {
  const list = (W_().log || []).filter((l) => !kinds || kinds.includes(l.kind)).slice(0, 80);
  return h('div', { class: 'card' }, h('h3', {}, 'World chronicle'), h('div', { class: 'list' }, list.map((l) => h('div', { class: 'small' }, h('span', { class: 'muted' }, `T${l.turn} · ${new Date(l.at).toLocaleString()} · `), plain(l.text)))));
}

// ════════════════════════════════════════ POLITICS ════════════════════════════════════════
VIEWS.politics = async () => {
  await loadWorld();
  const w = W_();
  const fs = w.factions;
  const members = (f) => WD.characters.filter((c) => f.sect && c.sect === f.sect).length;
  const land = (f) => Object.values(w.regions).filter((r) => r.controller === f.id && r.population !== undefined).length;
  const pending = w.proposals.filter((p) => p.status.startsWith('awaiting'));
  return [
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, 'Factions'), h('button', { class: 'btn', onclick: () => editFaction(null) }, '+ New faction')),
      table([
        ['Faction', (f) => h('span', {}, h('span', { class: 'dot', style: `background:${f.color}` }), `${f.icon || ''} `, h('b', {}, f.name), f.active ? '' : h('span', { class: 'muted' }, ' (inactive)'))],
        ['Kind', (f) => `${f.kind}${f.npc ? ' · NPC' : ''}`], ['Lands', land], ['Members', members], ['Treasury', (f) => fmtN(f.treasury)], ['Influence', (f) => fmt(f.influence)], ['Rep.', (f) => fmt(f.reputation)],
        ['Representatives', (f) => [f.leaderCharId, ...f.representatives].filter(Boolean).map(charName).join(', ') || h('span', { class: 'muted' }, 'none')],
        ['Policies', (f) => f.policies.map((p) => w.policies.find((x) => x.id === p.policyId)?.emoji || '').join(' ')],
        ['Shop', (f) => (f.shop.items.length ? `${f.shop.items.length} item(s) · ${f.shop.access}` : '—')],
      ], fs, editFaction)),
    pending.length ? h('div', { class: 'card' }, h('h3', {}, `Waiting proposals (${pending.length})`), table([
      ['Action', (p) => { const a = w.actions.find((x) => x.id === p.actionId); return `${a?.emoji || ''} ${a?.name || p.actionId}`; }], ['From → to', (p) => `${facName(p.from)} → ${facName(p.to)}`],
      ['Characters', (p) => (p.subjectCharId ? `${charName(p.subjectCharId)} ⇄ ${charName(p.targetCharId)}` : '')], ['Note', (p) => p.note], ['Waiting for', (p) => p.status.replace('awaiting-', '')],
      ['', (p) => h('div', { class: 'toolbar' }, h('button', { class: 'btn small primary', onclick: run(async () => { await api(`/world/proposals/${p.id}/approve`, { method: 'POST', body: {} }); toast('Approved.'); render(); }) }, 'Approve'), h('button', { class: 'btn small danger', onclick: run(async () => { await api(`/world/proposals/${p.id}/reject`, { method: 'POST', body: {} }); render(); }) }, 'Reject'))],
    ], pending)) : null,
    relationsCard(),
    treatiesCard(),
    diplomacyMapCard(),
    h('div', { class: 'card' }, h('h3', {}, `Marriages (${w.marriages.length})`), table([['Couple', (m) => `${charName(m.a)} 💍 ${charName(m.b)}`], ['Houses', (m) => m.factions.map(facName).join(' & ')], ['Since', (m) => `turn ${m.turn}`]], w.marriages)),
    listEditorCard('Policies', 'policies', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' }, { k: 'enabled', label: 'Available', t: 'check' },
      { k: 'scope', label: 'Applies to', t: 'select', opts: [['faction', 'All the faction\'s land'], ['region', 'One region']] },
      { k: 'cost.influence', label: 'Cost: influence', t: 'number' }, { k: 'cost.treasury', label: 'Cost: treasury', t: 'number' }, { k: 'upkeep.treasury', label: 'Upkeep / turn', t: 'number' }, { k: 'upkeep.influence', label: 'Influence upkeep / turn', t: 'number' },
      { k: 'fatigue', label: 'Fatigue / turn (0–1)', t: 'number', step: 0.01, help: 'Weakens every turn after the grace period' }, { k: 'grace', label: 'Grace (turns)', t: 'number' }, { k: 'floor', label: 'Never below', t: 'number', step: 0.05 }, { k: 'minTurns', label: 'Minimum turns', t: 'number' },
      { k: 'shopAccess', label: 'Sect shop access while active', t: 'select', opts: [['', '— unchanged —'], ['members', 'Members only'], ['allies', 'Members & allies'], ['everyone', 'Everyone']] },
      { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'scriptId', label: 'Custom code (regionTick)', t: 'select', opts: scriptOpts },
    ], (p) => `${p.emoji} ${p.name} — ${p.scope} · ${p.cost?.influence || 0} infl${p.upkeep?.treasury ? ` · ${p.upkeep.treasury}/turn` : ''}`, { json: [['effects', 'Effects per turn (treasury & influence go to the faction once; the rest to each region)', 6], ['kinds', 'Faction kinds allowed (empty = all)', 2], ['exclusive', 'Can\'t combine with (policy ids)', 2]] }),
    listEditorCard('Diplomacy actions', 'actions', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' }, { k: 'enabled', label: 'Available', t: 'check' },
      { k: 'category', label: 'Group', t: 'select', opts: ['courtesy', 'trade', 'alliance', 'marriage', 'murim', 'court', 'hostile'] },
      { k: 'costInfluence', label: 'Influence cost', t: 'number' }, { k: 'costTreasury', label: 'Treasury cost', t: 'number' }, { k: 'cooldown', label: 'Cooldown (turns)', t: 'number' },
      { k: 'unilateral', label: 'One-sided (no acceptance)', t: 'check' }, { k: 'needsCharacters', label: 'Needs a character from each side', t: 'check' }, { k: 'staffApproval', label: 'Staff must approve', t: 'check' },
      { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'scriptId', label: 'Custom code (diplomacy hook)', t: 'select', opts: scriptOpts },
    ], (a) => `${a.emoji} ${a.name} — ${a.category}${a.staffApproval ? ' · staff' : ''}`, { json: [['requires', 'Requires { minRelation, maxRelation, atWar: true/false/null, treaties: [...], noTreaties: [...] }', 4], ['onAccept', 'On accept { relation, treaty: { type, duration }, transfer, influence, reputation, war, endsWar, breaks: [...], breaksAny, marry, unmarry, bond, joinWar, reparations }', 5], ['onReject', 'On reject { relation }', 2], ['unlocks', 'Unlocks (arrows on the diplomacy map)', 2]] }),
    listEditorCard('Treaty types', 'treatyTypes', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' }, { k: 'drift', label: 'Relation drift / turn', t: 'number', step: 0.05 },
      { k: 'tribute', label: 'Tribute % of taxes', t: 'number' }, { k: 'shopTier', label: 'Sect shops treat as', t: 'select', opts: [['', '—'], ['ally', 'ally']] }, { k: 'tariffFree', label: 'No tariffs between them', t: 'check' },
      { k: 'description', label: 'Description', t: 'textarea', wide: true },
    ], (t) => `${t.emoji} ${t.name}`, { json: [['effects', 'Effects on both parties\' regions every turn', 4]] }),
    worldLogCard(['diplomacy', 'treaty', 'policy']),
  ].filter(Boolean);
};

function relationsCard() {
  const w = W_();
  const fs = w.factions.filter((f) => f.active);
  const cell = (a, b) => {
    if (a.id === b.id) return h('td', { style: 'background:#2a241e' }, '');
    const r = relOf(a.id, b.id);
    const t = (r.value + 100) / 200;
    return h('td', { title: `${a.name} ↔ ${b.name}: ${Math.round(r.value)}${r.war ? ' (WAR)' : ''}`, style: `background:${r.war ? '#5a0d0d' : ramp(t)};color:#111;text-align:center;cursor:pointer;font-size:11px;padding:4px`, onclick: () => editRelation(a, b) }, r.war ? '⚔' : Math.round(r.value));
  };
  return h('div', { class: 'card' }, h('h3', {}, 'Relations'), h('p', { class: 'muted small' }, 'Click a cell to change it. Relations drift back toward 0 slowly; treaties push them up, wars down.'),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), fs.map((f) => h('th', { title: f.name, style: 'writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px' }, f.name)))),
      h('tbody', {}, fs.map((a) => h('tr', {}, h('th', { style: 'font-size:11px' }, `${a.icon || ''} ${a.name}`), fs.map((b) => cell(a, b))))))));
}
function editRelation(a, b) {
  const r = relOf(a.id, b.id);
  const v = h('input', { type: 'number', min: -100, max: 100, value: Math.round(r.value) });
  const war = h('input', { type: 'checkbox' }); war.checked = !!r.war;
  openModal(`${a.name} ↔ ${b.name}`, h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', {}, 'Relation (−100 to 100)'), v), h('label', { class: 'field check' }, war, h('span', {}, 'At war'))),
    [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: run(async () => { await api('/world/relations', { method: 'PUT', body: { a: a.id, b: b.id, value: Number(v.value), war: war.checked } }); closeModal(); render(); }) }, 'Save')]);
}

function treatiesCard() {
  const w = W_();
  return h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `Treaties & agreements (${w.treaties.length})`), h('button', { class: 'btn', onclick: () => editTreaty(null) }, '+ Custom agreement')),
    table([
      ['Treaty', (t) => `${w.treatyTypes.find((x) => x.id === t.type)?.emoji || '📜'} ${t.name}`], ['Between', (t) => t.parties.map(facName).join(' & ')],
      ['Ends', (t) => (t.endTurn ? `turn ${t.endTurn}` : 'never')], ['Terms', (t) => [t.payer ? `${facName(t.payer)} pays ${facName(t.receiver)}` : '', t.couple ? t.couple.map(charName).join(' 💍 ') : '', t.scriptId ? '⚙ custom code' : '', t.note].filter(Boolean).join(' · ')],
    ], w.treaties, editTreaty));
}
function editTreaty(t) {
  const w = W_();
  const v = t ? clone(t) : { type: 'custom', name: '', parties: [w.factions[0]?.id, w.factions[1]?.id], duration: 0, terms: {}, effects: {}, scriptId: '', note: '' };
  const f = buildForm([
    { k: 'type', label: 'Type', t: 'select', opts: w.treatyTypes.map((x) => [x.id, `${x.emoji} ${x.name}`]) }, { k: 'name', label: 'Name' },
    { k: 'parties.0', label: 'Party A', t: 'select', opts: factionOpts() }, { k: 'parties.1', label: 'Party B', t: 'select', opts: factionOpts() },
    { k: 'payer', label: 'Payer (tribute)', t: 'select', opts: factionOpts() }, { k: 'receiver', label: 'Receiver', t: 'select', opts: factionOpts() },
    t ? { k: 'endTurn', label: 'Ends on turn (empty = never)', t: 'number', nullable: true } : { k: 'duration', label: 'Duration (turns, 0 = forever)', t: 'number' },
    { k: 'scriptId', label: 'Custom code (treatyTick)', t: 'select', opts: scriptOpts, help: 'For very specific agreements: move Nyang, change relations or end it by its terms' },
    { k: 'note', label: 'What was agreed (shown to staff)', t: 'textarea', wide: true },
  ], v);
  const terms = jsonField('Terms (free data your custom code can read, e.g. { "tribute": 10, "fixed": 50 })', v.terms, 3);
  const eff = jsonField('Effects on both parties\' regions every turn (same keys as events/policies)', v.effects, 4);
  openModal(t ? t.name : 'New agreement', h('div', { style: 'display:grid;gap:10px' }, f.el, terms, eff), [
    t ? h('button', { class: 'btn danger left', onclick: run(async () => { if (!confirm('End this treaty?')) return; await api(`/world/treaties/${t.id}`, { method: 'DELETE' }); closeModal(); render(); }) }, 'End treaty') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const x = f.read(); const body = { ...x, parties: [x.parties[0], x.parties[1]], terms: terms.read(), effects: eff.read() };
      if (t) await api(`/world/treaties/${t.id}`, { method: 'PUT', body }); else await api('/world/treaties', { method: 'POST', body });
      closeModal(); render();
    }) }, 'Save'),
  ].filter(Boolean));
}

function diplomacyMapCard() {
  const w = W_();
  const fromSel = select(factionOpts('— from —'), w.factions[0]?.id);
  const toSel = select(factionOpts('— to —'), w.factions[1]?.id);
  const box = h('div', { class: 'table-wrap', style: 'background:#17130f' });
  const info = h('p', { class: 'muted small' }, 'Hover an action to see what it needs. Arrows: grey = opens the way to, gold = needs the treaty made by.');
  const draw = run(async () => {
    const g = await api(`/world/diplomacy-graph?from=${encodeURIComponent(fromSel.value)}&to=${encodeURIComponent(toSel.value)}`);
    const cats = ['courtesy', 'trade', 'murim', 'alliance', 'marriage', 'court', 'hostile'];
    const colW = 170; const rowH = 54;
    const pos = {}; const counts = {};
    for (const n of g.nodes) { const c = Math.max(0, cats.indexOf(n.category)); const i = (counts[c] = (counts[c] || 0) + 1) - 1; pos[n.id] = [30 + c * colW, 50 + i * rowH]; }
    const H = 60 + Math.max(...Object.values(counts)) * rowH;
    const svg = sv('svg', { width: 30 + cats.length * colW, height: H, viewBox: `0 0 ${30 + cats.length * colW} ${H}` },
      sv('defs', {}, sv('marker', { id: 'darr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, sv('path', { d: 'M0 0 L10 5 L0 10z', fill: '#8a7a62' }))));
    cats.forEach((c, i) => svg.append(sv('text', { x: 30 + i * colW + 70, y: 24, fill: '#d9a441', 'font-size': 13, 'text-anchor': 'middle', 'font-family': 'Cormorant Garamond, serif', 'font-weight': 700 }, c[0].toUpperCase() + c.slice(1))));
    for (const e of g.edges) { const a = pos[e.from]; const b = pos[e.to]; if (!a || !b) continue; svg.append(sv('path', { d: `M${a[0] + 140} ${a[1] + 16} C ${a[0] + 160} ${a[1] + 16}, ${b[0] - 20} ${b[1] + 16}, ${b[0]} ${b[1] + 16}`, fill: 'none', stroke: e.kind === 'requires' ? '#d9a441' : '#8a7a62', 'stroke-width': 1.2, opacity: 0.7, 'marker-end': 'url(#darr)' })); }
    for (const n of g.nodes) {
      const [x, y] = pos[n.id];
      const fill = n.available === null ? '#2b251f' : n.available ? '#1f3d26' : '#3a1d1a';
      const stroke = n.available === null ? '#5a4f42' : n.available ? '#4f9d5d' : '#8a3a30';
      const node = sv('g', {}, sv('rect', { x, y, width: 140, height: 32, rx: 6, fill, stroke }), sv('text', { x: x + 8, y: y + 20, fill: '#ece4d6', 'font-size': 12, 'font-family': 'IBM Plex Sans, sans-serif' }, `${n.emoji} ${n.name.length > 19 ? `${n.name.slice(0, 18)}…` : n.name}`), sv('title', {}, `${n.name}${n.staffApproval ? ' (staff approve)' : ''}${n.unilateral ? ' (one-sided)' : ''}\n${n.description}${n.reasons?.length ? `\n\n🔒 ${n.reasons.join('\n🔒 ')}` : n.available ? '\n\n✅ Available now' : ''}`));
      node.addEventListener('mouseenter', () => { info.textContent = `${n.emoji} ${n.name}: ${n.description} ${n.reasons?.length ? `— 🔒 ${n.reasons.join(' · ')}` : n.available ? '— ✅ available now' : ''}`; });
      svg.append(node);
    }
    box.replaceChildren(svg);
  });
  fromSel.onchange = draw; toSel.onchange = draw;
  setTimeout(draw, 0);
  const proposeBtn = h('button', { class: 'btn', onclick: () => staffPropose(fromSel.value, toSel.value) }, '📜 Make a proposal as staff');
  return h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, 'Diplomacy map'), fromSel, h('span', {}, '→'), toSel, proposeBtn),
    h('p', { class: 'muted small' }, 'Every decision a faction can take toward another, and what each opens up. Green = possible right now for the pair you picked, red = locked (hover for why).'), info, box);
}
function staffPropose(from, to) {
  const w = W_();
  const f = buildForm([
    { k: 'actionId', label: 'Action', t: 'select', opts: w.actions.map((a) => [a.id, `${a.emoji} ${a.name}`]) },
    { k: 'from', label: 'From', t: 'select', opts: factionOpts() }, { k: 'to', label: 'To', t: 'select', opts: factionOpts() },
    { k: 'subjectCharId', label: 'Their character (from side)', t: 'select', opts: () => [['', '—'], ...WD.characters.map((c) => [c.id, `${c.name} (${c.sect || 'Rogue'})`])] },
    { k: 'targetCharId', label: 'Character (to side)', t: 'select', opts: () => [['', '—'], ...WD.characters.map((c) => [c.id, `${c.name} (${c.sect || 'Rogue'})`])] },
    { k: 'autoAccept', label: 'Skip acceptance (apply now)', t: 'check' }, { k: 'note', label: 'Note', t: 'textarea', wide: true },
  ], { actionId: w.actions[0].id, from, to });
  openModal('Staff proposal', f.el, [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: run(async () => { const r = await api('/world/proposals', { method: 'POST', body: f.read() }); toast(`Proposal ${r.proposal.status}.`); closeModal(); render(); }) }, 'Send')]);
}

function editFaction(f) {
  const w = W_();
  const v = f ? clone(f) : { name: '', kind: 'other', alignment: 'Neutral', color: '#888888', treasury: 2000, influence: 60, reputation: 50, active: true, representatives: [], shop: { access: 'everyone', items: [] }, policies: [] };
  const chars = () => [['', '—'], ...WD.characters.map((c) => [c.id, `${c.name} (${c.sect || 'Rogue'})`])];
  const form = buildForm([
    { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字' }, { k: 'icon', label: 'Emoji' }, { k: 'color', label: 'Colour', t: 'color' },
    { k: 'kind', label: 'Kind', t: 'select', opts: ['sect', 'clan', 'palace', 'cult', 'court', 'guild', 'bandits', 'other'] }, { k: 'alignment', label: 'Alignment', t: 'select', opts: ['Orthodox', 'Unorthodox', 'Neutral', 'Imperial', 'Demonic'] },
    { k: 'sect', label: 'Linked sect (members)', t: 'select', opts: () => [['', '— none —'], ...WD.sects.map((s) => [s.name, s.name])] }, { k: 'hq', label: 'Headquarters', t: 'select', opts: () => [['', '—'], ...marketOpts()] },
    { k: 'active', label: 'Active', t: 'check' }, { k: 'npc', label: 'NPC (not for players)', t: 'check' },
    { k: 'treasury', label: 'Treasury', t: 'number' }, { k: 'influence', label: 'Influence', t: 'number' }, { k: 'reputation', label: 'Reputation (0–100)', t: 'number' },
    { section: 'Sect Representatives' },
    { k: 'leaderCharId', label: 'Leader', t: 'select', opts: chars },
    { k: 'repRoleId', label: 'Representative role', t: 'role', help: 'Sect members with this Discord role are representatives' },
    { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'scriptId', label: 'Custom code (factionTick, regionTick, diplomacy, battleRound, shopPrice)', t: 'select', opts: scriptOpts, wide: true },
  ], v);
  const repSel = h('select', { multiple: true }, WD.characters.map((c) => h('option', { value: c.id }, `${c.name} (${c.sect || 'Rogue'})`)));
  [...repSel.options].forEach((o) => (o.selected = v.representatives.includes(o.value)));
  // shop
  const shop = clone(v.shop);
  const shopWrap = h('div');
  const access = select([['everyone', 'Open to everyone (except enemies)'], ['allies', 'Members & allies only'], ['members', 'Members only (closed gates)']], shop.access);
  access.onchange = () => (shop.access = access.value);
  const drawShop = () => shopWrap.replaceChildren(table([
    ['Item', (e) => { const s = select(WD.items.filter((i) => !i.tradeGood).map((i) => [i.id, `${i.name} (${i.type})`]), e.itemId); s.onchange = () => (e.itemId = s.value); return s; }],
    ['Price', (e) => { const i = h('input', { type: 'number', value: e.price ?? '', placeholder: `shop ${WD.items.find((x) => x.id === e.itemId)?.price || ''}`, style: 'width:80px' }); i.onchange = () => (e.price = i.value === '' ? null : Number(i.value)); return i; }],
    ['Stock', (e) => { const i = h('input', { type: 'number', value: e.stock, style: 'width:70px', title: '-1 = unlimited' }); i.onchange = () => (e.stock = Number(i.value)); return i; }],
    ['+ / turn', (e) => { const i = h('input', { type: 'number', value: e.restock || 0, style: 'width:60px' }); i.onchange = () => (e.restock = Number(i.value)); return i; }],
    ['Who', (e) => { const s = select([['inherit', 'shop rule'], ['everyone', 'everyone'], ['allies', 'allies'], ['members', 'members']], e.access); s.onchange = () => (e.access = s.value); return s; }],
    ['', (e) => h('button', { class: 'btn small danger', onclick: () => { shop.items.splice(shop.items.indexOf(e), 1); drawShop(); } }, '✕')],
  ], shop.items));
  drawShop();
  // policies
  const polWrap = h('div');
  if (f) {
    const adopted = [...f.policies.map((p) => ({ ...p, region: '' })), ...Object.entries(w.regions).flatMap(([k, r]) => (r.policies || []).filter((p) => p.factionId === f.id).map((p) => ({ ...p, region: k })))];
    const polSel = select(w.policies.map((p) => [p.id, `${p.emoji} ${p.name} (${p.scope})`]));
    const regSel = select([['', '— (faction-wide) —'], ...Object.entries(w.regions).filter(([, r]) => r.controller === f.id && r.population !== undefined).map(([k]) => [k, rfull(k)])]);
    const free = h('input', { type: 'checkbox' });
    polWrap.append(
      h('div', { class: 'list' }, adopted.map((p) => { const d = w.policies.find((x) => x.id === p.policyId); return h('div', { class: 'toolbar small' }, h('span', { class: 'grow' }, `${d?.emoji || ''} ${d?.name || p.policyId}${p.region ? ` — ${rname(p.region)}` : ''} · since turn ${p.since}`), h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/factions/${f.id}/policies/${p.policyId}?region=${encodeURIComponent(p.region)}`, { method: 'DELETE' }); closeModal(); render(); }) }, 'Revoke')); })),
      h('div', { class: 'toolbar', style: 'margin-top:6px' }, polSel, regSel, h('label', { class: 'field check' }, free, h('span', {}, 'free')), h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/factions/${f.id}/policies`, { method: 'POST', body: { policyId: polSel.value, region: regSel.value, free: free.checked } }); toast('Adopted.'); closeModal(); render(); }) }, 'Adopt')),
    );
  }
  openModal(f ? `${f.icon || ''} ${f.name}` : 'New faction', h('div', { style: 'display:grid;gap:12px' }, form.el,
    h('label', { class: 'field wide' }, h('span', {}, 'Representatives (characters who speak for the faction in /world → Politics and War)'), repSel),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, '🏯 Sect shop'), access, h('button', { class: 'btn small', onclick: () => { shop.items.push({ itemId: WD.items[0]?.id, price: null, stock: -1, restock: 0, access: 'inherit' }); drawShop(); } }, '+ Item')),
      h('p', { class: 'muted small' }, `Prices: members ${W_().settings.shopTiers.member}% · allies ${W_().settings.shopTiers.ally}% · outsiders +${W_().settings.shopTiers.neutral}% · rivals +${W_().settings.shopTiers.rival}% · enemies at war can't buy. Items linked to a good (item editor → World economy) also follow its local price.`), shopWrap),
    f ? h('div', { class: 'card' }, h('h3', {}, '🏛️ Policies'), polWrap) : null,
  ), [
    f && !f.sect ? h('button', { class: 'btn danger left', onclick: run(async () => { if (!confirm(`Delete ${f.name}?`)) return; await api(`/world/factions/${f.id}`, { method: 'DELETE' }); closeModal(); render(); }) }, 'Delete') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const body = { ...form.read(), representatives: [...repSel.selectedOptions].map((o) => o.value), shop };
      if (f) await api(`/world/factions/${f.id}`, { method: 'PUT', body }); else await api('/world/factions', { method: 'POST', body });
      toast('Saved.'); closeModal(); render();
    }) }, 'Save'),
  ].filter(Boolean));
}

// ════════════════════════════════════════ WAR ════════════════════════════════════════
VIEWS.war = async () => {
  await loadWorld();
  const w = W_();
  const men = (a) => Object.values(a.units).reduce((s, n) => s + n, 0);
  const preparing = w.battles.filter((b) => b.status === 'preparing');
  const fought = w.battles.filter((b) => b.status === 'fought').slice(0, 10);
  return [
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `Armies (${w.armies.length})`), h('button', { class: 'btn', onclick: () => editArmy(null) }, '+ Raise army (staff)'), h('button', { class: 'btn', onclick: openBattleForm }, '⚔️ Start a battle')),
      table([
        ['Army', (a) => h('b', {}, a.name)], ['Faction', (a) => facName(a.factionId)], ['Where', (a) => `${rname(a.region)}${a.march ? ` → ${rname(a.march.path[a.march.path.length - 1])}` : ''}`],
        ['Men', (a) => fmtN(men(a))], ['Troops', (a) => Object.entries(a.units).map(([k, n]) => `${fmtN(n)} ${w.unitTypes.find((u) => u.id === k)?.name || k}`).join(' · ')],
        ['Morale', (a) => fmt(a.morale)], ['Supply', (a) => fmt(a.supply)], ['Formation', (a) => w.formations.find((f) => f.id === a.formationId)?.name || a.formationId], ['Commander', (a) => charName(a.commanderId)], ['Status', (a) => a.status],
      ], w.armies, editArmy)),
    ...preparing.map(battleCard),
    fought.length ? h('div', { class: 'card' }, h('h3', {}, 'Recent battles'), table([
      ['Battle', (b) => `⚔️ ${rname(b.region)}`], ['Sides', (b) => `${facName(b.sides.A.factionId)} vs ${facName(b.sides.D.factionId)}`], ['Winner', (b) => facName(b.result?.winnerFaction)],
      ['Losses', (b) => `${fmtN(b.result?.lost?.A)} / ${fmtN(b.result?.lost?.D)}`], ['Rounds', (b) => b.rounds.map((r) => `${w.tactics.find((t) => t.id === r.tactics.A)?.emoji || ''}${w.tactics.find((t) => t.id === r.tactics.D)?.emoji || ''}`).join(' ')], ['Duels', (b) => b.duels.length],
    ], fought)) : null,
    simulatorCard(),
    listEditorCard('Formations', 'formations', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字' }, { k: 'emoji', label: 'Emoji' },
      { k: 'attack', label: 'Attack ×', t: 'number', step: 0.05 }, { k: 'defense', label: 'Defence ×', t: 'number', step: 0.05 }, { k: 'speed', label: 'Speed ×', t: 'number', step: 0.05 }, { k: 'morale', label: 'Morale / round', t: 'number' },
      { k: 'enemyTactics', label: 'Enemy tactics × (confusion)', t: 'number', step: 0.05, help: '0.85 = enemy tactic bonuses are 15% weaker' },
      { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'scriptId', label: 'Custom code (battleRound)', t: 'select', opts: scriptOpts },
    ], (f) => `${f.emoji} ${f.name} ${f.hanzi || ''} — atk ×${f.attack} · def ×${f.defense}`, { json: [['vsRole', 'Extra attack vs troop roles { cavalry: 1.15 }', 2], ['counters', 'Extra attack vs formations { arrowhead: 1.2 }', 2], ['tactics', 'Boosts tactics { charge: 1.2 }', 2], ['requires', 'Requires { minMen, roles: { cavalry: 0.15 }, commanderRealm (0 = 3rd Rate), commanderSect: [...] }', 3]] }),
    listEditorCard('Troop types', 'unitTypes', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' }, { k: 'role', label: 'Role', t: 'select', opts: ['infantry', 'spear', 'ranged', 'cavalry', 'martial', 'siege'] },
      { k: 'attack', label: 'Attack / man', t: 'number', step: 0.5 }, { k: 'defense', label: 'Defence / man', t: 'number', step: 0.5 }, { k: 'speed', label: 'Speed', t: 'number', step: 0.1 },
      { k: 'cost', label: 'Cost / 100', t: 'number' }, { k: 'upkeep', label: 'Upkeep / 100 / turn', t: 'number', step: 0.5 }, { k: 'volley', label: 'Volley ×', t: 'number', step: 0.1 }, { k: 'pursuit', label: 'Pursuit ×', t: 'number', step: 0.1 }, { k: 'siege', label: 'Siege (ignores walls)', t: 'number', step: 0.05 },
      { k: 'description', label: 'Description', t: 'textarea', wide: true },
    ], (u) => `${u.emoji} ${u.name} — ${u.role} · atk ${u.attack} · def ${u.defense} · ${u.cost}/100`, { json: [['needs', 'Equipment per 100 men, bought from the market { arms: 1.5, horses: 1 }', 2], ['counters', 'Extra attack vs roles { cavalry: 1.6 }', 2], ['kinds', 'Only these faction kinds (empty = all)', 2]] }),
    listEditorCard('Tactics', 'tactics', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' }, { k: 'attack', label: 'Attack ×', t: 'number', step: 0.05 }, { k: 'defense', label: 'Defence ×', t: 'number', step: 0.05 },
      { k: 'ranged', label: 'Ranged ×', t: 'number', step: 0.05 }, { k: 'melee', label: 'Melee ×', t: 'number', step: 0.05 }, { k: 'cavalry', label: 'Cavalry ×', t: 'number', step: 0.05 },
      { k: 'moraleHit', label: 'Enemy morale hit (round 1)', t: 'number' }, { k: 'exposes', label: 'Enemy next defence ×', t: 'number', step: 0.05 }, { k: 'backfire', label: 'Backfire chance', t: 'number', step: 0.05 },
      { k: 'firstRoundOnly', label: 'First round only', t: 'check' }, { k: 'needsAmbush', label: 'Needs hiding terrain', t: 'check' }, { k: 'retreat', label: 'Ends the battle (retreat)', t: 'check' },
      { k: 'description', label: 'Description', t: 'textarea', wide: true },
    ], (t) => `${t.emoji} ${t.name} — atk ×${t.attack} · def ×${t.defense}`, { json: [['beats', 'Beats { enemyTacticId: × attack }', 2], ['seasons', 'Only in seasons [0 spring … 3 winter] (or null)', 2]] }),
    warFormulas(),
  ].filter(Boolean);
};

function battleCard(b) {
  const w = W_();
  const side = (k) => b.sides[k];
  const champs = (k) => side(k).champions.map(charName).join(', ') || '—';
  const wSel = select([['', '— winner —'], ...[...side('A').champions, ...side('D').champions].map((id) => [id, charName(id)])]);
  const lSel = select([['', '— loser —'], ...[...side('A').champions, ...side('D').champions].map((id) => [id, charName(id)])]);
  const note = h('input', { placeholder: 'link to the RP / note' });
  const planRow = (k) => {
    const fm = select(w.formations.map((f) => [f.id, `${f.emoji} ${f.name}`]), side(k).formationId);
    const plan = h('input', { value: (side(k).plan || []).join(', '), placeholder: 'volley, hold, charge, hold, charge' });
    const cmd = select([['', '— commander —'], ...WD.characters.map((c) => [c.id, c.name])], side(k).commanderId);
    const chSel = h('select', { multiple: true, style: 'min-height:70px' }, WD.characters.map((c) => h('option', { value: c.id }, `${c.name} (${c.sect || 'Rogue'}) · ${Math.round(c.champion)}`)));
    [...chSel.options].forEach((o) => (o.selected = side(k).champions.includes(o.value)));
    return h('div', { class: 'card' }, h('b', {}, `${k === 'A' ? '🗡️ Attacker' : '🛡️ Defender'}: ${facName(side(k).factionId)}`), h('p', { class: 'small muted' }, `Momentum +${Math.round(side(k).momentum * 100)}%${side(k).moraleShock ? ` · morale −${side(k).moraleShock}` : ''} · champions: ${champs(k)}`),
      h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', {}, 'Formation'), fm), h('label', { class: 'field' }, h('span', {}, 'Commander'), cmd), h('label', { class: 'field wide' }, h('span', {}, `Tactics per round (${w.tactics.map((t) => t.id).join(', ')})`), plan), h('label', { class: 'field wide' }, h('span', {}, 'Champions (power)'), chSel)),
      h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/battles/${b.id}/plan`, { method: 'POST', body: { side: k, formationId: fm.value, commanderId: cmd.value, plan: plan.value.split(/[,\s]+/).filter(Boolean), champions: [...chSel.selectedOptions].map((o) => o.value) } }); toast('Plan saved.'); render(); }) }, 'Save side'));
  };
  return h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `🔥 Battle of ${rname(b.region)} — fought ${new Date(b.resolveAt).toLocaleString()}`), h('button', { class: 'btn danger', onclick: run(async () => { if (!confirm('Fight the battle now?')) return; await api(`/world/battles/${b.id}/resolve`, { method: 'POST', body: {} }); render(); }) }, 'Fight now')),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(300px,1fr))' }, planRow('A'), planRow('D')),
    h('div', { class: 'toolbar', style: 'margin-top:8px' }, h('b', {}, '🤺 Record a duel:'), wSel, lSel, note, h('button', { class: 'btn', onclick: run(async () => { const r = await api(`/world/battles/${b.id}/duel`, { method: 'POST', body: { winner: wSel.value, loser: lSel.value, note: note.value } }); toast(plain(r.text)); render(); }) }, 'Record')),
    b.duels.length ? h('p', { class: 'small' }, b.duels.map((d) => `🤺 ${charName(d.winner)} beat ${charName(d.loser)}${d.note ? ` (${d.note})` : ''}`).join(' · ')) : null);
}

function openBattleForm() {
  const w = W_();
  const armies = w.armies.filter((a) => a.status !== 'disbanded');
  const att = h('select', { multiple: true }, armies.map((a) => h('option', { value: a.id }, `${a.name} — ${rname(a.region)}`)));
  const def = h('select', { multiple: true }, armies.map((a) => h('option', { value: a.id }, `${a.name} — ${rname(a.region)}`)));
  const reg = select(marketOpts());
  const hours = h('input', { type: 'number', value: w.settings.battlePrepHours });
  openModal('Start a battle', h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', {}, 'Attackers'), att), h('label', { class: 'field' }, h('span', {}, 'Defenders'), def), h('label', { class: 'field' }, h('span', {}, 'Where'), reg), h('label', { class: 'field' }, h('span', {}, 'Preparation hours (RP duels)'), hours)),
    [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: run(async () => { await api('/world/battles', { method: 'POST', body: { attackers: [...att.selectedOptions].map((o) => o.value), defenders: [...def.selectedOptions].map((o) => o.value), region: reg.value, hours: Number(hours.value) } }); closeModal(); render(); }) }, 'Open battle')]);
}

function editArmy(a) {
  const w = W_();
  const v = a ? clone(a) : { name: '', factionId: w.factions[0]?.id, region: WD.markets[0], units: {}, morale: 70, supply: 100, formationId: 'square', stance: 'balanced', commanderId: '' };
  const f = buildForm([
    { k: 'name', label: 'Name' }, { k: 'factionId', label: 'Faction', t: 'select', opts: factionOpts() }, { k: 'region', label: 'Where', t: 'select', opts: marketOpts },
    { k: 'formationId', label: 'Formation', t: 'select', opts: w.formations.map((x) => [x.id, `${x.emoji} ${x.name}`]) }, { k: 'stance', label: 'Stance', t: 'select', opts: ['aggressive', 'balanced', 'defensive'] },
    { k: 'commanderId', label: 'Commander', t: 'select', opts: () => [['', '—'], ...WD.characters.map((c) => [c.id, c.name])] },
    { k: 'morale', label: 'Morale', t: 'number' }, { k: 'supply', label: 'Supply', t: 'number' },
    { section: 'Troops' }, ...w.unitTypes.map((u) => ({ k: `units.${u.id}`, label: `${u.emoji} ${u.name}`, t: 'number' })),
  ], v);
  const marchSel = select([['', '— march to —'], ...marketOpts()]);
  openModal(a ? a.name : 'Raise an army', h('div', { style: 'display:grid;gap:10px' }, f.el, a ? h('div', { class: 'toolbar' }, marchSel, h('button', { class: 'btn', onclick: run(async () => { if (!marchSel.value) return; await api(`/world/armies/${a.id}/march`, { method: 'POST', body: { to: marchSel.value } }); toast('Marching.'); closeModal(); render(); }) }, 'March')) : null), [
    a ? h('button', { class: 'btn danger left', onclick: run(async () => { if (!confirm('Disband this army?')) return; await api(`/world/armies/${a.id}`, { method: 'DELETE' }); closeModal(); render(); }) }, 'Disband') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => { const x = f.read(); if (a) await api(`/world/armies/${a.id}`, { method: 'PUT', body: x }); else await api('/world/armies', { method: 'POST', body: x }); closeModal(); render(); }) }, 'Save'),
  ].filter(Boolean));
}

function simulatorCard() {
  const w = W_();
  const side = (label, units) => {
    const v = { units, formationId: 'square', plan: '', morale: 70, momentum: 0, champions: '' };
    const f = buildForm([...w.unitTypes.map((u) => ({ k: `units.${u.id}`, label: `${u.emoji} ${u.name}`, t: 'number' })), { k: 'formationId', label: 'Formation', t: 'select', opts: w.formations.map((x) => [x.id, x.name]) }, { k: 'morale', label: 'Morale', t: 'number' }, { k: 'momentum', label: 'Momentum (duels, 0–0.3)', t: 'number', step: 0.01 }, { k: 'plan', label: 'Tactics (comma separated)', wide: true }, { k: 'champions', label: 'Champion powers (comma separated)', wide: true, help: 'Power = (STR+END+MOB) × realm multiplier' }], v);
    return { el: h('div', { class: 'card' }, h('b', {}, label), f.el), read: () => { const x = f.read(); return { ...x, plan: String(x.plan || '').split(/[,\s]+/).filter(Boolean), champions: String(x.champions || '').split(/[,\s]+/).filter(Boolean).map(Number) }; } };
  };
  const A = side('🗡️ Attacker', { spearmen: 1000, crossbows: 400 }); const Dd = side('🛡️ Defender', { swordsmen: 900, disciples: 100 });
  const terrain = select(Object.entries(w.terrains).map(([k, t]) => [k, `${t.emoji} ${t.label}`]), 'plains');
  const fort = h('input', { type: 'number', value: 0, min: 0, max: 5, style: 'width:70px' });
  const out = h('div');
  return h('div', { class: 'card' }, h('h3', {}, '🎲 Battle simulator'), h('p', { class: 'muted small' }, 'Runs the real battle code 300 times on made-up armies (nothing in the world changes). Use it to balance troops and formations.'),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(300px,1fr))' }, A.el, Dd.el),
    h('div', { class: 'toolbar', style: 'margin-top:8px' }, terrain, h('span', {}, 'walls'), fort, h('button', { class: 'btn primary', onclick: run(async () => { const r = await api('/world/simulate', { method: 'POST', body: { A: A.read(), D: Dd.read(), terrain: terrain.value, fort: Number(fort.value), runs: 300 } }); out.replaceChildren(h('p', {}, h('b', {}, `Attacker wins ${r.attackerWins}%`), ` · average losses ${fmtN(r.avgLossA)} (attacker) / ${fmtN(r.avgLossD)} (defender) · ${r.avgRounds} rounds`)); }) }, 'Simulate'), out));
}

function warFormulas() {
  const s = W_().settings;
  return h('div', { class: 'card ref' }, h('h3', {}, 'How battles work'),
    h('p', {}, `When hostile armies meet, a battle opens for ${s.battlePrepHours} h. Commanders pick a formation and a tactic per round; characters join as champions; staff record in-character duels (each win: +${Math.round(s.duelMomentum * 100)}% momentum, max ${Math.round(s.maxMomentum * 100)}%; a beaten commander costs their army 15 morale). Then ${s.battleRounds} rounds are fought:`),
    h('p', {}, h('code', {}, 'attack = Σ men × attack × counters × terrain × formation × tactic (× beats) × (0.5 + morale/200) × (0.6 + 0.4 × supply/100) × (1 + momentum) + champions')),
    h('p', {}, h('code', {}, 'defence = Σ men × defence × terrain × formation × tactic × walls (defender: 1 + 8% per wall level, less with siege engineers) + champions × 0.5')),
    h('p', {}, h('code', {}, 'losses = min(35%, 10% × attack ÷ enemy defence × luck 0.85–1.15)'), ' — morale falls 1.6 per 1% lost. Below 25 morale an army routs; cavalry chase routed or retreating armies. If nobody breaks, the side with 5+ more morale wins; otherwise the defender holds.'),
    h('p', {}, h('code', {}, 'champion power = (Strength + Endurance + Mobility) × realm multiplier'), ` (${(s.championRealmMult || []).join(', ')}) × ${s.championScale}.`),
    h('p', { class: 'muted small' }, 'Armies cost upkeep every turn, eat grain where they stand (raising its price), and lose supply in enemy land. An unopposed army at war with a region\'s ruler occupies it: the occupier collects its taxes.'));
}

// ════════════════════════════════════════ BALANCE ════════════════════════════════════════
VIEWS.balance = async () => {
  await loadWorld();
  const npc = h('input', { type: 'checkbox' }); npc.checked = !!W_().settings.includeNpcInBalance;
  const wrap = h('div');
  const draw = run(async () => {
    const r = await api(`/world/balance?npc=${npc.checked ? 1 : 0}`);
    const bar = (v, max, color) => h('div', { style: 'display:flex;align-items:center;gap:6px' }, h('div', { style: `height:10px;width:${Math.max(2, (v / Math.max(1e-9, max)) * 120)}px;background:${color};border-radius:3px` }), h('span', { class: 'small' }, `${fmt(v)}%`));
    const maxPi = Math.max(...r.rows.map((x) => x.pi), 1);
    wrap.replaceChildren(
      h('div', { class: 'grid' },
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Verdict'), h('b', { class: r.verdict === 'Balanced' ? 'ok' : 'bad' }, r.verdict)),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'HHI (fair = ' + r.hhiFair + ')'), h('b', {}, r.hhi), h('small', { class: 'muted' }, 'above 0.25 = one faction dominates')),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Dominance (top ÷ median)'), h('b', {}, `${r.dominance}×`)),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Recommended for new players'), h('b', { style: 'font-size:18px' }, r.recommend.map((x) => `${x.icon || ''} ${x.name}`).join(' · ') || '—'))),
      h('div', { class: 'card' }, table([
        ['Faction', (x) => h('span', {}, h('span', { class: 'dot', style: `background:${x.color}` }), `${x.icon || ''} ${x.name}`)],
        ['① Power Index', (x) => bar(x.pi, maxPi, x.color)],
        ['② vs fair share', (x) => h('b', { class: x.gap > 3 ? 'bad' : x.gap < -3 ? 'muted' : 'ok' }, `${x.gap > 0 ? '+' : ''}${fmt(x.gap)} pts`)],
        ['③ Recruitment need', (x) => h('b', { class: x.need >= 50 ? 'ok' : '' }, fmt(x.need))],
        ['Military', (x) => `${fmt(x.share.military)}%`], ['Economy', (x) => `${fmt(x.share.economy)}%`], ['Politics', (x) => `${fmt(x.share.politics)}%`], ['Cultivation', (x) => `${fmt(x.share.cultivation)}%`],
        ['Members', (x) => x.pillars.members], ['Lands', (x) => x.pillars.regions], ['Men', (x) => fmtN(x.pillars.men)],
      ], r.rows)),
      h('div', { class: 'card ref' }, h('h3', {}, 'The three formulas'),
        h('p', {}, h('b', {}, '① Power Index'), ` = ${r.weights.military} × military share + ${r.weights.economy} × economy share + ${r.weights.politics} × politics share + ${r.weights.cultivation} × cultivation share (weights in World settings).`),
        h('p', { class: 'muted small' }, 'Military = army strength (men × average attack & defence × morale) + champion power of members. Economy = Σ ruled regions (people × prosperity ÷ 100) + treasury ÷ 50 + workshop profits × 10. Politics = influence + 20 per treaty + positive relations ÷ 5 + reputation. Cultivation = Σ members (stat total × realm multiplier). Each pillar is a share of the server total, so the Power Index of all factions adds up to 100%.'),
        h('p', {}, h('b', {}, '② vs fair share'), ` = Power Index − ${r.fair}% (100% ÷ number of factions). HHI = Σ (Power Index)²: ${r.hhiFair} when perfectly even; above 0.25 a single faction dominates.`),
        h('p', {}, h('b', {}, '③ Recruitment need'), ' = 60 × power deficit + 40 × member deficit (0–100). Power deficit = how far below the fair share the faction is; member deficit = how far below the average member count. The top three playable sects are recommended to new players (shown in /help and in /world → Politics for characters without a sect), and World settings → "join bonus" can pay extra Nyang for joining them.')),
    );
  });
  npc.onchange = draw; draw();
  return [h('div', { class: 'toolbar' }, h('label', { class: 'field check' }, npc, h('span', {}, 'Include NPC factions (Imperial Court, Merchant Guild)'))), wrap];
};
