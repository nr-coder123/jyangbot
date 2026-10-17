'use strict';
/**
 * Map geometry and the travel graph.
 *
 * Every province is a region ("河南"). Prefectures are "河南/洛阳". Only provinces and the prefectures
 * staff mark as *special* are markets (they have their own stock, prices, coffers and workshops);
 * ordinary prefectures belong to their province.
 *
 * Distances are in map pixels between region centers (the dashboard map is 1400×920).
 */
const path = require('path');

let DATA = null;
function data() {
  if (!DATA) {
    DATA = require(path.join(__dirname, 'mapdata.json'));
    DATA.byKey = new Map();
    for (const p of DATA.provinces) DATA.byKey.set(p.key, { ...p, kind: 'province' });
    for (const p of DATA.prefectures) DATA.byKey.set(p.key, { ...p, kind: 'prefecture' });
  }
  return DATA;
}

const get = (key) => data().byKey.get(key) || null;
const provinceOf = (key) => (key && key.includes('/') ? key.split('/')[0] : key);
const isProvince = (key) => !!get(key) && get(key).kind === 'province';
const provinces = () => data().provinces;
const prefectures = (province) => (province ? data().prefectures.filter((p) => p.province === province) : data().prefectures);

/** Display name of a region: custom name > English / hanzi depending on `lang`. */
function label(state, key, lang = 'english') {
  const g = get(key);
  const r = state?.world?.regions?.[key];
  if (r?.displayName) return r.displayName;
  if (!g) return key || '—';
  if (lang === 'hanzi') return g.hanzi;
  if (lang === 'both') return `${g.name} (${g.hanzi})`;
  if (lang === 'historical' && g.historicalName) return g.historicalName;
  return g.name;
}

/** "Luoyang, Henan" for prefectures, "Henan" for provinces. */
function fullLabel(state, key) {
  if (!key) return '—';
  if (!key.includes('/')) return label(state, key);
  return `${label(state, key)}, ${label(state, provinceOf(key))}`;
}

const dist = (a, b) => {
  const A = get(a); const B = get(b);
  if (!A || !B) return Infinity;
  return Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1]);
};

/** Market nodes: every province + every special prefecture. */
function marketKeys(state) {
  const special = Object.entries(state.world?.regions || {}).filter(([k, r]) => k.includes('/') && r.special && get(k)).map(([k]) => k);
  return [...provinces().map((p) => p.key), ...special];
}
const isMarket = (state, key) => !!get(key) && (!key.includes('/') || !!state.world?.regions?.[key]?.special);
/** The market that serves a key (a normal prefecture is served by its province). */
const marketOf = (state, key) => (key && isMarket(state, key) ? key : provinceOf(key));

/**
 * Travel graph between market nodes. Cached per world revision of special/routes.
 * Edges: neighbouring provinces · special prefecture ↔ its province · special prefecture ↔ special
 * prefectures / provinces it borders · extra routes staff added (sea lanes, roads).
 */
let GRAPH = null; let GRAPH_SIG = '';
function graph(state) {
  const routes = state.world?.routes || [];
  const nodes = marketKeys(state);
  const sig = nodes.join(',') + '|' + JSON.stringify(routes);
  if (GRAPH && GRAPH_SIG === sig) return GRAPH;
  const set = new Set(nodes);
  const adj = new Map(nodes.map((k) => [k, new Map()]));
  const link = (a, b, w, kind = 'road') => {
    if (!set.has(a) || !set.has(b) || a === b) return;
    const cost = Number.isFinite(w) ? w : dist(a, b);
    if (!adj.get(a).has(b) || adj.get(a).get(b).cost > cost) {
      adj.get(a).set(b, { cost, kind });
      adj.get(b).set(a, { cost, kind });
    }
  };
  for (const p of provinces()) for (const n of p.neighbors || []) link(p.key, n);
  for (const k of nodes) {
    if (!k.includes('/')) continue;
    const g = get(k);
    link(k, g.province, dist(k, g.province) * 0.6);
    for (const n of g.neighbors || []) {
      if (set.has(n)) link(k, n);
      else if (provinceOf(n) !== g.province) link(k, provinceOf(n));
    }
  }
  for (const r of routes) {
    if (r && r.a && r.b) link(r.a, r.b, Number(r.cost) > 0 ? Number(r.cost) : dist(r.a, r.b) * (r.kind === 'sea' ? 0.8 : 1), r.kind || 'road');
  }
  GRAPH = adj; GRAPH_SIG = sig;
  return adj;
}

function neighbors(state, key) {
  const g = graph(state).get(marketOf(state, key));
  return g ? [...g.keys()] : [];
}

/** Shortest route between two market nodes: { path: [keys], distance (px), hops, kinds } or null. */
function route(state, from, to) {
  from = marketOf(state, from); to = marketOf(state, to);
  const g = graph(state);
  if (!g.has(from) || !g.has(to)) return null;
  if (from === to) return { path: [from], distance: 0, hops: 0, kinds: [] };
  const best = new Map([[from, 0]]);
  const prev = new Map();
  const open = new Set([from]);
  while (open.size) {
    let cur = null; let cd = Infinity;
    for (const k of open) if (best.get(k) < cd) { cd = best.get(k); cur = k; }
    open.delete(cur);
    if (cur === to) break;
    for (const [n, e] of g.get(cur)) {
      const nd = cd + e.cost;
      if (nd < (best.has(n) ? best.get(n) : Infinity)) { best.set(n, nd); prev.set(n, cur); open.add(n); }
    }
  }
  if (!best.has(to)) return null;
  const p = [to];
  while (p[0] !== from) p.unshift(prev.get(p[0]));
  const kinds = p.slice(1).map((k, i) => g.get(p[i]).get(k).kind);
  return { path: p, distance: Math.round(best.get(to)), hops: p.length - 1, kinds };
}

/** All market nodes within `maxHops` hops: Map(key -> hops). */
function within(state, key, maxHops) {
  const g = graph(state);
  const start = marketOf(state, key);
  const seen = new Map([[start, 0]]);
  let frontier = [start];
  for (let h = 1; h <= maxHops; h++) {
    const next = [];
    for (const k of frontier) for (const n of (g.get(k) || new Map()).keys()) if (!seen.has(n)) { seen.set(n, h); next.push(n); }
    frontier = next;
  }
  return seen;
}

/** Which region a Discord channel belongs to: a special prefecture's channel, else the province of its category. */
function regionOfChannel(state, channel) {
  if (!channel) return null;
  const regions = state.world?.regions || {};
  const ids = [channel.id, channel.parentId, channel.parent?.parentId].filter(Boolean);
  for (const id of ids) {
    for (const [k, r] of Object.entries(regions)) {
      if ((r.channelIds || []).includes(id)) return k;
    }
    for (const [k, r] of Object.entries(regions)) {
      if (r.categoryId && r.categoryId === id) return k;
    }
  }
  return null;
}

module.exports = { data, get, provinceOf, isProvince, provinces, prefectures, label, fullLabel, dist, marketKeys, isMarket, marketOf, graph, neighbors, route, within, regionOfChannel };
