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
    MAPDATA.prefByProv = new Map();
    for (const p of MAPDATA.prefectures) (MAPDATA.prefByProv.get(p.province) || MAPDATA.prefByProv.set(p.province, []).get(p.province)).push(p);
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
// Works like the Murim Map Studio: pick a faction, then click or drag over the land to paint it. Eraser unclaims.
// Drag the sea (or hold Space / Shift, or use the middle mouse button) to move; wheel or pinch to zoom; Ctrl+Z undoes.
// The first view leaves room for the side panel on the right.
const MAP_HOME = { x: 130, y: 30, w: 1330, h: 874 };
const MAPV = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('jh_map') || '{}'); } catch {}
  return {
    tool: 'paint', overlay: saved.overlay || 'political', good: saved.good || 'grain', relF: saved.relF || '', paintF: saved.paintF || '', side: saved.side || 'factions', sideOpen: saved.sideOpen !== false,
    layers: { borders: false, rivers: true, mountains: true, labels: true, factionNames: true, landmarks: true, armies: true, caravans: false, events: false, routes: false, title: false, ...(saved.layers || {}) },
    vb: { ...MAP_HOME }, frontier: null, undo: [], redo: [], hover: null, search: '',
  };
})();
const saveMapPrefs = () => { try { localStorage.setItem('jh_map', JSON.stringify({ overlay: MAPV.overlay, good: MAPV.good, relF: MAPV.relF, layers: MAPV.layers, paintF: MAPV.paintF, side: MAPV.side, sideOpen: MAPV.sideOpen })); } catch {} };
const UNCLAIMED = '#dcd3ba';
const splitSet = () => new Set(W_().map.split || []);
const prefsOf = (prov) => MAPDATA.prefByProv?.get(prov) || [];
/** Who rules a region as the map shows it (prefectures follow their province unless painted on their own). */
function ctlOf(key) {
  const w = W_();
  if (!key) return null;
  if (!key.includes('/')) return w.regions[key]?.controller || null;
  const r = w.regions[key];
  if (r?.ownController) return r.controller || null;
  return w.regions[provinceOf(key)]?.controller || null;
}
/** The shapes that make up the territory layer: whole provinces, or the prefectures of split ones. */
function territoryShapes() {
  const split = splitSet();
  const out = [];
  for (const p of MAPDATA.provinces) {
    if (split.has(p.key)) for (const pf of prefsOf(p.key)) out.push({ ...pf, kind: 'prefecture' });
    else out.push({ ...p, kind: 'province' });
  }
  return out;
}
function factionOpacity(f) {
  const style = f?.colorStyle || W_().map.colorStyle || 'washed';
  return style === 'vivid' ? 0.92 : 0.5;
}
function regionValue(key) {
  const w = W_();
  const r = w.regions[marketOf(key)];
  switch (MAPV.overlay) {
    case 'prosperity': return r ? ramp(r.prosperity / 100) : UNCLAIMED;
    case 'security': return r ? ramp(r.security / 100) : UNCLAIMED;
    case 'unrest': return r ? ramp(r.unrest / 100, true) : UNCLAIMED;
    case 'corruption': return r ? ramp(r.corruption / 60, true) : UNCLAIMED;
    case 'food': return r ? ramp(((r.last?.food ?? 1) - 0.5) / 0.5) : UNCLAIMED;
    case 'price': { const g = goodOf(MAPV.good); return g && r ? priceRamp((r.prices?.[g.id] || g.basePrice) / g.basePrice) : UNCLAIMED; }
    case 'terrain': return TERRAIN_COLOR[r?.terrain] || UNCLAIMED;
    case 'events': return r && w.activeEvents.some((e) => e.regions.includes(marketOf(key))) ? '#e08a3c' : UNCLAIMED;
    case 'relations': {
      const ctl = ctlOf(key);
      if (!MAPV.relF || !ctl) return UNCLAIMED;
      if (ctl === MAPV.relF) return '#d9a441';
      const rel = relOf(MAPV.relF, ctl);
      return rel.war ? '#7a1010' : ramp((rel.value + 100) / 200);
    }
    default: return fac(ctlOf(key))?.color || UNCLAIMED;
  }
}
function fillFor(key) {
  if (MAPV.overlay !== 'political') return { fill: regionValue(key), op: 0.88 };
  const f = fac(ctlOf(key));
  return f ? { fill: f.color, op: factionOpacity(f) } : { fill: UNCLAIMED, op: 0.85 };
}

function legendFor() {
  const o = MAPV.overlay;
  const box = (c, t) => h('span', { class: 'wm-key' }, h('span', { class: 'dot', style: `background:${c}` }), t);
  if (o === 'political') return [];
  if (o === 'price') return [box(priceRamp(0.4), 'cheap'), box(priceRamp(1), 'base'), box(priceRamp(2.5), 'dear')];
  if (o === 'terrain') return Object.entries(TERRAIN_COLOR).map(([k, c]) => box(c, W_().terrains[k]?.label || k));
  if (o === 'relations') return [box('#d9a441', 'this faction'), box(ramp(1), 'friendly'), box(ramp(0.5), 'neutral'), box(ramp(0), 'hostile'), box('#7a1010', 'at war')];
  if (o === 'events') return [box('#e08a3c', 'event in progress')];
  const rev = o === 'unrest' || o === 'corruption';
  return [box(ramp(rev ? 1 : 0), 'low'), box(ramp(0.5), 'mid'), box(ramp(rev ? 0 : 1), 'high')];
}

/** Contiguous groups of each faction's land, for one name label per group (as in the Map Studio). */
function factionClusters(shapes) {
  const byF = new Map();
  for (const s of shapes) { const f = ctlOf(s.key); if (f) (byF.get(f) || byF.set(f, []).get(f)).push(s); }
  const out = [];
  for (const [fid, list] of byF) {
    const f = fac(fid); if (!f) continue;
    const seen = new Set();
    const keys = new Set(list.map((s) => s.key));
    const byKey = new Map(list.map((s) => [s.key, s]));
    for (const s of list) {
      if (seen.has(s.key)) continue;
      const group = []; const q = [s]; seen.add(s.key);
      while (q.length) {
        const cur = q.shift(); group.push(cur);
        const near = [...(cur.neighbors || [])];
        if (cur.kind === 'prefecture') for (const p of prefsOf(cur.province)) near.push(p.key);
        for (const n of near) {
          if (seen.has(n)) continue;
          // Neighbours can be a province (whole) or a prefecture of a split province: match either way.
          const hit = keys.has(n) ? n : [...keys].find((k) => !seen.has(k) && (provinceOf(k) === n || (byKey.get(k)?.neighbors || []).includes(cur.key)));
          if (hit && !seen.has(hit)) { seen.add(hit); q.push(byKey.get(hit)); }
        }
      }
      const area = group.reduce((a, x) => a + (x.area || 1), 0);
      let cx = group.reduce((a, x) => a + x.c[0] * (x.area || 1), 0) / area;
      let cy = group.reduce((a, x) => a + x.c[1] * (x.area || 1), 0) / area;
      // Keep the label on the faction's own land.
      const best = group.reduce((b, x) => (Math.hypot(x.c[0] - cx, x.c[1] - cy) < Math.hypot(b.c[0] - cx, b.c[1] - cy) ? x : b), group[0]);
      if (Math.hypot(best.c[0] - cx, best.c[1] - cy) > Math.sqrt(best.area || 1) * 0.6) { cx = best.c[0]; cy = best.c[1]; }
      out.push({ f, group, area, cx, cy, anchor: best.key });
    }
  }
  return out;
}

function buildMapSvg(onPick) {
  const w = W_();
  const vb = MAPV.vb;
  const zoomK = Math.max(0.3, Math.min(1.1, vb.w / 1400));
  const svg = sv('svg', { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, class: `wmap tool-${MAPV.tool}`, xmlns: SVGNS, 'font-family': 'Cormorant Garamond, Georgia, serif' });
  svg.append(sv('defs', {},
    sv('pattern', { id: 'wm-waves', width: 40, height: 20, patternUnits: 'userSpaceOnUse' }, sv('path', { d: 'M0 10 Q10 5 20 10 T40 10', fill: 'none', stroke: '#0284c7', 'stroke-width': 0.8, opacity: 0.12 })),
    sv('pattern', { id: 'wm-hatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: '#5a1010', 'stroke-width': 2, opacity: 0.35 })),
    sv('marker', { id: 'wm-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, sv('path', { d: 'M0 0 L10 5 L0 10 z', fill: '#7a1010' })),
  ));
  svg.append(sv('rect', { x: -3000, y: -3000, width: 7400, height: 6920, fill: '#ede2cc', class: 'wm-sea' }), sv('rect', { x: -3000, y: -3000, width: 7400, height: 6920, fill: 'url(#wm-waves)', opacity: 0.25, 'pointer-events': 'none' }));
  const split = splitSet();
  const shapes = territoryShapes();
  const land = sv('g', {});
  for (const s of shapes) {
    const { fill, op } = fillFor(s.key);
    land.append(sv('path', { d: s.d, fill, 'fill-opacity': op, stroke: '#3e2e1e', 'stroke-width': s.kind === 'prefecture' ? 0.7 : 1.3, 'stroke-opacity': 0.85, 'stroke-linejoin': 'round', 'fill-rule': 'evenodd', class: 'wreg', 'data-key': s.key }));
  }
  svg.append(land);
  // Outlines of split provinces stay visible above their prefectures.
  const outl = sv('g', { 'pointer-events': 'none' });
  for (const p of MAPDATA.provinces) if (split.has(p.key)) outl.append(sv('path', { d: p.d, fill: 'none', stroke: '#3e2e1e', 'stroke-width': 1.5, 'stroke-opacity': 0.9, 'stroke-linejoin': 'round' }));
  if (MAPV.layers.borders) for (const p of MAPDATA.prefectures) if (!split.has(p.province)) outl.append(sv('path', { d: p.d, fill: 'none', stroke: '#5a4a36', 'stroke-width': 0.35, 'stroke-dasharray': '2 2', opacity: 0.45 }));
  svg.append(outl);
  // Occupation hatching
  const occ = sv('g', { 'pointer-events': 'none' });
  for (const [k, r] of Object.entries(w.regions)) if (r.occupiedBy && geoOf(k)) occ.append(sv('path', { d: geoOf(k).d, fill: 'url(#wm-hatch)' }));
  svg.append(occ);
  // Special prefectures inside whole provinces: a quiet dotted outline (their own colour if they have their own ruler).
  const spec = sv('g', {});
  for (const [k, r] of Object.entries(w.regions)) {
    if (!r.special || split.has(provinceOf(k))) continue;
    const g0 = geoOf(k); if (!g0) continue;
    const own = r.ownController && r.controller !== ctlOf(provinceOf(k));
    const { fill, op } = fillFor(k);
    spec.append(sv('path', { d: g0.d, fill: own || MAPV.overlay !== 'political' ? fill : 'none', 'fill-opacity': own || MAPV.overlay !== 'political' ? op : 0, stroke: '#6b4a1f', 'stroke-width': 0.9, 'stroke-dasharray': '3 2', 'data-key': k, class: 'wspec', 'pointer-events': MAPV.tool === 'inspect' ? 'auto' : 'none' }));
  }
  svg.append(spec);
  if (MAPV.layers.rivers) {
    const g = sv('g', { 'pointer-events': 'none' });
    for (const rv of MAPDATA.rivers) {
      g.append(sv('path', { d: rv.d, fill: 'none', stroke: rv.color || '#3f78a8', 'stroke-width': rv.width * 0.8, opacity: 0.6, 'stroke-linecap': 'round' }));
      if (MAPV.layers.labels && rv.type === 'major' && vb.w < 1100) g.append(sv('text', { x: rv.label[0], y: rv.label[1], 'font-size': (10 * zoomK).toFixed(1), fill: '#2f5f86', 'font-style': 'italic', 'text-anchor': 'middle', opacity: 0.8 }, rv.name));
    }
    svg.append(g);
  }
  if (MAPV.layers.routes) {
    const g = sv('g', { 'pointer-events': 'none' });
    const seen = new Set();
    for (const p of MAPDATA.provinces) for (const n of p.neighbors || []) { const k = [p.key, n].sort().join('|'); if (seen.has(k)) continue; seen.add(k); const b = geoOf(n); if (b) g.append(sv('line', { x1: p.c[0], y1: p.c[1], x2: b.c[0], y2: b.c[1], stroke: '#6b5434', 'stroke-width': 0.7, 'stroke-dasharray': '3 3', opacity: 0.5 })); }
    for (const r of w.routes || []) { const a = geoOf(r.a); const b = geoOf(r.b); if (a && b) g.append(sv('line', { x1: a.c[0], y1: a.c[1], x2: b.c[0], y2: b.c[1], stroke: r.kind === 'sea' ? '#1f4f78' : '#6b5434', 'stroke-width': 1, 'stroke-dasharray': '6 3', opacity: 0.7 })); }
    svg.append(g);
  }
  if (MAPV.layers.mountains) {
    const g = sv('g', { 'pointer-events': 'none', opacity: 0.7 });
    for (const m of MAPDATA.mountains) {
      g.append(sv('path', { d: `M${m.xy[0] - 4.5} ${m.xy[1] + 3.5} L${m.xy[0]} ${m.xy[1] - 4.5} L${m.xy[0] + 4.5} ${m.xy[1] + 3.5}`, fill: 'none', stroke: '#5b4630', 'stroke-width': 1, 'stroke-linejoin': 'round' }));
      if (MAPV.layers.labels && vb.w < 700) g.append(sv('text', { x: m.xy[0] + 6, y: m.xy[1] + 3, 'font-size': (8 * zoomK * 1.4).toFixed(1), fill: '#4a3826' }, m.name.replace(/\s*\(.*\)/, '')));
    }
    svg.append(g);
  }
  if (MAPV.layers.caravans) {
    const g = sv('g', { 'pointer-events': 'none' });
    for (const cv of (w.caravans || []).filter((x) => x.status === 'travelling').slice(0, 120)) {
      const pts = (cv.path || []).map((k) => geoOf(k)?.c).filter(Boolean);
      if (pts.length > 1) g.append(sv('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: cv.npc ? '#8a6d2b' : '#b3261e', 'stroke-width': cv.npc ? 0.9 : 1.6, 'stroke-dasharray': cv.npc ? '2 3' : '5 3', opacity: cv.npc ? 0.5 : 0.85 }));
    }
    svg.append(g);
  }
  // Names: provinces (or prefectures of split provinces when zoomed in), then one faction name per territory.
  const labG = sv('g', { 'pointer-events': 'none' });
  const clusters = MAPV.overlay === 'political' && MAPV.layers.factionNames ? factionClusters(shapes) : [];
  const anchors = new Map(clusters.map((c) => [c.anchor, c]));
  if (MAPV.layers.labels) {
    for (const p of MAPDATA.provinces) {
      const fs = Math.max(10, Math.min(24, Math.sqrt(p.area) / 6.5)) * zoomK;
      if (split.has(p.key)) {
        labG.append(sv('text', { x: p.c[0], y: p.c[1] - 10, 'font-size': (fs * 1.05).toFixed(1), 'text-anchor': 'middle', fill: '#221910', 'font-weight': 700, 'font-style': 'italic', stroke: '#ede2cc', 'stroke-width': 2.2, 'paint-order': 'stroke', opacity: 0.45, 'letter-spacing': 2 }, rname(p.key).toUpperCase()));
        if (vb.w < 950) for (const pf of prefsOf(p.key)) labG.append(sv('text', { x: pf.c[0], y: pf.c[1] + (anchors.has(pf.key) ? 7 : 2), 'font-size': (Math.max(6.5, Math.min(11, Math.sqrt(pf.area) / 3.2)) * zoomK * 1.3).toFixed(1), 'text-anchor': 'middle', fill: '#221910', 'font-weight': 700, stroke: '#ede2cc', 'stroke-width': 1.8, 'paint-order': 'stroke' }, rname(pf.key)));
      } else {
        labG.append(sv('text', { x: p.c[0], y: p.c[1] + (anchors.has(p.key) ? fs * 0.55 : 0), 'font-size': fs.toFixed(1), 'text-anchor': 'middle', fill: '#221910', 'font-weight': 700, stroke: '#ede2cc', 'stroke-width': 2.4, 'paint-order': 'stroke', opacity: 0.92 }, rname(p.key)));
      }
    }
    for (const [k, r] of Object.entries(w.regions)) {
      if (!r.special || split.has(provinceOf(k)) || vb.w >= 1000) continue;
      const g0 = geoOf(k); if (!g0) continue;
      labG.append(sv('text', { x: g0.c[0], y: g0.c[1] + 12 * zoomK, 'font-size': (9 * zoomK * 1.25).toFixed(1), 'text-anchor': 'middle', fill: '#5a3a12', 'font-style': 'italic', stroke: '#ede2cc', 'stroke-width': 1.6, 'paint-order': 'stroke' }, rname(k)));
    }
  }
  const lang = w.map.lang || 'english';
  for (const c of clusters) {
    const fs = Math.max(9, Math.min(30, 7 + Math.sqrt(c.area) / 9)) * zoomK;
    const name = lang === 'hanzi' && c.f.hanzi ? c.f.hanzi : lang === 'both' && c.f.hanzi ? `${c.f.name} · ${c.f.hanzi}` : c.f.name;
    labG.append(sv('text', { x: c.cx, y: c.cy - (MAPV.layers.labels ? fs * 0.45 : -fs * 0.3), 'font-size': fs.toFixed(1), 'text-anchor': 'middle', fill: c.f.color, 'font-weight': 700, stroke: '#000', 'stroke-width': Math.max(1.2, fs / 7).toFixed(2), 'paint-order': 'stroke', 'letter-spacing': 0.5 }, name));
  }
  svg.append(labG);
  if (MAPV.layers.landmarks) {
    const g = sv('g', {});
    for (const l of w.map.landmarks || []) {
      const s = 3.4;
      g.append(sv('g', { class: 'wlm', 'data-lm': l.id },
        sv('path', { d: `M${l.xy[0]} ${l.xy[1] - s} L${l.xy[0] + s} ${l.xy[1]} L${l.xy[0]} ${l.xy[1] + s} L${l.xy[0] - s} ${l.xy[1]} Z`, fill: fac(l.factionId)?.color || '#7a1010', stroke: '#ede2cc', 'stroke-width': 0.9 }),
        vb.w < 1100 ? sv('text', { x: l.xy[0] + 5, y: l.xy[1] + 3, 'font-size': (8.5 * zoomK * 1.3).toFixed(1), fill: '#2a1a10', stroke: '#ede2cc', 'stroke-width': 1.8, 'paint-order': 'stroke' }, l.name) : null,
        sv('title', {}, `${l.name}${l.hanzi ? ` (${l.hanzi})` : ''}${l.notes ? ` — ${l.notes}` : ''}`)));
    }
    svg.append(g);
  }
  for (const fl of w.map.frontiers || []) svg.append(sv('polyline', { points: fl.points.map((p) => p.join(',')).join(' '), fill: 'none', stroke: fl.color, 'stroke-width': fl.style === 'wall' ? 3 : 1.8, 'stroke-dasharray': fl.style === 'dashed' ? '6 4' : null, 'pointer-events': 'none', opacity: 0.9 }));
  if (MAPV.frontier?.length) svg.append(sv('polyline', { points: MAPV.frontier.map((p) => p.join(',')).join(' '), fill: 'none', stroke: '#b3261e', 'stroke-width': 2, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
  if (MAPV.layers.events) {
    const g = sv('g', { 'pointer-events': 'none' });
    const byRegion = {};
    for (const ae of w.activeEvents) for (const k of ae.regions) byRegion[k] = (byRegion[k] || 0) + 1;
    for (const [k, n] of Object.entries(byRegion)) { const g0 = geoOf(k); if (!g0) continue; g.append(sv('circle', { cx: g0.c[0] - 12, cy: g0.c[1] + 9, r: 5, fill: '#e08a3c', stroke: '#3e2e1e', 'stroke-width': 0.6 }), sv('text', { x: g0.c[0] - 12, y: g0.c[1] + 11.6, 'font-size': 7, 'text-anchor': 'middle', fill: '#1c1208', 'font-family': 'IBM Plex Sans, sans-serif', 'font-weight': 700 }, n)); }
    svg.append(g);
  }
  if (MAPV.layers.armies) {
    const g = sv('g', { 'pointer-events': 'none', 'font-family': 'IBM Plex Sans, sans-serif' });
    const byRegion = {};
    for (const a of w.armies) if (a.status !== 'disbanded') (byRegion[a.region] ||= []).push(a);
    for (const [k, list] of Object.entries(byRegion)) {
      const g0 = geoOf(k); if (!g0) continue;
      list.forEach((a, i) => {
        const men = Object.values(a.units).reduce((s, n) => s + n, 0);
        const x = g0.c[0] + 12; const y = g0.c[1] + 2 + i * 10;
        g.append(sv('rect', { x, y: y - 7, width: 24, height: 9, rx: 1.5, fill: fac(a.factionId)?.color || '#555', stroke: '#1c1208', 'stroke-width': 0.6 }), sv('text', { x: x + 12, y: y, 'font-size': 6.5, 'text-anchor': 'middle', fill: '#fff', stroke: '#000', 'stroke-width': 0.8, 'paint-order': 'stroke', 'font-weight': 600 }, men >= 1000 ? `${Math.round(men / 100) / 10}k` : String(men)));
        if (a.march) { const pts = a.march.path.slice(a.march.step).map((kk) => geoOf(kk)?.c).filter(Boolean); if (pts.length > 1) g.append(sv('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: '#7a1010', 'stroke-width': 1.5, 'marker-end': 'url(#wm-arrow)', opacity: 0.8 })); }
      });
    }
    for (const b of w.battles.filter((x) => x.status === 'preparing')) {
      const g0 = geoOf(b.region); if (!g0) continue;
      const [x, y] = [g0.c[0] - 2, g0.c[1] - 16];
      g.append(sv('circle', { cx: x, cy: y, r: 6, fill: '#ede2cc', stroke: '#7a1010', 'stroke-width': 1.2 }), sv('path', { d: `M${x - 3.5} ${y - 3.5} L${x + 3.5} ${y + 3.5} M${x + 3.5} ${y - 3.5} L${x - 3.5} ${y + 3.5}`, stroke: '#7a1010', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
    }
    svg.append(g);
  }
  if (WSEL && geoOf(WSEL)) svg.append(sv('path', { d: geoOf(WSEL).d, fill: 'none', stroke: '#d97706', 'stroke-width': 2.6, 'pointer-events': 'none', 'stroke-linejoin': 'round' }));
  if (MAPV.layers.title && w.map.title) svg.append(sv('g', { 'pointer-events': 'none' }, sv('text', { x: 40, y: 60, 'font-size': 30, fill: '#2a1a10', 'font-weight': 700, stroke: '#ede2cc', 'stroke-width': 3, 'paint-order': 'stroke' }, w.map.title), sv('text', { x: 42, y: 82, 'font-size': 14, fill: '#3b2a1a', stroke: '#ede2cc', 'stroke-width': 2, 'paint-order': 'stroke' }, [w.map.subtitle, w.map.era].filter(Boolean).join(' · '))));
  wireMap(svg, onPick);
  return svg;
}

let SPACE_DOWN = false;
function wireMap(svg, onPick) {
  const toMap = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
  let drag = null; const pointers = new Map(); let pinch = null; let stroke = null;
  const setVB = () => svg.setAttribute('viewBox', `${MAPV.vb.x} ${MAPV.vb.y} ${MAPV.vb.w} ${MAPV.vb.h}`);
  const keyAt = (x, y) => { const el = document.elementFromPoint(x, y); return el?.getAttribute?.('data-key') || null; };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toMap(e); const k = e.deltaY < 0 ? 0.87 : 1.15;
    const vb = MAPV.vb; const nw = Math.max(100, Math.min(2800, vb.w * k)); const s = nw / vb.w;
    MAPV.vb = { x: p.x - (p.x - vb.x) * s, y: p.y - (p.y - vb.y) * s, w: nw, h: vb.h * s };
    setVB();
  }, { passive: false });
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // Two fingers: pinch-zoom and move; cancel any stroke in progress.
      if (stroke) { stroke = null; onPick({ cancel: true }); }
      const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], vb: { ...MAPV.vb } }; drag = null; return;
    }
    const key = e.target.getAttribute?.('data-key');
    const painting = MAPV.tool === 'paint' || MAPV.tool === 'erase';
    const pan = e.button === 1 || e.button === 2 || e.shiftKey || SPACE_DOWN || !key || e.target.classList?.contains('wm-sea');
    if (painting && !pan) {
      stroke = new Set([key]); onPick({ preview: key });
      svg.setPointerCapture?.(e.pointerId); return;
    }
    drag = { x: e.clientX, y: e.clientY, vb: { ...MAPV.vb }, moved: false, key, lm: e.target.closest?.('[data-lm]')?.getAttribute('data-lm') };
    svg.classList.add('panning');
    svg.setPointerCapture?.(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = svg.getBoundingClientRect();
      const s = pinch.d / Math.max(1, d); const vb = pinch.vb;
      const nw = Math.max(100, Math.min(2800, vb.w * s)); const nh = vb.h * (nw / vb.w);
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const fx = (pinch.mid[0] - rect.left) / rect.width; const fy = (pinch.mid[1] - rect.top) / rect.height;
      const px = vb.x + fx * vb.w; const py = vb.y + fy * vb.h;
      const dx = (mid[0] - pinch.mid[0]) * (nw / rect.width); const dy = (mid[1] - pinch.mid[1]) * (nh / rect.height);
      MAPV.vb = { x: px - fx * nw - dx, y: py - fy * nh - dy, w: nw, h: nh }; setVB(); return;
    }
    if (stroke) {
      const key = keyAt(e.clientX, e.clientY);
      if (key && !stroke.has(key)) { stroke.add(key); onPick({ preview: key }); }
      return;
    }
    if (!drag) { onPick({ hover: e.target.getAttribute?.('data-key') || null }); return; }
    const r = svg.getBoundingClientRect();
    const dx = (e.clientX - drag.x) * (MAPV.vb.w / r.width); const dy = (e.clientY - drag.y) * (MAPV.vb.h / r.height);
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    if (drag.moved) { MAPV.vb = { ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy }; setVB(); }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    svg.classList.remove('panning');
    if (stroke) { const keys = [...stroke]; stroke = null; onPick({ paint: keys }); return; }
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) return;
    const p = toMap(e);
    if (d.lm) return onPick({ landmark: d.lm });
    onPick({ key: d.key, xy: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] });
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; if (stroke) { stroke = null; onPick({ cancel: true }); } pinch = null; });
  svg.addEventListener('pointerleave', () => { if (!stroke && !drag) onPick({ hover: null }); });
}

const ICONS = {
  paint: ['M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z', 'M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7'],
  erase: ['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9'],
  inspect: ['M21 21l-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  landmark: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  frontier: ['M3 17c3-6 6 2 9-4s6 2 9-4', 'M3 21h18'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  panel: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', 'M15 3v18'],
};
function icon(name, size = 18) {
  return sv('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, ...(ICONS[name] || []).map((d) => sv('path', { d })));
}

/** Apply a server reply ({ changed }) to the local copy, mirroring how prefectures follow their province. */
function applyControl(changed) {
  const w = W_();
  const provs = new Set();
  for (const c of changed || []) {
    if (!c.exists) delete w.regions[c.key];
    else w.regions[c.key] = { ...(w.regions[c.key] || { key: c.key }), controller: c.controller, ownController: c.ownController };
    provs.add(provinceOf(c.key));
  }
  for (const p of provs) for (const pf of prefsOf(p)) { const r = w.regions[pf.key]; if (r && !r.ownController) r.controller = w.regions[p]?.controller || null; }
}

VIEWS.map = async () => {
  await loadWorld();
  const w = W_();
  if (MAPV.paintF && !fac(MAPV.paintF)) MAPV.paintF = '';
  const studio = h('div', { class: 'wm-studio' });
  const holder = h('div', { class: 'wm-canvas' });
  const status = h('div', { class: 'wm-status' });
  const legend = h('div', { class: 'wm-legend' });
  const side = h('aside', { class: `wm-side${MAPV.sideOpen ? '' : ' closed'}` });
  const active = h('div', { class: 'wm-active' });
  const rail = h('div', { class: 'wm-rail' });
  let svgEl = null;
  const redraw = () => { svgEl = buildMapSvg(onPick); holder.replaceChildren(svgEl); legend.replaceChildren(...legendFor()); drawStatus(); };
  const drawStatus = () => {
    const k = MAPV.hover;
    status.replaceChildren(k ? h('span', {}, h('b', {}, rfull(k)), ` ${geoOf(k)?.hanzi || ''} — `, (() => { const f = fac(ctlOf(k)); return f ? h('span', { style: `color:${f.color};font-weight:600` }, f.name) : h('span', { class: 'muted' }, 'unclaimed'); })(), W_().regions[k]?.special ? h('span', { class: 'muted' }, ' · own market') : null)
      : h('span', { class: 'muted' }, MAPV.tool === 'paint' ? (fac(MAPV.paintF) ? `Click or drag to paint ${fac(MAPV.paintF).name}. Drag the sea to move.` : 'Pick a faction to paint with.') : MAPV.tool === 'erase' ? 'Click or drag to unclaim land.' : MAPV.tool === 'landmark' ? 'Click the map to place a landmark.' : MAPV.tool === 'frontier' ? 'Click points to draw a line.' : 'Click a region to inspect it.'));
  };
  // ----- painting with undo / redo -----
  async function paint(keys, ctl) {
    keys = keys.filter((k) => ctlOf(k) !== ctl);
    if (!keys.length) { redraw(); return; }
    const r = await api('/world/paint', { method: 'POST', body: { keys, controller: ctl } });
    applyControl(r.changed);
    MAPV.undo.push({ before: r.before, label: `${keys.length} region${keys.length > 1 ? 's' : ''} → ${fac(ctl)?.name || 'unclaimed'}` });
    if (MAPV.undo.length > 100) MAPV.undo.shift();
    MAPV.redo = [];
    redraw(); drawSide(); drawRail(); drawActive();
  }
  async function undo() {
    const e = MAPV.undo.pop(); if (!e) return;
    const r = await api('/world/paint/restore', { method: 'POST', body: { snapshot: e.before } });
    applyControl(r.changed); e.after = r.before; MAPV.redo.push(e);
    toast(`Undone: ${e.label}`); redraw(); drawSide(); drawRail(); drawActive();
  }
  async function redo() {
    const e = MAPV.redo.pop(); if (!e) return;
    const r = await api('/world/paint/restore', { method: 'POST', body: { snapshot: e.after } });
    applyControl(r.changed); e.before = r.before; MAPV.undo.push(e);
    toast(`Redone: ${e.label}`); redraw(); drawSide(); drawRail(); drawActive();
  }
  const reloadAll = async () => { await loadWorld(); redraw(); drawSide(); drawActive(); };
  async function onPick(ev) {
    try {
      if (ev.hover !== undefined) { if (MAPV.hover !== ev.hover) { MAPV.hover = ev.hover; drawStatus(); } return; }
      if (ev.cancel) { redraw(); return; }
      if (ev.preview) {
        const ctl = MAPV.tool === 'erase' ? null : MAPV.paintF;
        const f = fac(ctl);
        svgEl?.querySelectorAll(`[data-key="${CSS.escape(ev.preview)}"]`).forEach((el) => { el.setAttribute('fill', f ? f.color : UNCLAIMED); el.setAttribute('fill-opacity', f ? factionOpacity(f) : 0.85); });
        MAPV.hover = ev.preview; drawStatus();
        return;
      }
      if (ev.paint) {
        if (MAPV.tool === 'paint' && !fac(MAPV.paintF)) { redraw(); toast('Pick a faction to paint with first (top left).', true); return; }
        return await paint(ev.paint, MAPV.tool === 'erase' ? null : MAPV.paintF);
      }
      if (ev.landmark) return editLandmark(w.map.landmarks.find((l) => l.id === ev.landmark), reloadAll);
      if (MAPV.tool === 'landmark') return editLandmark({ name: '', hanzi: '', type: 'sect_site', xy: ev.xy, region: ev.key || '', factionId: '', notes: '' }, reloadAll);
      if (MAPV.tool === 'frontier') { MAPV.frontier = [...(MAPV.frontier || []), ev.xy]; redraw(); drawActive(); return; }
      if (ev.key) { WSEL = ev.key; MAPV.side = 'region'; MAPV.sideOpen = true; redraw(); drawSide(); }
    } catch (e) { toast(e.message, true); redraw(); }
  }
  // ----- left rail (tools) -----
  const setTool = (t) => { MAPV.tool = t; if (t !== 'frontier') MAPV.frontier = null; drawRail(); drawActive(); redraw(); };
  const zoom = (k) => { const vb = MAPV.vb; const nw = Math.max(100, Math.min(2800, vb.w * k)); const nh = vb.h * (nw / vb.w); MAPV.vb = { x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh }; redraw(); };
  const railBtn = (id, label, desc, onclick, { on = false, disabled = false } = {}) => h('button', { class: `wm-tool${on ? ' on' : ''}`, onclick, disabled, 'aria-label': label }, icon(id), h('span', { class: 'wm-tip' }, h('b', {}, label), desc ? h('small', {}, desc) : null));
  function drawRail() {
    rail.replaceChildren(
      railBtn('paint', 'Paint  (B)', 'Click or drag land to give it to the active faction', () => setTool('paint'), { on: MAPV.tool === 'paint' }),
      railBtn('erase', 'Eraser  (E)', 'Click or drag to unclaim land', () => setTool('erase'), { on: MAPV.tool === 'erase' }),
      railBtn('inspect', 'Inspect  (I)', 'Click a region to see and edit it', () => setTool('inspect'), { on: MAPV.tool === 'inspect' }),
      railBtn('landmark', 'Landmark  (L)', 'Click the map to place a sect site, pass or city', () => setTool('landmark'), { on: MAPV.tool === 'landmark' }),
      railBtn('frontier', 'Frontier line  (F)', 'Click points to draw walls, truce lines and fronts', () => setTool('frontier'), { on: MAPV.tool === 'frontier' }),
      h('div', { class: 'wm-sep' }),
      railBtn('undo', 'Undo  (Ctrl+Z)', MAPV.undo.at(-1)?.label || 'Nothing to undo', run(undo), { disabled: !MAPV.undo.length }),
      railBtn('redo', 'Redo  (Ctrl+Y)', MAPV.redo.at(-1)?.label || 'Nothing to redo', run(redo), { disabled: !MAPV.redo.length }),
      h('div', { class: 'wm-sep' }),
      railBtn('plus', 'Zoom in', '', () => zoom(0.75)),
      railBtn('minus', 'Zoom out', '', () => zoom(1.33)),
      railBtn('fit', 'Whole map', '', () => { MAPV.vb = MAPV.sideOpen ? { ...MAP_HOME } : { x: 0, y: 0, w: 1400, h: 920 }; redraw(); }),
      railBtn('panel', MAPV.sideOpen ? 'Hide panel' : 'Show panel', '', () => { MAPV.sideOpen = !MAPV.sideOpen; saveMapPrefs(); side.classList.toggle('closed', !MAPV.sideOpen); drawRail(); }),
    );
  }
  // ----- active faction widget -----
  function drawActive() {
    const f = fac(MAPV.paintF);
    if (MAPV.tool === 'frontier') {
      active.replaceChildren(h('div', { class: 'wm-active-row' }, h('span', {}, `Frontier line: ${(MAPV.frontier || []).length} point(s)`)),
        h('div', { class: 'toolbar' },
          h('button', { class: 'btn small primary', onclick: run(async () => {
            if ((MAPV.frontier || []).length < 2) throw new Error('Click at least two points.');
            const name = prompt('Name of this frontier / wall?', 'Frontier'); if (name === null) return;
            await api('/world/map', { method: 'PUT', body: { frontiers: [...w.map.frontiers, { name, color: '#b3261e', style: 'dashed', points: MAPV.frontier }] } });
            MAPV.frontier = null; toast('Line saved.'); await reloadAll();
          }) }, 'Save'), h('button', { class: 'btn small', onclick: () => { MAPV.frontier = null; redraw(); drawActive(); } }, 'Clear'),
          w.map.frontiers.length ? h('button', { class: 'btn small danger', onclick: run(async () => { if (!confirm('Delete every frontier line?')) return; await api('/world/map', { method: 'PUT', body: { frontiers: [] } }); await reloadAll(); }) }, 'Delete all') : null));
      return;
    }
    const sel = select([['', '— choose a faction to paint —'], ...w.factions.filter((x) => x.active).map((x) => [x.id, `${x.name}${x.hanzi ? ` (${x.hanzi})` : ''}`])], MAPV.paintF, { class: 'wm-select' });
    sel.onchange = () => { MAPV.paintF = sel.value; if (MAPV.tool !== 'paint') MAPV.tool = 'paint'; saveMapPrefs(); drawActive(); drawRail(); drawSide(); drawStatus(); };
    active.replaceChildren(
      h('div', { class: 'wm-active-row' }, h('span', { class: 'muted' }, MAPV.tool === 'erase' ? 'Eraser — unclaims land' : 'Active faction'), h('button', { class: 'linkbtn', onclick: () => newFaction(reloadAll) }, '+ New')),
      sel,
      f ? h('div', { class: 'wm-chip' }, h('span', { class: 'dot', style: `background:${f.color}` }), h('span', { class: 'grow' }, f.name), h('span', { class: 'muted small' }, `${holdingsOf(f.id).length} regions`)) : '',
    );
  }
  // ----- right panel -----
  const SIDE_TABS = [['factions', 'Factions'], ['region', 'Region'], ['takeovers', 'Takeovers'], ['map', 'Map']];
  function drawSide() {
    const pending = (w.takeovers || []).filter((t) => t.status === 'pending').length;
    const tabs = h('div', { class: 'wm-tabs' }, SIDE_TABS.map(([id, label]) => h('button', { class: MAPV.side === id ? 'on' : '', onclick: () => { MAPV.side = id; saveMapPrefs(); drawSide(); } }, label, id === 'takeovers' && pending ? h('span', { class: 'wm-badge' }, pending) : null)));
    const body = h('div', { class: 'wm-side-body' });
    if (MAPV.side === 'factions') body.append(...factionsPanel());
    else if (MAPV.side === 'region') body.append(...(WSEL ? regionDrawer(WSEL, reloadAll) : [h('p', { class: 'muted' }, 'Pick the Inspect tool (or press I) and click a region to see who rules it, its market, Discord channels and more.')]));
    else if (MAPV.side === 'takeovers') body.append(...takeoversPanel(reloadAll));
    else body.append(...mapPanel(reloadAll, redraw));
    side.replaceChildren(tabs, body);
  }
  function factionsPanel() {
    const q = h('input', { type: 'search', placeholder: 'Search factions…', value: MAPV.search, class: 'wm-search' });
    const list = h('div', { class: 'wm-flist' });
    const draw = () => {
      const s = MAPV.search.toLowerCase();
      list.replaceChildren(...w.factions.filter((f) => !s || f.name.toLowerCase().includes(s) || (f.hanzi || '').includes(s)).map((f) => {
        const color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#888888', title: 'Colour' });
        color.onchange = run(async () => { await api(`/world/factions/${f.id}`, { method: 'PUT', body: { color: color.value } }); f.color = color.value; redraw(); drawActive(); });
        const style = f.colorStyle || '';
        const tone = h('button', { class: 'btn small ghost', title: 'Washed or vivid colour on the map', onclick: run(async () => { const next = (f.colorStyle || w.map.colorStyle || 'washed') === 'vivid' ? 'washed' : 'vivid'; await api(`/world/factions/${f.id}`, { method: 'PUT', body: { colorStyle: next } }); f.colorStyle = next; redraw(); draw(); }) }, (style || w.map.colorStyle || 'washed') === 'vivid' ? 'Vivid' : 'Washed');
        const n = holdingsOf(f.id).length;
        return h('div', { class: `wm-frow${MAPV.paintF === f.id ? ' on' : ''}${f.active ? '' : ' off'}`, onclick: (e) => { if (e.target.closest('input,button')) return; MAPV.paintF = f.id; MAPV.tool = 'paint'; saveMapPrefs(); drawRail(); drawActive(); draw(); drawStatus(); } },
          color,
          h('div', { class: 'grow' }, h('div', { class: 'wm-fname' }, f.name, f.hanzi ? h('span', { class: 'muted' }, ` ${f.hanzi}`) : null), h('div', { class: 'muted small' }, `${n} region${n === 1 ? '' : 's'}${f.sect ? '' : ` · ${f.kind}`}${f.active ? '' : ' · inactive'}`)),
          tone,
          h('button', { class: 'btn small ghost', title: 'Edit faction', onclick: () => editFaction(f, reloadAll) }, 'Edit'));
      }));
    };
    q.oninput = () => { MAPV.search = q.value; draw(); };
    draw();
    return [
      h('div', { class: 'toolbar' }, q, h('button', { class: 'btn small primary', onclick: () => newFaction(reloadAll) }, '+ New')),
      list,
      h('p', { class: 'muted small' }, 'Click a faction, then click or drag over the map to paint its land. Every sect has a faction of its own; add others (a court, a guild, bandits) with + New. Nothing is preset: no land, relations or treaties until you decide them.'),
    ];
  }
  // ----- keyboard -----
  if (window.__mapKeys) { document.removeEventListener('keydown', window.__mapKeys); document.removeEventListener('keyup', window.__mapKeysUp); }
  window.__mapKeys = (e) => {
    if (!document.body.contains(studio)) { document.removeEventListener('keydown', window.__mapKeys); document.removeEventListener('keyup', window.__mapKeysUp); return; }
    if (e.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('.modal-backdrop:not(.hidden), dialog[open]')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); (e.shiftKey ? run(redo) : run(undo))(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); run(redo)(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ') { SPACE_DOWN = true; svgEl?.classList.add('space'); e.preventDefault(); return; }
    const map = { b: 'paint', p: 'paint', e: 'erase', i: 'inspect', l: 'landmark', f: 'frontier' };
    if (map[k]) setTool(map[k]);
    if (k === 'escape') { WSEL = null; redraw(); drawSide(); }
  };
  window.__mapKeysUp = (e) => { if (e.key === ' ') { SPACE_DOWN = false; svgEl?.classList.remove('space'); } };
  document.addEventListener('keydown', window.__mapKeys);
  document.addEventListener('keyup', window.__mapKeysUp);

  redraw(); drawRail(); drawActive(); drawSide();
  studio.append(holder, h('div', { class: 'wm-left' }, rail, active), side, h('div', { class: 'wm-bottom' }, status, legend));
  return [studio];
};

function holdingsOf(fid) {
  const w = W_();
  const split = splitSet();
  const out = [];
  for (const p of MAPDATA.provinces) {
    if (split.has(p.key)) { for (const pf of prefsOf(p.key)) if (ctlOf(pf.key) === fid) out.push(pf.key); } else if (ctlOf(p.key) === fid) out.push(p.key);
  }
  for (const [k, r] of Object.entries(w.regions)) if (r.special && !split.has(provinceOf(k)) && r.ownController && r.controller === fid) out.push(k);
  return out;
}

function newFaction(done) {
  const f = buildForm([
    { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字 (optional)' },
    { k: 'color', label: 'Colour', t: 'color' },
    { k: 'kind', label: 'Kind', t: 'select', opts: [['other', 'Other'], ['court', 'Imperial court'], ['guild', 'Merchant guild'], ['bandits', 'Bandits'], ['sect', 'Sect (without a sect entry)'], ['clan', 'Clan'], ['palace', 'Palace'], ['cult', 'Cult']] },
    { k: 'npc', label: 'Run by staff (not a player sect)', t: 'bool' },
    { k: 'description', label: 'Description', t: 'textarea', wide: true },
  ], { name: '', hanzi: '', color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`, kind: 'other', npc: true, description: '' });
  openModal('New faction', h('div', {}, f.el, h('p', { class: 'muted small' }, 'Sects already have their own faction (it follows the sect\'s name and members). Use this for powers that are not sects. It starts with no land, no relations and no treaties.')), [
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => { const v = f.read(); if (!v.name) throw new Error('Name it first.'); const r = await api('/world/factions', { method: 'POST', body: { ...v, treasury: 0, influence: 0 } }); MAPV.paintF = r.faction.id; MAPV.tool = 'paint'; saveMapPrefs(); closeModal(); toast(`${v.name} created — paint its land.`); done(); }) }, 'Create'),
  ]);
}

function takeoversPanel(reload) {
  const w = W_();
  const all = w.takeovers || [];
  const pending = all.filter((t) => t.status === 'pending');
  const done = all.filter((t) => t.status !== 'pending').slice(0, 40);
  const regionOpts = [...MAPDATA.provinces.map((p) => [p.key, rname(p.key)]), ...MAPDATA.prefectures.map((p) => [p.key, rfull(p.key)])].sort((a, b) => a[1].localeCompare(b[1]));
  const rSel = select(regionOpts, WSEL || '');
  const fSel = select(factionOpts('— unclaimed —'), '');
  const reason = h('input', { placeholder: 'Reason (shown in the announcement)' });
  const label = (t) => `${t.regions.map(rfull).join(', ')} → ${fac(t.to)?.name || 'unclaimed'}`;
  const row = (t, actions) => h('div', { class: 'wm-trow' },
    h('div', {}, h('b', {}, label(t)), t.reason ? h('div', { class: 'small' }, `“${t.reason}”`) : null,
      h('div', { class: 'muted small' }, `${t.source === 'conquest' ? 'Conquest' : t.source === 'staff' ? 'Staff' : `Claim by ${t.by?.name || '?'}`} · turn ${t.turn} · ${t.status}${t.decidedBy ? ` by ${t.decidedBy}` : ''}`)),
    h('div', { class: 'toolbar' }, actions));
  const act = (t, a) => run(async () => { await api(`/world/takeovers/${t.id}/${a}`, { method: 'POST', body: {} }); toast(a === 'approve' ? 'Approved — the land changed hands.' : a === 'reject' ? 'Rejected.' : 'Reverted.'); reload(); });
  return [
    h('h4', {}, 'Transfer a region'),
    h('div', { class: 'wm-form' }, rSel, fSel, reason,
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn small primary', onclick: run(async () => { if (!rSel.value) throw new Error('Pick a region.'); await api('/world/takeovers', { method: 'POST', body: { regions: [rSel.value], to: fSel.value || null, reason: reason.value } }); toast('Done — announced in Discord.'); reload(); }) }, 'Transfer now'),
        h('button', { class: 'btn small', onclick: run(async () => { if (!rSel.value) throw new Error('Pick a region.'); await api('/world/takeovers', { method: 'POST', body: { regions: [rSel.value], to: fSel.value || null, reason: reason.value, approve: false } }); toast('Saved as pending.'); reload(); }) }, 'Save as pending'))),
    h('p', { class: 'muted small' }, 'Painting is the quickest way to move land. Takeovers are for changes you want announced and kept on record: players\' representatives claim land from /world → Politics, long occupations in war ask here too, and staff can also use /takeover in Discord. Every approved takeover can be reverted.'),
    h('h4', {}, `Waiting for staff (${pending.length})`),
    ...(pending.length ? pending.map((t) => row(t, [h('button', { class: 'btn small primary', onclick: act(t, 'approve') }, 'Approve'), h('button', { class: 'btn small danger', onclick: act(t, 'reject') }, 'Reject')])) : [h('p', { class: 'muted small' }, 'Nothing pending.')]),
    h('h4', {}, 'History'),
    ...(done.length ? done.map((t) => row(t, [t.status === 'approved' ? h('button', { class: 'btn small', onclick: act(t, 'revert') }, 'Revert') : null, h('button', { class: 'btn small ghost', title: 'Remove from the list', onclick: run(async () => { await api(`/world/takeovers/${t.id}`, { method: 'DELETE' }); reload(); }) }, '✕')].filter(Boolean))) : [h('p', { class: 'muted small' }, 'No takeovers yet.')]),
  ];
}

function mapPanel(reload, redraw) {
  const w = W_();
  const overlaySel = select([['political', 'Political (who rules)'], ['prosperity', 'Prosperity'], ['food', 'Food supply'], ['security', 'Security'], ['unrest', 'Unrest'], ['corruption', 'Corruption'], ['price', 'Price of…'], ['relations', 'Relations of…'], ['events', 'Events'], ['terrain', 'Terrain']], MAPV.overlay);
  const goodSel = select(w.goods.map((g) => [g.id, g.name]), MAPV.good);
  const relSel = select(factionOpts('— faction —'), MAPV.relF);
  const sub = h('div');
  const drawSub = () => sub.replaceChildren(MAPV.overlay === 'price' ? goodSel : MAPV.overlay === 'relations' ? relSel : '');
  overlaySel.onchange = () => { MAPV.overlay = overlaySel.value; saveMapPrefs(); drawSub(); redraw(); };
  goodSel.onchange = () => { MAPV.good = goodSel.value; saveMapPrefs(); redraw(); };
  relSel.onchange = () => { MAPV.relF = relSel.value; saveMapPrefs(); redraw(); };
  drawSub();
  const langSel = select([['english', 'English names'], ['hanzi', '漢字'], ['both', 'Both'], ['historical', 'Historical']], w.map.lang || 'english');
  langSel.onchange = run(async () => { await api('/world/map', { method: 'PUT', body: { lang: langSel.value } }); w.map.lang = langSel.value; redraw(); });
  const toneSel = select([['washed', 'Washed colours'], ['vivid', 'Vivid colours']], w.map.colorStyle || 'washed');
  toneSel.onchange = run(async () => { await api('/world/map', { method: 'PUT', body: { colorStyle: toneSel.value } }); w.map.colorStyle = toneSel.value; redraw(); });
  const layers = h('div', { class: 'wm-checks' }, Object.entries({ labels: 'Region names', factionNames: 'Faction names', rivers: 'Rivers', mountains: 'Peaks & passes', borders: 'Prefecture borders', landmarks: 'Landmarks', armies: 'Armies & battles', caravans: 'Caravans', events: 'Events', routes: 'Trade routes', title: 'Map title' }).map(([k, label]) => {
    const c = h('input', { type: 'checkbox' }); c.checked = !!MAPV.layers[k]; c.onchange = () => { MAPV.layers[k] = c.checked; saveMapPrefs(); redraw(); };
    return h('label', {}, c, ' ', label);
  }));
  const split = splitSet();
  const splits = h('div', { class: 'wm-checks' }, MAPDATA.provinces.slice().sort((a, b) => rname(a.key).localeCompare(rname(b.key))).map((p) => {
    const c = h('input', { type: 'checkbox' }); c.checked = split.has(p.key);
    c.onchange = run(async () => { const r = await api('/world/split', { method: 'POST', body: { province: p.key, on: c.checked } }); w.map.split = r.split; redraw(); });
    return h('label', { title: `${prefsOf(p.key).length} prefectures` }, c, ' ', rname(p.key));
  }));
  return [
    h('h4', {}, 'Map mode'), overlaySel, sub,
    h('div', { class: 'toolbar' }, langSel, toneSel),
    h('h4', {}, 'Layers'), layers,
    h('details', {}, h('summary', {}, h('b', {}, `Split provinces (${split.size})`)), h('p', { class: 'muted small' }, 'A split province is shown and painted prefecture by prefecture (like Henan in the Map Studio). Whoever holds most of it taxes the provincial market.'), splits),
    h('h4', {}, 'More'),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn small', onclick: mapSettings }, 'Title, Discord & import'),
      h('button', { class: 'btn small', onclick: () => exportMap('svg') }, 'Export SVG'),
      h('button', { class: 'btn small', onclick: () => exportMap('png') }, 'Export PNG')),
    h('p', { class: 'muted small' }, `${calText()} · turn ${w.turn}${w.settings.paused ? ' · paused' : ''}`),
    h('details', {}, h('summary', {}, h('b', {}, 'Start over')),
      h('div', { class: 'toolbar', style: 'margin-top:6px' },
        h('button', { class: 'btn small danger', onclick: run(async () => { const c = prompt('Unclaim every region on the map? Type CLEAR to confirm.'); if (c !== 'CLEAR') return; const r = await api('/world/clear-territory', { method: 'POST', body: { confirm: 'CLEAR' } }); MAPV.undo.push({ before: r.before, label: 'clear all territory' }); toast('The map is blank again (Undo brings it back).'); reload(); }) }, 'Clear all territory'),
        h('button', { class: 'btn small danger', onclick: run(async () => { if (!confirm('Set every relation between factions back to 0 (neutral)? Wars stay.')) return; const r = await api('/world/reset-relations', { method: 'POST', body: {} }); toast(`${r.reset} relation(s) reset.`); reload(); }) }, 'Reset relations to 0'))),
  ];
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
  out.push(h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `${rname(key)} ${g?.hanzi || ''}`), h('button', { class: 'btn small ghost', onclick: () => { WSEL = null; MAPV.side = 'factions'; render(); } }, '✕')));
  out.push(h('p', { class: 'muted small', style: 'margin:0' }, [key.includes('/') ? `Prefecture of ${rname(provinceOf(key))}` : g?.historicalName || '', r.special ? ' · ★ special (own market)' : !isM ? ` · served by the ${rname(market)} market` : ''].join('')));
  if (g?.description) out.push(h('p', { class: 'small' }, r.notes || g.description));
  if (mr) {
    const f = fac(mr.controller);
    out.push(h('div', { class: 'kv small' },
      h('span', { class: 'muted' }, 'Ruler'), h('span', {}, facName(ctlOf(key)), key.includes('/') && !r.ownController ? h('span', { class: 'muted' }, ' (follows the province)') : '', mr.occupiedBy ? ` · occupied by ${facName(mr.occupiedBy)}` : ''),
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
        { k: 'ruler', label: 'Ruled by', t: 'select', opts: () => (key.includes('/') ? [['__follow', `— same as ${rname(provinceOf(key))} —`], ['', '— no one —'], ...factionOpts().slice(1)] : factionOpts('— no one —')) },
        !key.includes('/') ? { k: 'categoryId', label: 'Discord category', t: categoryOpts().length > 1 ? 'select' : 'text', opts: categoryOpts } : null,
        { k: 'channelIds', label: 'Discord channels in this region', t: 'channels', help: key.includes('/') ? 'Channels for this prefecture (e.g. #luoyang-market)' : 'Extra channels that belong here (the category already counts)' },
        { k: 'announceChannelId', label: 'Post this region\'s events in', t: 'channel' },
        { k: 'notes', label: 'Notes / description', t: 'textarea', wide: true },
        isM ? { k: 'scriptId', label: 'Custom code', t: 'select', opts: scriptOpts, help: 'regionTick hook: change this region\'s modifiers every turn' } : null,
        isM ? { section: 'Land & people' } : null,
        isM ? { k: 'terrain', label: 'Terrain', t: 'select', opts: Object.entries(w.terrains).map(([k, t]) => [k, t.label]) } : null,
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
      const f = buildForm(fields, { ...r, ruler: key.includes('/') && !r.ownController ? '__follow' : ctlOf(key) || '' });
      const splitOn = !key.includes('/') && splitSet().has(key);
      return [f.el, h('div', { class: 'toolbar', style: 'margin-top:8px' },
        key.includes('/') ? h('button', { class: 'btn', onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(key)}/special`, { method: 'POST', body: { on: !r.special } }); toast('Done.'); reload(); }) }, r.special ? 'Make ordinary' : 'Give it its own market') : null,
        !key.includes('/') ? h('button', { class: 'btn', title: 'Show and paint this province prefecture by prefecture', onclick: run(async () => { await api('/world/split', { method: 'POST', body: { province: key, on: !splitOn } }); reload(); }) }, splitOn ? 'Show whole' : 'Split into prefectures') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: run(async () => { const v = f.read(); const ruler = v.ruler; delete v.ruler; if (ruler === '__follow') v.followProvince = true; else v.controller = ruler || null; await api(`/world/regions/${encodeURIComponent(key)}`, { method: 'PUT', body: v }); toast('Saved.'); reload(); }) }, 'Save'))];
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
    { k: 'startRegion', label: 'Where new characters start', t: 'select', opts: marketOpts },
    { k: 'travelMode', label: 'Travel', t: 'select', opts: [['channel', 'Text RP: you are where you post (instant)'], ['timed', 'Timed: travelling takes real hours']], help: 'In text RP mode, posting in a region\'s channel (or /world there) moves your character; distances are only shown as RP info' },
    { k: 'kmPerPx', label: 'Km per map unit', t: 'number', step: 0.1, help: 'Used for the RP travel info (Beijing→Luoyang ≈ 860 km)' },
    { k: 'travelHoursPer100', label: 'Timed travel: hours per 100 map px', t: 'number', step: 0.1, help: 'Only in Timed mode' },
    { k: 'maxTradePerTurn', label: 'Max market trade per character per turn', t: 'number', help: 'Stops arbitrage farming. 0 = no limit' },
    { k: 'caravanHoursPer100', label: 'Caravan hours per 100 px', t: 'number', step: 0.1 }, { k: 'maxPlayerCaravans', label: 'Caravans per character', t: 'number' }, { k: 'caravanCapacity', label: 'Caravan capacity', t: 'number' },
    { k: 'escortCost', label: 'Escort cost (share of cargo)', t: 'number', step: 0.01 }, { k: 'maxWorkshopsPerCharacter', label: 'Workshops per character', t: 'number' }, { k: 'workshopSlotsBase', label: 'Workshop plots (base)', t: 'number' },
    { k: 'shopTiers.member', label: 'Sect shop: members %', t: 'number' }, { k: 'shopTiers.ally', label: 'Sect shop: allies %', t: 'number' }, { k: 'shopTiers.neutral', label: 'Sect shop: outsiders %', t: 'number' }, { k: 'shopTiers.rival', label: 'Sect shop: rivals %', t: 'number' }, { k: 'rivalBelow', label: 'Rival below relation', t: 'number' },
    { k: 'underdogBonus', label: 'Join bonus for recommended sects', t: 'number', help: 'Extra Nyang for new characters joining a sect the Balance tab recommends' },
    { section: 'Representatives & stipends' },
    { k: 'representativeRoleIds', label: 'Representative roles (any sect)', t: 'roles', help: 'Members with these roles count as their sect\'s representatives; /office gives the first one' },
    { k: 'maxRepresentatives', label: 'Representatives per faction', t: 'number', help: '0 = no limit' }, { k: 'representativesFight', label: 'Representatives may fight in battles', t: 'check' },
    { k: 'baseIncome', label: 'Faction income / turn (donations)', t: 'number' }, { k: 'memberIncome', label: 'Faction income / member / turn', t: 'number' },
    { k: 'stipendEveryTurns', label: 'Pay stipends every … turns', t: 'number' }, { k: 'maxStipendRate', label: 'Max stipend rate %', t: 'number' },
    { k: 'stipendSoftCap', label: 'Stipend soft cap per weight', t: 'number', help: 'Nobody gets more than cap × weight per payday, however rich the faction' },
    { k: 'repWeight', label: 'Weight: representative', t: 'number', step: 0.5 }, { k: 'leaderWeight', label: 'Weight: leader', t: 'number', step: 0.5 },
    { section: 'Events' },
    { k: 'eventRate', label: 'Event rate ×', t: 'number', step: 0.1 }, { k: 'maxNewEventsPerTurn', label: 'Max new events / turn', t: 'number' },
    { section: 'War' },
    { k: 'battlePrepHours', label: 'Battle preparation (h)', t: 'number', help: 'Time for RP duels and plans before a battle is fought' }, { k: 'battleDays', label: 'Max days per battle', t: 'number' },
    { k: 'duelMomentum', label: 'Dice per duel won', t: 'number', step: 0.5 }, { k: 'maxMomentum', label: 'Max duel dice', t: 'number', step: 0.5 },
    { k: 'pipStat', label: 'Stat per general pip', t: 'number', help: 'Commander pips = stat ÷ this (max 6)' }, { k: 'championDicePer', label: 'Champion power per die', t: 'number' }, { k: 'maxChampionDice', label: 'Max champion dice', t: 'number', step: 0.5 },
    { k: 'casualtyScale', label: 'Casualty scale', t: 'number', step: 0.05 }, { k: 'moraleScale', label: 'Morale loss scale', t: 'number' }, { k: 'wallStrength', label: 'Walls: damage reduction per level', t: 'number', step: 0.01 },
    { k: 'championScale', label: 'Champion power ×', t: 'number', step: 0.1 }, { k: 'autoConquest', label: 'Long occupations change hands without staff approval', t: 'check' }, { k: 'occupationTurns', label: 'Turns of occupation before a takeover', t: 'number' },
    { section: 'Balance' },
    { k: 'powerWeights.military', label: 'Weight: military', t: 'number', step: 0.05 }, { k: 'powerWeights.economy', label: 'Weight: economy', t: 'number', step: 0.05 }, { k: 'powerWeights.politics', label: 'Weight: politics', t: 'number', step: 0.05 }, { k: 'powerWeights.cultivation', label: 'Weight: cultivation', t: 'number', step: 0.05 },
    { k: 'includeNpcInBalance', label: 'Count staff-run (NPC) factions in Balance', t: 'check' },
  ], s);
  const champ = h('input', { value: (s.championRealmMult || []).join(', ') });
  openModal('World settings', h('div', { style: 'display:grid;gap:12px' }, f.el, h('label', { class: 'field wide' }, h('span', {}, 'Champion multiplier per realm (3rd Rate first)'), champ),
    h('div', { class: 'card warn bad' }, h('b', {}, 'Reset the world'), h('p', { class: 'small' }, 'Rebuilds every region, faction, market and event from the defaults (a blank map: no land, relations or treaties). A backup is made first.'),
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
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, 'Factions'), h('button', { class: 'btn', onclick: () => newFaction(render) }, '+ New faction')),
      h('p', { class: 'muted small' }, 'Factions start empty: no land, relations or treaties. Paint land on the Map, set relations below, and let players\' representatives make agreements in /world → Politics.'),
      table([
        ['Faction', (f) => h('span', {}, h('span', { class: 'dot', style: `background:${f.color}` }), ' ', h('b', {}, f.name), f.active ? '' : h('span', { class: 'muted' }, ' (inactive)'))],
        ['Kind', (f) => `${f.kind}${f.npc ? ' · NPC' : ''}`], ['Lands', land], ['Members', members], ['Treasury', (f) => fmtN(f.treasury)], ['Influence', (f) => fmt(f.influence)], ['Rep.', (f) => fmt(f.reputation)],
        ['Leader · representatives', (f) => [f.leaderCharId ? `${charName(f.leaderCharId)} (leader)` : '', ...f.representatives.map(charName)].filter(Boolean).join(', ') || h('span', { class: 'muted' }, 'none')],
        ['Stipends', (f) => (f.stipendRate ? `${fmt(f.stipendRate)}% · fund ${fmtN(f.stipendFund)}` : '—')],
        ['Policies', (f) => f.policies.map((p) => w.policies.find((x) => x.id === p.policyId)?.emoji || '').join(' ')],
        ['Shop', (f) => (f.shop.items.length ? `${f.shop.items.length} item(s) · ${f.shop.access}` : '—')],
      ], fs, (f) => editFaction(f))),
    officesCard(),
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

function officesCard() {
  const w = W_();
  const s = w.settings;
  const withSect = w.factions.filter((f) => f.sect);
  const rows = WD.characters.filter((c) => withSect.some((f) => f.sect === c.sect)).sort((a, b) => (a.sect || '').localeCompare(b.sect || '') || a.name.localeCompare(b.name));
  const preview = h('div');
  const fSel = select(withSect.map((f) => [f.id, f.name]), withSect[0]?.id);
  const showPlan = run(async () => {
    const f = fac(fSel.value); if (!f) return;
    const r = await api(`/world/stipends/${f.id}?fund=${Math.max(Number(f.stipendFund) || 0, 1000)}`);
    preview.replaceChildren(h('p', { class: 'small' }, `${f.name}: fund ${fmtN(r.plan.fund)} → paid ${fmtN(r.plan.total)}, back to the treasury ${fmtN(r.plan.returned)} (cap per person ${fmtN(r.plan.capBase)} × weight).`),
      table([['Character', (x) => x.name], ['Office', (x) => x.office], ['Weight', (x) => x.weight], ['Fair share', (x) => fmtN(x.raw)], ['Cap', (x) => fmtN(x.cap)], ['Paid', (x) => h('b', {}, fmtN(x.paid))]], r.plan.rows),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn small', onclick: run(async () => { if (!confirm(`Pay ${f.name}'s stipend fund out now?`)) return; await api(`/world/stipends/${f.id}/pay`, { method: 'POST', body: {} }); toast('Paid.'); render(); }) }, 'Pay the real fund now')));
  });
  fSel.onchange = showPlan;
  setTimeout(showPlan, 0);
  return h('div', { class: 'card' }, h('h3', {}, 'Representatives, leaders & stipends'),
    h('p', { class: 'muted small' }, `Representatives (up to ${s.maxRepresentatives || '∞'} per faction) are the players whose characters lead their sect's politics, diplomacy and trade. ${s.representativesFight ? 'They may fight in battles.' : 'They do not fight in battles (World settings → "Representatives may fight").'} Staff can also use /office in Discord, which gives the Representative role.`),
    h('div', { class: 'table-wrap', style: 'max-height:320px' }, table([
      ['Character', (c) => h('b', {}, c.name)], ['Sect', (c) => c.sect], ['Player', (c) => c.ownerTag || ''],
      ['Office', (c) => { const sl = select([['member', 'Member'], ['representative', 'Representative'], ['leader', 'Leader']], c.office || 'member'); sl.onchange = run(async () => { await api('/world/office', { method: 'PUT', body: { charId: c.id, office: sl.value } }); toast(`${c.name}: ${sl.value}.`); render(); }); return sl; }],
      ['Purse', (c) => fmtN(c.nyang)],
    ], rows)),
    h('div', { class: 'ref', style: 'margin-top:10px' },
      h('p', {}, h('b', {}, 'Where the money goes. '), 'Each region\'s ', h('i', {}, 'coffers'), ' are its merchants\' and households\' purse: they pay players who sell there and fill when players buy. Every turn the ruler taxes part of it into the faction ', h('i', {}, 'treasury'), ', which pays armies, policies, diplomacy and officials. Members get nothing automatically — unless the faction pays ', h('i', {}, 'stipends'), ':'),
      h('p', {}, h('code', {}, `fund += stipendRate% × net income each turn · every ${s.stipendEveryTurns} turns: raw = fund × weight ÷ Σweights · cap = ${s.stipendSoftCap} × weight × (1 + ln(members) ÷ 4) · paid = cap × (1 − e^(−raw ÷ cap))`)),
      h('p', { class: 'muted small' }, `Weights: member 1 · representative ${s.repWeight} · leader ${s.leaderWeight}. The soft cap is the brake on small rich factions: however big the fund, nobody gets more than their cap per season, and the rest goes back to the treasury. A separate cap stops anyone moving more than ${fmtN(s.maxTradePerTurn)} through the markets per turn (0 = no cap).`),
      h('div', { class: 'toolbar' }, h('span', {}, 'Preview:'), fSel)), preview);
}

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

function editFaction(f, done = render) {
  const w = W_();
  const v = f ? clone(f) : { name: '', kind: 'other', alignment: 'Neutral', color: '#888888', treasury: 2000, influence: 60, reputation: 50, active: true, representatives: [], shop: { access: 'everyone', items: [] }, policies: [] };
  const chars = () => [['', '—'], ...WD.characters.map((c) => [c.id, `${c.name} (${c.sect || 'Rogue'})`])];
  const form = buildForm([
    { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字' }, { k: 'color', label: 'Colour', t: 'color' },
    { k: 'colorStyle', label: 'On the map', t: 'select', opts: [['', 'Map default'], ['washed', 'Washed'], ['vivid', 'Vivid']] },
    { k: 'icon', label: 'Icon in Discord (optional)', help: 'Only used in Discord menus; never drawn on the map' },
    { k: 'kind', label: 'Kind', t: 'select', opts: ['sect', 'clan', 'palace', 'cult', 'court', 'guild', 'bandits', 'other'] }, { k: 'alignment', label: 'Alignment', t: 'select', opts: ['Orthodox', 'Unorthodox', 'Neutral', 'Imperial', 'Demonic'] },
    { k: 'sect', label: 'Linked sect (members)', t: 'select', opts: () => [['', '— none —'], ...WD.sects.map((s) => [s.name, s.name])] }, { k: 'hq', label: 'Headquarters', t: 'select', opts: () => [['', '—'], ...marketOpts()] },
    { k: 'active', label: 'Active', t: 'check' }, { k: 'npc', label: 'NPC (not for players)', t: 'check' },
    { k: 'treasury', label: 'Treasury', t: 'number' }, { k: 'influence', label: 'Influence', t: 'number' }, { k: 'reputation', label: 'Reputation (0–100)', t: 'number' },
    { section: 'Leader, representatives & stipends' },
    { k: 'leaderCharId', label: 'Leader', t: 'select', opts: chars },
    { k: 'repRoleId', label: 'Representative role', t: 'role', help: 'Given to its representatives by /office; members with it count as representatives' },
    { k: 'stipendRate', label: `Stipend: % of net income (max ${W_().settings.maxStipendRate})`, t: 'number', help: 'Set aside each turn, paid to members every season (soft-capped per person)' },
    { k: 'stipendFund', label: 'Stipend fund now', t: 'number' },
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
  openModal(f ? f.name : 'New faction', h('div', { style: 'display:grid;gap:12px' }, form.el,
    h('label', { class: 'field wide' }, h('span', {}, `Representatives (max ${W_().settings.maxRepresentatives || '∞'}) — they lead the faction's diplomacy, trade and politics and usually don't fight`), repSel),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, '🏯 Sect shop'), access, h('button', { class: 'btn small', onclick: () => { shop.items.push({ itemId: WD.items[0]?.id, price: null, stock: -1, restock: 0, access: 'inherit' }); drawShop(); } }, '+ Item')),
      h('p', { class: 'muted small' }, `Prices: members ${W_().settings.shopTiers.member}% · allies ${W_().settings.shopTiers.ally}% · outsiders +${W_().settings.shopTiers.neutral}% · rivals +${W_().settings.shopTiers.rival}% · enemies at war can't buy. Items linked to a good (item editor → World economy) also follow its local price.`), shopWrap),
    f ? h('div', { class: 'card' }, h('h3', {}, '🏛️ Policies'), polWrap) : null,
  ), [
    f && !f.sect ? h('button', { class: 'btn danger left', onclick: run(async () => { if (!confirm(`Delete ${f.name}?`)) return; await api(`/world/factions/${f.id}`, { method: 'DELETE' }); closeModal(); done(); }) }, 'Delete') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const body = { ...form.read(), representatives: [...repSel.selectedOptions].map((o) => o.value), shop };
      if (f) await api(`/world/factions/${f.id}`, { method: 'PUT', body }); else await api('/world/factions', { method: 'POST', body });
      toast('Saved.'); closeModal(); done();
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
      ['Losses', (b) => `${fmtN(b.result?.lost?.A)} / ${fmtN(b.result?.lost?.D)}`], ['Days', (b) => b.result?.days ?? (b.rounds ? `${b.rounds.length} rounds` : '')], ['Terrain', (b) => `${w.terrains[b.result?.terrain]?.label || b.result?.terrain || ''}${b.result?.terrainPenalty ? ` (${b.result.terrainPenalty} dice)` : ''}`], ['Duels', (b) => b.duels.length],
    ], fought, battleDetails)) : null,
    simulatorCard(),
    listEditorCard('Formations', 'formations', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字' },
      { k: 'fire', label: 'Fire damage ×', t: 'number', step: 0.05 }, { k: 'shock', label: 'Shock damage ×', t: 'number', step: 0.05 }, { k: 'defense', label: 'Damage taken ÷', t: 'number', step: 0.05 },
      { k: 'morale', label: 'Morale ×', t: 'number', step: 0.05 }, { k: 'maneuver', label: '+ Maneuver pips', t: 'number' }, { k: 'width', label: 'Combat width ×', t: 'number', step: 0.05 },
      { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'scriptId', label: 'Custom code (battleRound)', t: 'select', opts: scriptOpts },
    ], (f) => `${f.name} ${f.hanzi || ''} — fire ×${f.fire ?? 1} · shock ×${f.shock ?? 1} · def ÷${f.defense ?? 1}${f.maneuver ? ` · +${f.maneuver} maneuver` : ''}`, { json: [['vsRole', 'Extra damage vs troop roles { cavalry: 1.15 }', 2], ['requires', 'Requires { minMen, roles: { cavalry: 0.15 }, commanderRealm (0 = 3rd Rate), commanderSect: [...] }', 3]] }),
    listEditorCard('Troop types', 'unitTypes', [
      { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'role', label: 'Role', t: 'select', opts: ['infantry', 'spear', 'ranged', 'cavalry', 'martial', 'siege'] },
      { k: 'fireOff', label: 'Fire offence pips', t: 'number' }, { k: 'fireDef', label: 'Fire defence pips', t: 'number' }, { k: 'shockOff', label: 'Shock offence pips', t: 'number' }, { k: 'shockDef', label: 'Shock defence pips', t: 'number' },
      { k: 'morale', label: 'Morale ×', t: 'number', step: 0.05 }, { k: 'power', label: 'Power (men each one is worth)', t: 'number', step: 0.1 }, { k: 'speed', label: 'Speed', t: 'number', step: 0.1 },
      { k: 'cost', label: 'Cost / 100', t: 'number' }, { k: 'upkeep', label: 'Upkeep / 100 / turn', t: 'number', step: 0.5 }, { k: 'pursuit', label: 'Pursuit ×', t: 'number', step: 0.1 }, { k: 'siege', label: 'Siege (beats walls)', t: 'number', step: 0.05 },
      { k: 'attack', label: 'Strength rating: attack', t: 'number', step: 0.5, help: 'Only used by the Balance tab' }, { k: 'defense', label: 'Strength rating: defence', t: 'number', step: 0.5 },
      { k: 'description', label: 'Description', t: 'textarea', wide: true },
    ], (u) => `${u.name} — ${u.role} · fire ${u.fireOff ?? 0}/${u.fireDef ?? 0} · shock ${u.shockOff ?? 0}/${u.shockDef ?? 0}${(u.power ?? 1) !== 1 ? ` · ×${u.power}` : ''} · ${u.cost}/100`, { json: [['needs', 'Equipment per 100 men, bought from the market { arms: 1.5, horses: 1 }', 2], ['counters', 'Extra damage vs roles { cavalry: 1.5 }', 2], ['kinds', 'Only these faction kinds (empty = all)', 2]] }),
    terrainCard(),
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
    const fm = select(w.formations.map((f) => [f.id, f.name]), side(k).formationId);
    const cmd = select([['', '— commander —'], ...WD.characters.filter((c) => c.office !== 'representative' || w.settings.representativesFight).map((c) => [c.id, `${c.name} · fire ${c.pips?.fire ?? 0} shock ${c.pips?.shock ?? 0} man. ${c.pips?.maneuver ?? 0}`])], side(k).commanderId);
    const chSel = h('select', { multiple: true, style: 'min-height:70px' }, WD.characters.map((c) => h('option', { value: c.id }, `${c.name} (${c.sect || 'Rogue'}) · ${Math.round(c.champion)}`)));
    [...chSel.options].forEach((o) => (o.selected = side(k).champions.includes(o.value)));
    return h('div', { class: 'card' }, h('b', {}, `${k === 'A' ? 'Attacker' : 'Defender'}: ${facName(side(k).factionId)}`), h('p', { class: 'small muted' }, `Duel dice +${side(k).momentum || 0}${side(k).moraleShock ? ` · morale −${side(k).moraleShock}` : ''}${side(k).commanderFallen ? ' · commander fallen' : ''} · champions: ${champs(k)}`),
      h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', {}, 'Formation'), fm), h('label', { class: 'field' }, h('span', {}, 'Commander (general pips)'), cmd), h('label', { class: 'field wide' }, h('span', {}, 'Champions (power → extra dice)'), chSel)),
      h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/battles/${b.id}/plan`, { method: 'POST', body: { side: k, formationId: fm.value, commanderId: cmd.value, champions: [...chSel.selectedOptions].map((o) => o.value) } }); toast('Saved.'); render(); }) }, 'Save side'));
  };
  return h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `Battle of ${rname(b.region)} — fought ${new Date(b.resolveAt).toLocaleString()}`), h('button', { class: 'btn danger', onclick: run(async () => { if (!confirm('Fight the battle now?')) return; await api(`/world/battles/${b.id}/resolve`, { method: 'POST', body: {} }); render(); }) }, 'Fight now')),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(300px,1fr))' }, planRow('A'), planRow('D')),
    h('div', { class: 'toolbar', style: 'margin-top:8px' }, h('b', {}, 'Record a duel:'), wSel, lSel, note, h('button', { class: 'btn', onclick: run(async () => { const r = await api(`/world/battles/${b.id}/duel`, { method: 'POST', body: { winner: wSel.value, loser: lSel.value, note: note.value } }); toast(plain(r.text)); render(); }) }, 'Record')),
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
  const v = a ? clone(a) : { name: '', factionId: w.factions[0]?.id, region: WD.markets[0], units: {}, morale: 70, supply: 100, formationId: 'square', commanderId: '', scriptId: '' };
  const f = buildForm([
    { k: 'name', label: 'Name' }, { k: 'factionId', label: 'Faction', t: 'select', opts: factionOpts() }, { k: 'region', label: 'Where', t: 'select', opts: marketOpts },
    { k: 'formationId', label: 'Formation', t: 'select', opts: w.formations.map((x) => [x.id, x.name]) },
    { k: 'commanderId', label: 'Commander', t: 'select', opts: () => [['', '—'], ...WD.characters.map((c) => [c.id, `${c.name} (fire ${c.pips?.fire ?? 0} · shock ${c.pips?.shock ?? 0} · maneuver ${c.pips?.maneuver ?? 0} · siege ${c.pips?.siege ?? 0})`])] },
    { k: 'scriptId', label: 'Custom code (armyTick, battleRound)', t: 'select', opts: scriptOpts, help: 'For special benefits: a famous banner, a sect\'s secret drill, a blessed general…' },
    { k: 'morale', label: 'Morale', t: 'number' }, { k: 'supply', label: 'Supply', t: 'number' },
    { section: 'Troops' }, ...w.unitTypes.map((u) => ({ k: `units.${u.id}`, label: u.name, t: 'number' })),
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
    const v = { units, formationId: 'square', morale: 70, duelDice: 0, champions: '', general: { fire: 0, shock: 0, maneuver: 0, siege: 0 } };
    const f = buildForm([...w.unitTypes.map((u) => ({ k: `units.${u.id}`, label: u.name, t: 'number' })), { k: 'formationId', label: 'Formation', t: 'select', opts: w.formations.map((x) => [x.id, x.name]) }, { k: 'morale', label: 'Morale', t: 'number' },
      { k: 'general.fire', label: 'General fire pips', t: 'number' }, { k: 'general.shock', label: 'General shock pips', t: 'number' }, { k: 'general.maneuver', label: 'General maneuver pips', t: 'number' }, { k: 'general.siege', label: 'General siege pips', t: 'number' },
      { k: 'duelDice', label: 'Duel dice (0–2)', t: 'number' }, { k: 'champions', label: 'Champion powers (comma separated)', wide: true, help: 'Power = (STR+END+MOB) × realm multiplier; every ' + (w.settings.championDicePer || 600) + ' power = +1 die' }], v);
    return { el: h('div', { class: 'card' }, h('b', {}, label), f.el), read: () => { const x = f.read(); return { ...x, champions: String(x.champions || '').split(/[,\s]+/).filter(Boolean).map(Number) }; } };
  };
  const A = side('Attacker', { spearmen: 2000, crossbows: 1000 }); const Dd = side('Defender', { swordsmen: 2500, disciples: 100 });
  const terrain = select(Object.entries(w.terrains).map(([k, t]) => [k, `${t.label} (attacker ${t.attackerPenalty || 0} dice · width ${t.width || 30}k)`]), 'plains');
  const fort = h('input', { type: 'number', value: 0, min: 0, max: 5, style: 'width:70px' });
  const out = h('div');
  return h('div', { class: 'card' }, h('h3', {}, 'Battle simulator'), h('p', { class: 'muted small' }, 'Runs the real battle code 300 times on made-up armies (nothing in the world changes). The defender is treated as holding its own land, so walls count.'),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(300px,1fr))' }, A.el, Dd.el),
    h('div', { class: 'toolbar', style: 'margin-top:8px' }, terrain, h('span', {}, 'walls'), fort, h('button', { class: 'btn primary', onclick: run(async () => {
      const r = await api('/world/simulate', { method: 'POST', body: { A: A.read(), D: Dd.read(), terrain: terrain.value, fort: Number(fort.value), runs: 300 } });
      const smp = r.sample;
      out.replaceChildren(h('p', {}, h('b', {}, `Attacker wins ${r.attackerWins}%`), ` · average losses ${fmtN(r.avgLossA)} (attacker) / ${fmtN(r.avgLossD)} (defender) · ${r.avgDays} days`),
        smp ? h('details', {}, h('summary', {}, 'One sample battle, day by day'), dayChart(smp)) : null);
    }) }, 'Simulate'), out));
}
/** Morale of both sides over the days of a battle. */
function dayChart(b) {
  const days = b.days || [];
  if (!days.length) return h('p', { class: 'muted' }, 'No days fought.');
  const W0 = 520; const H0 = 140;
  const maxM = Math.max(1, ...days.flatMap((d) => [d.morale.A, d.morale.D]), b.result?.morale?.A?.[0] || 0, b.result?.morale?.D?.[0] || 0);
  const x = (i) => 30 + (i / Math.max(1, days.length - 1)) * (W0 - 40); const y = (m) => H0 - 20 - (m / maxM) * (H0 - 30);
  const line = (k, color) => sv('polyline', { points: days.map((d, i) => `${x(i)},${y(d.morale[k])}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2 });
  const svg = sv('svg', { width: W0, height: H0, viewBox: `0 0 ${W0} ${H0}`, style: 'max-width:100%' });
  (b.phases || []).forEach((p) => { const i = days.findIndex((d) => d.day === p.day); if (i < 0) return; svg.append(sv('rect', { x: x(i), y: 6, width: Math.max(2, x(Math.min(days.length - 1, i + 3)) - x(i)), height: H0 - 26, fill: p.phase === 'fire' ? '#3a2e1c' : '#2a1d1d', opacity: 0.5 }), sv('text', { x: x(i) + 2, y: 16, 'font-size': 9, fill: '#a39887' }, `${p.phase} ${p.dice.A}:${p.dice.D}`)); });
  svg.append(line('A', '#d9a441'), line('D', '#7fb3d5'), sv('text', { x: 30, y: H0 - 4, 'font-size': 10, fill: '#a39887' }, `day 1 … ${days.length} · gold = attacker morale, blue = defender`));
  return h('div', {}, svg, h('p', { class: 'small muted' }, `Winner: ${b.result?.winner === 'A' ? 'attacker' : 'defender'} · losses ${fmtN(b.result?.lost?.A)} / ${fmtN(b.result?.lost?.D)}${b.result?.pursuit ? ` (pursuit ${fmtN(b.result.pursuit)})` : ''}`));
}
function battleDetails(b) {
  openModal(`Battle of ${rname(b.region)}`, h('div', {}, dayChart(b), b.duels.length ? h('p', { class: 'small' }, b.duels.map((d) => `${charName(d.winner)} beat ${charName(d.loser)}`).join(' · ')) : null,
    b.result?.pips ? h('p', { class: 'small muted' }, `Generals — attacker ${b.result.commanders?.A || 'none'} (fire ${b.result.pips.A.fire} · shock ${b.result.pips.A.shock} · maneuver ${b.result.pips.A.maneuver}), defender ${b.result.commanders?.D || 'none'} (fire ${b.result.pips.D.fire} · shock ${b.result.pips.D.shock} · maneuver ${b.result.pips.D.maneuver}) · walls ×${b.result.walls}`) : null),
  [h('button', { class: 'btn', onclick: closeModal }, 'Close')]);
}
function terrainCard() {
  const w = W_();
  const t = clone(w.terrains);
  const rows = Object.entries(t);
  const num = (o, k, step = 1) => { const i = h('input', { type: 'number', step, value: o[k] ?? '', style: 'width:70px' }); i.onchange = () => (o[k] = i.value === '' ? undefined : Number(i.value)); return i; };
  return h('div', { class: 'card' }, h('h3', {}, 'Terrain in battle'), h('p', { class: 'muted small' }, 'Where a battle is fought matters: the attacker loses dice in rough country (better maneuver cancels it), only so many thousand men fit in the line, cavalry hits harder on open ground. Supply changes how fast armies starve there.'),
    table([['Terrain', ([, o]) => o.label], ['Attacker dice', ([, o]) => num(o, 'attackerPenalty')], ['Width (k men)', ([, o]) => num(o, 'width')], ['Cavalry ×', ([, o]) => num(o, 'cavalry', 0.05)], ['Supply / turn', ([, o]) => num(o, 'supply')], ['River crossing', ([, o]) => { const c = h('input', { type: 'checkbox' }); c.checked = !!o.riverCrossing; c.onchange = () => (o.riverCrossing = c.checked); return c; }]], rows),
    h('div', { class: 'toolbar', style: 'margin-top:8px' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: run(async () => { await api('/world/terrains', { method: 'PUT', body: t }); toast('Saved.'); render(); }) }, 'Save terrain')));
}

function warFormulas() {
  const s = W_().settings;
  return h('div', { class: 'card ref' }, h('h3', {}, 'How battles work (Europa Universalis style)'),
    h('p', {}, `When hostile armies meet in a region, a battle opens for ${s.battlePrepHours} h of real time. Each side picks a formation and a commander; characters join as champions; staff record in-character duels (each win = +${s.duelMomentum} die for that side, max ${s.maxMomentum}; a beaten commander leaves the field and costs 15 morale). Then up to ${s.battleDays} days are fought in the region itself — its terrain, its walls and its width.`),
    h('p', {}, h('b', {}, 'Phases. '), 'Days alternate 3 of FIRE (arrows, crossbows) and 3 of SHOCK (melee). Each phase, both sides roll a die 0–9.'),
    h('p', {}, h('code', {}, 'dice = roll + max(0, my general\'s pips − theirs) + terrain penalty (attacker only; cancelled by better maneuver; −1 more crossing a river) + champion dice + duel dice + custom code')),
    h('p', {}, h('code', {}, `damage per troop type = (15 + 5 × max(0, dice + its offence pips − enemy defence pips)) × men in the line × power ÷ 1000 × formation × counters × cavalry terrain × supply × ${s.casualtyScale}`)),
    h('p', {}, h('code', {}, `casualties = damage ÷ (enemy formation defence × walls)   ·   walls = 1 + ${s.wallStrength} × (fort − ½ siege), only for a defender on its own land`)),
    h('p', {}, h('code', {}, `morale lost = share of strength lost × ${s.moraleScale} ÷ formation morale + 0.3 a day`), ' — at 0 morale an army routs and the winner\'s cavalry pursue. If both stand after the last day, the side with more of its morale left wins; a tie goes to the defender.'),
    h('p', {}, h('code', {}, `general pips = stat ÷ ${s.pipStat} (max 6): fire = Qi · shock = Strength · maneuver = Mobility · siege = Endurance`), ' · ', h('code', {}, `champion dice = Σ champion power ÷ ${s.championDicePer} (max ${s.maxChampionDice})`), ` · champion power = (Strength + Endurance + Mobility) × realm multiplier (${(s.championRealmMult || []).join(', ')}).`),
    h('p', {}, h('b', {}, 'Custom code. '), 'Give an army, a faction, a formation or a region a script: ', h('code', {}, 'hooks.battleRound = (ctx, v) => { if (ctx.side === "attacker" && ctx.phase === "shock") v.attacker.dice += 1; return v; }'), ' runs every phase (v.attacker / v.defender have dice, damage × and morale +). ', h('code', {}, 'hooks.armyTick = (ctx, v) => { v.morale += 1; return v; }'), ' runs every turn on the army (morale, supply, attrition %).'),
    h('p', { class: 'muted small' }, `Armies cost upkeep every turn, eat grain where they stand and lose supply in foreign land. An unopposed army at war with a region's ruler occupies it (the occupier collects its taxes); after ${s.occupationTurns} turns a takeover request goes to staff${s.autoConquest ? ' — or happens automatically (World settings)' : ''}. ${s.representativesFight ? '' : 'Representatives don\'t fight.'}`));
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
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Recommended for new players'), h('b', { style: 'font-size:18px' }, r.recommend.map((x) => x.name).join(' · ') || '—'))),
      h('div', { class: 'card' }, table([
        ['Faction', (x) => h('span', {}, h('span', { class: 'dot', style: `background:${x.color}` }), ` ${x.name}`)],
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
  return [h('div', { class: 'toolbar' }, h('label', { class: 'field check' }, npc, h('span', {}, 'Include staff-run (NPC) factions'))), wrap];
};
