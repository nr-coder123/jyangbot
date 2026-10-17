'use strict';
/**
 * Builds src/world/mapdata.json — the map geometry used by the dashboard Map tab and the world engine.
 * Run once (output is committed):
 *   npm i --no-save china-map-geojson pinyin-pro esbuild
 *   npx esbuild scripts/map/myumyu-entry.ts --bundle --platform=node --format=cjs --outfile=scripts/map/mm.cjs \
 *       --external:china-map-geojson --external:pinyin-pro --external:china-map-geojson/lib/china.js
 *   node scripts/map/build-map-data.js
 * Province / prefecture names, descriptions, rivers and mountains come from the Murim Map Studio (nr-coder123/myumyu).
 */
const fs = require('fs');
const path = require('path');
const { ChinaData, ProvinceData } = require('china-map-geojson');
const mm = require(process.env.MM || './mm.cjs');

const W = 1400; const H = 920; const SCALE = 1100; const C = [104, 36];
const rad = (d) => (d * Math.PI) / 180;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const proj = ([lon, lat]) => [W / 2 + SCALE * (rad(lon) - rad(C[0])), H / 2 - SCALE * (merc(lat) - merc(C[1]))];
const r1 = (v) => Math.round(v * 10) / 10;

function ringPath(ring, minDist = 0.7) {
  const pts = [];
  for (const c of ring) {
    const p = proj(c);
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) pts.push(p);
  }
  if (pts.length < 3) return '';
  return 'M' + pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L') + 'Z';
}
function featurePath(f, minDist) {
  const g = f.geometry; if (!g) return '';
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map((poly) => poly.map((ring) => ringPath(ring, minDist)).join('')).join('');
}
function rings(f) {
  const g = f.geometry; if (!g) return [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.flat();
}
function area(f) { // projected area for label placement / size
  let a = 0;
  for (const ring of rings(f)) { const p = ring.map(proj); for (let i = 0; i < p.length - 1; i++) a += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1]; }
  return Math.abs(a / 2);
}
const center = (f) => { const cp = f.properties?.cp; if (cp) return proj(cp).map(r1); const all = rings(f).flat(); const s = all.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); return proj([s[0] / all.length, s[1] / all.length]).map(r1); };

const clean = (n) => n.replace(/(省|市|自治区|特别行政区|壮族自治区|回族自治区|维吾尔自治区)$/, '');
const cleanSub = (n) => n.replace(/(市|地区|藏族自治州|彝族自治州|自治州|哈萨克自治州|回族自治州|蒙古自治州|朝鲜族自治州|布依族苗族自治州|苗族侗族自治州|哈尼族彝族自治州|傣族自治州|白族自治州|藏族羌族自治州|土家族苗族自治州|壮族苗族自治州|林区|特别行政区|自治县|县|区)$/, '').replace(/((蒙古|藏|回|彝|苗|侗|壮|布依|土家|哈尼|傣|白|羌|朝鲜|哈萨克|柯尔克孜|傈僳|景颇|维吾尔|蒙古族藏)族)+$/, '') || n;

const provinces = []; const prefectures = [];
const vertexOwners = (list, keyOf, prec = 2) => { const m = new Map(); for (const f of list) { const k = keyOf(f); for (const ring of rings(f)) for (const c of ring) { const v = c[0].toFixed(prec) + ',' + c[1].toFixed(prec); if (!m.has(v)) m.set(v, new Set()); m.get(v).add(k); } } return m; };
const neighborsFrom = (owners) => { const counts = new Map(); for (const set of owners.values()) { if (set.size < 2) continue; const arr = [...set]; for (const a of arr) for (const b of arr) if (a !== b) { const k = a + '|' + b; counts.set(k, (counts.get(k) || 0) + 1); } } const out = {}; for (const [k, n] of counts) { if (n < 2) continue; const [a, b] = k.split('|'); (out[a] ||= []).push(b); } return out; };

const provFeatures = [];
for (const f of ChinaData.features) {
  const key = clean(f.properties.name);
  const meta = mm.PROVINCE_METADATA[key] || { name: key, hanzi: key, historicalName: key, region: 'Frontier', capital: '', landmarks: [], description: '' };
  provFeatures.push([key, f]);
  provinces.push({ key, name: meta.name, hanzi: meta.hanzi || key, historicalName: meta.historicalName, region: meta.region, capital: meta.capital, landmarks: meta.landmarks || [], description: meta.description || '', d: featurePath(f, 0.6), c: center(f), area: Math.round(area(f)) });
  const gk = mm.PROVINCE_TO_GEOJSON_KEY[key];
  const sub = gk && ProvinceData[gk];
  for (const sf of sub?.features || []) {
    const hz = cleanSub(sf.properties.name || '');
    const sm = mm.getSubprovinceMeta(hz, key);
    prefectures.push({ key: `${key}/${hz}`, province: key, name: sm.name || hz, hanzi: hz, historicalName: sm.historicalName || '', landmarks: sm.landmarks || [], description: sm.description || '', d: featurePath(sf, 0.45), c: center(sf), area: Math.round(area(sf)), _f: sf });
  }
}
// Province adjacency from shared border vertices (fallback: nearest centers for islands).
const pAdj = neighborsFrom(vertexOwners(provFeatures.map(([k, f]) => ({ k, f })), (x) => x.k).constructor === Map ? (() => { const m = new Map(); for (const [k, f] of provFeatures) for (const ring of rings(f)) for (const c of ring) { const v = c[0].toFixed(1) + ',' + c[1].toFixed(1); if (!m.has(v)) m.set(v, new Set()); m.get(v).add(k); } return m; })() : null);
for (const p of provinces) p.neighbors = (pAdj[p.key] || []).sort();
const fAdj = (() => { const m = new Map(); for (const p of prefectures) for (const ring of rings(p._f)) for (const c of ring) { const v = c[0].toFixed(1) + ',' + c[1].toFixed(1); if (!m.has(v)) m.set(v, new Set()); m.get(v).add(p.key); } return neighborsFrom(m); })();
for (const p of prefectures) { p.neighbors = (fAdj[p.key] || []).sort(); delete p._f; }

const riverPath = (coords) => { const pts = coords.map(proj); let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]; const b = pts[i]; d += `Q${r1(a[0])} ${r1(a[1])} ${r1((a[0] + b[0]) / 2)} ${r1((a[1] + b[1]) / 2)}`; } const l = pts[pts.length - 1]; return d + `L${r1(l[0])} ${r1(l[1])}`; };
const rivers = mm.CHINA_RIVERS.map((r) => { const pts = r.coordinates.map(proj); const mid = pts[Math.floor(pts.length / 2)]; return { id: r.id, name: r.name, hanzi: r.hanzi, type: r.type, width: r.width, color: r.color || null, d: riverPath(r.coordinates), label: mid.map(r1) }; });
const mountains = mm.SACRED_PEAKS_AND_PASSES.map((m) => ({ id: m.id, name: m.name, hanzi: m.hanzi, type: m.type, elevation: m.elevation, province: m.province, description: m.description, geo: m.coordinates, xy: proj(m.coordinates).map(r1) }));

const out = { source: 'Murim Map Studio (github.com/nr-coder123/myumyu) + china-map-geojson', width: W, height: H, projection: { type: 'mercator', center: C, scale: SCALE }, regions: mm.HISTORIC_REGIONS, provinces, prefectures, rivers, mountains };
const file = path.join(__dirname, '../../src/world/mapdata.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log('provinces', provinces.length, 'prefectures', prefectures.length, 'bytes', fs.statSync(file).size);
const lone = provinces.filter((p) => !p.neighbors.length).map((p) => p.key);
console.log('no neighbors:', lone.join(','));
console.log(provinces.map((p) => p.key + ':' + p.neighbors.length).join(' '));
console.log('prefectures without neighbors', prefectures.filter((p) => !p.neighbors.length).length);
