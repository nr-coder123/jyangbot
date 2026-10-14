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
const { grant } = require('../src/engine/grants');

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
  const lines = grant(state, c, 'qi', 10);
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
  assert.ok(s.fx.qiRegenDisabled);
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
  c.stats = { strength: 20, endurance: 20, mobility: 20, qi: 20 };
  c.impurity = 100;
  let s = effects.compute(state, c);
  assert.strictEqual(s.fx.qiRegenDisabled, false);
  assert.strictEqual(s.effStats.endurance, 23);
  assert.strictEqual(s.qiBars.total, 3);
  assert.deepStrictEqual(s.scriptErrors, []);
  c.impurity = 99;
  assert.ok(!chars.addImpurity(state, c, 1).burst, 'Heart of Spirit prevents the burst');
  const r = chars.addImpurity(state, c, 30);
  assert.ok(r.burst, 'Fake Heart Demon at 125+ lets the burst happen');
  s = effects.compute(state, c);
  assert.ok(s.fx.qiRegenDisabled);
});

test('No Meridians / Heavenly Martial Meridian traits', () => {
  const { state, c } = fresh();
  c.traits = [{ id: 'heavenly-martial-meridian', name: 'Heavenly Martial Meridian' }];
  assert.strictEqual(effects.compute(state, c).qiBars.total, 6);
  grant(state, c, 'qi', 4);
  assert.strictEqual(c.stats.qi, 3);
  c.traits = [{ id: 'no-meridians', name: 'No Meridians' }];
  assert.strictEqual(effects.compute(state, c).qiBars.total, 0);
});

test('absorption: best positive + all negatives (Wood 15, Metal -20)', () => {
  const { state, c } = fresh();
  state.items.push(defaults.normalizeItem({ id: 'a', name: 'A', type: 'cultivation', cultivation: { absorption: 0, affinities: { Wood: 10, Metal: 5 } } }));
  state.items.push(defaults.normalizeItem({ id: 'b', name: 'B', type: 'cultivation', cultivation: { absorption: 0, affinities: { Wood: 15, Metal: -25 } } }));
  c.cultivationMethods = [{ id: 'a' }, { id: 'b' }];
  const abs = affinity.absorption(state, c);
  assert.strictEqual(abs.byElement.Wood, 15);
  assert.strictEqual(abs.byElement.Metal, -20);
});

test('pill yield uses absorption and adds impurity + breakthrough bonus', () => {
  const { state, c } = fresh();
  state.items.push(defaults.normalizeItem({ id: 'w', name: 'Wood Manual', type: 'cultivation', cultivation: { affinities: { Wood: 20 } } }));
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

test('title formatting', () => {
  const { state, c } = fresh();
  c.titles = { prefix: '', stem: 'Rising', suffix: 'Dragon' };
  assert.strictEqual(chars.titleString(state, c), "Mount Hua's Rising Dragon");
  c.sect = '';
  assert.strictEqual(chars.titleString(state, c), 'Rogue Rising Dragon');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
