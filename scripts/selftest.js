'use strict';
/**
 * Offline checks of the game rules. Run with:  npm run check
 * Does not touch your database or Discord.
 */
const assert = require('assert');
const defaults = require('../src/defaults');
const stats = require('../src/engine/stats');
const effects = require('../src/engine/effects');
const chars = require('../src/engine/characters');
const affinity = require('../src/engine/affinity');
const { purify } = require('../src/engine/fengshui');
const rolls = require('../src/engine/rolls');
const economy = require('../src/engine/economy');
const { grant, take } = require('../src/engine/grants');
const crafting = require('../src/engine/crafting');
const combat = require('../src/engine/combat');
const templates = require('../src/engine/templates');

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};
const fresh = () => {
  const state = defaults.createDefaultState();
  const c = chars.createCharacter(state, { ownerId: '1', ownerTag: 'tester', name: 'Chung Myung', sect: 'Mount Hua Sect' });
  return { state, c };
};

console.log('Game rule self-test');

test('new character gets 50 flexible starting points', () => {
  const { c } = fresh();
  assert.strictEqual(c.pools.flex, 50);
  assert.strictEqual(c.cultivationMethods[0].name, 'Qi Gathering');
});

test('parses multi-line stat messages', () => {
  const e = stats.parseAllocation('strength 5\nmobility 5\nendurance 5, qi 3');
  assert.deepStrictEqual(e.map((x) => x.stat), ['strength', 'mobility', 'endurance', 'qi']);
});

test('50% rule blocks putting more than half into one stat', () => {
  const { state, c } = fresh();
  assert.throws(() => stats.applyAllocation(state, c, [{ stat: 'strength', amount: 30 }]), /50%/);
  stats.applyAllocation(state, c, [{ stat: 'strength', amount: 25 }]);
  assert.strictEqual(c.stats.strength, 25);
  // putting 20 into qi would leave only 30 normal points -> strength 25 > 15
  assert.throws(() => stats.applyAllocation(state, c, [{ stat: 'qi', amount: 20 }]), /50%/);
});

test('"all" points cannot go into Qi, "allqi" can', () => {
  const { state, c } = fresh();
  c.pools.flex = 0;
  grant(state, c, 'all', 10);
  assert.throws(() => stats.spendPoints(state, c, 'qi', 5), /flexible/);
  grant(state, c, 'allqi', 10);
  stats.spendPoints(state, c, 'qi', 5);
  assert.strictEqual(c.stats.qi, 5);
});

test('soft cap halves gains, hard cap stops them (2nd Rate: 100 -> 110)', () => {
  const { state, c } = fresh();
  c.realm = 1;
  c.pools.flex = 0;
  c.stats = { strength: 34, endurance: 33, mobility: 33, qi: 40 };
  grant(state, c, 'all', 30);
  assert.strictEqual(c.pools.normal, 20, 'only 20 raw points fit before the hard cap (10 stat points at 50%)');
  const r = stats.spendPoints(state, c, 'endurance', 20);
  assert.strictEqual(r.gained, 10);
  assert.strictEqual(stats.normalTotal(c), 110);
  assert.throws(() => stats.spendPoints(state, c, 'mobility', 1), /Not enough|hard capped/);
});

test('Qi has no soft-cap reduction but stops at its hard cap (55)', () => {
  const { state, c } = fresh();
  c.realm = 1;
  c.stats.qi = 50;
  const { lines } = grant(state, c, 'qi', 10);
  assert.strictEqual(c.stats.qi, 55);
  assert.ok(lines.some((l) => l.includes('hard cap')));
});

test('receiving Qi resets impurity', () => {
  const { state, c } = fresh();
  c.impurity = 60;
  grant(state, c, 'qi', 1);
  assert.strictEqual(c.impurity, 0);
});

test('impurity drawbacks at 50 / 75 / 100', () => {
  const { state, c } = fresh();
  c.stats = { strength: 20, endurance: 20, mobility: 20, qi: 20 };
  c.impurity = 80;
  const s = effects.compute(state, c);
  assert.strictEqual(s.fx.yieldMultiplier, 0.5);
  assert.strictEqual(s.effStats.strength, 15);
  const r = chars.addImpurity(state, c, 25);
  assert.ok(r.burst);
  assert.strictEqual(c.stats.strength, 15);
  assert.strictEqual(c.stats.qi, 15);
});

test('poison impurity does not burst meridians unless marked', () => {
  const { state, c } = fresh();
  c.stats.strength = 20;
  const r = chars.addImpurity(state, c, 120, { poison: true });
  assert.ok(!r.burst);
  assert.strictEqual(c.stats.strength, 20);
});

test('Three Hearts script: hearts at 50/75/100, Fake Heart Demon at 125', () => {
  const { state, c } = fresh();
  c.cultivationMethods.push({ id: 'three-hearts-cultivation', name: 'Three Hearts Cultivation Method' });
  assert.ok(state.arts.some((a) => a.id === 'three-hearts-cultivation'));
  c.stats = { strength: 20, endurance: 20, mobility: 20, qi: 20 };
  c.impurity = 100;
  let s = effects.compute(state, c);
  assert.strictEqual(s.fx.yieldMultiplier, 1);
  assert.strictEqual(s.effStats.endurance, 23);
  assert.strictEqual(s.qiBars.total, 3);
  assert.deepStrictEqual(s.scriptErrors, []);
  c.impurity = 99;
  assert.ok(!chars.addImpurity(state, c, 1).burst, 'Heart of Spirit prevents the burst');
  const r = chars.addImpurity(state, c, 30);
  assert.ok(r.burst, 'Fake Heart Demon at 125+ lets the burst happen');
  s = effects.compute(state, c);
  assert.strictEqual(s.fx.yieldMultiplier, 0.5);
});

test('No Meridians / Heavenly Martial Meridian traits', () => {
  const { state, c } = fresh();
  c.traits = [{ id: 'heavenly-martial-meridian', name: 'Heavenly Martial Meridian' }];
  assert.strictEqual(effects.compute(state, c).qiBars.total, 6);
  grant(state, c, 'qi', 4);
  c.stats.qi = 3;
  assert.strictEqual(c.stats.qi, 3);
  c.traits = [{ id: 'no-meridians', name: 'No Meridians' }];
  assert.strictEqual(effects.compute(state, c).qiBars.total, 0);
});

test('absorption: best positive + all negatives (Wood 15, Metal -20)', () => {
  const { state, c } = fresh();
  state.arts.push(defaults.normalizeArt({ id: 'a', name: 'A', kind: 'cultivation', affinities: { Wood: 10, Metal: 5 } }));
  state.arts.push(defaults.normalizeArt({ id: 'b', name: 'B', kind: 'cultivation', affinities: { Wood: 15, Metal: -25 } }));
  c.cultivationMethods = [{ id: 'a' }, { id: 'b' }];
  const abs = affinity.absorption(state, c);
  assert.strictEqual(abs.byElement.Wood, 15);
  assert.strictEqual(abs.byElement.Metal, -20);
});

test('pill yield uses absorption and adds impurity + breakthrough bonus', () => {
  const { state, c } = fresh();
  state.arts.push(defaults.normalizeArt({ id: 'w', name: 'Wood Method', kind: 'cultivation', affinities: { Wood: 20 } }));
  state.items.push(defaults.normalizeItem({ id: 'pill', name: 'Green Pill', type: 'pill', pill: { yieldType: 'qi', yieldAmount: 10, impurity: 15, element: 'Wood', breakthroughBonus: 5 } }));
  c.cultivationMethods = [{ id: 'w' }];
  economy.addItem(c, 'pill', 1);
  chars.consumePill(state, c, state.items.find((i) => i.id === 'pill'));
  assert.strictEqual(c.stats.qi, 12);
  assert.strictEqual(c.impurity, 15);
  assert.strictEqual(c.breakthroughBonus, 5);
});

test('realm breakthrough: 3rd Rate needs 70/30 and is guaranteed', () => {
  const { state, c } = fresh();
  assert.throws(() => chars.attemptBreakthrough(state, c), /requirements/);
  c.stats = { strength: 25, endurance: 25, mobility: 20, qi: 30 };
  const r = chars.attemptBreakthrough(state, c);
  assert.ok(r.success);
  assert.strictEqual(c.realm, 1);
});

test('purification Feng Shui', () => {
  assert.strictEqual(purify(1, 'Fire', 1, 'Wood').effectiveTier, 0, 'Wood boosts Fire: T1 -> nothing');
  assert.strictEqual(purify(3, 'Metal', 3, 'Wood').effectiveTier, 0, 'Wood is weak to Metal: useless');
  const r = purify(2, 'Water', 2, 'Earth');
  assert.strictEqual(r.numerical, 'halved');
  assert.strictEqual(r.gimmick, 'removed');
  assert.strictEqual(purify(1, 'Metal', 2, 'Water').numerical, 'removed');
});

test('drop roll respects rarity chances', () => {
  const { state, c } = fresh();
  for (const r of ['Earthly', 'Heavenly', 'Immortal']) state.items.push(defaults.normalizeItem({ name: `${r} thing`, rarity: r }));
  const counts = { Earthly: 0, Heavenly: 0, Immortal: 0 };
  for (let i = 0; i < 20000; i++) counts[rolls.rollDrop(state, c).rarity.name]++;
  assert.ok(Math.abs(counts.Earthly / 20000 - 0.75) < 0.02, JSON.stringify(counts));
  assert.ok(Math.abs(counts.Immortal / 20000 - 0.05) < 0.01, JSON.stringify(counts));
});

test('trade swaps items and Nyang', () => {
  const { state, c } = fresh();
  const d = chars.createCharacter(state, { ownerId: '2', ownerTag: 'other', name: 'Baek Cheon' });
  const it = defaults.normalizeItem({ id: 'sword', name: 'Plum Sword' });
  state.items.push(it);
  economy.addItem(c, 'sword', 1);
  d.nyang = 100;
  const t = economy.createTrade(state, c, d, { itemId: 'sword', qty: 1 }, { nyang: 60 });
  economy.settleTrade(state, t);
  assert.strictEqual(economy.qtyOf(d, 'sword'), 1);
  assert.strictEqual(c.nyang, 60);
  assert.strictEqual(d.nyang, 40);
});

test('title is typed by staff; old prefix/stem/suffix saves are converted', () => {
  const { state, c } = fresh();
  c.title = 'Rising Dragon';
  assert.strictEqual(chars.titleString(state, c), 'Rising Dragon');
  const store = require('../src/store');
  const migrated = store.migrate({ items: [], characters: [{ name: 'X', ownerId: '9', sect: 'Mount Hua Sect', titles: { prefix: '', stem: 'Rising', suffix: 'Dragon' } }] });
  assert.strictEqual(migrated.characters[0].title, "Mount Hua's Rising Dragon");
  assert.ok(migrated.items.some((i) => i.id === 'default-weapon'), 'default weapon added to old saves');
});

test('weapons: default weapon equipped, treasure bonuses change effective stats only', () => {
  const { state, c } = fresh();
  assert.strictEqual(require('../src/engine/weapons').mainWeapon(state, c).id, 'default-weapon');
  state.items.push(defaults.normalizeItem({ id: 'sw', name: 'Plum Sword', type: 'weapon', weapon: { grade: 'Spiritual Treasure' }, bonuses: { strength: 5, qiBars: 0.5 } }));
  c.stats.strength = 35;
  assert.throws(() => require('../src/engine/weapons').equip(state, c, state.items.find((i) => i.id === 'sw')), /don't have/);
  economy.addItem(c, 'sw', 1);
  require('../src/engine/weapons').equip(state, c, state.items.find((i) => i.id === 'sw'));
  const sh = effects.compute(state, c);
  assert.strictEqual(sh.effStats.strength, 40);
  assert.strictEqual(c.stats.strength, 35);
  assert.strictEqual(sh.qiBars.total, 2.5);
  economy.removeItem(state, c, 'sw', 1);
  assert.strictEqual(effects.compute(state, c).effStats.strength, 35, 'traded away -> back to default weapon');
});

test('pill breakdown: absorption and impurity reduction are shown', () => {
  const { state, c } = fresh();
  state.arts.push(defaults.normalizeArt({ id: 'cm', name: 'Lotus Method', kind: 'cultivation', affinities: { Wood: 20 }, impurityReduction: 30 }));
  state.items.push(defaults.normalizeItem({ id: 'pp', name: 'Green Pill', type: 'pill', pill: { yieldType: 'qi', yieldAmount: 10, impurity: 20, element: 'Wood' } }));
  c.cultivationMethods = [{ id: 'cm' }];
  economy.addItem(c, 'pp', 1);
  const r = chars.consumePill(state, c, state.items.find((i) => i.id === 'pp'));
  assert.strictEqual(c.stats.qi, 12);
  assert.strictEqual(c.impurity, 14);
  const text = r.lines.join('\n');
  assert.ok(/Absorption:\*\* 120%/.test(text), text);
  assert.ok(/6 shaved off/.test(text), text);
});

test('detox pill removes impurity', () => {
  const { state, c } = fresh();
  c.impurity = 50;
  state.items.push(defaults.normalizeItem({ id: 'dx', name: 'Detox', type: 'pill', pill: { yieldType: 'none', impurity: -30 } }));
  economy.addItem(c, 'dx', 1);
  const r = chars.consumePill(state, c, state.items.find((i) => i.id === 'dx'));
  assert.strictEqual(c.impurity, 20);
  assert.ok(r.lines.join(' ').includes('Impurity removed'));
});

test('items marked not marketable cannot be listed', () => {
  const { state, c } = fresh();
  const it = defaults.normalizeItem({ id: 'nm', name: 'Sect Token', marketable: false });
  state.items.push(it);
  economy.addItem(c, 'nm', 1);
  assert.throws(() => economy.listOnMarket(state, c, it, 1, 10), /player market/);
});

test('Qi Bar bonus from Qi: 26 -> +1, 101 -> +2, 751 -> +6', () => {
  const { state, c } = fresh();
  c.stats.qi = 25;
  assert.strictEqual(effects.compute(state, c).qiBars.total, 2);
  c.stats.qi = 26;
  assert.strictEqual(effects.compute(state, c).qiBars.total, 3);
  c.stats.qi = 150;
  assert.strictEqual(effects.compute(state, c).qiBars.fromQi, 2);
  c.stats.qi = 800;
  assert.strictEqual(effects.compute(state, c).qiBars.fromQi, 6);
});

test('staff take: points, stats with refund, nyang', () => {
  const { state, c } = fresh();
  c.stats.strength = 20;
  c.nyang = 10;
  take(state, c, 'allqi', 30);
  assert.strictEqual(c.pools.flex, 20);
  const r = take(state, c, 'stat', 5, { stat: 'strength', refund: true });
  assert.strictEqual(c.stats.strength, 15);
  assert.strictEqual(c.pools.normal, 5);
  assert.ok(r.summary.includes('Strength'));
  take(state, c, 'nyang', 50);
  assert.strictEqual(c.nyang, 0);
});

test('crafting consumes inputs and gives outputs', () => {
  const { state, c } = fresh();
  state.items.push(defaults.normalizeItem({ id: 'herb', name: 'Herb' }), defaults.normalizeItem({ id: 'pill2', name: 'Pill', type: 'pill' }));
  const r = defaults.normalizeRecipe({ name: 'Pill', inputs: [{ itemId: 'herb', qty: 2 }], outputs: [{ itemId: 'pill2', qty: 1 }], nyangCost: 5 });
  economy.addItem(c, 'herb', 1);
  c.nyang = 10;
  assert.strictEqual(crafting.check(state, c, r).ok, false);
  economy.addItem(c, 'herb', 1);
  const out = crafting.craft(state, c, r);
  assert.ok(out.success);
  assert.strictEqual(economy.qtyOf(c, 'herb'), 0);
  assert.strictEqual(economy.qtyOf(c, 'pill2'), 1);
  assert.strictEqual(c.nyang, 5);
});

test('compare: damage/clash/mobility tiers with realm-tier caps', () => {
  const { state, c } = fresh();
  const d = chars.createCharacter(state, { ownerId: '2', ownerTag: 'o', name: 'Baek Cheon' });
  c.stats = { strength: 40, endurance: 10, mobility: 45, qi: 0 };
  d.stats = { strength: 10, endurance: 10, mobility: 5, qi: 0 };
  let r = combat.compare(state, c, d);
  assert.strictEqual(r.aHitsB.wanted.tier, 'T7');
  assert.strictEqual(r.aHitsB.row.tier, 'T6', 'T7 needs +1 realm tier');
  assert.ok(r.aHitsB.capped);
  assert.strictEqual(r.bHitsA.row.tier, 'T4');
  assert.strictEqual(r.clash.row.name, 'Overwhelmed');
  assert.strictEqual(r.speed.row.tier, 'T4', 'Blitz/T5 need realm tiers');
  c.realm = 2;
  r = combat.compare(state, c, d);
  assert.strictEqual(r.aHitsB.row.tier, 'T7');
  assert.strictEqual(r.speed.row.tier, 'T6');
});

test('templates fill placeholders and drop empty footers', () => {
  const state = defaults.createDefaultState();
  const m = templates.render(state, 'progressionReport', { player: '<@1>', summary: '+50 Stat Points', details: '', staff: '<@2>', reason: '' });
  assert.ok(m.embeds[0].description.includes('+50 Stat Points to <@1>'));
  assert.ok(m.embeds[0].description.includes('## Approved by\n<@2>'));
  assert.strictEqual(m.embeds[0].footer, undefined);
});


test('Qi Gathering absorbs only 50% of a pill; a better method absorbs fully', () => {
  const { state, c } = fresh();
  state.items.push(defaults.normalizeItem({ id: 'qp', name: 'Qi Pill', type: 'pill', pill: { yieldType: 'qi', yieldAmount: 10 } }));
  economy.addItem(c, 'qp', 2);
  const r = chars.consumePill(state, c, state.items.find((i) => i.id === 'qp'));
  assert.strictEqual(c.stats.qi, 5);
  assert.ok(r.lines.join(' ').includes('Qi Gathering 50%'), r.lines.join(' '));
  c.cultivationMethods.push({ id: 'three-hearts-cultivation', name: 'Three Hearts' });
  chars.consumePill(state, c, state.items.find((i) => i.id === 'qp'));
  assert.strictEqual(c.stats.qi, 15);
});

test('Impurity 50+ halves pill yields (stats too)', () => {
  const { state, c } = fresh();
  c.cultivationMethods = [];
  c.impurity = 55;
  state.items.push(defaults.normalizeItem({ id: 'sp', name: 'Strength Pill', type: 'pill', pill: { yieldType: 'strength', yieldAmount: 10 } }));
  economy.addItem(c, 'sp', 1);
  const r = chars.consumePill(state, c, state.items.find((i) => i.id === 'sp'));
  assert.strictEqual(c.stats.strength, 5);
  assert.ok(r.lines.join(' ').includes('reduced by 50%'));
});

test('manuals teach arts from the library', () => {
  const { state, c } = fresh();
  assert.strictEqual(c.martialArts.core[0].id, 'plum-blossom-sword', 'Mount Hua gives its Core art');
  c.martialArts.core = [];
  state.items.push(defaults.normalizeItem({ id: 'man', name: 'Plum Manual', type: 'manual', manual: { artId: 'plum-blossom-sword' } }));
  economy.addItem(c, 'man', 1);
  const r = chars.learnItem(state, c, state.items.find((i) => i.id === 'man'));
  assert.strictEqual(r.art.name, 'Plum Blossom Sword');
  assert.strictEqual(c.martialArts.core[0].id, 'plum-blossom-sword');
  assert.strictEqual(economy.qtyOf(c, 'man'), 0);
});

test('sect follows Discord roles; join Nyang once; Rogue when the role is removed', () => {
  const { state, c } = fresh();
  const wudang = state.sects.find((x) => x.name === 'Wudang Sect');
  const hua = state.sects.find((x) => x.name === 'Mount Hua Sect');
  wudang.roleId = 'r-wudang';
  hua.roleId = 'r-hua';
  wudang.joinNyang = 100;
  let r = chars.syncSectFromRoles(state, c, ['r-wudang']);
  assert.strictEqual(c.sect, 'Wudang Sect');
  assert.strictEqual(c.nyang, 100);
  assert.ok(r.changed);
  chars.syncSectFromRoles(state, c, ['r-hua']);
  chars.syncSectFromRoles(state, c, ['r-wudang']);
  assert.strictEqual(c.nyang, 100, 'join bonus only once');
  chars.syncSectFromRoles(state, c, []);
  assert.strictEqual(c.sect, '');
  assert.strictEqual(chars.syncSectFromRoles(state, c, ['unrelated']), null);
});

test('pill tolerance, monthly limit and realm falloff', () => {
  const { state, c } = fresh();
  c.cultivationMethods = [];
  state.items.push(defaults.normalizeItem({ id: 'tp', name: 'Tol Pill', type: 'pill', pill: { yieldType: 'qi', yieldAmount: 10, tolerance: 50, monthlyLimit: 3 } }));
  economy.addItem(c, 'tp', 5);
  const tp = state.items.find((i) => i.id === 'tp');
  chars.consumePill(state, c, tp);
  chars.consumePill(state, c, tp);
  chars.consumePill(state, c, tp);
  assert.strictEqual(c.stats.qi, 17.5, '10 + 5 + 2.5');
  assert.throws(() => chars.consumePill(state, c, tp), /this month/);
  c.pillUsesMonth = '2000-01';
  chars.consumePill(state, c, tp);
  assert.strictEqual(c.stats.qi, 27.5, 'new month resets tolerance');
  state.items.push(defaults.normalizeItem({ id: 'rp', name: 'Low Pill', type: 'pill', pill: { yieldType: 'strength', yieldAmount: 8, peakRealm: 0, realmFalloff: 50 } }));
  economy.addItem(c, 'rp', 1);
  c.realm = 2;
  chars.consumePill(state, c, state.items.find((i) => i.id === 'rp'));
  assert.strictEqual(c.stats.strength, 2, '8 x 0.5 x 0.5');
});

test('breakthrough pill cap and keep-on-fail', () => {
  const { state, c } = fresh();
  state.settings.maxBreakthroughBonus = 12;
  state.items.push(defaults.normalizeItem({ id: 'bp', name: 'Ward Pill', type: 'pill', pill: { breakthroughBonus: 8, keepOnFail: 50 } }));
  economy.addItem(c, 'bp', 2);
  const bp = state.items.find((i) => i.id === 'bp');
  chars.consumePill(state, c, bp);
  const r = chars.consumePill(state, c, bp);
  assert.strictEqual(c.breakthroughBonus, 12, 'capped');
  assert.ok(r.lines.join(' ').includes('wasted'));
  c.realm = 3;
  c.stats = { strength: 70, endurance: 70, mobility: 70, qi: 100 };
  state.realms[3].breakthroughChance = -100;
  const res = chars.attemptBreakthrough(state, c);
  assert.ok(!res.success);
  assert.strictEqual(c.breakthroughBonus, 6, '50% of 8 + 50% of 4 kept');
  chars.attemptBreakthrough(state, c);
  assert.strictEqual(c.breakthroughBonus, 0, 'kept bonus is only kept once');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
