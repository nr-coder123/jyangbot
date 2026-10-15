'use strict';
/** Character creation, titles, learning arts, pills, impurity and Realm Breakthroughs. */
const defaults = require('../defaults');
const stats = require('./stats');
const effects = require('./effects');
const affinity = require('./affinity');
const economy = require('./economy');
const scripts = require('./scripts');
const { mainWeapon, equip } = require('./weapons');
const { r2, fmt, num, norm, clamp, findByName, UserError } = require('../utils');

const sectOf = (state, name) => (name ? state.sects.find((s) => norm(s.name) === norm(name) || norm(s.titleName) === norm(name)) : null);

/** Turn a name into a reference: linked to an item/trait if one exists with that name, otherwise free text. */
function resolveRef(state, name, kind = 'item') {
  if (name && typeof name === 'object') name = name.name || name.id;
  name = String(name || '').trim();
  if (!name) return null;
  const found = findByName(kind === 'trait' ? state.traits : state.items, name);
  return found ? { id: found.id, name: found.name } : { name };
}
const refName = (state, ref, kind) => scripts.refName(state, ref, kind);

/** The character's title as typed by staff (empty = none). */
function titleString(state, c) {
  return String(c.title || '').trim();
}

function activeCharacterOf(state, userId) {
  const u = state.users[userId];
  return (
    (u && state.characters.find((x) => x.id === u.activeCharacterId && x.status === 'active')) ||
    state.characters.find((x) => x.ownerId === userId && x.status === 'active') ||
    null
  );
}

function createCharacter(state, { ownerId, ownerTag, name, sect, docLink, approvedBy, gender }) {
  name = String(name || '').trim();
  if (!name) throw new UserError('A character name is required.');
  const s = state.settings;
  const owned = state.characters.filter((c) => c.ownerId === ownerId && c.status === 'active');
  if (num(s.maxCharactersPerUser) > 0 && owned.length >= num(s.maxCharactersPerUser)) {
    throw new UserError(`That player already has ${owned.length} active character(s) (limit ${s.maxCharactersPerUser}). Retire one in the dashboard or raise the limit in Settings.`);
  }
  if (state.characters.some((c) => c.status === 'active' && norm(c.name) === norm(name))) throw new UserError(`An active character named "${name}" already exists.`);
  const sectObj = sectOf(state, sect);
  const c = defaults.normalizeCharacter({
    ownerId, ownerTag, name, gender,
    sect: sectObj ? sectObj.name : String(sect || '').trim(),
    docLink: docLink || '',
    approvedBy: approvedBy || null,
    approvedAt: new Date().toISOString(),
    pools: { normal: 0, flex: num(s.startingFlexPoints) },
    nyang: num(s.startingNyang),
    rolls: num(s.startingRolls),
    cultivationMethods: (s.defaultCultivationMethods || []).map((n) => resolveRef(state, n)).filter(Boolean),
    qiCore: resolveRef(state, s.defaultQiCore),
  });
  const dw = state.items.find((i) => i.id === s.defaultWeaponId);
  if (dw) {
    c.inventory[dw.id] = 1;
    c.weaponId = dw.id;
  }
  state.characters.push(c);
  state.users[ownerId] = { ...(state.users[ownerId] || {}), activeCharacterId: c.id };
  return c;
}

/** Add (or remove) impurity. Non-poison impurity reaching the burst threshold bursts meridians unless a script prevents it. */
function addImpurity(state, c, amount, { poison = false, triggersBurst = false } = {}) {
  const th = state.settings.impurity;
  c.impurity = Math.max(0, r2(c.impurity + Number(amount)));
  const out = { impurity: c.impurity, burst: false, prevented: false };
  if (Number(amount) > 0 && c.impurity >= th.burstAt && !c.burstApplied && (!poison || triggersBurst)) {
    const sheet = effects.compute(state, c);
    if (sheet.fx.preventMeridianBurst) out.prevented = true;
    else {
      const k = 1 - th.burstPercent / 100;
      for (const s of stats.ALL) c.stats[s] = r2(c.stats[s] * k);
      c.burstApplied = true;
      out.burst = true;
    }
  }
  return out;
}

const knownLists = (c) => [
  ...Object.entries(c.martialArts).map(([cat, list]) => ({ key: `martialArts.${cat}`, list, label: `${cat} martial art` })),
  { key: 'cultivationMethods', list: c.cultivationMethods, label: 'cultivation method' },
];

/** Learn a manual / cultivation method / qi core from the inventory (consumes it). */
function learnItem(state, c, item) {
  const s = state.settings;
  if (economy.qtyOf(c, item.id) < 1) throw new UserError(`You don't have **${item.name}**.`);
  const already = knownLists(c).some(({ list }) => list.some((r) => r.id === item.id)) || c.qiCore?.id === item.id;
  if (already) throw new UserError(`**${c.name}** already knows **${item.name}**.`);
  const ref = { id: item.id, name: item.name };
  let note = '';
  if (item.type === 'manual') {
    const cat = defaults.MANUAL_CATEGORIES.includes(item.manual?.category) ? item.manual.category : 'generic';
    const list = c.martialArts[cat];
    const limit = num(s.martialArtLimits?.[cat], 1);
    if (list.length >= limit) throw new UserError(`Your ${cat} martial art slots are full (${list.length}/${limit}). Forget one first in /menu → 📊 Stats.`);
    if (item.manual.replacesCore && (cat === 'special' || cat === 'forbidden') && c.martialArts.core.length) {
      note = `It **replaces** your Core art: ${c.martialArts.core.map((r) => refName(state, r)).join(', ')}.`;
      c.martialArts.core = [];
    }
    list.push(ref);
  } else if (item.type === 'cultivation') {
    const limit = num(s.maxCultivationMethods, 2);
    if (c.cultivationMethods.length >= limit) throw new UserError(`You already have ${c.cultivationMethods.length}/${limit} cultivation methods. Forget one first in /menu → 📊 Stats.`);
    c.cultivationMethods.push(ref);
  } else if (item.type === 'core') {
    if (c.qiCore) note = `It replaces **${refName(state, c.qiCore)}**.`;
    c.qiCore = ref;
  } else {
    throw new UserError(`**${item.name}** is a ${item.type}, it can't be learned. Pills are consumed instead.`);
  }
  economy.removeItem(state, c, item.id, 1);
  return { note };
}

/** Remove a known martial art / cultivation method by name (no refund). */
function forget(state, c, name) {
  for (const { key, list, label } of knownLists(c)) {
    const idx = list.findIndex((r) => norm(refName(state, r)) === norm(name) || r.id === name);
    if (idx >= 0) {
      const [removed] = list.splice(idx, 1);
      return { name: refName(state, removed), label, key };
    }
  }
  throw new UserError(`**${c.name}** doesn't know "${name}".`);
}

const YIELD_LABEL = { qi: 'Qi', strength: 'Strength', endurance: 'Endurance', mobility: 'Mobility', points: 'stat points', flex: 'flexible points' };
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

/**
 * Consume a pill. Absorption (cultivation methods + qi core) changes the yield, impurity reduction changes
 * the impurity, then "consume" scripts may change the result. Returns lines explaining every step.
 */
function consumePill(state, c, item) {
  if (item.type !== 'pill') throw new UserError(`**${item.name}** is not a pill/elixir.`);
  if (economy.qtyOf(c, item.id) < 1) throw new UserError(`You don't have **${item.name}**.`);
  const p = item.pill || {};
  const abs = affinity.absorption(state, c);
  const elementRate = p.element ? abs.byElement[p.element] || 0 : 0;
  const rate = affinity.rateFor(abs, p.element);
  const baseYield = num(p.yieldAmount);
  const baseImpurity = num(p.impurity);
  const reduction = baseImpurity > 0 ? abs.impurityReduction : 0;
  const pre = {
    yieldType: p.yieldType || 'none',
    baseYield,
    rate,
    yieldAmount: r2(Math.max(0, baseYield * (1 + rate / 100))),
    baseImpurity,
    impurityReduction: reduction,
    impurity: baseImpurity > 0 ? r2(Math.max(0, baseImpurity * (1 - reduction / 100))) : baseImpurity,
    breakthroughBonus: num(p.breakthroughBonus),
    element: p.element || '',
    notes: [],
  };
  let result = { ...pre };
  const chain = scripts.runChain(state, c, 'consume', result, {
    extraSources: [{ scriptId: item.scriptId, type: 'pill', name: item.name }],
    extra: { item: { id: item.id, name: item.name, pill: p, element: p.element || '' } },
  });
  if (chain.value && typeof chain.value === 'object') result = { ...result, ...chain.value };
  result.notes = Array.isArray(result.notes) ? result.notes.map(String) : [];
  result.errors = chain.errors;

  economy.removeItem(state, c, item.id, 1);
  const lines = [];
  const label = YIELD_LABEL[result.yieldType];
  const amt = num(result.yieldAmount);
  if (label && (baseYield || amt)) {
    lines.push(`**Yield:** ${fmt(baseYield)} ${label}`);
    if (rate) {
      const why = [abs.general ? `general ${signed(abs.general)}%` : '', elementRate ? `${p.element} ${signed(elementRate)}%` : ''].filter(Boolean).join(', ');
      lines.push(`**Absorption:** ${signed(rate)}% (${why}) → ${signed(r2(pre.yieldAmount - baseYield))} ${label}`);
    }
    if (Math.abs(amt - pre.yieldAmount) > 1e-9) lines.push(`**Cultivation effects:** ${signed(r2(amt - pre.yieldAmount))} ${label}`);
    switch (result.yieldType) {
      case 'qi': {
        const g = stats.gainQi(state, c, amt, { resetImpurity: state.settings.pillQiResetsImpurity, source: 'pill' });
        let t = `**Gained:** +${fmt(g.gained)} Qi (now ${fmt(c.stats.qi)})`;
        if (g.effective < amt) t += ` · ${fmt(r2(amt - g.effective))} lost to Qi overflow`;
        if (g.capped) t += ` · ${fmt(r2(g.effective - g.gained))} lost to the Qi hard cap`;
        lines.push(t);
        if (g.reset) lines.push('🧹 Receiving Qi reset your Impurity.');
        break;
      }
      case 'strength':
      case 'endurance':
      case 'mobility': {
        const g = stats.gainStat(state, c, result.yieldType, amt);
        lines.push(`**Gained:** +${fmt(g)} ${label} (now ${fmt(c.stats[result.yieldType])})${g < amt ? ` · ${fmt(r2(amt - g))} lost to the soft/hard cap` : ''}`);
        break;
      }
      case 'points':
      case 'flex': {
        const g = stats.grantPoints(state, c, result.yieldType === 'flex' ? 'allqi' : 'all', amt);
        lines.push(`**Gained:** +${fmt(g.granted)} ${label} to spend${g.discarded ? ` · ${fmt(g.discarded)} lost to the hard cap` : ''}`);
        break;
      }
      default:
        break;
    }
  }
  if (result.breakthroughBonus) {
    c.breakthroughBonus = r2(c.breakthroughBonus + num(result.breakthroughBonus));
    lines.push(`**Realm Breakthrough:** ${signed(num(result.breakthroughBonus))}% chance (now +${fmt(c.breakthroughBonus)}%, used on your next attempt)`);
  }
  const imp = num(result.impurity);
  if (baseImpurity || imp) {
    const before = c.impurity;
    const res = addImpurity(state, c, imp);
    let t;
    if (imp < 0) t = `**Impurity removed:** ${fmt(-imp)} (${fmt(before)} → ${fmt(c.impurity)})`;
    else {
      t = `**Impurity:** ${fmt(baseImpurity)}`;
      if (reduction) t += ` ${reduction > 0 ? '−' : '+'} ${fmt(Math.abs(reduction))}% (cultivation) → ${fmt(pre.impurity)}`;
      if (Math.abs(imp - pre.impurity) > 1e-9) t += ` → ${fmt(imp)} (effects)`;
      t += ` · now **${fmt(c.impurity)}**`;
      if (baseImpurity > imp) t += ` *(${fmt(r2(baseImpurity - imp))} shaved off)*`;
    }
    lines.push(t);
    if (res.burst) lines.push(`💥 **Meridians burst!** Stats and Qi permanently reduced by ${state.settings.impurity.burstPercent}%.`);
    if (res.prevented) lines.push('🛡️ A cultivation effect prevented your meridians from bursting.');
  }
  return { result, lines: [...lines, ...result.notes] };
}

function breakthroughChance(state, c) {
  const realm = stats.realmOf(state, c);
  const base = num(realm.breakthroughChance);
  const pills = num(c.breakthroughBonus);
  const run = scripts.runChain(state, c, 'breakthroughChance', base + pills);
  const scripted = Number.isFinite(Number(run.value)) ? Number(run.value) : base + pills;
  return { base, pills, scriptDelta: r2(scripted - base - pills), total: r2(clamp(scripted, 0, 100)), errors: run.errors };
}

function attemptBreakthrough(state, c) {
  const check = stats.breakthroughCheck(state, c);
  if (!check.next) throw new UserError('You are already at the final realm.');
  if (!check.ok) throw new UserError(`You don't meet the requirements for **${check.next.name}** yet: ${check.reasons.join(', ')}.`);
  const cd = num(state.settings.breakthroughCooldownHours);
  if (cd > 0 && c.lastBreakthroughAt) {
    const wait = Date.parse(c.lastBreakthroughAt) + cd * 3600e3 - Date.now();
    if (wait > 0) throw new UserError(`Your meridians are still recovering. Try again in ${Math.ceil(wait / 60000)} minutes.`);
  }
  const chance = breakthroughChance(state, c);
  const roll = r2(Math.random() * 100);
  const success = roll < chance.total;
  const from = stats.realmOf(state, c).name;
  c.breakthroughBonus = 0;
  c.lastBreakthroughAt = new Date().toISOString();
  let failImpurity = null;
  if (success) c.realm += 1;
  else if (num(state.settings.breakthroughFailureImpurity) > 0) failImpurity = addImpurity(state, c, num(state.settings.breakthroughFailureImpurity));
  return { success, roll, chance, from, to: success ? stats.realmOf(state, c).name : check.next.name, failImpurity };
}

module.exports = {
  sectOf, resolveRef, refName, titleString, mainWeapon, equip, activeCharacterOf, createCharacter, addImpurity, learnItem, forget,
  consumePill, breakthroughChance, attemptBreakthrough,
};
