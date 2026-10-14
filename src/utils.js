'use strict';
const crypto = require('crypto');

/** Error whose message is safe to show to the user as-is. */
class UserError extends Error {}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => {
  if (n === Infinity) return '∞';
  if (n === null || n === undefined || n === '') return '—';
  const v = r2(n);
  return Number.isInteger(v) ? String(v) : String(v);
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const norm = (s) => String(s ?? '').trim().toLowerCase();
const newId = (prefix = '') => prefix + crypto.randomBytes(4).toString('hex');
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const num = (v, d = 0) => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) ? n : d;
};
const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || newId();
const truncate = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
};

function findByName(list, query) {
  if (query === null || query === undefined || query === '') return null;
  const q = norm(query);
  return list.find((x) => x.id === query) || list.find((x) => norm(x.name) === q) || null;
}

function weightedPick(entries, weightOf) {
  const weights = entries.map((e) => Math.max(0, Number(weightOf(e)) || 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i];
    if (r < 0) return entries[i];
  }
  return entries[entries.length - 1];
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? clone(base) : clone(over);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : clone(v);
  return out;
}

module.exports = { UserError, r2, fmt, clamp, norm, newId, clone, num, numOrNull, arr, slug, truncate, findByName, weightedPick, deepMerge, isPlainObject };
