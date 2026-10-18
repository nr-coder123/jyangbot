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

// ---------------- world ----------------
const { migrate } = require('../src/store');
const W = require('../src/world');
const worldFresh = () => {
  const state = migrate(null);
  const c = chars.createCharacter(state, { ownerId: '1', ownerTag: 'tester', name: 'Chung Myung', sect: 'Mount Hua Sect' });
  const d = chars.createCharacter(state, { ownerId: '2', ownerTag: 'other', name: 'Namgoong Dowi', sect: 'Namgoong Clan' });
  return { state, c, d };
};

test('world: map data, factions for every sect, trade-good items', () => {
  const { state } = worldFresh();
  assert.strictEqual(W.geo.provinces().length, 34);
  assert.ok(W.geo.prefectures().length > 400);
  for (const s of state.sects) assert.ok(W.common.factionOfSect(state, s.name), `faction for ${s.name}`);
  assert.strictEqual(state.items.filter((i) => i.tradeGood).length, state.world.goods.length);
  assert.ok(W.geo.route(state, '河南', '广东').hops >= 2);
  assert.ok(W.geo.route(state, '海南', '北京'), 'islands reachable by sea lanes');
});

test('world: 300 turns stay stable (no negative stock, prosperity moves, no famine everywhere)', () => {
  const { state } = worldFresh();
  for (let i = 0; i < 300; i++) W.tick.runTurn(state);
  const regs = W.geo.marketKeys(state).map((k) => state.world.regions[k]);
  for (const r of regs) for (const [g, v] of Object.entries(r.stock)) assert.ok(v >= 0, `${r.key} ${g} ${v}`);
  const p = regs.map((r) => r.prosperity).sort((a, b) => a - b);
  assert.ok(p[Math.floor(p.length / 2)] > 35 && p[Math.floor(p.length / 2)] < 90, `median prosperity ${p[Math.floor(p.length / 2)]}`);
  assert.ok(regs.filter((r) => r.last.food < 0.8).length < regs.length / 4, 'most regions are fed');
  for (const f of state.world.factions) assert.ok(f.treasury >= 0, `${f.name} treasury`);
});

test('world: raw materials belong to the economy — players cannot trade, list or sell them', () => {
  const { state, c, d } = worldFresh();
  const it = state.items.find((i) => i.tradeGood === 'silk');
  assert.ok(it && !it.tradeable && !it.marketable);
  c.inventory[it.id] = 5;
  assert.strictEqual(economy.shopSellPrice(state, it), 0);
  assert.throws(() => economy.sellToShop(state, c, it, 1), /raw material/);
  assert.throws(() => economy.listOnMarket(state, c, it, 1, 10), /raw material/);
  assert.throws(() => economy.createTrade(state, c, d, { itemId: it.id, qty: 1 }, {}), /raw material/);
  for (const k of ['buyGood', 'sellGood', 'sendCaravan', 'startTravel', 'requireAt']) assert.ok(!W.economy[k], `${k} is gone`);
});

test('world: item prices — sect markets, cheapest source, resale cap, sell-back; no money from reselling', () => {
  const { state, c, d } = worldFresh();
  const E = W.economy; const w = state.world;
  const pill = defaults.normalizeItem({ id: 'test-pill', name: 'Test Pill', type: 'pill', rarity: 'Earthly', shop: { enabled: true, price: 100, stock: -1 } });
  state.items.push(pill);
  assert.strictEqual(E.autoLinkItems(state), 1);
  assert.strictEqual(pill.economy.good, 'elixirs');
  pill.economy.sensitivity = 0.3;
  const f = W.common.factionOfChar(state, c); const g = W.common.factionOfChar(state, d);
  W.territory.paint(state, ['湖北'], f.id); W.territory.paint(state, ['四川'], g.id);
  // Hubei is flooded with elixir stock, Sichuan has none.
  const hb = w.regions['湖北']; hb.stock.elixirs = hb.targets.elixirs * 4; E.updatePrices(state, '湖北', W.common.emptyMods());
  const sc = w.regions['四川']; sc.stock.elixirs = sc.targets.elixirs * 0.6; E.updatePrices(state, '四川', W.common.emptyMods());
  const qc = E.itemQuote(state, pill, c); const qd = E.itemQuote(state, pill, d);
  assert.ok(qc.yours < qc.global && qd.yours > qd.global, `sect prices: ${qc.yours} < ${qc.global} < ${qd.yours}`);
  assert.strictEqual(qc.cheapest, qc.yours, 'the cheapest source is the Hubei sect');
  assert.strictEqual(qc.resaleCap, qc.cheapest, 'nobody can resell above the cheapest source');
  assert.ok(qc.sellback < qc.cheapest, 'the shop always pays less than anyone pays it');
  // Buy cheap through the sect, try to resell dear: the listing is corrected down to the cap.
  c.nyang = 10000; economy.buyFromShop(state, c, pill, 2, qc.yours);
  const l = economy.listOnMarket(state, c, pill, 2, qd.yours * 2);
  assert.strictEqual(l.price, qc.resaleCap); assert.ok(l.corrected);
  // A gift resold to the shop can't make money out of nothing either.
  d.inventory[pill.id] = 1; const before = d.nyang;
  economy.sellToShop(state, d, pill, 1);
  assert.ok(d.nyang - before < qc.cheapest);
  // Free trade gives access to the partner's markets: the Sichuan sect pays less.
  W.diplomacy.makeAgreement(state, { parties: [f.id, g.id], perks: { freeTrade: true } });
  assert.ok(E.itemQuote(state, pill, d).yours < qd.yours);
});

test('world: taxes come from GDP — production, building value added and trade', () => {
  const { state } = worldFresh();
  const w = state.world;
  W.territory.paint(state, ['四川'], w.factions[0].id);
  for (let i = 0; i < 3; i++) W.tick.runTurn(state);
  const r = w.regions['四川'];
  assert.ok(r.last.gdp > 0 && r.last.produced > 0);
  assert.ok(Math.abs(r.last.taxes - Math.min(r.last.gdp * r.taxRate / 100, r.last.taxes)) < 0.01);
  const rich = w.regions['四川'].last.gdp; const poor = w.regions['青海'].last.gdp;
  assert.ok(rich > poor, 'a productive province has a bigger economy');
});

test('world: painting, split provinces, takeovers and revert', () => {
  const { state } = worldFresh();
  const T = W.territory; const w = state.world;
  const [f, g] = w.factions;
  // Unsplit province: paint whole, prefectures follow.
  const undo1 = T.paint(state, ['山东'], f.id);
  assert.strictEqual(T.controllerOf(state, '山东/济南'), f.id);
  // Split province (Henan): painting one prefecture leaves the others alone and the largest holder taxes the province.
  T.paint(state, ['河南'], f.id);
  const undo2 = T.paint(state, ['河南/洛阳'], g.id);
  assert.strictEqual(T.controllerOf(state, '河南/洛阳'), g.id);
  assert.strictEqual(T.controllerOf(state, '河南/开封'), f.id);
  assert.strictEqual(w.regions['河南'].controller, f.id);
  T.restore(state, undo2);
  assert.strictEqual(T.controllerOf(state, '河南/洛阳'), f.id);
  T.restore(state, undo1);
  assert.strictEqual(T.controllerOf(state, '山东/济南'), null);
  // Takeover: request → approve → revert
  T.paint(state, ['江苏'], f.id);
  const t = T.requestTakeover(state, { regions: ['江苏'], to: g.id, reason: 'Ceded after the war', by: { name: 'rep' } });
  assert.strictEqual(t.status, 'pending');
  T.approveTakeover(state, t.id, { name: 'staff' });
  assert.strictEqual(T.controllerOf(state, '江苏'), g.id);
  assert.strictEqual(T.controllerOf(state, '江苏/扬州'), g.id, 'special prefecture follows');
  T.revertTakeover(state, t.id);
  assert.strictEqual(T.controllerOf(state, '江苏'), f.id);
  const t2 = T.forceTakeover(state, { regions: ['浙江'], to: g.id, reason: 'staff', by: { name: 'staff' } });
  assert.strictEqual(t2.status, 'approved');
});

test('world: representatives, stipends with a soft cap', () => {
  const { state, c, d } = worldFresh();
  const T = W.territory;
  const f = W.common.factionOfChar(state, c);
  T.setOffice(state, c, 'representative');
  assert.strictEqual(T.officeOf(state, c), 'representative');
  assert.ok(T.isNonCombatant(state, c));
  const extra = chars.createCharacter(state, { ownerId: '3', ownerTag: 'x', name: 'Yoon Jong', sect: 'Mount Hua Sect' });
  // Tiny faction, huge fund: nobody gets more than their cap.
  f.stipendFund = 100000;
  const plan = T.stipendPlan(state, f);
  assert.strictEqual(plan.members, 2);
  const rep = plan.rows.find((x) => x.id === c.id); const mem = plan.rows.find((x) => x.id === extra.id);
  assert.ok(rep.paid <= rep.cap && mem.paid <= mem.cap && rep.paid > mem.paid);
  const before = c.nyang; const treasury = f.treasury;
  T.payStipends(state, f);
  assert.strictEqual(c.nyang, before + rep.paid);
  assert.ok(f.treasury > treasury + 90000, 'the rest goes back to the treasury');
  // Accrual
  f.stipendRate = 20; f.treasury = 1000;
  assert.strictEqual(T.accrueStipend(state, f, 100), 20);
  assert.strictEqual(f.stipendFund, 20);
});

test('world: old saves — player caravans on the road bring their cargo home, travel settings go', () => {
  const { state, c } = worldFresh();
  const w = state.world; const it = state.items.find((i) => i.tradeGood === 'tea');
  w.version = 6; w.settings.playerMarketBuy = true; w.settings.travelMode = 'timed'; c.travel = { to: '河南' };
  w.caravans.push({ id: 'cv-x', npc: false, owner: { type: 'character', id: c.id }, good: 'tea', qty: 12, status: 'travelling', to: '河南', from: '四川' });
  it.description = 'Tea.\n\n-# **Trade good** — bought and sold at regional markets (`/world` → Market). Base price 9; its worth depends on where you are.'; it.marketable = false;
  W.state.normalizeWorld(state);
  assert.strictEqual(c.inventory[it.id], 12);
  assert.ok(!w.caravans.some((x) => x.id === 'cv-x') && !c.travel);
  assert.ok(!('playerMarketBuy' in w.settings) && !('travelMode' in w.settings));
  assert.ok(!it.marketable && !it.tradeable && !/where you are/.test(it.description));
});

test('world: forced events apply effects; drought can chain', () => {
  const { state } = worldFresh();
  const ae = W.events.startEvent(state, 'flood', '河南', { forced: true });
  assert.ok(ae.regions.includes('河南'));
  const mods = W.common.regionMods(state, '河南');
  assert.ok(mods.production.food < 1 && mods.prosperity < 0);
  W.events.startEvent(state, 'drought', '山东', { forced: true });
  assert.ok(state.world.pendingChains.some((p) => p.eventId === 'famine'));
});

test('world: walls — base walls 0–10, City Walls add +1 per level, old saves migrate', () => {
  const { state } = worldFresh();
  const w = state.world;
  const r = w.regions['湖北'];
  r.fort = 7; r.buildings = [W.state.normalizeBuilding({ typeId: 'walls', level: 3, status: 'ready' })];
  assert.strictEqual(W.common.wallsOf(state, '湖北'), 10);
  r.buildings[0].hp = 40;
  assert.strictEqual(W.common.wallsOf(state, '湖北'), 7, 'broken walls do not count');
  assert.strictEqual(W.state.normalizeRegion('湖北', { ...r, fort: 14 }).fort, 10);
  // A v4 save: walls max level 1, shop tiers, sect shops, a members-only policy.
  w.version = 4; w.buildingTypes.find((t) => t.id === 'walls').maxLevel = 1;
  w.settings.shopTiers = { member: -15 }; w.factions[0].shop = { items: [{ itemId: 'x' }] };
  w.policies.find((p) => p.id === 'closed-gates').shopAccess = 'members'; delete w.policies.find((p) => p.id === 'closed-gates').outsiderMarkup;
  W.state.normalizeWorld(state);
  assert.strictEqual(w.buildingTypes.find((t) => t.id === 'walls').maxLevel, 3);
  assert.ok(!w.settings.shopTiers && !w.factions[0].shop);
  assert.ok(!('shopAccess' in w.policies.find((p) => p.id === 'closed-gates')) && !('outsiderMarkup' in w.policies.find((p) => p.id === 'closed-gates')));
});

test('world: diplomacy — agreements, alliances call allies to war, marriage needs consent', () => {
  const { state, c, d } = worldFresh();
  const D = W.diplomacy; const C = W.common;
  const A = C.factionOfChar(state, c); const B = C.factionOfChar(state, d);
  const [X, Y] = state.world.factions.filter((f) => f.id !== A.id && f.id !== B.id);
  const p = D.propose(state, { kind: 'agreement', from: A.id, to: B.id, payload: { perks: { freeTrade: true, militaryAccess: true } }, proposer: c });
  assert.strictEqual(p.status, 'awaiting-target');
  D.respond(state, p.id, true, { kind: 'target', name: d.name, userId: d.ownerId });
  assert.ok(C.hasPerk(state, A.id, B.id, 'freeTrade') && C.hasPerk(state, A.id, B.id, 'militaryAccess'));
  assert.strictEqual(C.stance(state, A.id, B.id), 'agreement');
  // An alliance: all members share its terms; a defensive pact pulls members into a war.
  const al = D.createAlliance(state, { name: 'Nine Pillars', members: [A.id, X.id], terms: { defensive: true, nonAggression: true } });
  assert.ok(C.sameAlliance(state, A.id, X.id) && C.hasPerk(state, A.id, X.id, 'defensive'));
  assert.throws(() => D.declareWar(state, A.id, X.id), /non-aggression/);
  const war = D.declareWar(state, Y.id, A.id, { reason: 'old grudge' });
  assert.ok(war.defenders.includes(X.id), 'ally joins the defence');
  assert.ok(C.atWar(state, Y.id, X.id));
  D.makePeace(state, war.id);
  assert.ok(!C.atWar(state, Y.id, A.id));
  D.addMember(state, al.id, B.id);
  assert.strictEqual(C.stance(state, A.id, B.id), 'allied');
  // Marriage: the target's player must consent (here the representative is that player).
  const m = D.propose(state, { kind: 'marriage', from: A.id, to: B.id, payload: { subjectCharId: c.id, targetCharId: d.id }, proposer: c });
  D.respond(state, m.id, true, { kind: 'target', name: d.name, userId: d.ownerId, needsStaff: true });
  assert.strictEqual(m.status, 'awaiting-staff', 'accepting rep\'s rank needs staff');
  D.respond(state, m.id, true, { kind: 'staff', name: 'staff' });
  assert.strictEqual(c.spouseId, d.id);
});

test('world: representative ranks — free, staff approval, spending limit; buildings', () => {
  const { state, c } = worldFresh();
  const R = W.realm; const T = W.territory;
  const f = W.common.factionOfChar(state, c);
  T.setOffice(state, c, 'representative');
  f.repRanks[c.id] = 'envoy';
  assert.strictEqual(R.powerLevel(state, f, c, null, 'build'), 'none');
  assert.throws(() => R.perform(state, 'build', f, { region: '陕西', typeId: 'granary' }, { char: c }), /office doesn't allow/);
  f.repRanks[c.id] = 'steward';
  T.paint(state, ['陕西'], f.id);
  f.treasury = 10000;
  const preset = state.world.regions['陕西'].buildings.length;
  const ok = R.perform(state, 'build', f, { region: '陕西', typeId: 'granary' }, { char: c });
  assert.ok(ok.done, 'steward builds on the spot under the limit');
  const big = R.perform(state, 'build', f, { region: '陕西', typeId: 'walls' }, { char: c });
  assert.ok(big.pending, 'over the spending limit → staff');
  R.approveRequest(state, big.pending.id, { name: 'staff' });
  const r = state.world.regions['陕西'];
  assert.strictEqual(r.buildings.length, preset + 2);
  state.world.turn += 10; R.tickBuildings(state);
  assert.ok(r.buildings.every((b) => b.status === 'ready'));
  assert.ok(W.common.wallsOf(state, '陕西') === r.fort + 1, 'walls add a fort level');
  assert.ok(W.common.regionMods(state, '陕西').sources.some((x) => /Granary/.test(x)));
  // A battle damages buildings; a takeover can raze them.
  const dmg = R.battleDamage(state, '陕西', { days: 30, attackerWon: true }, () => 0.99);
  assert.ok(dmg.every((x) => x.hp < 100));
  const other = state.world.factions.find((x) => x.id !== f.id);
  const t = T.forceTakeover(state, { regions: ['陕西'], to: other.id, by: { name: 'staff' } });
  assert.ok(Array.isArray(t.razed));
});

test('world: a trade guild runs caravans where it has trade rights', () => {
  const { state } = worldFresh();
  const R = W.realm; const T = W.territory;
  const guild = W.state.normalizeFaction({ id: 'jade-guild', name: 'Jade Road Guild', kind: 'guild', treasury: 20000 });
  state.world.factions.push(guild);
  const sect = state.world.factions[0];
  T.paint(state, ['四川'], sect.id);
  assert.throws(() => R.sendFactionCaravan(state, guild, { from: '河南', to: '四川', good: 'tea', qty: 20 }), /trade rights/);
  W.diplomacy.makeAgreement(state, { parties: [guild.id, sect.id], perks: { freeTrade: true } });
  const cv = R.sendFactionCaravan(state, guild, { from: '河南', to: '四川', good: 'tea', qty: 20 });
  assert.ok(guild.treasury < 20000);
  state.world.turn = cv.arriveTurn;
  const done = R.settleFactionCaravans(state);
  assert.strictEqual(done.length, 1);
  assert.ok(done[0].result.earned > 0);
  assert.throws(() => R.sendFactionCaravan(state, sect, { from: '四川', to: '河南', good: 'tea', qty: 5 }), /doesn't run trade caravans/);
});

test('world: normal market — border tariffs, free trade, embargo and war', () => {
  const { state } = worldFresh();
  const E = W.economy; const T = W.territory;
  const [f, g] = state.world.factions;
  T.paint(state, ['河南'], f.id); T.paint(state, ['湖北'], g.id);
  const t0 = E.border(state, '河南', '湖北');
  assert.ok(!t0.blocked && t0.tariff === 0.05 && t0.payee === g.id, 'goods into another ruler\'s land pay a tariff to them');
  assert.strictEqual(E.border(state, '河南', '四川').tariff, 0, 'unclaimed land charges nothing');
  W.diplomacy.makeAgreement(state, { parties: [f.id, g.id], perks: { freeTrade: true } });
  assert.strictEqual(E.border(state, '河南', '湖北').tariff, 0, 'free trade removes the tariff');
  g.embargoes = [f.id];
  assert.ok(E.border(state, '河南', '湖北').blocked && E.border(state, '湖北', '河南').blocked, 'an embargo stops trade both ways');
  g.embargoes = [];
  W.diplomacy.declareWar(state, f.id, g.id, { force: true, silent: true });
  assert.ok(E.border(state, '河南', '湖北').blocked, 'no trade in war');
});

test('world: free-trade partners trade automatically; taxes can come every 2 turns', () => {
  const { state } = worldFresh();
  const R = W.realm; const T = W.territory;
  const [f, g] = state.world.factions;
  T.paint(state, ['河南', '山东'], f.id); T.paint(state, ['四川', '云南'], g.id);
  f.treasury = 20000; g.treasury = 20000;
  const lands = (id) => Object.keys(state.world.regions).filter((k) => state.world.regions[k].controller === id);
  const cross = () => state.world.caravans.filter((c) => c.auto && c.owner.id === f.id && lands(g.id).includes(c.to));
  for (let i = 0; i < 3; i++) R.autoTrade(state);
  assert.strictEqual(cross().length, 0, 'without a trade deal merchants only work their own lands (the normal market still crosses borders)');
  W.diplomacy.makeAgreement(state, { parties: [f.id, g.id], perks: { freeTrade: true } });
  for (let i = 0; i < 8; i++) W.tick.runTurn(state);
  assert.ok(state.world.caravans.some((c) => c.auto && (c.owner.id === f.id || c.owner.id === g.id) && (lands(g.id).includes(c.to) !== lands(g.id).includes(c.from))), 'free-trade partners send caravans to each other on their own');
  state.world.settings.taxEveryTurns = 2;
  const paid = [];
  for (let i = 0; i < 4; i++) { W.tick.runTurn(state); paid.push(f.lastIncome.taxes || 0); }
  assert.strictEqual(paid.filter((x) => x > 0).length, 2, `taxes paid on every second turn (${paid})`);
});

test('world: preset buildings and old workshops become buildings', () => {
  const { state, c } = worldFresh();
  const all = Object.values(state.world.regions).flatMap((r) => r.buildings || []);
  assert.ok(all.length >= 20, 'the map starts with buildings');
  assert.ok(all.some((b) => b.typeId === 'brewery'));
  // A save from before: a player-owned workshop is refunded and converted.
  const w = state.world;
  w.version = 3; w.workshopTypes = [{ id: 'teahouse', cost: 400 }];
  w.regions['河南'].buildings = []; w.regions['河南'].workshops = [{ typeId: 'teahouse', level: 2, owner: { type: 'character', id: c.id } }];
  const before = c.nyang;
  W.state.normalizeWorld(state);
  assert.strictEqual(c.nyang, before + 800, 'refunded');
  assert.ok(w.regions['河南'].buildings.some((b) => b.typeId === 'inn'));
  assert.ok(!w.workshopTypes && !w.regions['河南'].workshops);
  assert.ok(w.unitTypes.some((u) => u.id === 'scouts'));
  // Scouts make an army march faster.
  const M = W.military;
  const slow = M.slowestSpeed(state, { units: { infantry: 1000 } });
  const fast = M.slowestSpeed(state, { units: { infantry: 1000, scouts: 200 } });
  assert.ok(fast > slow);
});

test('world: EU4-style battles — numbers, duel dice, generals, terrain, custom code', () => {
  const { state } = worldFresh();
  const sim = (A, D, extra = {}) => W.military.simulate(state, { A, D, ...extra }, 150).attackerWins;
  assert.ok(sim({ units: { spearmen: 2000 } }, { units: { spearmen: 1000 } }) > 85, '2:1 should win');
  const even = sim({ units: { swordsmen: 3000 } }, { units: { swordsmen: 3000 } });
  assert.ok(sim({ units: { swordsmen: 3000 }, duelDice: 2 }, { units: { swordsmen: 3000 } }) > even + 15, 'duel dice matter');
  assert.ok(sim({ units: { swordsmen: 3000 }, general: { shock: 3, fire: 3 } }, { units: { swordsmen: 3000 } }) > even + 15, 'general pips matter');
  assert.ok(sim({ units: { swordsmen: 3000 } }, { units: { swordsmen: 3000 } }, { terrain: 'mountains' }) < even - 10, 'attacking into mountains is hard');
  assert.ok(sim({ units: { 'heavy-cav': 1000 } }, { units: { crossbows: 2000 } }) > 60, 'cavalry beats crossbows');
  // A battleRound hook on the army adds dice.
  state.scripts.push({ id: 'banner', name: 'Tiger banner', enabled: true, code: 'hooks.battleRound = (ctx, v) => { if (ctx.side === "attacker") v.attacker.dice += 3; return v; };' });
  const f = state.world.factions[0]; const g = state.world.factions[1];
  W.diplomacy.declareWar(state, f.id, g.id);
  const a = W.military.recruit(state, f, '河南', 'swordsmen', 3000, { staff: true }).army; a.scriptId = 'banner';
  const d = W.military.recruit(state, g, '河南', 'swordsmen', 3000, { staff: true }).army;
  let wins = 0;
  for (let i = 0; i < 20; i++) {
    a.units = { swordsmen: 3000 }; d.units = { swordsmen: 3000 }; a.morale = 70; d.morale = 70; a.region = d.region = '河南';
    state.world.battles = [];
    const b = W.military.openBattle(state, '河南', [a.id], [d.id], { hours: 0 });
    W.military.resolveBattle(state, b);
    if (b.result.winner === 'A') wins++;
    assert.ok(b.days.length >= 1 && b.phases[0].phase === 'fire');
  }
  assert.ok(wins >= 15, `army script helps (${wins}/20)`);
});

test('world: balance report adds up and recommends playable sects', () => {
  const { state } = worldFresh();
  const r = W.power.report(state);
  const sum = r.rows.reduce((a, x) => a + x.pi, 0);
  assert.ok(Math.abs(sum - 100) < 1, `PI sums to 100 (${sum})`);
  assert.strictEqual(r.recommend.length, 3);
  assert.ok(r.recommend.every((x) => state.sects.find((s) => s.name === x.sect)?.playable !== false));
});

test('world: custom code can change a region every turn', () => {
  const { state } = worldFresh();
  state.scripts.push({ id: 'boom', name: 'Boomtown', enabled: true, code: 'hooks.regionTick = (ctx, m) => { m.prosperity += 5; m.notes = ["boom in " + ctx.region.name]; return m; };' });
  const base = W.common.regionMods(state, '河南').prosperity;
  state.world.regions['河南'].scriptId = 'boom';
  const m = W.common.regionMods(state, '河南');
  assert.strictEqual(Math.round((m.prosperity - base) * 100) / 100, 5);
  assert.ok(m.notes[0].includes('Henan'));
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
