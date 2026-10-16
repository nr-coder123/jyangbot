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
/** kind: 'art' (martial arts, cultivation methods, qi cores) or 'trait'. Unknown names are kept as free text. */
function resolveRef(state, name, kind = 'art') {
  if (name && typeof name === 'object') name = name.name || name.id;
  name = String(name || '').trim();
  if (!name) return null;
  const found = findByName(kind === 'trait' ? state.traits : state.arts || [], name);
  return found ? { id: found.id, name: found.name } : { name };
}
const refName = (state, ref, kind) => scripts.refName(state, ref, kind);

/** The character's title as typed by staff (empty = none). */
function titleString(state, c) {
  return String(c.title || '').trim();
}

/**
 * Change a character's sect. A sect can give its Core martial art (only if the character has no Core art yet)
 * and a one-time Nyang bonus (only the first time the character joins that sect).
 */
function setSect(state, c, sectName) {
  const sect = sectOf(state, sectName);
  const before = c.sect || '';
  c.sect = sect ? sect.name : String(sectName || '').trim();
  const out = { changed: before !== c.sect, before, after: c.sect, coreArt: null, nyang: 0 };
  if (!sect) return out;
  const art = sect.coreArtId && (state.arts || []).find((a) => a.id === sect.coreArtId);
  if (art && !c.martialArts.core.length) {
    c.martialArts.core.push({ id: art.id, name: art.name });
    out.coreArt = art.name;
  }
  if (num(sect.joinNyang) > 0 && !(c.joinedSects || []).includes(sect.id)) {
    c.nyang = r2(c.nyang + num(sect.joinNyang));
    out.nyang = num(sect.joinNyang);
  }
  c.joinedSects = [...new Set([...(c.joinedSects || []), sect.id])];
  return out;
}

/**
 * Discord roles win: if the member has a sect's role, that is their sect. If they lost the role of
 * the sect they were in, they become Rogue. Sects without a linked role are never touched.
 * Returns the setSect result when something changed, otherwise null.
 */
function syncSectFromRoles(state, c, roleIds) {
  const linked = state.sects.filter((x) => x.roleId);
  if (!linked.length) return null;
  const has = linked.find((x) => roleIds.includes(x.roleId));
  if (has) return norm(c.sect) === norm(has.name) ? null : setSect(state, c, has.name);
  const cur = sectOf(state, c.sect);
  if (cur && cur.roleId) return setSect(state, c, '');
  return null;
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
  const sectPerks = setSect(state, c, c.sect);
  Object.defineProperty(c, 'creationPerks', { value: sectPerks, enumerable: false }); // not saved
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

/** Read a manual from the inventory: learns the martial art / cultivation method it teaches (consumes the manual). */
function learnItem(state, c, item) {
  const s = state.settings;
  if (economy.qtyOf(c, item.id) < 1) throw new UserError(`You don't have **${item.name}**.`);
  if (item.type !== 'manual') throw new UserError(`**${item.name}** is a ${item.type}, it can't be learned.${item.type === 'pill' ? ' Pills are consumed instead.' : ''}`);
  const art = (state.arts || []).find((a) => a.id === item.manual?.artId);
  if (!art) throw new UserError(`**${item.name}** doesn't teach anything yet (staff: pick what it teaches in the dashboard).`);
  const already = knownLists(c).some(({ list }) => list.some((r) => r.id === art.id)) || c.qiCore?.id === art.id;
  if (already) throw new UserError(`**${c.name}** already knows **${art.name}**.`);
  const ref = { id: art.id, name: art.name };
  let note = '';
  if (['core', 'special', 'forbidden', 'generic'].includes(art.kind)) {
    const cat = art.kind;
    const list = c.martialArts[cat];
    const limit = num(s.martialArtLimits?.[cat], 1);
    const replaces = art.replacesCore && (cat === 'special' || cat === 'forbidden') && c.martialArts.core.length;
    if (list.length >= limit) throw new UserError(`Your ${cat} martial art slots are full (${list.length}/${limit}). Forget one first in /menu → Stats.`);
    if (replaces) {
      note = `It **replaces** your Core art: ${c.martialArts.core.map((r) => refName(state, r)).join(', ')}.`;
      c.martialArts.core = [];
    }
    list.push(ref);
  } else if (art.kind === 'cultivation') {
    const limit = num(s.maxCultivationMethods, 2);
    if (c.cultivationMethods.length >= limit) throw new UserError(`You already have ${c.cultivationMethods.length}/${limit} cultivation methods. Forget one first in /menu → Stats.`);
    c.cultivationMethods.push(ref);
  } else {
    throw new UserError(`**${art.name}** can't be learned from a manual.`);
  }
  economy.removeItem(state, c, item.id, 1);
  return { note, art };
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
const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}`;
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

/**
 * Consume a pill. Absorption (cultivation methods + qi core) changes the yield, impurity reduction changes
 * the impurity, then "consume" scripts may change the result. Returns lines explaining every step.
 */
function consumePill(state, c, item) {
  if (item.type !== 'pill') throw new UserError(`**${item.name}** is not a pill/elixir.`);
  if (economy.qtyOf(c, item.id) < 1) throw new UserError(`You don't have **${item.name}**.`);
  const p = item.pill || {};
  // Monthly use counter (tolerance / monthly limit). Resets automatically when the month changes.
  const month = new Date().toISOString().slice(0, 7);
  if (c.pillUsesMonth !== month) {
    c.pillUses = {};
    c.pillUsesMonth = month;
  }
  const uses = num(c.pillUses?.[item.id]);
  if (num(p.monthlyLimit) > 0 && uses >= num(p.monthlyLimit)) {
    throw new UserError(`Your body can't take more **${item.name}** this month (${uses}/${num(p.monthlyLimit)}). It resets at the start of next month.`);
  }
  // Tolerance: every earlier use this month weakens the pill by tolerance%.
  const tolMult = num(p.tolerance) > 0 ? r2(Math.pow(1 - Math.min(100, num(p.tolerance)) / 100, uses)) : 1;
  // Realm falloff: a pill made for a realm loses falloff% for every realm above it (yield and breakthrough bonus).
  const above = p.peakRealm !== null && p.peakRealm !== undefined && p.peakRealm !== '' ? Math.max(0, (c.realm || 0) - num(p.peakRealm)) : 0;
  const realmMult = above ? r2(Math.max(0, Math.pow(1 - Math.min(100, num(p.realmFalloff, 50)) / 100, above))) : 1;
  const abs = affinity.absorption(state, c);
  const elementRate = p.element ? abs.byElement[p.element] || 0 : 0;
  const rate = affinity.rateFor(abs, p.element);
  const absorbPct = Math.max(0, r2(abs.base + rate)); // e.g. Qi Gathering 50% + Wood 20% = 70%
  const fx = effects.compute(state, c).fx;
  const yieldMult = Math.max(0, Number(fx.yieldMultiplier ?? 1));
  const baseYield = num(p.yieldAmount);
  const absorbed = r2(baseYield * (absorbPct / 100));
  const baseImpurity = num(p.impurity);
  const reduction = baseImpurity > 0 ? abs.impurityReduction : 0;
  const pre = {
    yieldType: p.yieldType || 'none',
    baseYield,
    baseAbsorption: abs.base,
    rate,
    absorption: absorbPct,
    impurityYieldMultiplier: yieldMult,
    toleranceMultiplier: tolMult,
    realmMultiplier: realmMult,
    usesThisMonth: uses,
    yieldAmount: r2(Math.max(0, absorbed * yieldMult * tolMult * realmMult)),
    baseImpurity,
    impurityReduction: reduction,
    impurity: baseImpurity > 0 ? r2(Math.max(0, baseImpurity * (1 - reduction / 100))) : baseImpurity,
    breakthroughBonus: r2(num(p.breakthroughBonus) * realmMult * tolMult),
    keepOnFail: Math.max(0, Math.min(100, num(p.keepOnFail))),
    element: p.element || '',
    notes: [],
  };
  let result = { ...pre };
  const chain = scripts.runChain(state, c, 'consume', result, {
    extraSources: [{ scriptId: item.scriptId, type: 'pill', name: item.name }],
    extra: { item: { id: item.id, name: item.name, pill: p, element: p.element || '' }, usesThisMonth: uses },
  });
  if (chain.value && typeof chain.value === 'object') result = { ...result, ...chain.value };
  result.notes = Array.isArray(result.notes) ? result.notes.map(String) : [];
  result.errors = chain.errors;

  economy.removeItem(state, c, item.id, 1);
  c.pillUses = { ...(c.pillUses || {}), [item.id]: uses + 1 };
  const lines = [];
  const label = YIELD_LABEL[result.yieldType];
  const amt = num(result.yieldAmount);
  if (label && (baseYield || amt)) {
    if (baseYield) lines.push(`**Yield:** ${fmt(baseYield)} ${label}`);
    if (baseYield && absorbPct !== 100) {
      const why = [
        `${abs.baseSource || 'base'} ${fmt(abs.base)}%`,
        abs.general ? `general ${signed(abs.general)}%` : '',
        elementRate ? `${p.element} ${signed(elementRate)}%` : '',
      ].filter(Boolean).join(', ');
      lines.push(`**Absorption:** ${fmt(absorbPct)}% (${why}) → ${fmt(absorbed)} ${label}${absorbed < baseYield ? ` *(${fmt(r2(baseYield - absorbed))} wasted)*` : ''}`);
    }
    if (baseYield && yieldMult !== 1) lines.push(`**Impurity:** yields ${yieldMult < 1 ? `reduced by ${fmt(r2((1 - yieldMult) * 100))}%` : `×${fmt(yieldMult)}`}`);
    if (baseYield && tolMult !== 1) lines.push(`**Tolerance:** ${ordinal(uses + 1)} this month → ${fmt(r2(tolMult * 100))}% potency`);
    if (baseYield && realmMult !== 1) lines.push(`**Realm:** made for ${state.realms[num(p.peakRealm)]?.name || 'a lower realm'} → ${fmt(r2(realmMult * 100))}% potency`);
    if (baseYield && (yieldMult !== 1 || tolMult !== 1 || realmMult !== 1)) lines.push(`**After penalties:** ${fmt(pre.yieldAmount)} ${label}`);
    if (Math.abs(amt - pre.yieldAmount) > 1e-9) lines.push(`**Special effects:** ${signed(r2(amt - pre.yieldAmount))} ${label}`);
    switch (result.yieldType) {
      case 'qi': {
        const g = stats.gainQi(state, c, amt, { resetImpurity: state.settings.pillQiResetsImpurity, source: 'pill' });
        let t = g.gained < 0 ? `**Lost:** ${fmt(-g.gained)} Qi (now ${fmt(c.stats.qi)})` : `**Gained:** +${fmt(g.gained)} Qi (now ${fmt(c.stats.qi)})`;
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
    const cap = num(state.settings.maxBreakthroughBonus, 0);
    const before = num(c.breakthroughBonus);
    let add = num(result.breakthroughBonus);
    if (cap > 0) add = r2(Math.max(0, Math.min(add, cap - before)));
    c.breakthroughBonus = r2(before + add);
    if (add > 0) c.breakthroughPills = [...(c.breakthroughPills || []), { name: item.name, bonus: add, keepOnFail: num(result.keepOnFail) }];
    let t = `**Realm Breakthrough:** ${signed(add)}% chance (now +${fmt(c.breakthroughBonus)}%, used on your next attempt)`;
    const pen = [tolMult !== 1 ? `${ordinal(uses + 1)} this month: ${fmt(r2(tolMult * 100))}%` : '', realmMult !== 1 ? `made for ${state.realms[num(p.peakRealm)]?.name}: ${fmt(r2(realmMult * 100))}%` : ''].filter(Boolean);
    if (pen.length && !(baseYield)) t += ` · potency ${pen.join(', ')}`;
    if (add < num(result.breakthroughBonus)) t += ` · ${fmt(r2(num(result.breakthroughBonus) - add))}% wasted — pill bonuses are capped at +${fmt(cap)}%`;
    if (num(result.keepOnFail) && add > 0) t += ` · ${fmt(result.keepOnFail)}% of it stays if the attempt fails`;
    lines.push(t);
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
  if (item.useEffect) lines.push(`**Effect:** ${item.useEffect}`);
  return { result, lines: [...lines, ...result.notes] };
}

/** Use any consumable: pills go through consumePill, other consumables (poisons, antidotes, talismans…) are just spent and logged. */
function useItem(state, c, item) {
  if (item.type === 'pill') return consumePill(state, c, item);
  if (!item.consumable) throw new UserError(`**${item.name}** can't be used up.`);
  if (economy.qtyOf(c, item.id) < 1) throw new UserError(`You don't have **${item.name}**.`);
  economy.removeItem(state, c, item.id, 1);
  const lines = [item.useEffect ? `**Effect:** ${item.useEffect}` : `**Used** ${item.name}.`];
  if (item.type === 'poison') lines.push(`**Poison T${item.poison.tier}**${item.poison.element ? ` (${item.poison.element})` : ''}: ${[item.poison.debuff, item.poison.gimmick].filter(Boolean).join(' · ') || `+${fmt(item.poison.impurity)} Impurity on hit`}`);
  if (item.type === 'purification') lines.push(`**Purification T${item.purification.tier}**${item.purification.element ? ` (${item.purification.element})` : ''} — check it against the poison with \`/purify\`.`);
  return { result: { errors: [] }, lines };
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
  // Pill bonuses are spent; on failure, pills with "keep on fail" leave part of their bonus behind (once).
  const kept = success ? [] : (c.breakthroughPills || []).filter((x) => x.keepOnFail > 0).map((x) => ({ name: x.name, bonus: r2((x.bonus * x.keepOnFail) / 100), keepOnFail: 0 })).filter((x) => x.bonus > 0);
  c.breakthroughPills = kept;
  c.breakthroughBonus = r2(kept.reduce((a, x) => a + x.bonus, 0));
  c.lastBreakthroughAt = new Date().toISOString();
  let failImpurity = null;
  if (success) c.realm += 1;
  else if (num(state.settings.breakthroughFailureImpurity) > 0) failImpurity = addImpurity(state, c, num(state.settings.breakthroughFailureImpurity));
  return { success, roll, chance, from, to: success ? stats.realmOf(state, c).name : check.next.name, failImpurity, keptBonus: c.breakthroughBonus };
}

module.exports = {
  setSect, syncSectFromRoles, sectOf, resolveRef, refName, titleString, mainWeapon, equip, activeCharacterOf, createCharacter, addImpurity, learnItem, forget,
  consumePill, useItem, breakthroughChance, attemptBreakthrough,
};
