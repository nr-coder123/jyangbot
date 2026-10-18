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
/** Walls of a market in battle: base walls + City Walls (+fort per level, only at half strength or more). */
const wallsOfR = (r) => (r ? Number(r.fort || 0) + (r.buildings || []).reduce((s, b) => { const t = W_().buildingTypes.find((x) => x.id === b.typeId); return s + (b.status === 'ready' && b.hp >= 50 ? Number(t?.fort || 0) * (b.level || 1) : 0); }, 0) : 0);
const isProd = (t) => !!t && (Object.keys(t.outputs || {}).length > 0 || Number(t.service) > 0);
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
const STANCE_COLOR = { self: '#d9a441', allied: '#4f9d5d', agreement: '#9cc58a', neutral: '#dcd3ba', war: '#a32020' };
function stanceOf(a, b) {
  const w = W_();
  if (!a || !b) return 'neutral';
  if (a === b) return 'self';
  if (w.wars.some((x) => (x.attackers.includes(a) && x.defenders.includes(b)) || (x.attackers.includes(b) && x.defenders.includes(a)))) return 'war';
  if (w.alliances.some((x) => x.members.includes(a) && x.members.includes(b))) return 'allied';
  if (w.agreements.some((t) => t.parties.includes(a) && t.parties.includes(b))) return 'agreement';
  return 'neutral';
}
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
  if (value !== undefined && value !== null) s.value = value;
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
    layers: { borders: false, rivers: true, mountains: true, labels: true, factionNames: true, alliances: true, landmarks: true, armies: true, caravans: false, events: false, routes: false, title: false, ...(saved.layers || {}) },
    vb: { ...MAP_HOME }, frontier: null, allianceId: saved.allianceId || '', undo: [], redo: [], hover: null, search: '',
  };
})();
const saveMapPrefs = () => { try { localStorage.setItem('jh_map', JSON.stringify({ overlay: MAPV.overlay, good: MAPV.good, relF: MAPV.relF, layers: MAPV.layers, paintF: MAPV.paintF, side: MAPV.side, sideOpen: MAPV.sideOpen, allianceId: MAPV.allianceId })); } catch {} };
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
    case 'food': return r ? ramp(((r.last?.food ?? 1) - 0.5) / 0.5) : UNCLAIMED;
    case 'price': { const g = goodOf(MAPV.good); return g && r ? priceRamp((r.prices?.[g.id] || g.basePrice) / g.basePrice) : UNCLAIMED; }
    case 'terrain': return TERRAIN_COLOR[r?.terrain] || UNCLAIMED;
    case 'walls': return r ? wallRamp(wallsOfR(r)) : UNCLAIMED;
    case 'events': return r && w.activeEvents.some((e) => e.regions.includes(marketOf(key))) ? '#e08a3c' : UNCLAIMED;
    case 'relations': {
      const ctl = ctlOf(key);
      if (!MAPV.relF || !ctl) return UNCLAIMED;
      return STANCE_COLOR[stanceOf(MAPV.relF, ctl)] || UNCLAIMED;
    }
    default: return fac(ctlOf(key))?.color || UNCLAIMED;
  }
}
function wallRamp(v) { return v <= 0 ? '#e9e1cf' : ramp(Math.min(1, v / 10)); }
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
  if (o === 'relations') return [box(STANCE_COLOR.self, 'this faction'), box(STANCE_COLOR.allied, 'same alliance'), box(STANCE_COLOR.agreement, 'agreement'), box(STANCE_COLOR.neutral, 'neutral'), box(STANCE_COLOR.war, 'at war')];
  if (o === 'events') return [box('#e08a3c', 'event in progress')];
  if (o === 'walls') return [box(wallRamp(0), 'no walls'), box(wallRamp(3), '3'), box(wallRamp(6), '6'), box(wallRamp(10), '10+')];
  return [box(ramp(0), 'low'), box(ramp(0.5), 'mid'), box(ramp(1), 'high')];
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
  // Alliances (as in the Map Studio): a hatched or dotted wash over every member's land and one thick border around the bloc.
  const allianceLabels = [];
  if (MAPV.layers.alliances && MAPV.overlay === 'political') {
    const defs = svg.querySelector('defs');
    for (const al of (w.alliances || []).filter((a) => a.showOnMap !== false && a.members.length)) {
      const mine = shapes.filter((x) => al.members.includes(ctlOf(x.key)));
      if (!mine.length) continue;
      const id = al.id.replace(/[^\w-]/g, '');
      const width = Math.max(1, Number(al.style?.width) || 5);
      const fill = al.style?.fill || 'hatched';
      if (fill === 'hatched') defs.append(sv('pattern', { id: `al-pat-${id}`, width: 12, height: 12, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('line', { x1: 0, y1: 0, x2: 0, y2: 12, stroke: al.color, 'stroke-width': 2.5, opacity: 0.4 })));
      if (fill === 'dots') defs.append(sv('pattern', { id: `al-pat-${id}`, width: 9, height: 9, patternUnits: 'userSpaceOnUse' }, sv('circle', { cx: 4.5, cy: 4.5, r: 1.4, fill: al.color, opacity: 0.55 })));
      defs.append(sv('filter', { id: `al-rim-${id}`, x: '-5%', y: '-5%', width: '110%', height: '110%' },
        sv('feMorphology', { in: 'SourceGraphic', operator: 'erode', radius: (width * 0.45).toFixed(2), result: 'in' }),
        sv('feComposite', { in: 'SourceGraphic', in2: 'in', operator: 'out' })));
      const g = sv('g', { 'pointer-events': 'none' });
      if (fill !== 'none') g.append(sv('g', {}, ...mine.map((x) => sv('path', { d: x.d, fill: `url(#al-pat-${id})` }))));
      g.append(sv('g', { filter: `url(#al-rim-${id})`, opacity: 0.95 }, ...mine.map((x) => sv('path', { d: x.d, fill: al.color, stroke: al.color, 'stroke-width': 2.6, 'stroke-linejoin': 'round' }))));
      svg.append(g);
      const area = mine.reduce((a, x) => a + (x.area || 1), 0);
      const cx = mine.reduce((a, x) => a + x.c[0] * (x.area || 1), 0) / area; const cy = mine.reduce((a, x) => a + x.c[1] * (x.area || 1), 0) / area;
      // The name sits under the bloc's southernmost land, clear of the faction names.
      const low = mine.reduce((a, x) => (x.c[1] > a.c[1] ? x : a), mine[0]);
      allianceLabels.push({ al, cx: (cx + low.c[0]) / 2, cy: low.c[1] + Math.sqrt(low.area || 1) * 0.45, area });
    }
  }
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
  for (const x of allianceLabels) {
    const fs = Math.max(8, Math.min(22, 6 + Math.sqrt(x.area) / 14)) * zoomK;
    labG.append(sv('text', { x: x.cx, y: x.cy, 'font-size': fs.toFixed(1), 'text-anchor': 'middle', fill: x.al.color, 'font-weight': 700, 'font-style': 'italic', stroke: '#ede2cc', 'stroke-width': Math.max(1.5, fs / 6).toFixed(2), 'paint-order': 'stroke', 'letter-spacing': 2 }, (lang === 'hanzi' && x.al.hanzi ? x.al.hanzi : x.al.name).toUpperCase()));
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
  alliance: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'M8 11h8', 'M12 7v8'],
  walls: ['M3 21V8h3V5h3v3h2V5h2v3h2V5h3v3h3v13Z', 'M10 21v-5a2 2 0 0 1 4 0v5'],
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
  let w = W_();
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
    status.replaceChildren(k ? h('span', {}, h('b', {}, rfull(k)), ` ${geoOf(k)?.hanzi || ''} — `, (() => { const f = fac(ctlOf(k)); return f ? h('span', { style: `color:${f.color};font-weight:600` }, f.name) : h('span', { class: 'muted' }, 'unclaimed'); })(), W_().regions[k]?.special ? h('span', { class: 'muted' }, ' · own market') : null, MAPV.tool === 'walls' || MAPV.overlay === 'walls' ? h('span', {}, ` · walls ${fmt(W_().regions[marketOf(k)]?.fort || 0)}${wallsOfR(W_().regions[marketOf(k)]) > (W_().regions[marketOf(k)]?.fort || 0) ? ` (+${fmt(wallsOfR(W_().regions[marketOf(k)]) - (W_().regions[marketOf(k)]?.fort || 0))} City Walls)` : ''}`) : null)
      : h('span', { class: 'muted' }, MAPV.tool === 'paint' ? (fac(MAPV.paintF) ? `Click or drag to paint ${fac(MAPV.paintF).name}. Drag the sea to move.` : 'Pick a faction to paint with.') : MAPV.tool === 'erase' ? 'Click or drag to unclaim land.' : MAPV.tool === 'alliance' ? 'Click a region to add or remove its ruler from the alliance.' : MAPV.tool === 'walls' ? 'Click a region to set its walls (choose the level top left).' : MAPV.tool === 'landmark' ? 'Click the map to place a landmark.' : MAPV.tool === 'frontier' ? 'Click points to draw a line.' : 'Click a region to inspect it.'));
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
  const reloadAll = async () => { await loadWorld(); w = W_(); redraw(); drawSide(); drawActive(); drawRail(); };
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
      if (MAPV.tool === 'walls' && ev.key) {
        const mk = marketOf(ev.key); const r = w.regions[mk];
        const lv = MAPV.wallLv ?? 3;
        const next = MAPV.wallMode === 'add' ? Math.max(0, Math.min(10, Number(r?.fort || 0) + 1)) : MAPV.wallMode === 'sub' ? Math.max(0, Number(r?.fort || 0) - 1) : lv;
        await api(`/world/regions/${encodeURIComponent(mk)}`, { method: 'PUT', body: { fort: next } });
        await loadWorld(); w = W_();
        const extra = wallsOfR(w.regions[mk]) - next;
        toast(`${rfull(mk)}: walls ${next}${extra ? ` (+${extra} from City Walls = ${next + extra} in battle)` : ''}.`);
        redraw(); drawSide(); return;
      }
      if (MAPV.tool === 'alliance' && ev.key) {
        const al = w.alliances.find((a) => a.id === MAPV.allianceId);
        if (!al) { toast('Pick or create an alliance first (top left).', true); return; }
        const fid = ctlOf(ev.key);
        if (!fid) { toast(`${rfull(ev.key)} has no ruler — paint it first.`, true); return; }
        const inIt = al.members.includes(fid);
        const members = inIt ? al.members.filter((m) => m !== fid) : [...al.members, fid];
        await api(`/world/alliances/${al.id}`, { method: 'PUT', body: { members } });
        toast(`${fac(fid)?.name} ${inIt ? 'left' : 'joined'} the ${al.name}.`);
        await reloadAll(); return;
      }
      if (ev.key) { WSEL = ev.key; MAPV.side = 'region'; MAPV.sideOpen = true; redraw(); drawSide(); }
    } catch (e) { toast(e.message, true); redraw(); }
  }
  // ----- left rail (tools) -----
  const setTool = (t) => {
    // The walls tool shows the walls map mode while it is active, then puts the previous one back.
    const swap = (MAPV.tool === 'walls') !== (t === 'walls');
    if (swap && t === 'walls') { MAPV.prevOverlay = MAPV.overlay; MAPV.overlay = 'walls'; } else if (swap && MAPV.overlay === 'walls') MAPV.overlay = MAPV.prevOverlay && MAPV.prevOverlay !== 'walls' ? MAPV.prevOverlay : 'political';
    MAPV.tool = t; if (swap) drawSide(); if (t !== 'frontier') MAPV.frontier = null; drawRail(); drawActive(); redraw(); };
  const zoom = (k) => { const vb = MAPV.vb; const nw = Math.max(100, Math.min(2800, vb.w * k)); const nh = vb.h * (nw / vb.w); MAPV.vb = { x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh }; redraw(); };
  const railBtn = (id, label, desc, onclick, { on = false, disabled = false } = {}) => h('button', { class: `wm-tool${on ? ' on' : ''}`, onclick, disabled, 'aria-label': label }, icon(id), h('span', { class: 'wm-tip' }, h('b', {}, label), desc ? h('small', {}, desc) : null));
  function drawRail() {
    rail.replaceChildren(
      railBtn('paint', 'Paint  (B)', 'Click or drag land to give it to the active faction', () => setTool('paint'), { on: MAPV.tool === 'paint' }),
      railBtn('erase', 'Eraser  (E)', 'Click or drag to unclaim land', () => setTool('erase'), { on: MAPV.tool === 'erase' }),
      railBtn('inspect', 'Inspect  (I)', 'Click a region to see and edit it', () => setTool('inspect'), { on: MAPV.tool === 'inspect' }),
      railBtn('alliance', 'Alliance  (A)', 'Click a region to add or remove its ruler from the active alliance', () => setTool('alliance'), { on: MAPV.tool === 'alliance' }),
      railBtn('walls', 'Walls  (W)', 'Click a region to set its walls (forts for battles)', () => setTool('walls'), { on: MAPV.tool === 'walls' }),
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
    if (MAPV.tool === 'walls') {
      const lv = MAPV.wallLv ?? 3; const mode = MAPV.wallMode || 'set';
      const pick = (m, n) => { MAPV.wallMode = m; if (n !== undefined) MAPV.wallLv = n; drawActive(); };
      active.replaceChildren(
        h('div', { class: 'wm-active-row' }, h('span', { class: 'muted' }, 'Walls — click a region')),
        h('div', { class: 'toolbar small', style: 'flex-wrap:wrap;gap:4px' }, ...Array.from({ length: 11 }, (_, n) => h('button', { class: `btn small${mode === 'set' && lv === n ? ' primary' : ''}`, style: 'min-width:30px;padding:4px 6px', onclick: () => pick('set', n) }, String(n)))),
        h('div', { class: 'toolbar small' }, h('button', { class: `btn small${mode === 'add' ? ' primary' : ''}`, onclick: () => pick('add') }, '+1 per click'), h('button', { class: `btn small${mode === 'sub' ? ' primary' : ''}`, onclick: () => pick('sub') }, '−1 per click')),
        h('div', { class: 'muted small' }, mode === 'set' ? `Clicked regions get walls ${lv}. ` : '', '0 = open country, 3 = a walled city, 6 = a great fortress, 10 = an impregnable pass. City Walls buildings add +1 per level on top. A prefecture without its own market sets its province\'s walls.'));
      return;
    }
    if (MAPV.tool === 'alliance') {
      const al = w.alliances.find((a) => a.id === MAPV.allianceId);
      const asel = select([['', '— choose an alliance —'], ...w.alliances.map((a) => [a.id, a.name])], MAPV.allianceId, { class: 'wm-select' });
      asel.onchange = () => { MAPV.allianceId = asel.value; saveMapPrefs(); drawActive(); };
      active.replaceChildren(
        h('div', { class: 'wm-active-row' }, h('span', { class: 'muted' }, 'Active alliance'), h('button', { class: 'linkbtn', onclick: () => editAlliance(null) }, '+ New')),
        asel,
        al ? h('div', { class: 'wm-chip' }, h('span', { class: 'dot', style: `background:${al.color}` }), h('span', { class: 'grow' }, al.name), h('span', { class: 'muted small' }, `${al.members.length} members`)) : '',
        h('div', { class: 'muted small' }, 'Click a region: its ruler joins or leaves.'));
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
  const SIDE_TABS = [['factions', 'Factions'], ['alliances', 'Alliances'], ['region', 'Region'], ['takeovers', 'Claims'], ['map', 'Map']];
  function drawSide() {
    const pending = (w.takeovers || []).filter((t) => t.status === 'pending').length;
    const tabs = h('div', { class: 'wm-tabs' }, SIDE_TABS.map(([id, label]) => h('button', { class: MAPV.side === id ? 'on' : '', onclick: () => { MAPV.side = id; saveMapPrefs(); drawSide(); } }, label, id === 'takeovers' && pending ? h('span', { class: 'wm-badge' }, pending) : null)));
    const body = h('div', { class: 'wm-side-body' });
    if (MAPV.side === 'factions') body.append(...factionsPanel());
    else if (MAPV.side === 'region') body.append(...(WSEL ? regionDrawer(WSEL, reloadAll) : [h('p', { class: 'muted' }, 'Pick the Inspect tool (or press I) and click a region to see who rules it, its market, Discord channels and more.')]));
    else if (MAPV.side === 'takeovers') body.append(...takeoversPanel(reloadAll));
    else if (MAPV.side === 'alliances') body.append(...alliancesPanel());
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
  function alliancesPanel() {
    return [
      h('div', { class: 'toolbar' }, h('span', { class: 'grow muted small' }, 'A bloc drawn on the map, with terms shared by all its members.'), h('button', { class: 'btn small primary', onclick: () => editAlliance(null) }, '+ New')),
      h('div', { class: 'wm-flist' }, w.alliances.map((a) => h('div', { class: `wm-frow${MAPV.allianceId === a.id ? ' on' : ''}`, onclick: (e) => { if (e.target.closest('button')) return; MAPV.allianceId = a.id; MAPV.tool = 'alliance'; saveMapPrefs(); drawRail(); drawActive(); drawSide(); redraw(); } },
        h('span', { class: 'dot', style: `background:${a.color};width:22px;height:22px;flex:none` }),
        h('div', { class: 'grow' }, h('div', { class: 'wm-fname' }, a.name, a.hanzi ? h('span', { class: 'muted' }, ` ${a.hanzi}`) : ''), h('div', { class: 'muted small' }, a.members.map((m) => fac(m)?.name).join(', ') || 'no members')),
        h('button', { class: 'btn small ghost', onclick: () => editAlliance(a) }, 'Edit')))),
      w.alliances.length ? null : h('p', { class: 'muted small' }, 'No alliances yet.'),
      h('p', { class: 'muted small' }, 'Pick an alliance, then use the Alliance tool (A) and click regions: their rulers join or leave. Terms, colour and border are set with Edit.'),
    ].filter(Boolean);
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
    const map = { b: 'paint', p: 'paint', e: 'erase', i: 'inspect', a: 'alliance', l: 'landmark', f: 'frontier', w: 'walls' };
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
    { k: 'npc', label: 'Run by staff (not a player sect)', t: 'check' },
    { k: 'description', label: 'Description', t: 'textarea', wide: true },
  ], { name: '', hanzi: '', color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`, kind: 'other', npc: true, description: '' });
  openModal('New faction', h('div', {}, f.el, h('p', { class: 'muted small' }, 'Sects already have their own faction (it follows the sect\'s name and members). Use this for powers that are not sects. It starts with no land, no relations and no treaties.')), [
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => { const v = f.read(); if (!v.name) throw new Error('Name it first.'); const r = await api('/world/factions', { method: 'POST', body: { ...v, treasury: 0 } }); MAPV.paintF = r.faction.id; MAPV.tool = 'paint'; saveMapPrefs(); closeModal(); toast(`${v.name} created — paint its land.`); done(); }) }, 'Create'),
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
  const overlaySel = select([['political', 'Political (who rules)'], ['prosperity', 'Prosperity'], ['food', 'Food supply'], ['security', 'Security'], ['price', 'Price of…'], ['relations', 'Alliances & wars of…'], ['events', 'Events'], ['terrain', 'Terrain'], ['walls', 'Walls & forts']], MAPV.overlay);
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
  const layers = h('div', { class: 'wm-checks' }, Object.entries({ labels: 'Region names', factionNames: 'Faction names', alliances: 'Alliances', rivers: 'Rivers', mountains: 'Peaks & passes', borders: 'Prefecture borders', landmarks: 'Landmarks', armies: 'Armies & battles', caravans: 'Caravans', events: 'Events', routes: 'Trade routes', title: 'Map title' }).map(([k, label]) => {
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
        )),
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
      h('p', { class: 'muted' }, 'Load a project you exported from the Murim Map Studio (myumyu). Factions are matched by name (new ones are created), provinces are painted, landmarks, frontier lines and the title come along, and its alliances are created with their colours and members.'),
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
      h('span', { class: 'muted' }, 'Security'), h('span', {}, fmt(mr.security)),
      h('span', { class: 'muted' }, 'Walls'), h('span', { class: 'toolbar small', style: 'gap:4px' },
        h('button', { class: 'btn small', title: 'Lower the walls', disabled: !(mr.fort > 0), onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(market)}`, { method: 'PUT', body: { fort: Math.max(0, Math.round(mr.fort) - 1) } }); reload(); }) }, '−'),
        h('b', {}, String(Math.round(mr.fort * 10) / 10)),
        h('button', { class: 'btn small', title: 'Raise the walls', disabled: mr.fort >= 10, onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(market)}`, { method: 'PUT', body: { fort: Math.min(10, Math.round(mr.fort) + 1) } }); reload(); }) }, '+'),
        h('span', { class: 'muted' }, wallsOfR(mr) > mr.fort ? `+${fmt(wallsOfR(mr) - mr.fort)} City Walls = ${fmt(wallsOfR(mr))} in battle` : `${key !== market ? `(${rname(market)}) ` : ''}0–10`)),
      h('span', { class: 'muted' }, 'Buildings'), h('span', {}, (mr.buildings || []).map((b) => `${w.buildingTypes.find((x) => x.id === b.typeId)?.name || b.typeId}${b.level > 1 ? ` Lv ${b.level}` : ''}${b.status === 'building' ? ' (building)' : b.hp < 100 ? ` (${Math.round(b.hp)}%)` : ''}`).join(', ') || '—'),
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
        isM ? { k: 'fort', label: 'Walls / forts (0–10)', t: 'number', help: 'Base walls. City Walls buildings add +1 per level' } : null,
        isM ? { k: 'taxRate', label: 'Tax rate %', t: 'number' } : null,
        isM ? { k: 'prosperity', label: 'Prosperity', t: 'number' } : null,
        isM ? { k: 'security', label: 'Security', t: 'number' } : null,
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
    buildings: () => {
      if (!mr) return [];
      const btype = (id) => w.buildingTypes.find((x) => x.id === id);
      const typeSel = select(w.buildingTypes.filter((t) => !(mr.buildings || []).some((b) => b.typeId === t.id)).map((t) => [t.id, `${t.name} ${t.hanzi || ''}`]));
      const lvl = h('input', { type: 'number', min: 1, max: 3, value: 1, style: 'width:56px' });
      const redo = async () => reload();
      const rows = (mr.buildings || []).map((b) => {
        const t = btype(b.typeId);
        const lv = h('input', { type: 'number', min: 1, max: t?.maxLevel || 1, value: b.level, style: 'width:56px' });
        const hp = h('input', { type: 'number', min: 0, max: 100, value: Math.round(b.hp), style: 'width:64px' });
        return h('tr', {}, h('td', {}, h('b', {}, t?.name || b.typeId), ' ', h('span', { class: 'muted small' }, t?.hanzi || '')),
          h('td', {}, (t?.maxLevel || 1) > 1 ? lv : '—'), h('td', {}, hp),
          h('td', {}, b.status === 'building' ? `building (turn ${b.readyTurn})` : isProd(t) ? `${fmt(b.lastProfit)}/turn${b.lastRun < 1 ? ` · ${Math.round(b.lastRun * 100)}% busy` : ''}` : 'in use'),
          h('td', {}, h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(market)}/buildings/${b.id}`, { method: 'PUT', body: { level: Number(lv.value), hp: Number(hp.value), status: 'ready' } }); toast('Saved.'); await redo(); }) }, 'Save'), ' ',
            h('button', { class: 'btn small danger', onclick: run(async () => { if (!confirm('Remove this building?')) return; await api(`/world/regions/${encodeURIComponent(market)}/buildings/${b.id}`, { method: 'DELETE' }); await redo(); }) }, '✕')));
      });
      return [
        h('p', { class: 'muted small' }, `Buildings in ${rname(market)}. Production buildings (brewery, smithy…) buy their inputs here, sell their goods back and pay the profit to whoever rules the region; the rest give lasting bonuses. ${mr.controller ? `Owned by ${facName(mr.controller)}.` : 'Unclaimed: profits stay in the town\'s coffers until someone takes it.'}`),
        rows.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Building', 'Level', 'Strength', 'Last turn', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))) : h('p', { class: 'muted' }, 'Nothing built here.'),
        h('div', { class: 'toolbar', style: 'margin-top:8px' }, typeSel, h('span', {}, 'level'), lvl,
          h('button', { class: 'btn primary', onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(market)}/buildings`, { method: 'POST', body: { typeId: typeSel.value, free: true, ready: true, level: Number(lvl.value) } }); toast('Built (free, by staff).'); await redo(); }) }, '+ Add (free, finished)')),
      ];
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
  const names = [['edit', 'Edit'], ...(mr ? [['market', 'Market'], ['buildings', 'Buildings'], ['event', 'Force event'], ['people', 'Who\'s here']] : [])];
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
      ['Δ/turn', (x) => fmt(x.r.last?.dP)], ['Food', (x) => `${Math.round((x.r.last?.food ?? 1) * 100)}%`], ['People', (x) => fmt(x.r.population)], ['Security', (x) => fmt(x.r.security)], ['Buildings', (x) => (x.r.buildings || []).length || ''],
      ['Coffers', (x) => fmtN(x.r.coffers)], ['Scarcest', (x) => { const s = shortage(x.r); return s ? `${s.g.emoji} ${s.g.name} (${Math.round(s.ratio * 100)}%)` : '—'; }], ['Glut', (x) => { const s = surplus(x.r); return s ? `${s.g.emoji} ${s.g.name} (${Math.round(s.ratio * 100)}%)` : '—'; }],
    ], markets.sort((a, b) => b.r.prosperity - a.r.prosperity), (x) => { WSEL = x.k; location.hash = 'map'; })),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, 'Prices across the realm'), goodSel), h('div', { style: 'margin-top:8px' }, matrix)),
    h('div', { class: 'card' }, h('h3', {}, `Caravans on the road (${caravans.length})`), table([
      ['Owner', (c) => (c.npc ? 'Merchants' : c.owner?.type === 'faction' ? facName(c.owner.id) : charName(c.owner.id))], ['Cargo', (c) => `${fmt(c.qty)} ${goodOf(c.good)?.name || c.good}`],
      ['From → to', (c) => `${rname(c.from)} → ${rname(c.to)}`], ['Arrives', (c) => (c.arriveTurn ? `turn ${c.arriveTurn}` : new Date(c.arriveAt).toLocaleString())],
    ], caravans.slice(0, 80))),
    listEditorCard('Trade goods', 'goods', [
      { k: 'id', label: 'Id', help: 'Never change after players own it' }, { k: 'name', label: 'Name' }, { k: 'emoji', label: 'Emoji' },
      { k: 'category', label: 'Category', t: 'select', opts: ['food', 'staple', 'raw', 'refined', 'medicine', 'military', 'luxury', 'rare'] },
      { k: 'basePrice', label: 'Base price', t: 'number' }, { k: 'perPop', label: 'Eaten per pop / turn', t: 'number', step: 0.001 },
      { k: 'elasticity', label: 'Price elasticity', t: 'number', step: 0.05, help: 'How hard the price reacts to shortages' }, { k: 'lux', label: 'Luxury (0–1)', t: 'number', step: 0.1, help: 'Demand rises with prosperity' },
      { k: 'perish', label: 'Spoils / turn (0–1)', t: 'number', step: 0.005 }, { k: 'weight', label: 'Weight (caravans)', t: 'number' }, { k: 'winterDemand', label: 'Winter demand ×', t: 'number', step: 0.1 },
      { k: 'itemId', label: 'Item id for players' }, { k: 'description', label: 'Description', t: 'textarea', wide: true },
    ], (g) => `${g.emoji} ${g.name} — base ${g.basePrice} · ${g.category}`, { extra: h('button', { class: 'btn', onclick: run(async () => { const r = await api('/world/goods/items', { method: 'POST', body: {} }); toast(`Created ${r.created} trade-good item(s).`); await refresh(); }) }, '🎒 Create missing good items'), json: [['seasonal', 'Seasonal production (spring, summer, autumn, winter multipliers) or null']] }),
    economyFormulas(),
  ];
};

function economyFormulas() {
  return h('div', { class: 'card ref' }, h('h3', {}, 'How the economy works'),
    h('details', {}, h('summary', {}, 'Prices, supply and demand'),
      h('p', {}, h('code', {}, 'price = base × (target ÷ stock)^elasticity'), ' — clamped between ×', W_().settings.minPriceMul, ' and ×', W_().settings.maxPriceMul, ', then × event/policy modifiers.'),
      h('p', {}, h('code', {}, 'target = (people × eaten per pop × luxury factor × winter + building inputs + armies) × stock turns'), ` (stock turns = ${W_().settings.stockTurns}).`),
      h('p', {}, 'Producers answer prices: production × (price ÷ base)^', W_().settings.supplyResponse, ' (between ×0.55 and ×1.3). Gluts above 3× the target rot 5% a turn.')),
    h('details', {}, h('summary', {}, 'Trade: the normal market, trade deals and caravans'),
      h('p', {}, h('b', {}, 'The normal market runs on its own. '), 'Every turn peddlers move goods along each road from where a good is plentiful to where it is scarce, if the price gap pays for the trip (5% per road). The Merchant Guild sends up to ', W_().settings.npcCaravansPerTurn, ' big caravans to markets 2–4 roads away; it keeps ', Math.round(W_().settings.guildShare * 100), '% of the margin. This trade crosses borders freely — nobody has to sign anything.'),
      h('p', {}, h('b', {}, 'Borders. '), 'Goods crossing into another faction\'s land pay a ', W_().settings.borderTariff, '% tariff to the ruler they enter (it is added to their taxes). Factions at war don\'t trade at all, and a faction can declare an ', h('b', {}, 'embargo'), ' (/world → Realm → Diplomacy) to shut its borders to one other faction.'),
      h('p', {}, h('b', {}, 'Trade agreements. '), 'A "free trade" agreement (or an alliance with free trade) removes the tariff between the two and opens their markets to each other\'s merchant houses. When automatic trade is on, every faction with two or more markets sends up to ', W_().settings.autoTradeCaravans, ' caravans a turn (+1 per free-trade partner, max 6) between its own and its partners\' markets, bought with the treasury (at most ', Math.round(W_().settings.autoTradeInvest * 100), '% of it a turn) where the margin is at least ', Math.round(W_().settings.autoTradeMinMargin * 100), '%. Guilds also trade in unclaimed land. Nobody has to send these caravans by hand; the profit shows as "trade" in the realm\'s income.'),
      h('p', {}, `${W_().settings.playerMarketBuy ? 'Players may also buy at their market.' : 'Players don\'t buy from province markets'}${W_().settings.playerMarketSell !== false ? '; they can sell trade goods they own (each unit lowers the price, the market only pays what is in its coffers).' : '.'}`)),
    h('details', {}, h('summary', {}, 'Coffers and taxes'),
      h('p', {}, h('code', {}, 'coffers += (household spending × 0.9 + people × household income × prosperity factor) × income modifiers − taxes')),
      h('p', {}, h('code', {}, 'taxes = that income × tax rate × tax modifiers'), ' — owed to the ruling (or occupying) faction and paid every ', W_().settings.taxEveryTurns, ' turn(s). Factions pay ', W_().settings.adminCost, '% of their treasury each turn in retainers, so nobody hoards forever.')),
    h('details', {}, h('summary', {}, 'Prosperity'),
      h('p', {}, h('code', {}, 'growth = 3×(food − 0.85) + 1.5×(staples − 0.8) + 0.8×luxuries + trade + (security − 50) ÷ 25')),
      h('p', {}, h('code', {}, 'drag = 5×(prosperity ÷ 100)²')),
      h('p', {}, 'Δ prosperity = growth − drag + events + policies + buildings (± a little luck). A region settles where its food and trade can carry it; famine, war and disasters knock it down. Security (bandits on the roads) rises with walls and garrisons and falls with hunger.'),
      h('p', {}, 'Production and building output scale with prosperity (×0.75 at 0, ×1 at 50, ×1.25 at 100). Population grows with food and prosperity but the land only feeds so many (its base population).')),
    h('details', {}, h('summary', {}, 'Production buildings'),
      h('p', {}, 'A brewery, smithy, apothecary… buys its inputs from its market and sells its output back every turn (× 1 / 1.8 / 2.5 at level 1 / 2 / 3, × prosperity). The profit goes to whoever rules the region; in unclaimed land it stays in the town\'s coffers. It cuts back when the output is worth less than the inputs plus wages. Every map starts with some preset buildings; factions build and upgrade more from their treasury.')),
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
    { k: 'taxEveryTurns', label: 'Taxes reach the treasury every … turns', t: 'number', help: 'Taxes are collected every turn and paid out to the faction together. 2 = every second turn' },
    { section: 'Trade between factions' },
    { k: 'borderTariff', label: 'Border tariff %', t: 'number', help: 'Paid to the ruler when goods enter their land. Free trade removes it; war or an embargo stops trade' },
    { k: 'autoTrade', label: 'Automatic trade caravans for free-trade partners (and guilds)', t: 'check', help: 'Factions with free trade send caravans between their markets on their own' },
    { k: 'autoTradeCaravans', label: 'Automatic caravans / faction / turn', t: 'number', help: '+1 per free-trade partner, max 6' },
    { k: 'autoTradeInvest', label: 'Share of the treasury they may invest / turn (0–1)', t: 'number', step: 0.01 },
    { k: 'autoTradeMinMargin', label: 'Minimum margin for a caravan (0–1)', t: 'number', step: 0.05 },
    { section: 'Players' },
    { k: 'startRegion', label: 'Where new characters start', t: 'select', opts: marketOpts },
    { k: 'maxTradePerTurn', label: 'Max market trade per character per turn', t: 'number', help: 'Stops arbitrage farming. 0 = no limit' },
    { k: 'playerMarketBuy', label: 'Players may buy trade goods at province markets', t: 'check', help: 'Off by default: markets sell to merchants and caravans' },
    { k: 'playerMarketSell', label: 'Players may sell trade goods they own', t: 'check' },
    { k: 'playerCaravans', label: 'Players may send their own caravans', t: 'check', help: 'Off by default: caravans are run by trade factions' },
    { k: 'factionCaravans', label: 'Which factions run trade caravans', t: 'select', opts: [['guilds', 'Guilds (and factions with a trade charter)'], ['all', 'Every faction'], ['none', 'None']] },
    { k: 'factionCaravanTurns', label: 'Faction caravan travel (turns, 0 = by distance)', t: 'number' },
    { k: 'caravanCapacity', label: 'Caravan capacity', t: 'number' }, { k: 'escortCost', label: 'Escort cost (share of cargo)', t: 'number', step: 0.01 },
    { k: 'underdogBonus', label: 'Join bonus for recommended sects', t: 'number', help: 'Extra Nyang for new characters joining a sect the Balance tab recommends' },
    { section: 'The shop, priced where you stand' },
    { k: 'localPrices.home', label: 'Ruler\'s own members %', t: 'number', help: 'Shopping in your own faction\'s lands' }, { k: 'localPrices.friend', label: 'Open-market partners %', t: 'number', help: 'Agreement or alliance with "Open markets"' },
    { k: 'localPrices.neutral', label: 'Everyone else %', t: 'number' }, { k: 'localPrices.enemy', label: 'Enemies at war with the ruler %', t: 'number' },
    { k: 'shopSalesTax', label: 'Sales tax to the ruler %', t: 'number', help: 'Share of every shop purchase paid to the faction that rules the region' },
    { k: 'madeHereDiscount', label: 'Made here: % cheaper per building level', t: 'number', help: 'If the region has a working building that makes the item\'s linked good' },
    { k: 'shopSwingMax', label: 'Max shop price swing %', t: 'number', help: 'Items linked to a good never move more than this with its local price' },
    { section: 'Buildings' },
    { k: 'buildingRazeChance', label: 'Chance each building is razed when a region is taken (0–1)', t: 'number', step: 0.05 },
    { k: 'battleBuildingDamage', label: 'Battle damage to buildings ×', t: 'number', step: 0.1 },
    { k: 'buildingRepairShare', label: 'Repairs cost (share of the price for full repair)', t: 'number', step: 0.05 },
    { section: 'Representatives & stipends' },
    { k: 'representativeRoleIds', label: 'Representative roles (any sect)', t: 'roles', help: 'Members with these roles count as their sect\'s representatives; /office gives the first one' },
    { k: 'maxRepresentatives', label: 'Representatives per faction', t: 'number', help: '0 = no limit. Their ranks are edited in Politics → Rules' }, { k: 'representativesFight', label: 'Representatives may fight in battles', t: 'check' },
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
    { k: 'baseDisciples', label: 'Rank-and-file disciples every sect has', t: 'number', help: 'Counted in military and cultivation, so a few strong players don\'t outweigh a whole sect' },
  ], s);
  const champ = h('input', { value: (s.championRealmMult || []).join(', ') });
  const worth = h('input', { value: (s.realmWorth || []).join(', ') });
  openModal('World settings', h('div', { style: 'display:grid;gap:12px' }, f.el, h('label', { class: 'field wide' }, h('span', {}, 'Champion multiplier per realm in battle (3rd Rate first)'), champ),
    h('label', { class: 'field wide' }, h('span', {}, 'Power Index: one cultivator is worth … disciples, per realm (3rd Rate first)'), worth, h('small', { class: 'muted' }, 'A 3rd Rate fighter barely counts; a Transcendent or above can be worth thousands of disciples.')),
    h('div', { class: 'card warn bad' }, h('b', {}, 'Reset the world'), h('p', { class: 'small' }, 'Rebuilds every region, faction, market and event from the defaults (a blank map: no land, relations or treaties). A backup is made first.'),
      h('button', { class: 'btn danger', onclick: run(async () => { const c = prompt('Type RESET to rebuild the world from scratch.'); if (c !== 'RESET') return; await api('/world/reset', { method: 'POST', body: { confirm: 'RESET' } }); toast('World reset.'); closeModal(); render(); }) }, 'Reset world…'))),
  [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: run(async () => { const v = deepMerge(s, f.read()); v.championRealmMult = champ.value.split(/[,\s]+/).filter(Boolean).map(Number); v.realmWorth = worth.value.split(/[,\s]+/).filter(Boolean).map(Number); await api('/world/settings', { method: 'PUT', body: v }); toast('Saved.'); closeModal(); render(); }) }, 'Save')]);
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
  const effHelp = 'Per-turn effects. Keys: prosperity, security, population (%), production / demand / price / stockLoss ({ goodId | category | "*": multiplier }), caravanRisk, income, tax, tariff, coffers, supply, attrition, recruitCost.';
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
// Kept simple, like the realm screens of Crusader Kings or Europa Universalis: who rules, who leads, who stands
// with whom, who is at war. Feelings between factions are role-played — the bot records only what was agreed.
const perkNames = (perks) => (WD.perks || []).filter((p) => perks?.[p.id]).map((p) => p.name);
const chip = (text, color, title = '') => h('span', { class: 'chip', title, style: color ? `border-color:${color};color:${color}` : '' }, text);
function tabsEl(defs, start) {
  const bar = h('div', { class: 'wm-tabs inline' });
  const body = h('div', { style: 'display:grid;gap:10px;margin-top:10px' });
  const show = (id) => { [...bar.children].forEach((b) => b.classList.toggle('on', b.dataset.t === id)); body.replaceChildren(...[defs.find((d) => d[0] === id)[2]()].flat().filter(Boolean)); };
  for (const [id, label] of defs) bar.append(h('button', { 'data-t': id, onclick: () => show(id) }, label));
  setTimeout(() => show(start || defs[0][0]), 0);
  return h('div', {}, bar, body);
}
const allianceOfF = (fid) => W_().alliances.find((a) => a.members.includes(fid));
const warsOfF = (fid) => W_().wars.filter((x) => x.attackers.includes(fid) || x.defenders.includes(fid));
const landsOf = (fid) => Object.values(W_().regions).filter((r) => r.controller === fid && r.population !== undefined);

VIEWS.politics = async () => {
  await loadWorld();
  const w = W_();
  const members = (f) => WD.characters.filter((c) => f.sect && c.sect === f.sect).length;
  const inbox = [
    ...w.requests.filter((q) => q.status === 'pending').map((q) => ({ what: `${fac(q.factionId)?.name}: ${q.byName ? `${q.byName} wants to ` : ''}${q.summary}`, why: q.why, approve: () => api(`/world/requests/${q.id}/approve`, { method: 'POST', body: {} }), reject: () => api(`/world/requests/${q.id}/reject`, { method: 'POST', body: {} }) })),
    ...w.proposals.filter((p) => p.status === 'awaiting-staff').map((p) => ({ what: `${WD.proposalKinds?.[p.kind]?.name || p.kind}: ${facName(p.from)} → ${facName(p.to)}`, why: p.note || 'accepted by both sides, waiting for staff', approve: () => api(`/world/proposals/${p.id}/approve`, { method: 'POST', body: {} }), reject: () => api(`/world/proposals/${p.id}/reject`, { method: 'POST', body: {} }) })),
    ...(w.takeovers || []).filter((t) => t.status === 'pending').map((t) => ({ what: `Takeover: ${t.regions.map(rfull).join(', ')} → ${fac(t.to)?.name || 'unclaimed'}`, why: t.reason || (t.source === 'conquest' ? 'long occupation' : ''), approve: () => api(`/world/takeovers/${t.id}/approve`, { method: 'POST', body: {} }), reject: () => api(`/world/takeovers/${t.id}/reject`, { method: 'POST', body: {} }) })),
  ];
  const offers = w.proposals.filter((p) => p.status === 'awaiting-target' || p.status === 'awaiting-character');
  const card = (f) => {
    const al = allianceOfF(f.id); const wars = warsOfF(f.id);
    const lead = f.leaderCharId ? charName(f.leaderCharId) : '—';
    return h('button', { class: `realm-card${f.active ? '' : ' off'}`, style: `--fc:${f.color}`, onclick: () => openRealm(f) },
      h('div', { class: 'realm-name' }, f.name, f.hanzi ? h('span', { class: 'muted' }, ` ${f.hanzi}`) : ''),
      h('div', { class: 'realm-line muted small' }, `${f.kind}${f.npc ? ' · staff-run' : ''} · ${members(f)} member${members(f) === 1 ? '' : 's'}`),
      h('div', { class: 'realm-line' }, h('span', { class: 'muted' }, 'Leader '), lead, f.representatives.length ? h('span', { class: 'muted' }, ` · council ${f.representatives.length}`) : ''),
      h('div', { class: 'realm-line' }, h('span', { class: 'muted' }, 'Treasury '), fmtN(f.treasury), h('span', { class: 'muted' }, ' · lands '), String(landsOf(f.id).length)),
      h('div', { class: 'realm-chips' }, al ? chip(al.name, al.color) : null, ...wars.map((x) => chip(`War: ${x.name}`, '#d0453a'))));
  };
  return [
    inbox.length ? h('div', { class: 'card warn' }, h('h3', {}, `Waiting for staff (${inbox.length})`),
      h('div', { class: 'list' }, inbox.map((x) => h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, h('b', {}, x.what), x.why ? h('div', { class: 'muted small' }, x.why) : null),
        h('button', { class: 'btn small primary', onclick: run(async () => { await x.approve(); toast('Approved.'); render(); }) }, 'Approve'),
        h('button', { class: 'btn small danger', onclick: run(async () => { await x.reject(); toast('Rejected.'); render(); }) }, 'Reject'))))) : null,
    h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, 'Realms'), h('button', { class: 'btn', onclick: () => newFaction(render) }, '+ New faction')),
      h('p', { class: 'muted small' }, 'Click a realm to see its council, lands, buildings, policies and shop. Land is painted on the Map. Factions start empty; how they feel about each other is role-played — only wars, alliances and agreements are recorded.'),
      h('div', { class: 'realm-grid' }, w.factions.map(card))),
    alliancesCard(),
    warsCard(),
    agreementsCard(),
    offers.length ? h('div', { class: 'card' }, h('h3', {}, `Offers waiting for the other side (${offers.length})`), table([
      ['Offer', (p) => WD.proposalKinds?.[p.kind]?.name || p.kind], ['From → to', (p) => `${facName(p.from)} → ${facName(p.to)}`], ['Note', (p) => p.note], ['Waiting for', (p) => p.status.replace('awaiting-', '')],
      ['', (p) => h('div', { class: 'toolbar' }, h('button', { class: 'btn small primary', title: 'Push it through as staff', onclick: run(async () => { await api(`/world/proposals/${p.id}/approve`, { method: 'POST', body: {} }); toast('Done.'); render(); }) }, 'Force'), h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/proposals/${p.id}/reject`, { method: 'POST', body: {} }); render(); }) }, 'Cancel'))],
    ], offers)) : null,
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `Marriages (${w.marriages.length})`), h('button', { class: 'btn small', onclick: recordMarriage }, '+ Record a marriage')),
      table([['Couple', (m) => `${charName(m.a)} & ${charName(m.b)}`], ['Houses', (m) => m.factions.map(facName).join(' & ')], ['Since', (m) => `turn ${m.turn}`], ['', (m) => h('button', { class: 'btn small ghost', onclick: run(async () => { if (!confirm('Dissolve this marriage?')) return; await api(`/world/marriages/${m.a}`, { method: 'DELETE' }); render(); }) }, 'Dissolve')]], w.marriages)),
    officesCard(),
    h('details', { class: 'card' }, h('summary', {}, h('b', {}, 'Rules: representative ranks, policies, buildings')),
      h('div', { style: 'display:grid;gap:12px;margin-top:10px' },
        ranksCard(),
        listEditorCard('Policies', 'policies', [
          { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'enabled', label: 'Available', t: 'check' },
          { k: 'scope', label: 'Applies to', t: 'select', opts: [['faction', 'All the faction\'s land'], ['region', 'One region']] },
          { k: 'cost.treasury', label: 'Cost to adopt', t: 'number' }, { k: 'upkeep.treasury', label: 'Upkeep / turn', t: 'number' },
          { k: 'fatigue', label: 'Fatigue / turn (0–1)', t: 'number', step: 0.01, help: 'Weakens every turn after the grace period' }, { k: 'grace', label: 'Grace (turns)', t: 'number' }, { k: 'floor', label: 'Never below', t: 'number', step: 0.05 }, { k: 'minTurns', label: 'Minimum turns', t: 'number' },
          { k: 'outsiderMarkup', label: 'Shop: outsiders pay +% in this faction\'s lands', t: 'number', help: 'Faction policies only. Closed Gates: +25' },
          { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'scriptId', label: 'Custom code (regionTick)', t: 'select', opts: scriptOpts },
        ], (p) => `${p.name} — ${p.scope} · ${p.cost?.treasury || 0}${p.upkeep?.treasury ? ` · ${p.upkeep.treasury}/turn` : ''}`, { json: [['effects', 'Effects per turn (treasury goes to the faction once; the rest to each region)', 6], ['kinds', 'Faction kinds allowed (empty = all)', 2], ['exclusive', 'Can\'t combine with (policy ids)', 2]] }),
        listEditorCard('Buildings', 'buildingTypes', [
          { k: 'id', label: 'Id' }, { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字' },
          { k: 'cost', label: 'Cost', t: 'number' }, { k: 'turns', label: 'Turns to build', t: 'number' }, { k: 'upkeep', label: 'Upkeep / wages per turn', t: 'number' }, { k: 'fort', label: '+ Walls in battle', t: 'number' },
          { k: 'maxLevel', label: 'Max level (1–3)', t: 'number', help: 'Each level makes a production building produce more (×1 / ×1.8 / ×2.5)' }, { k: 'service', label: 'Service income per turn (inns, escort agencies)', t: 'number' },
          { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'scriptId', label: 'Custom code (regionTick)', t: 'select', opts: scriptOpts },
        ], (b) => `${b.name} ${b.hanzi || ''} — ${b.cost}, ${b.turns} turns, ${b.upkeep}/turn${b.fort ? ` · +${b.fort} walls` : ''}${Object.keys(b.outputs || {}).length ? ` · ${Object.entries(b.inputs || {}).map(([g, q]) => `${q} ${goodOf(g)?.name || g}`).join(' + ') || 'nothing'} → ${Object.entries(b.outputs).map(([g, q]) => `${q} ${goodOf(g)?.name || g}`).join(' + ')}` : ''}${b.service ? ` · service ${b.service}` : ''}`,
        { json: [['effects', 'Effects on the region every turn (same keys as policies)', 5], ['inputs', 'Production: inputs per turn bought from the market { goodId: qty }', 2], ['outputs', 'Production: outputs per turn sold to the market { goodId: qty }', 2], ['requires', 'Requires { terrains: [...], anyProduction: [goodIds] }', 2]] }))),
    worldLogCard(['diplomacy', 'alliance', 'war', 'request', 'policy', 'build', 'takeover', 'trade']),
  ].filter(Boolean);
};

function alliancesCard() {
  const w = W_();
  return h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `Alliances (${w.alliances.length})`), h('button', { class: 'btn', onclick: () => editAlliance(null) }, '+ New alliance')),
    h('p', { class: 'muted small' }, 'One alliance instead of many one-on-one deals: its terms hold between every pair of members, and it is drawn on the map. A faction can be in one alliance at a time.'),
    h('div', { class: 'realm-grid' }, w.alliances.map((a) => h('button', { class: 'realm-card', style: `--fc:${a.color}`, onclick: () => editAlliance(a) },
      h('div', { class: 'realm-name' }, a.name, a.hanzi ? h('span', { class: 'muted' }, ` ${a.hanzi}`) : ''),
      h('div', { class: 'realm-line' }, h('span', { class: 'muted' }, 'Leader '), facName(a.leader)),
      h('div', { class: 'realm-chips' }, a.members.map((m) => chip(fac(m)?.name || m, fac(m)?.color))),
      h('div', { class: 'realm-line muted small' }, perkNames(a.terms).join(' · ') || 'no shared terms', a.tribute ? ` · tribute ${a.tribute}%` : '')))));
}
function editAlliance(a) {
  const w = W_();
  const v = a ? clone(a) : { name: '', hanzi: '', color: '#b3261e', members: [], leader: '', terms: Object.fromEntries((WD.perks || []).map((p) => [p.id, ['militaryAccess', 'freeTrade', 'sharedShops', 'nonAggression', 'defensive'].includes(p.id)])), tribute: 0, note: '', style: { width: 5, fill: 'hatched' }, showOnMap: true, scriptId: '' };
  const f = buildForm([
    { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字' }, { k: 'color', label: 'Colour', t: 'color' },
    { k: 'leader', label: 'Leader', t: 'select', opts: () => factionOpts('— none —') },
    { k: 'style.width', label: 'Border width on the map', t: 'number' }, { k: 'style.fill', label: 'Fill on the map', t: 'select', opts: [['hatched', 'Hatched'], ['dots', 'Dots'], ['none', 'Border only']] },
    { k: 'showOnMap', label: 'Show on the map', t: 'check' },
    { k: 'tribute', label: 'Members pay the leader (% of taxes)', t: 'number' },
    { section: 'Terms between every pair of members' },
    ...(WD.perks || []).map((p) => ({ k: `terms.${p.id}`, label: p.name, t: 'check', help: p.description })),
    { k: 'note', label: 'What the alliance stands for (shown to players)', t: 'textarea', wide: true },
    { k: 'scriptId', label: 'Custom code (regionTick for members\' lands)', t: 'select', opts: scriptOpts },
  ], v);
  const boxes = h('div', { class: 'wm-checks' }, w.factions.map((x) => { const c = h('input', { type: 'checkbox', value: x.id }); c.checked = v.members.includes(x.id); return h('label', {}, c, ' ', x.name); }));
  const eff = jsonField('Effects on every member\'s regions each turn (same keys as policies)', v.effects || {}, 3);
  openModal(a ? a.name : 'New alliance', h('div', { style: 'display:grid;gap:10px' }, f.el, h('div', {}, h('b', {}, 'Members'), boxes), eff), [
    a ? h('button', { class: 'btn danger left', onclick: run(async () => { if (!confirm(`Dissolve the ${a.name}?`)) return; await api(`/world/alliances/${a.id}`, { method: 'DELETE' }); closeModal(); render(); }) }, 'Dissolve') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const body = { ...f.read(), members: [...boxes.querySelectorAll('input:checked')].map((x) => x.value), effects: eff.read() };
      if (!body.name) throw new Error('Name it first.');
      if (a) await api(`/world/alliances/${a.id}`, { method: 'PUT', body }); else await api('/world/alliances', { method: 'POST', body });
      toast('Saved.'); closeModal(); render();
    }) }, 'Save'),
  ].filter(Boolean));
}

function warsCard() {
  const w = W_();
  return h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `Wars (${w.wars.length})`), h('button', { class: 'btn', onclick: () => editWar(null) }, '+ Declare a war')),
    w.wars.length ? h('div', { class: 'list' }, w.wars.map((x) => h('div', { class: 'toolbar' },
      h('div', { class: 'grow' }, h('b', {}, x.name), h('div', { class: 'small' }, x.attackers.map(facName).join(', '), h('span', { class: 'muted' }, ' vs '), x.defenders.map(facName).join(', ')), h('div', { class: 'muted small' }, `since turn ${x.startTurn}${x.reason ? ` · ${x.reason}` : ''}`)),
      h('button', { class: 'btn small', onclick: () => editWar(x) }, 'Edit'),
      h('button', { class: 'btn small primary', onclick: run(async () => { const note = prompt('Peace terms agreed in role-play (optional):', ''); if (note === null) return; await api(`/world/wars/${x.id}/peace`, { method: 'POST', body: { note } }); toast('Peace.'); render(); }) }, 'Make peace')))) : h('p', { class: 'muted' }, 'All is quiet.'));
}
function editWar(x) {
  const w = W_();
  const sideBoxes = (list) => h('div', { class: 'wm-checks' }, w.factions.map((f) => { const c = h('input', { type: 'checkbox', value: f.id }); c.checked = list.includes(f.id); return h('label', {}, c, ' ', f.name); }));
  const att = sideBoxes(x?.attackers || []); const def = sideBoxes(x?.defenders || []);
  const name = h('input', { value: x?.name || '', placeholder: 'e.g. The Plum Blossom War (blank = automatic)' });
  const reason = h('input', { value: x?.reason || '', placeholder: 'Why (shown in the announcement)' });
  openModal(x ? x.name : 'Declare a war', h('div', { style: 'display:grid;gap:10px' }, h('label', { class: 'field' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'Reason'), reason),
    h('div', {}, h('b', {}, 'Attackers'), att), h('div', {}, h('b', {}, 'Defenders'), def),
    x ? null : h('p', { class: 'muted small' }, 'The first ticked faction on each side is the main one. Allies with a defensive pact or call to arms (alliances or agreements) join automatically.')), [
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const A = [...att.querySelectorAll('input:checked')].map((i) => i.value); const D = [...def.querySelectorAll('input:checked')].map((i) => i.value);
      if (!A.length || !D.length) throw new Error('Tick at least one faction on each side.');
      if (x) await api(`/world/wars/${x.id}`, { method: 'PUT', body: { name: name.value, reason: reason.value, attackers: A, defenders: D } });
      else await api('/world/wars', { method: 'POST', body: { attacker: A[0], defender: D[0], attackers: A, defenders: D, name: name.value, reason: reason.value } });
      closeModal(); render();
    }) }, x ? 'Save' : 'Declare'),
  ]);
}

function agreementsCard() {
  const w = W_();
  return h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { class: 'grow', style: 'margin:0' }, `One-on-one agreements (${w.agreements.length})`), h('button', { class: 'btn', onclick: () => editAgreement(null) }, '+ New agreement')),
    table([
      ['Agreement', (t) => h('b', {}, t.name)], ['Between', (t) => t.parties.map(facName).join(' & ')],
      ['Includes', (t) => [...perkNames(t.perks), t.tribute ? `${facName(t.tribute.payer)} pays ${facName(t.tribute.receiver)}${t.tribute.percent ? ` ${t.tribute.percent}%` : ''}${t.tribute.fixed ? ` +${t.tribute.fixed}/turn` : ''}` : ''].filter(Boolean).join(' · ') || '—'],
      ['Ends', (t) => (t.endTurn ? `turn ${t.endTurn}` : '—')], ['Note', (t) => t.note],
    ], w.agreements, editAgreement));
}
function editAgreement(t) {
  const w = W_();
  const v = t ? clone(t) : { name: '', parties: [w.factions[0]?.id, w.factions[1]?.id], perks: {}, tribute: null, note: '', endTurn: null, scriptId: '' };
  v.tribute = v.tribute || { payer: '', receiver: '', percent: 0, fixed: 0 };
  const f = buildForm([
    { k: 'name', label: 'Name' },
    { k: 'parties.0', label: 'Faction A', t: 'select', opts: factionOpts }, { k: 'parties.1', label: 'Faction B', t: 'select', opts: factionOpts },
    ...(WD.perks || []).map((p) => ({ k: `perks.${p.id}`, label: p.name, t: 'check', help: p.description })),
    { section: 'Tribute (optional)' },
    { k: 'tribute.payer', label: 'Payer', t: 'select', opts: () => factionOpts('— none —') }, { k: 'tribute.receiver', label: 'Receiver', t: 'select', opts: () => factionOpts('— none —') },
    { k: 'tribute.percent', label: '% of the payer\'s taxes', t: 'number' }, { k: 'tribute.fixed', label: 'Fixed per turn', t: 'number' },
    t ? { k: 'endTurn', label: 'Ends on turn (empty = never)', t: 'number', nullable: true } : { k: 'duration', label: 'Lasts (turns, 0 = until ended)', t: 'number' },
    { k: 'note', label: 'What was agreed in role-play', t: 'textarea', wide: true },
    { k: 'scriptId', label: 'Custom code (treatyTick) for very specific terms', t: 'select', opts: scriptOpts },
  ], v);
  openModal(t ? t.name : 'New agreement', f.el, [
    t ? h('button', { class: 'btn danger left', onclick: run(async () => { if (!confirm('End this agreement?')) return; await api(`/world/agreements/${t.id}`, { method: 'DELETE' }); closeModal(); render(); }) }, 'End') : null,
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: run(async () => {
      const x = f.read();
      const body = { ...x, parties: [x.parties[0], x.parties[1]], tribute: x.tribute?.payer && x.tribute?.receiver ? x.tribute : null };
      if (t) await api(`/world/agreements/${t.id}`, { method: 'PUT', body }); else await api('/world/agreements', { method: 'POST', body });
      closeModal(); render();
    }) }, 'Save'),
  ].filter(Boolean));
}
function recordMarriage() {
  const opts = () => [['', '—'], ...WD.characters.map((c) => [c.id, `${c.name} (${c.sect || 'Rogue'})`])];
  const f = buildForm([{ k: 'a', label: 'Character', t: 'select', opts }, { k: 'b', label: 'Character', t: 'select', opts }], {});
  openModal('Record a marriage', f.el, [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: run(async () => { await api('/world/marriages', { method: 'POST', body: f.read() }); closeModal(); render(); }) }, 'Record')]);
}

function ranksCard() {
  const w = W_();
  const s = w.settings;
  const ranks = clone(WD.ranks || s.repRanks || []);
  const wrap = h('div');
  const lvl = (r, p) => { const sl = select([['free', 'On their own'], ['staff', 'Staff approve'], ['none', 'No']], r.powers?.[p] || 'none'); sl.onchange = () => { (r.powers ||= {})[p] = sl.value; }; return sl; };
  const inp = (r, k, type = 'text', width = 120) => { const i = h('input', { type, value: r[k] ?? '', style: `width:${width}px` }); i.onchange = () => (r[k] = type === 'number' ? Number(i.value) : i.value); return i; };
  const draw = () => wrap.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Rank'), h('th', {}, '漢字'), h('th', {}, 'Spend alone up to'), ...(WD.powers || []).map((p) => h('th', { title: p.description }, p.name)), h('th', {}, ''))),
    h('tbody', {}, ranks.map((r, i) => h('tr', {}, h('td', {}, inp(r, 'name')), h('td', {}, inp(r, 'hanzi', 'text', 70)), h('td', {}, inp(r, 'spendLimit', 'number', 90)), ...(WD.powers || []).map((p) => h('td', {}, lvl(r, p.id))),
      h('td', {}, h('button', { class: 'btn small ghost', onclick: () => { ranks.splice(i, 1); draw(); } }, '✕'))))))));
  draw();
  const defSel = h('select');
  const refreshSel = () => { for (const [sel, val] of [[defSel, s.defaultRepRank], [leadSel, s.leaderRank]]) { sel.replaceChildren(...ranks.map((r) => h('option', { value: r.id || r.name }, r.name))); sel.value = val; } };
  const leadSel = h('select');
  refreshSel();
  return h('div', { class: 'card' }, h('h3', {}, 'Representative ranks'),
    h('p', { class: 'muted small' }, 'What each rank may do on its own, only with staff approval, or not at all — and how much it may spend without approval. Anything above the limit goes to staff too. Staff can always act directly. Give each representative a rank in their faction\'s Council (or with /office).'),
    wrap,
    h('div', { class: 'toolbar', style: 'margin-top:8px' },
      h('button', { class: 'btn small', onclick: () => { ranks.push({ id: `rank-${ranks.length + 1}`, name: 'New rank', hanzi: '', spendLimit: 0, powers: {} }); draw(); refreshSel(); } }, '+ Rank'),
      h('span', {}, 'New representatives get'), defSel, h('span', {}, 'Leaders use'), leadSel,
      h('span', {}, 'Max representatives per faction'), (() => { const i = h('input', { type: 'number', value: s.maxRepresentatives, style: 'width:70px', id: 'maxReps' }); return i; })(),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: run(async () => {
        for (const r of ranks) if (!r.id || r.id.startsWith('rank-')) r.id = (r.name || 'rank').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `rank-${Math.random().toString(36).slice(2, 6)}`;
        await api('/world/settings', { method: 'PUT', body: { ...s, repRanks: ranks, defaultRepRank: defSel.value, leaderRank: leadSel.value, maxRepresentatives: Number($('#maxReps').value) } });
        toast('Ranks saved.'); render();
      }) }, 'Save ranks')));
}

/** One realm, CK3-style: overview, council, buildings, policies, shop. */
/** Embargoes: factions whose merchants may not trade in this faction's lands (the normal market and caravans stop between them). */
function embargoRow(f) {
  const w = W_();
  const list = [...(f.embargoes || [])];
  const others = w.factions.filter((x) => x.id !== f.id);
  const sel = select(others.filter((x) => !list.includes(x.id)).map((x) => [x.id, x.name]));
  const save = (next) => run(async () => { await api(`/world/factions/${f.id}`, { method: 'PUT', body: { embargoes: next } }); toast('Saved.'); await loadWorld(); openRealm(fac(f.id)); });
  return h('div', { class: 'toolbar small' }, h('b', {}, 'Embargoes:'),
    ...(list.length ? list.map((id) => h('button', { class: 'btn small', title: 'Lift', onclick: save(list.filter((x) => x !== id)) }, `${facName(id)} ✕`)) : [h('span', { class: 'muted' }, 'none — trades with everyone it is not at war with')]),
    h('span', { class: 'grow' }), others.length > list.length ? sel : null, others.length > list.length ? h('button', { class: 'btn small', onclick: save([...list, sel.value]) }, '+ Embargo') : null);
}

function openRealm(f, start = 'overview') {
  const w = W_();
  const v = clone(f);
  const done = () => { closeModal(); render(); };
  const lands = landsOf(f.id);
  const overview = () => {
    const form = buildForm([
      { k: 'name', label: 'Name' }, { k: 'hanzi', label: '漢字' }, { k: 'color', label: 'Colour', t: 'color' },
      { k: 'colorStyle', label: 'On the map', t: 'select', opts: [['', 'Map default'], ['washed', 'Washed'], ['vivid', 'Vivid']] },
      { k: 'kind', label: 'Kind', t: 'select', opts: ['sect', 'clan', 'palace', 'cult', 'court', 'guild', 'bandits', 'other'] }, { k: 'alignment', label: 'Alignment', t: 'select', opts: ['Orthodox', 'Unorthodox', 'Neutral', 'Imperial', 'Demonic'] },
      { k: 'sect', label: 'Linked sect (members)', t: 'select', opts: () => [['', '— none —'], ...WD.sects.map((x) => [x.name, x.name])] }, { k: 'hq', label: 'Seat', t: 'select', opts: () => [['', '—'], ...marketOpts()] },
      { k: 'active', label: 'Active', t: 'check' }, { k: 'npc', label: 'Run by staff (not a player sect)', t: 'check' }, { k: 'tradeCharter', label: 'Trade charter (sends caravans like a guild)', t: 'check' },
      { k: 'treasury', label: 'Treasury', t: 'number' },
      { k: 'icon', label: 'Icon in Discord menus (optional)' },
      { k: 'description', label: 'Description', t: 'textarea', wide: true }, { k: 'scriptId', label: 'Custom code (factionTick, regionTick, diplomacy, battleRound, shopPrice)', t: 'select', opts: scriptOpts, wide: true },
    ], v);
    const al = allianceOfF(f.id);
    return [
      h('div', { class: 'kv small' },
        h('span', { class: 'muted' }, 'Lands'), h('span', {}, lands.map((r) => rname(r.key)).join(', ') || '—'),
        h('span', { class: 'muted' }, 'Alliance'), h('span', {}, al ? al.name : '—'),
        h('span', { class: 'muted' }, 'Wars'), h('span', {}, warsOfF(f.id).map((x) => x.name).join(', ') || 'at peace'),
        h('span', { class: 'muted' }, 'Agreements'), h('span', {}, w.agreements.filter((t) => t.parties.includes(f.id)).map((t) => t.name).join(', ') || '—'),
        h('span', { class: 'muted' }, 'Last turn'), h('span', {}, Object.entries(f.lastIncome || {}).filter(([, x]) => x).map(([k, x]) => `${k} ${x > 0 ? '+' : ''}${fmt(x)}`).join(' · ') || '—'),
        h('span', { class: 'muted' }, 'Taxes owed'), h('span', {}, `${fmt(f.taxPending || 0)}${w.settings.taxEveryTurns > 1 ? ` (paid every ${w.settings.taxEveryTurns} turns)` : ''}`),
        h('span', { class: 'muted' }, 'Trade'), h('span', {}, `${(w.caravans || []).filter((c) => c.auto && c.owner?.id === f.id && c.status === 'travelling').length} automatic caravan(s) on the road · free trade with ${w.factions.filter((x) => x.id !== f.id && w.agreements.some((t) => t.parties.includes(f.id) && t.parties.includes(x.id) && t.perks?.freeTrade) || (al && al.terms?.freeTrade && al.members.includes(x.id) && x.id !== f.id)).map((x) => x.name).join(', ') || 'nobody (normal market, ' + w.settings.borderTariff + '% border tariff)'}`)),
      embargoRow(f),
      form.el,
      h('div', { class: 'toolbar' }, f.sect ? null : h('button', { class: 'btn danger', onclick: run(async () => { if (!confirm(`Delete ${f.name}?`)) return; await api(`/world/factions/${f.id}`, { method: 'DELETE' }); done(); }) }, 'Delete faction'), h('span', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: run(async () => { await api(`/world/factions/${f.id}`, { method: 'PUT', body: form.read() }); toast('Saved.'); done(); }) }, 'Save')),
    ];
  };
  const council = () => {
    const mem = WD.characters.filter((c) => f.sect && c.sect === f.sect);
    const rankSel = (c) => { const sl = select([['member', 'Member'], ...((WD.ranks || []).map((r) => [`rep:${r.id}`, r.name])), ['leader', 'Leader']], c.office === 'leader' ? 'leader' : c.office === 'representative' ? `rep:${f.repRanks?.[c.id] || w.settings.defaultRepRank}` : 'member');
      sl.onchange = run(async () => { const [o, rk] = sl.value.split(':'); await api('/world/office', { method: 'PUT', body: { charId: c.id, office: o === 'rep' ? 'representative' : o, rank: rk } }); toast(`${c.name}: ${sl.selectedOptions[0].text}.`); await loadWorld(); }); return sl; };
    const stip = buildForm([{ k: 'stipendRate', label: `Stipends: % of net income (max ${w.settings.maxStipendRate})`, t: 'number' }, { k: 'stipendFund', label: 'Stipend fund now', t: 'number' }, { k: 'repRoleId', label: 'Representative Discord role (optional)', t: 'role' }], v);
    return [
      h('p', { class: 'muted small' }, 'The leader and representatives act for the realm in /world → Realm. Their rank decides what they may do alone, with staff approval, or not at all (ranks are edited under Politics → Rules).'),
      mem.length ? table([['Character', (c) => h('b', {}, c.name)], ['Player', (c) => c.ownerTag || ''], ['Office', rankSel], ['Purse', (c) => fmtN(c.nyang)]], mem) : h('p', { class: 'muted' }, 'No members (link a sect in Overview).'),
      stip.el, h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: run(async () => { await api(`/world/factions/${f.id}`, { method: 'PUT', body: stip.read() }); toast('Saved.'); }) }, 'Save stipends')),
    ];
  };
  const buildings = () => {
    if (!lands.length) return [h('p', { class: 'muted' }, 'This faction rules no market region (paint it on the Map).')];
    const typeSel = select(w.buildingTypes.map((b) => [b.id, `${b.name} — ${b.cost}`]));
    const regSel = select(lands.map((r) => [r.key, rname(r.key)]));
    const ready = h('input', { type: 'checkbox' });
    return [
      ...lands.map((r) => h('div', { class: 'card' }, h('b', {}, rname(r.key)), (r.buildings || []).length ? h('div', { class: 'list' }, r.buildings.map((b) => {
        const t = w.buildingTypes.find((x) => x.id === b.typeId);
        const hp = h('input', { type: 'number', min: 0, max: 100, value: Math.round(b.hp), style: 'width:64px' });
        const lv = h('input', { type: 'number', min: 1, max: t?.maxLevel || 1, value: b.level, style: 'width:52px', disabled: (t?.maxLevel || 1) <= 1 });
        return h('div', { class: 'toolbar small' }, h('span', { class: 'grow' }, `${t?.name || b.typeId}${(t?.maxLevel || 1) > 1 ? ` (level ${b.level}/${t.maxLevel})` : ''} — ${b.status === 'building' ? `under construction (ready turn ${b.readyTurn})` : isProd(t) ? `${fmt(b.lastProfit)} last turn` : 'ready'}`), h('span', {}, 'level'), lv, h('span', {}, 'strength'), hp,
          h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(r.key)}/buildings/${b.id}`, { method: 'PUT', body: { hp: Number(hp.value), level: Number(lv.value), status: 'ready' } }); toast('Saved.'); await loadWorld(); openRealm(fac(f.id), 'buildings'); }) }, b.status === 'building' ? 'Finish now' : 'Save'),
          h('button', { class: 'btn small danger', onclick: run(async () => { if (!confirm('Remove this building?')) return; await api(`/world/regions/${encodeURIComponent(r.key)}/buildings/${b.id}`, { method: 'DELETE' }); await loadWorld(); openRealm(fac(f.id), 'buildings'); }) }, 'Remove'));
      })) : h('p', { class: 'muted small' }, 'Nothing built.'))),
      h('div', { class: 'toolbar' }, typeSel, h('span', {}, 'in'), regSel, h('label', { class: 'field check' }, ready, h('span', {}, 'already finished')),
        h('button', { class: 'btn', onclick: run(async () => { await api(`/world/regions/${encodeURIComponent(regSel.value)}/buildings`, { method: 'POST', body: { typeId: typeSel.value, factionId: f.id, free: true, ready: ready.checked } }); toast('Added (free, by staff).'); await loadWorld(); openRealm(fac(f.id), 'buildings'); }) }, '+ Add (free)')),
    ];
  };
  const policies = () => {
    const adopted = [...f.policies.map((p) => ({ ...p, region: '' })), ...Object.entries(w.regions).flatMap(([k, r]) => (r.policies || []).filter((p) => p.factionId === f.id).map((p) => ({ ...p, region: k })))];
    const polSel = select(w.policies.map((p) => [p.id, `${p.name} (${p.scope})`]));
    const regSel = select([['', '— (faction-wide) —'], ...lands.map((r) => [r.key, rfull(r.key)])]);
    const free = h('input', { type: 'checkbox' });
    return [
      h('div', { class: 'list' }, adopted.map((p) => { const d = w.policies.find((x) => x.id === p.policyId); return h('div', { class: 'toolbar small' }, h('span', { class: 'grow' }, `${d?.name || p.policyId}${p.region ? ` — ${rname(p.region)}` : ''} · since turn ${p.since}`), h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/factions/${f.id}/policies/${p.policyId}?region=${encodeURIComponent(p.region)}`, { method: 'DELETE' }); done(); }) }, 'Revoke')); })),
      adopted.length ? null : h('p', { class: 'muted small' }, 'No policies.'),
      h('div', { class: 'toolbar' }, polSel, regSel, h('label', { class: 'field check' }, free, h('span', {}, 'free')), h('button', { class: 'btn small', onclick: run(async () => { await api(`/world/factions/${f.id}/policies`, { method: 'POST', body: { policyId: polSel.value, region: regSel.value, free: free.checked } }); toast('Adopted.'); done(); }) }, 'Adopt')),
    ];
  };
  openModal(`${f.name}${f.hanzi ? ` ${f.hanzi}` : ''}`, tabsEl([['overview', 'Overview', overview], ['council', 'Council', council], ['buildings', 'Buildings', buildings], ['policies', 'Policies', policies]], start), [h('button', { class: 'btn', onclick: done }, 'Close')]);
}
const editFaction = (f) => (f ? openRealm(f) : newFaction(render));

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
  return h('div', { class: 'card' }, h('h3', {}, 'Council members & stipends (all realms)'),
    h('p', { class: 'muted small' }, `Representatives (up to ${s.maxRepresentatives || '∞'} per faction) are the players whose characters lead their sect's politics, diplomacy and trade. ${s.representativesFight ? 'They may fight in battles.' : 'They do not fight in battles (World settings → "Representatives may fight").'} Staff can also use /office in Discord, which gives the Representative role.`),
    h('div', { class: 'table-wrap', style: 'max-height:320px' }, table([
      ['Character', (c) => h('b', {}, c.name)], ['Sect', (c) => c.sect], ['Player', (c) => c.ownerTag || ''],
      ['Office', (c) => { const f = W_().factions.find((x) => x.sect === c.sect); const sl = select([['member', 'Member'], ...((WD.ranks || []).map((r) => [`rep:${r.id}`, r.name])), ['leader', 'Leader']], c.office === 'leader' ? 'leader' : c.office === 'representative' ? `rep:${f?.repRanks?.[c.id] || s.defaultRepRank}` : 'member'); sl.onchange = run(async () => { const [o, rk] = sl.value.split(':'); await api('/world/office', { method: 'PUT', body: { charId: c.id, office: o === 'rep' ? 'representative' : o, rank: rk } }); toast(`${c.name}: ${sl.selectedOptions[0].text}.`); render(); }); return sl; }],
      ['Purse', (c) => fmtN(c.nyang)],
    ], rows)),
    h('div', { class: 'ref', style: 'margin-top:10px' },
      h('p', {}, h('b', {}, 'Where the money goes. '), 'Each region\'s ', h('i', {}, 'coffers'), ' are its merchants\' and households\' purse: they pay players who sell there and fill when players buy. Every turn the ruler taxes part of it into the faction ', h('i', {}, 'treasury'), ', which pays armies, policies, diplomacy and officials. Members get nothing automatically — unless the faction pays ', h('i', {}, 'stipends'), ':'),
      h('p', {}, h('code', {}, `fund += stipendRate% × net income each turn · every ${s.stipendEveryTurns} turns: raw = fund × weight ÷ Σweights · cap = ${s.stipendSoftCap} × weight × (1 + ln(members) ÷ 4) · paid = cap × (1 − e^(−raw ÷ cap))`)),
      h('p', { class: 'muted small' }, `Weights: member 1 · representative ${s.repWeight} · leader ${s.leaderWeight}. The soft cap is the brake on small rich factions: however big the fund, nobody gets more than their cap per season, and the rest goes back to the treasury. A separate cap stops anyone moving more than ${fmtN(s.maxTradePerTurn)} through the markets per turn (0 = no cap).`),
      h('div', { class: 'toolbar' }, h('span', {}, 'Preview:'), fSel)), preview);
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
  const fort = h('input', { type: 'number', value: 0, min: 0, max: 13, style: 'width:70px' });
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
        h('p', { class: 'muted small' }, `Military = army strength (men × average attack & defence × morale) + (${W_().settings.baseDisciples} rank-and-file disciples + what members are worth) × a disciple\'s strength. Economy = Σ ruled regions (people × prosperity ÷ 100) + treasury ÷ 50 + building profits × 10. Politics = 10 per region ruled + 20 per agreement + 30 per fellow alliance member + 50. Cultivation = ${W_().settings.baseDisciples} disciples + disciple troops + Σ members\' realm worth (3rd Rate = ${(W_().settings.realmWorth || [])[0] ?? 1} disciple(s) … see World settings), so one weak cultivator hardly moves it; representatives don\'t count as fighters. Each pillar is a share of the server total, so the Power Index of all factions adds up to 100%.`),
        h('p', {}, h('b', {}, '② vs fair share'), ` = Power Index − ${r.fair}% (100% ÷ number of factions). HHI = Σ (Power Index)²: ${r.hhiFair} when perfectly even; above 0.25 a single faction dominates.`),
        h('p', {}, h('b', {}, '③ Recruitment need'), ' = 60 × power deficit + 40 × member deficit (0–100). Power deficit = how far below the fair share the faction is; member deficit = how far below the average member count. The top three playable sects are recommended to new players (shown in /help and in /world → Politics for characters without a sect), and World settings → "join bonus" can pay extra Nyang for joining them.')),
    );
  });
  npc.onchange = draw; draw();
  return [h('div', { class: 'toolbar' }, h('label', { class: 'field check' }, npc, h('span', {}, 'Include staff-run (NPC) factions'))), wrap];
};
