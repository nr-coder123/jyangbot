'use strict';
const crypto = require('crypto');
const config = require('../config');

const SECRET = config.sessionSecret || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 7;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const h = crypto.scryptSync(String(pw), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(b, h);
}

function hmac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = hmac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signSession, readSession, SESSION_DAYS };
