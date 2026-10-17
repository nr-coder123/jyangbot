'use strict';
/**
 * Generates examples/item-pack-world-expansion.json:
 *   23 trade goods (the regional market cargo), 5 crafting materials, 29 pills / elixirs / teas,
 *   6 poisons and 6 antidotes, from 2nd Rate up to Transcendent, plus recipes that use trade goods.
 * Priced on the same ladder as the server's own list (Dew 70 → Spirit Condensing 180 → Azure Cloud 650 → Purple Mist 1,400;
 * detox ≈ 12 Nyang per impurity point; breakthrough +5% ≈ 450 at low realms).
 *   node scripts/packs/world-pack.js examples/item-pack-world-expansion.json
 */
const fs = require('fs');
const W = require('../../src/world/defaults');

const S = (id, name, description, code) => ({ id, name, description, code: code.trim() + '\n', enabled: true });
const scripts = [
  S('wp-winter-plum', 'Winter Plum Pill', '×1.75 yield in winter, ×0.5 in summer.', `
// Winter Plum Pill — the plum blooms in the snow. Uses ctx.world.season (0 spring, 1 summer, 2 autumn, 3 winter).
hooks.consume = (ctx, result) => {
  const s = ctx.world && ctx.world.season;
  const mult = s === 3 ? 1.75 : s === 1 ? 0.5 : 1;
  result.yieldAmount = Math.round(result.yieldAmount * mult * 100) / 100;
  result.notes.push(s === 3 ? '❄️🌸 Plum blossoms in the snow — the pill is at its strongest (×1.75).' : s === 1 ? '☀️ The summer heat wilts the plum — half potency.' : '🌸 An ordinary season for the plum.');
  return result;
};`),
  S('wp-homeland-spring', 'Homeland Spring Pill', '+50% yield when taken in land your own faction rules.', `
// Homeland Spring Pill — water from your own sect's springs. Uses ctx.world.region.ownLand.
hooks.consume = (ctx, result) => {
  if (ctx.world && ctx.world.region && ctx.world.region.ownLand) {
    result.yieldAmount = Math.round(result.yieldAmount * 1.5 * 100) / 100;
    result.notes.push('🏞️ The springs of home answer you: +50% Qi.');
  } else {
    result.notes.push('🏞️ Far from home, the spring water is just water with herbs in it.');
  }
  return result;
};`),
  S('wp-bodhi-seed', 'Bodhi Seed Incense', 'Only works with a calm mind: wasted at 25+ Impurity.', `
// Bodhi Seed Incense — only a clear mind can use it.
hooks.consume = (ctx, result) => {
  if (ctx.character.impurity >= 25) {
    result.breakthroughBonus = 0;
    result.keepOnFail = 0;
    result.notes.push('🪷 Your thoughts are too turbid (Impurity 25+). The incense burns out unnoticed.');
  } else {
    result.notes.push('🪷 Your mind is still. The incense settles into your heart.');
  }
  return result;
};`),
  S('wp-moon-phase', 'Mid-Autumn Moon Elixir', '+2% Realm Breakthrough, +6% in autumn.', `
// Mid-Autumn Moon Elixir — strongest under the harvest moon.
hooks.consume = (ctx, result) => {
  if (ctx.world && ctx.world.season === 2) {
    result.breakthroughBonus = 6;
    result.notes.push('🌕 Under the harvest moon: +6% Realm Breakthrough.');
  } else {
    result.notes.push('🌙 The moon is not full — only +' + result.breakthroughBonus + '%.');
  }
  return result;
};`),
  S('wp-famine-mercy', 'Hundred Grains Pill', 'Twice as strong during a Famine or Drought where you are.', `
// Hundred Grains Pill — a commoner's pill. In hard times every grain counts.
hooks.consume = (ctx, result) => {
  const ev = (ctx.world && ctx.world.events) || [];
  if (ev.includes('famine') || ev.includes('drought')) {
    result.yieldAmount = result.yieldAmount * 2;
    result.notes.push('🌾 In a starving land, the humble grain pill feels like a feast: double Qi.');
  }
  return result;
};`),
  S('wp-cinnabar', 'Red Cinnabar Pill', 'Taoist cinnabar: +5 extra Impurity if you already have 40+.', `
// Red Cinnabar Pill — mercury builds up in the body.
hooks.consume = (ctx, result) => {
  if (ctx.character.impurity >= 40) {
    result.impurity += 5;
    result.notes.push('🔴 Mercury has gathered in your organs: +5 extra Impurity.');
  }
  return result;
};`),
  S('wp-snow-water', 'Snow Mountain Ice Water', 'Removes 45 Impurity but costs 4 Qi.', `
// Snow Mountain Ice Water — freezing the filth out also freezes some Qi.
hooks.consume = (ctx, result) => {
  const loss = Math.min(4, ctx.character.stats.qi);
  result.yieldType = 'qi';
  result.yieldAmount = -loss;
  result.notes.push('🏔️ The ice water burns cold through every meridian — ' + loss + ' Qi freezes away with the filth.');
  return result;
};`),
];

const base = { tradeable: true, marketable: true, inDropPool: true, dropWeight: 1, consumable: false, useEffect: '', sellPrice: null, scriptId: '', emoji: '' };
const shop = (price, sellPrice = null, stock = -1) => ({ shop: { enabled: true, price, stock }, sellPrice });
const noShop = { shop: { enabled: false, price: 0, stock: -1 } };
const eco = (good, sensitivity) => ({ economy: { good, sensitivity } });
const P = (id, name, rarity, emoji, pill, extra, description) => ({ ...base, id, name, rarity, type: 'pill', emoji, pill: { yieldType: 'none', yieldAmount: 0, impurity: 0, element: '', breakthroughBonus: 0, keepOnFail: 0, tolerance: 0, monthlyLimit: 0, peakRealm: null, realmFalloff: 50, ...pill }, ...extra, description });
const R = { third: 0, second: 1, first: 2, expert: 3, master: 4, peak: 5, supreme: 6, transcendent: 7 };

// ---------- trade goods (regional cargo) ----------
const RARE = new Set(['jade', 'pearls', 'spiritherbs', 'cinnabar', 'elixirs']);
const goods = W.GOODS.map((g) => ({
  ...base, id: g.itemId, name: g.name, rarity: RARE.has(g.id) ? 'Heavenly' : 'Earthly', type: 'material', emoji: g.emoji, marketable: false,
  inDropPool: RARE.has(g.id), dropWeight: 1, ...noShop, tradeGood: g.id,
  description: `${g.description || `${g.name}: bulk trade cargo.`}\n\n-# **Trade good** — bought and sold at regional markets (\`/world\` → Market). Base price ${g.basePrice}; what it's worth depends on where you are. Hand it over only in person (same region), or send it by caravan.`,
}));

// ---------- crafting materials ----------
const M = (id, name, rarity, emoji, dropWeight, description) => ({ ...base, id, name, rarity, type: 'material', emoji, ...noShop, dropWeight, description });
const materials = [
  M('wp-old-pine-resin', 'Old Pine Resin', 'Earthly', '🌲', 4, 'Amber resin from pines older than any dynasty. Calms the blood. Used in teas and incense (see Crafting).'),
  M('wp-phoenix-tail-fern', 'Phoenix Tail Fern', 'Earthly', '🌿', 3, 'A common fern of the southern hills, named for its shape. Draws out heat and fire poisons.'),
  M('wp-snow-lotus', 'Snow Lotus', 'Heavenly', '🪷', 1, 'Blooms once a decade on the snow line of the western mountains. The base of cold, clean pills.'),
  M('wp-purple-lingzhi', 'Purple Lingzhi', 'Heavenly', '🍄', 1, 'A purple ganoderma that grows on dead imperial pines. Prized by every alchemist.'),
  M('wp-moon-dew', 'Moon Dew', 'Heavenly', '🌕', 1, 'Dew gathered from lotus leaves on the night of the full moon. Spoils into ordinary water by dawn — unless sealed in jade.'),
];

// ---------- pills, elixirs, teas ----------
const pills = [
  // Qi — filling the gaps of the server's ladder, then Supreme Peak and Transcendent
  P('wp-hundred-grains-pill', 'Hundred Grains Pill', 'Earthly', '🍚', { yieldType: 'qi', yieldAmount: 1, impurity: 6, tolerance: 40, peakRealm: R.second }, { ...shop(40, 5), ...eco('grain', 0.8), dropWeight: 2, scriptId: 'wp-famine-mercy' },
    'A commoner\'s pill pressed from a hundred kinds of grain. Cheap, weak and honest.\n\n**Gimmick:** **double Qi** if you take it where a **Famine or Drought** is happening.\n-# Its price follows the local price of grain. Made for **2nd Rate**.'),
  P('wp-morning-pine-pill', 'Morning Pine Pill', 'Earthly', '🌲', { yieldType: 'qi', yieldAmount: 3, impurity: 18, tolerance: 35, peakRealm: R.second }, { ...shop(120, 15), ...eco('elixirs', 0.3) },
    'Rolled at dawn from pine pollen and spirit grass.\n\n-# Made for **2nd Rate**. 35% weaker for each one taken this month.'),
  P('wp-red-cinnabar-pill', 'Red Cinnabar Pill', 'Earthly', '🔴', { yieldType: 'qi', yieldAmount: 5, impurity: 28, element: 'Fire', tolerance: 40, peakRealm: R.first }, { ...shop(240), ...eco('cinnabar', 0.4), scriptId: 'wp-cinnabar' },
    'The classic Taoist pill: cinnabar fired nine times. Strong — and full of mercury.\n\n**Gimmick:** **+5 extra Impurity** if you already have 40 or more.\n-# Made for **1st Rate**.'),
  P('wp-winter-plum-pill', 'Winter Plum Pill', 'Heavenly', '🌸', { yieldType: 'qi', yieldAmount: 4, impurity: 18, element: 'Wood', tolerance: 30, monthlyLimit: 3 }, { ...shop(220), scriptId: 'wp-winter-plum' },
    'Brewed from plum blossoms picked in the snow.\n\n**Gimmick:** **×1.75 Qi in Winter**, ×0.5 in Summer. Max 3 per month.'),
  P('wp-homeland-spring-pill', 'Homeland Spring Pill', 'Earthly', '🏞️', { yieldType: 'qi', yieldAmount: 4, impurity: 20, tolerance: 30, monthlyLimit: 3 }, { ...shop(260), scriptId: 'wp-homeland-spring' },
    'Every sect brews it from the water of its own mountain springs.\n\n**Gimmick:** **+50% Qi** when taken in land **your own faction rules**. Max 3 per month.'),
  P('wp-snow-lotus-pill', 'Snow Lotus Pill', 'Heavenly', '❄️', { yieldType: 'qi', yieldAmount: 6, impurity: 22, element: 'Water', tolerance: 30, peakRealm: R.expert }, { ...shop(380), ...eco('elixirs', 0.3) },
    'A cold, clean pill around a snow lotus heart.\n\n-# Made for **Expert**. 30% weaker for each one taken this month.'),
  P('wp-ginseng-pill', 'Thousand-Year Ginseng Pill', 'Heavenly', '🥕', { yieldType: 'qi', yieldAmount: 7, impurity: 20, element: 'Earth', monthlyLimit: 1, peakRealm: R.master }, { ...shop(600), ...eco('spiritherbs', 0.3) },
    'A whole thousand-year root refined into one pill.\n\n-# Made for **Master**. Max 1 per month.'),
  P('wp-purple-ganoderma-elixir', 'Purple Ganoderma Elixir', 'Heavenly', '🍄', { yieldType: 'qi', yieldAmount: 5, impurity: -5, element: 'Wood', tolerance: 30, monthlyLimit: 2 }, { ...shop(520), ...eco('elixirs', 0.3) },
    'A rare clean elixir: it feeds Qi **and** washes a little impurity away.\n\n-# +5 Qi and −5 Impurity. Max 2 per month.'),
  P('wp-nine-turn-golden-pill', 'Nine-Turn Golden Pill', 'Heavenly', '🟡', { yieldType: 'qi', yieldAmount: 18, impurity: 35, element: 'Metal', monthlyLimit: 2, peakRealm: R.supreme }, { ...shop(2800), ...eco('elixirs', 0.25) },
    'Turned in the furnace nine times over forty-nine days.\n\n-# Made for **Supreme Peak**. Max 2 per month.'),
  P('wp-origin-pill', 'Heaven-and-Earth Origin Pill', 'Immortal', '🌌', { yieldType: 'qi', yieldAmount: 26, impurity: 40, monthlyLimit: 1, peakRealm: R.transcendent }, { ...shop(5500, null, 2), ...eco('elixirs', 0.2) },
    'Said to hold the Qi of the world before it split into Heaven and Earth. Only a handful exist.\n\n-# Made for **Transcendent**. Max 1 per month. The shop rarely has more than two.'),
  // Stat pills for Master → Supreme Peak
  P('wp-ox-horn-pill', 'Ox Horn Pill', 'Earthly', '🐂', { yieldType: 'strength', yieldAmount: 3, impurity: 18, tolerance: 35, peakRealm: R.master }, shop(260),
    'Powdered horn of a mountain ox, bound with honey.\n\n-# Made for **Master**. 35% weaker for each one taken this month.'),
  P('wp-bear-gall-pill', 'Bear Gall Pill', 'Earthly', '🐻', { yieldType: 'endurance', yieldAmount: 3, impurity: 18, tolerance: 35, peakRealm: R.master }, shop(260),
    'Bitter enough to make grown men weep. Toughens the body.\n\n-# Made for **Master**. 35% weaker for each one taken this month.'),
  P('wp-leopard-sinew-pill', 'Leopard Sinew Pill', 'Earthly', '🐆', { yieldType: 'mobility', yieldAmount: 3, impurity: 18, tolerance: 35, peakRealm: R.master }, shop(260),
    'Loosens the tendons like a hunting leopard\'s.\n\n-# Made for **Master**. 35% weaker for each one taken this month.'),
  P('wp-golden-body-pill', 'Golden Body Pill', 'Heavenly', '🥇', { yieldType: 'points', yieldAmount: 4, impurity: 24, monthlyLimit: 2, peakRealm: R.peak }, shop(600),
    'Tempers the whole body at once.\n\n-# Gives 4 stat points (Strength / Endurance / Mobility). Made for **Peak**. Max 2 per month.'),
  P('wp-myriad-forms-pill', 'Myriad Forms Pill', 'Heavenly', '🌀', { yieldType: 'flex', yieldAmount: 5, impurity: 28, monthlyLimit: 1, peakRealm: R.supreme }, shop(1500),
    'Lets the body become whatever the cultivator needs.\n\n-# Gives 5 flexible points (any stat, including Qi). Made for **Supreme Peak**. Max 1 per month.'),
  // Realm Breakthrough
  P('wp-moon-elixir', 'Mid-Autumn Moon Elixir', 'Heavenly', '🌕', { breakthroughBonus: 2, impurity: 15, monthlyLimit: 1 }, { ...shop(300), scriptId: 'wp-moon-phase' },
    'Sealed under the harvest moon with moon dew.\n\n**Gimmick:** +2% Realm Breakthrough — **+6% in Autumn**. Max 1 per month.'),
  P('wp-bodhi-seed-incense', 'Bodhi Seed Incense', 'Heavenly', '🪷', { breakthroughBonus: 4, keepOnFail: 100, monthlyLimit: 1, peakRealm: R.master }, { ...shop(650), scriptId: 'wp-bodhi-seed' },
    'Burned before seclusion by Shaolin elders.\n\n**Gimmick:** +4% Realm Breakthrough, **kept if the attempt fails** — but only works with a calm mind: **wasted at 25+ Impurity**. No impurity. Max 1 per month.'),
  P('wp-peak-opening-pill', 'Peak-Opening Pill', 'Heavenly', '⛰️', { breakthroughBonus: 6, impurity: 25, monthlyLimit: 1, peakRealm: R.peak }, shop(1600),
    'Pries open the last gate of the Peak.\n\n-# +6% Realm Breakthrough. Made for **Peak** → Supreme Peak. Max 1 per month.'),
  P('wp-heavenly-gate-elixir', 'Heavenly Gate Elixir', 'Immortal', '⛩️', { breakthroughBonus: 7, impurity: 30, monthlyLimit: 1, peakRealm: R.supreme }, shop(3200, null, 2),
    'Brewed once a generation for a sect master standing at the edge of Transcendence.\n\n-# +7% Realm Breakthrough. Made for **Supreme Peak** → Transcendent. Max 1 per month.'),
  // Impurity
  P('wp-pine-needle-tea', 'Pine Needle Tea', 'Earthly', '🍵', { impurity: -3, monthlyLimit: 4 }, { ...shop(35), ...eco('tea', 0.5) },
    'Bitter tea of pine needles and resin. A little cleaner each cup.\n\n-# −3 Impurity. Max 4 per month. Its price follows the local price of tea.'),
  P('wp-medicine-bath', 'Medicinal Bath Herbs', 'Earthly', '🛁', { impurity: -8, monthlyLimit: 2 }, { ...shop(90), ...eco('medicine', 0.6) },
    'A bundle of herbs for an hour-long medicinal bath.\n\n-# −8 Impurity. Max 2 per month. Cheaper where medicine is plentiful.'),
  P('wp-lotus-heart-decoction', 'Lotus Heart Decoction', 'Heavenly', '🪷', { impurity: -20, monthlyLimit: 2 }, { ...shop(260), ...eco('medicine', 0.3) },
    'Lotus hearts simmered for a day and a night.\n\n-# −20 Impurity. Max 2 per month.'),
  P('wp-snow-mountain-water', 'Snow Mountain Ice Water', 'Heavenly', '🏔️', { impurity: -45, monthlyLimit: 1, peakRealm: R.peak }, { ...shop(650), scriptId: 'wp-snow-water' },
    'Meltwater from the Kunlun glaciers, carried down in sealed jade.\n\n**Gimmick:** removes **45 Impurity**, but **4 Qi** freezes away with it. Max 1 per month.'),
];

// ---------- poisons & antidotes ----------
const C = (id, name, rarity, emoji, type, fields, extra, useEffect, description) => ({ ...base, id, name, rarity, type, emoji, consumable: true, useEffect, ...fields, ...extra, description });
const poison = (tier, element, impurity, debuff, gimmick, activation) => ({ poison: { tier, element, impurity, debuff, gimmick, activation, repeatable: false, triggersBurst: false } });
const antidote = (tier, element, gimmick = '') => ({ purification: { tier, element, gimmick } });
const poisons = [
  C('wp-drunken-immortal-powder', 'Drunken Immortal Powder', 'Earthly', '🍶', 'poison', poison(1, 'Water', 10, '+10 Impurity. If the target has 20+ Impurity: −5 Qi, −1 Qi Bar.', 'Wine-heavy limbs: the target\'s Mobility counts one tier lower for 1 turn.', 'Dissolved in wine or tea. Tasteless in strong liquor.'), shop(80),
    'Drunken Immortal Powder was slipped into the drink.', 'A tasteless powder sold under the counter in rowdy inns.'),
  C('wp-centipede-ash', 'Centipede Ash', 'Earthly', '🐛', 'poison', poison(1, 'Earth', 10, '+10 Impurity on hit. If the target has 20+ Impurity: −5 Qi, −1 Qi Bar.', 'The wound swells: T4 (Light) damage on the hit area, repeating over 2 turns.', 'Rubbed onto blades or hidden weapons; enters through broken skin.'), shop(100),
    'Weapon dusted with Centipede Ash.', 'Ash of burned giant centipedes, black and gritty.'),
  C('wp-silver-needle-toxin', 'Silver Needle Toxin', 'Earthly', '🪡', 'poison', poison(1, 'Metal', 10, '+10 Impurity on hit. If the target has 20+ Impurity: −5 Qi, −1 Qi Bar.', 'Hard to notice: the target only realises they were poisoned at the end of the next turn (unless they are Expert or above).', 'Coats hidden needles. One dose coats three needles.'), shop(110),
    'Needles coated with Silver Needle Toxin.', 'A clear oil favoured by assassins because it does not tarnish silver.'),
  C('wp-seven-step-venom', 'Seven-Step Snake Venom', 'Heavenly', '🐍', 'poison', poison(2, 'Wood', 30, '+30 Impurity on hit. If the target has 20+ Impurity: −20 Qi, −2 Qi Bars, −5 Endurance.', 'Seven steps: if the target uses a movement technique while poisoned, the venom reaches the heart — +10 more Impurity.', 'Coats a blade; enters through broken skin.'), shop(480),
    'Weapon coated with Seven-Step Snake Venom.', 'From the snake whose bite, they say, lets you walk seven steps.'),
  C('wp-corpse-flower-gu', 'Corpse Flower Gu', 'Heavenly', '🥀', 'poison', poison(2, 'Earth', 30, '+30 Impurity. If the target has 20+ Impurity: −20 Qi, −2 Qi Bars, −5 Strength.', 'Dormant: it sleeps until the target spends Qi Bars, then wakes and eats one more Qi Bar.', 'Swallowed in food or drink. Southern gu masters\' work.'), shop(520),
    'A Corpse Flower Gu was hidden in the meal.', 'A tiny larva sealed in wax. The Hao Sect denies it ever sold one.'),
  C('wp-heart-eroding-pill', 'Heart-Eroding Pill', 'Immortal', '🖤', 'poison', poison(3, 'Fire', 50, '+50 Impurity, applied over three days (+17 a day). If the target has 20+ Impurity: −50 Qi, −4 Qi Bars, −10 Mobility and −10 Endurance.', 'Slow poison: no symptoms for a day, so the victim rarely knows who gave it.', 'Disguised as an ordinary pill or sweet.'), noShop,
    'A Heart-Eroding Pill was given to the victim.', 'Looks exactly like a medicinal pill. That is the point.'),
];
const antidotes = [
  C('wp-golden-needle-antidote', 'Golden Needle Antidote', 'Earthly', '💛', 'purification', antidote(1, 'Metal'), { ...shop(70), ...eco('medicine', 0.4) },
    'T1 Metal purification: halves a T1 poison and removes its gimmick; halves a T2 poison\'s numbers. Useless against Fire, weaker against Earth.', 'Acupuncture needles dipped in a bitter tincture.'),
  C('wp-red-ember-antidote', 'Red Ember Antidote', 'Earthly', '❤️', 'purification', antidote(1, 'Fire'), { ...shop(70), ...eco('medicine', 0.4) },
    'T1 Fire purification: halves a T1 poison and removes its gimmick; halves a T2 poison\'s numbers. Useless against Water, weaker against Wood.', 'Phoenix tail fern charred over embers.'),
  C('wp-black-water-antidote', 'Black Water Antidote', 'Earthly', '🖤', 'purification', antidote(1, 'Water'), { ...shop(70), ...eco('medicine', 0.4) },
    'T1 Water purification: halves a T1 poison and removes its gimmick; halves a T2 poison\'s numbers. Useless against Earth, weaker against Metal.', 'A dark decoction that tastes of river mud.'),
  C('wp-jade-dew-antidote', 'Jade Dew Antidote', 'Heavenly', '💚', 'purification', antidote(2, 'Wood', 'Also halves any poison\'s gimmick duration, even ones it can\'t cure.'), { ...shop(320), ...eco('medicine', 0.3) },
    'T2 Wood purification: removes T1 poisons, halves T2 and removes its gimmick, halves T3. Useless against Metal, weaker against Fire.', 'Dew collected in a jade bowl, steeped with five herbs.'),
  C('wp-snow-lotus-antidote', 'Snow Lotus Antidote', 'Heavenly', '🤍', 'purification', antidote(2, 'Water', 'Cools the blood: the user loses 3 Impurity even if there was no poison.'), { ...shop(320), ...eco('medicine', 0.3) },
    'T2 Water purification: removes T1 poisons, halves T2 and removes its gimmick, halves T3. Useless against Earth, weaker against Metal.', 'A sliver of snow lotus in cold spring water.'),
  C('wp-hundred-poisons-elixir', 'Hundred Poisons Elixir', 'Immortal', '🧪', 'purification', antidote(3, 'Earth', 'Works on any element at one tier lower if its own element is weak against it.'), shop(1200, null, 3),
    'T3 Earth purification: removes T1 and T2 poisons, halves T3 and removes its gimmick. Weaker against Wood.', 'The Tang Clan\'s answer to its own poisons. They sell very few.'),
];

// ---------- recipes (many use trade goods bought at regional markets) ----------
const g = (id) => `good-${id}`;
const rc = (name, description, inputs, output, nyangCost, successChance, minRealm = 0) => ({ name, description, inputs: inputs.map(([itemId, qty]) => ({ itemId, qty })), outputs: [{ itemId: output, qty: 1 }], nyangCost, successChance, consumeOnFail: true, minRealm, enabled: true });
const recipes = [
  rc('Hundred Grains Pill', 'Press grain and herbs into a pill.', [[g('grain'), 8], [g('herbs'), 1]], 'wp-hundred-grains-pill', 0, 95),
  rc('Morning Pine Pill', 'Pine resin and spirit grass at dawn.', [['wp-old-pine-resin', 2], ['pack-spirit-grass', 2]], 'wp-morning-pine-pill', 20, 90, 1),
  rc('Red Cinnabar Pill', 'Fire cinnabar nine times.', [[g('cinnabar'), 2], [g('herbs'), 3]], 'wp-red-cinnabar-pill', 40, 75, 2),
  rc('Snow Lotus Pill', 'A snow lotus heart in spirit herbs.', [['wp-snow-lotus', 1], [g('spiritherbs'), 2]], 'wp-snow-lotus-pill', 60, 80, 3),
  rc('Thousand-Year Ginseng Pill', 'Refine a whole root.', [['pack-thousand-year-ginseng', 1], [g('elixirs'), 1], [g('spiritherbs'), 2]], 'wp-ginseng-pill', 100, 70, 4),
  rc('Purple Ganoderma Elixir', 'Lingzhi steeped in elixir stock.', [['wp-purple-lingzhi', 1], [g('elixirs'), 1]], 'wp-purple-ganoderma-elixir', 80, 75, 3),
  rc('Nine-Turn Golden Pill', 'Forty-nine days at the furnace.', [[g('elixirs'), 3], [g('cinnabar'), 2], ['pack-thousand-year-ginseng', 1], ['wp-snow-lotus', 1]], 'wp-nine-turn-golden-pill', 400, 55, 5),
  rc('Mid-Autumn Moon Elixir', 'Seal moon dew in jade.', [['wp-moon-dew', 1], [g('jade'), 1]], 'wp-moon-elixir', 30, 85, 2),
  rc('Pine Needle Tea', 'Brew pine needles with tea.', [[g('tea'), 1], ['wp-old-pine-resin', 1]], 'wp-pine-needle-tea', 0, 100),
  rc('Medicinal Bath Herbs', 'Bundle medicine for a bath.', [[g('medicine'), 2]], 'wp-medicine-bath', 10, 95),
  rc('Lotus Heart Decoction', 'Simmer for a day and a night.', [[g('medicine'), 3], ['wp-snow-lotus', 1]], 'wp-lotus-heart-decoction', 40, 85, 2),
  rc('Golden Needle Antidote', 'Dip needles in tincture.', [[g('herbs'), 2], [g('iron'), 1]], 'wp-golden-needle-antidote', 10, 100),
  rc('Red Ember Antidote', 'Char the fern over embers.', [['wp-phoenix-tail-fern', 2], [g('herbs'), 1]], 'wp-red-ember-antidote', 10, 100),
  rc('Black Water Antidote', 'A dark decoction.', [[g('herbs'), 2], [g('salt'), 1]], 'wp-black-water-antidote', 10, 100),
  rc('Green Antidote (from herbs)', 'The market way: buy herbs, skip the spirit grass.', [[g('herbs'), 3]], 'pack-green-antidote-pill', 0, 100),
  rc('Hundred Poisons Elixir', 'The Tang Clan recipe, more or less.', [[g('medicine'), 4], [g('spiritherbs'), 2], ['wp-snow-lotus', 1], ['wp-purple-lingzhi', 1]], 'wp-hundred-poisons-elixir', 200, 65, 4),
];

const items = [...goods, ...materials, ...pills, ...poisons, ...antidotes];
const pack = { format: 'jianghu-items', version: 1, exportedAt: new Date().toISOString(), note: `World expansion: ${goods.length} trade goods, ${materials.length} materials, ${pills.length} pills/elixirs/teas, ${poisons.length} poisons, ${antidotes.length} antidotes (2nd Rate to Transcendent) + ${recipes.length} recipes. Import from Dashboard → Items → Import. Recipes that use Spirit Grass / Thousand-Year Ginseng / Green Antidote need the first pack.`, items, arts: [], scripts, recipes };
fs.writeFileSync(process.argv[2] || 'examples/item-pack-world-expansion.json', JSON.stringify(pack, null, 2));
console.log(items.length, 'items,', scripts.length, 'scripts,', recipes.length, 'recipes');
