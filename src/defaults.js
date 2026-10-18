'use strict';
/**
 * Default data for a fresh install. Everything here can be edited from the dashboard afterwards.
 */
const { newId, num, numOrNull, arr, slug } = require('./utils');

const ITEM_TYPES = ['manual', 'pill', 'poison', 'purification', 'material', 'weapon', 'treasure', 'misc'];
// Martial arts, cultivation methods and qi cores live in their own library (state.arts), not as items.
const ART_KINDS = ['core', 'special', 'forbidden', 'generic', 'cultivation', 'qicore'];
const ART_KIND_LABEL = { core: 'Core martial art', special: 'Special martial art', forbidden: 'Forbidden/Heavenly martial art', generic: 'Generic martial art', cultivation: 'Cultivation method', qicore: 'Qi Core' };
const MANUAL_CATEGORIES = ['generic', 'core', 'special', 'forbidden'];
const YIELD_TYPES = ['none', 'qi', 'strength', 'endurance', 'mobility', 'points', 'flex'];
const ELEMENTS = ['Wood', 'Fire', 'Earth', 'Metal', 'Water', 'Yin', 'Yang'];
const WEAPON_GRADES = ['Default', 'Spiritual Treasure', 'Dharma Treasure', 'Numinous Treasure', 'Immortal Treasure'];
const BONUS_KEYS = ['strength', 'endurance', 'mobility', 'qi', 'qiBars'];
const DEFAULT_WEAPON_ID = 'default-weapon';
const DEFAULT_WEAPON_DESCRIPTION = 'This is a default weapon. Having this as the main weapon likely means the character is using something simple, like a normal sword, maybe a pair of them, _or whatever._ Sometimes, not even a weapon at all. No need for a specific description on what they use here.';

// name, qiBars, required stats/qi to ENTER, soft cap stats/qi, hard cap stats/qi, breakthrough chance (to the NEXT realm)
const R = (name, qiBars, reqStats, reqQi, softCapStats, softCapQi, hardCapStats, hardCapQi, breakthroughChance) => ({
  name, qiBars, reqStats, reqQi, softCapStats, softCapQi, hardCapStats, hardCapQi, breakthroughChance,
});
const REALMS = [
  R('3rd Rate', 2, 0, 0, 70, 30, 80, 40, 100),
  R('2nd Rate', 2.5, 70, 30, 100, 40, 110, 55, 95),
  R('1st Rate', 3, 100, 40, 150, 65, 165, 80, 85),
  R('Expert', 3.5, 150, 65, 195, 90, 215, 105, 75),
  R('Master', 4, 195, 90, 245, 100, 270, 125, 65),
  R('Peak', 4.5, 245, 100, 325, 170, 355, 190, 55),
  R('Supreme Peak', 5, 325, 170, 400, 225, 440, 260, 45),
  R('Transcendent', 5.5, 400, 225, 480, 325, 525, 355, 35),
  R('Unrestrained', 6, 480, 325, 555, 400, 610, 440, 25),
  R('Enlightened', 6.5, 555, 400, 600, 510, 660, 545, 18),
  R('Celestial', 7, 600, 510, 700, 575, 770, 630, 12),
  R('Life and Death', 7.5, 700, 575, null, null, null, null, 0),
];

const RARITIES = [
  { name: 'Earthly', chance: 75, color: '#5fae5b', emoji: '🟩' },
  { name: 'Heavenly', chance: 20, color: '#4f8fe0', emoji: '🟦' },
  { name: 'Immortal', chance: 5, color: '#e0a526', emoji: '🟨' },
];

const S = (name, alignment, titleName, description, playable = true, rarityBonus = {}) => ({
  id: slug(name), name, alignment, titleName, description, playable, roleId: '', rarityBonus, coreArtId: name === 'Mount Hua Sect' ? 'plum-blossom-sword' : '', joinNyang: 0,
});
const SECTS = [
  S('Wudang Sect', 'Orthodox', 'Wudang', 'The most "benevolent" sect, but everything is black and white (Yin/Yang). Welcoming to allies they deem good, merciless to those they deem evil.'),
  S('Shaolin Sect', 'Orthodox', 'Shaolin', 'Very traditional and against most change in the Jianghu. Never uses sharp weapons, strongly against killing. Cannot marry, except by rare exception.'),
  S('Mount Hua Sect', 'Orthodox', 'Mount Hua', 'Classy and obsessed with appearances. They consider themselves Taoists like Wudang, though for most members it is only theory.'),
  S('Beggar Sect', 'Orthodox', 'Beggar Sect', 'An information sect, not specialized in martial arts. Members are assigned by staff; what happens around them can be made public.', false),
  S('Jaegal Clan', 'Orthodox', 'Jaegal', 'Strategists. Lowered stats.'),
  S('Tang Clan', 'Orthodox', 'Tang', 'Poison users. Isolationist and distrustful, but not evil.'),
  S('Peng Clan', 'Orthodox', 'Peng', 'Bulky characters: weak Qi but strong physicals.'),
  S('Namgoong Clan', 'Orthodox', 'Namgoong', 'Super rich.'),
  S('Moyong Clan', 'Orthodox', 'Moyong', 'Destroyed in the war against the Demon Cult. Distant descendants may live, but are no longer clan members.', false),
  S('The 72 Strongholds', 'Unorthodox', 'Stronghold', 'Bandits. Higher drop rate.', true, { Earthly: -5, Heavenly: 4, Immortal: 1 }),
  S('Ice Palace', 'Unorthodox', 'Ice Palace', 'North. Ice users.'),
  S('Sun Palace', 'Unorthodox', 'Sun Palace', 'East. Fire users.'),
  S('Sword Palace', 'Unorthodox', 'Sword Palace', 'West. Sword users, super strong.'),
  S('Beast Palace', 'Unorthodox', 'Beast Palace', 'South. Start with Elemental Qi.'),
  S('Hao Sect', 'Unorthodox', 'Hao', 'The Ignoble Clan. Assassination and poison users; the reason Unorthodox characters can hear Beggar Sect information.'),
  S('Blood Cult', 'Unorthodox', 'Blood Cult', 'Descendants of the Demon Cult, taken over by the exiles of a Succession War.'),
  S('Demon Cult', 'Unorthodox', 'Demon Cult', 'Extinct. Once the "Divine Demon Cult", corrupted by forbidden Qi and exterminated by the entire Jianghu.', false),
];

const TITLES = {
  prefixes: ['Heavenly', 'Demonic', 'Absolute', 'Peerless', 'Primordial', 'Heaven Defying', 'Bloody', 'Sovereign', 'Chaos', 'Divine', 'Celestial', 'Abyssal', 'Radiant', 'Venerable', 'Myriad', 'Calamitous', 'Limitless', 'Supreme', 'Eternal', 'Void'],
  stems: ['Rising', 'Hidden', 'Roaring', 'Drunken', 'Murder', 'Unbroken', 'Piercing', 'Soaring', 'Raging', 'Silent', 'Thousand-Faced', 'Everlasting', 'Severing', 'Freezing', 'Blazing', 'Mad', 'Sword', 'Drifting', 'Vengeful', 'Serene'],
  suffixes: ['Dragon', 'Phoenix', 'Taoist', 'Blade', 'Asura', 'Monarch', 'Fist', 'God', 'Tiger', 'Viper', 'Demon', 'Immortal', 'Sage', 'Ghost', 'Crow', 'Tortoise', 'Saint', 'Wolf', 'Lotus', 'Devil'],
  notes: {
    Freezing: 'Female only, or ice/cold-based Core martial arts',
    Blazing: 'Male only, or fire/heat-based Core martial arts',
    Dragon: 'Male only',
    Phoenix: 'Female only',
  },
};

const SCRIPTS = [
  {
    id: 'three-hearts',
    name: 'Three Hearts Cultivation',
    description: 'Hearts of Essence / Energy / Spirit at 50 / 75 / 100 Impurity, Fake Heart Demon at 125+.',
    enabled: true,
    code: `// Three Hearts Cultivation Method
hooks.effects = (ctx, fx) => {
  const imp = ctx.character.impurity;
  if (imp >= 125) {
    fx.notes.push('👹 **Fake Heart Demon** — a false Heart Demon haunts you. All Three Hearts benefits are lost; you suffer every Impurity drawback.');
    return fx;
  }
  if (imp >= 50) {
    fx.yieldMultiplier = 1;
    fx.notes.push('💗 **Heart of Essence** — pill yields are NOT reduced. *(A light shines on the left side of the chest.)*');
  }
  if (imp >= 75) {
    fx.statMultiplier = 1;
    fx.tempStats.endurance += 3;
    fx.notes.push('💛 **Heart of Energy** — stats are NOT reduced; +3 temporary Endurance. *(A light shines on the right side of the chest.)*');
  }
  if (imp >= 100) {
    fx.preventMeridianBurst = true;
    fx.tempQiBars += 1;
    fx.notes.push('🤍 **Heart of Spirit** — meridians do NOT burst; +1 temporary Qi Bar. *(A light shines at the center of the chest.)*');
  }
  return fx;
};
`,
  },
  {
    id: 'no-meridians',
    name: 'No Meridians',
    description: '0 Qi Bars, but can learn virtually anything and use others\' External Qi.',
    enabled: true,
    code: `hooks.effects = (ctx, fx) => {
  fx.qiBarsOverride = 0;
  fx.notes.push('🕳️ **No Meridians** — 0 Qi Bars, but can learn virtually anything and wield others\\' External Qi.');
  return fx;
};
`,
  },
  {
    id: 'heavenly-martial-meridian',
    name: 'Heavenly Martial Meridian',
    description: '+4 Qi Bars, but Qi advances slowly due to overflow.',
    enabled: true,
    code: `// Change QI_GAIN_RATE to tune how slowly Qi grows (0.75 = 75% of every Qi gain).
const QI_GAIN_RATE = 0.75;

hooks.effects = (ctx, fx) => {
  fx.qiBarBonus += 4;
  fx.notes.push('🌌 **Heavenly Martial Meridian** — +4 Qi Bars; Qi gains are reduced by overflow.');
  return fx;
};

hooks.qiGain = (ctx, amount) => amount * QI_GAIN_RATE;
`,
  },
  {
    id: 'template',
    name: 'Template (copy me)',
    description: 'Shows every hook you can use. Not attached to anything.',
    enabled: true,
    code: `// Every hook is optional — delete the ones you do not need.
// Full reference: dashboard → Custom Code → "Custom code reference".
//
// ctx.character  -> { name, sect, gender, title, realm, realmIndex, stats{strength,endurance,mobility,qi},
//                     pools{normal,flex}, impurity, burstApplied, bonusQiBars, traits[], cultivationMethods[],
//                     qiCore, martialArts{core,special,forbidden,generic}, weapon{name,grade,bonuses}, inventory[], nyang }
// ctx.realm      -> the character's current realm row
// ctx.source     -> { type, name } of the item/trait this script is attached to
// ctx.thresholds -> impurity thresholds from Settings (yieldPenaltyAt, yieldPenaltyPercent, debuffAt, burstAt ...)
// ctx.extra      -> hook-specific info (ctx.extra.source for qiGain, ctx.extra.item for consume)

// 1) Sheet effects / impurity drawbacks.
hooks.effects = (ctx, fx) => {
  // fx.yieldMultiplier      pill yields: 1 = normal, 0.5 = -50% (Impurity 50+)
  // fx.statMultiplier       1 = normal, 0.75 = -25%
  // fx.preventMeridianBurst true stops the permanent 100-impurity burst
  // fx.tempStats.strength / endurance / mobility / qi   temporary bonuses
  // fx.tempQiBars           temporary Qi Bars
  // fx.qiBarBonus           permanent extra Qi Bars
  // fx.qiBarsOverride       a number forces Qi Bars to that value (null = off)
  // fx.notes.push('Text shown on the stat sheet');
  return fx;
};

// 2) How much Qi the character actually receives (from staff, points or pills).
hooks.qiGain = (ctx, amount) => amount;

// 3) Realm Breakthrough chance (0-100).
hooks.breakthroughChance = (ctx, chance) => chance;

// 4) Result of consuming a pill. ctx.extra.item is the pill.
// result = { yieldType, baseYield, rate, yieldAmount, baseImpurity, impurityReduction, impurity, breakthroughBonus, element, notes[] }
hooks.consume = (ctx, result) => result;
`,
  },
];

const TRAITS = [
  { id: 'nine-yin-body', name: 'Nine Yin Body', description: 'Ice Palace Heir. Extremely strong Yin arts.', scriptId: '' },
  { id: 'nine-yang-body', name: 'Nine Yang Body', description: 'Sun Palace Heir. Extremely strong Yang arts.', scriptId: '' },
  { id: 'no-meridians', name: 'No Meridians', description: '0 Qi Bars, but can learn virtually anything and use others\' External Qi.', scriptId: 'no-meridians' },
  { id: 'sword-sense', name: 'Sword Sense', description: 'Absolute Sword Sense. Senses weapons\' pasts and can replicate a master\'s arts.', scriptId: '' },
  { id: 'absolute-mimicry', name: 'Absolute Mimicry', description: 'Copy any martial art by seeing it. Limited copy slots.', scriptId: '' },
  { id: 'heavenly-martial-meridian', name: 'Heavenly Martial Meridian', description: 'Extremely high Qi Bars (+4 off-rip), but advances in Qi slowly due to overflow.', scriptId: 'heavenly-martial-meridian' },
  { id: 'mentor', name: 'Mentor', description: 'Teaches others how to use things.', scriptId: '' },
];

const THREE_HEARTS_DESCRIPTION = `- Upon reaching **\`50\` Impurity**, create the '__Heart of Essence.__'
  - __Does not reduce yields by 50%.__ _A light will be shown on the left side of your chest._
- Upon reaching **\`75\` Impurity**, create the '__Heart of Energy.__'
  - __Does not reduce stats by 25%.__ You are also granted temporary \`+3\` Endurance Points. _A light will be shown on the right side of your chest._
- Upon reaching **\`100\` Impurity**, create the '__Heart of Spirit.__'
  - __Does not reduce stats/Qi by 25% permanently.__ You are also granted temporary \`+1\` Qi Bar. _A light will be shown on the center of your chest._
- **[__!!!!__]** Upon reaching **\`125+\` Impurity**, experience '__Fake Heart Demon.__'
  - An entity similar to a 'Heart Demon' will haunt the inside of your head, leading you to a moment of madness that will remove all the positive effects of this cultivation method. **__You will receive all the drawbacks of Impurity.__**

**Absorption Rate**: 0%.
**Affinity**: _None._`;


// Stat-difference tables used by /compare. Rows are matched by "min" (the row with the highest min <= difference wins).
// reqRT = realm tiers the attacker / faster character must be above the other to reach this row.
const COMBAT = {
  damage: [
    { min: null, label: '-15 or lower', tier: 'T1', name: 'Nothing', reqRT: 0, desc: 'Nothing happens and the attack will bounce off and slightly hurt the attacker.' },
    { min: -14, label: '-14 to -6', tier: 'T2', name: 'Negligible', reqRT: 0, desc: 'Defender tanks the attack, leaving only the redness of the skin.' },
    { min: -5, label: '-5 to -1', tier: 'T3', name: 'Minor', reqRT: 0, desc: 'Attack leaves slight pain and a minor abrasion. It is like a kid punching a grown adult.' },
    { min: 0, label: '0 to 5', tier: 'T4', name: 'Light', reqRT: 0, desc: 'Clean hit that leaves a bruise or a shallow 1/4th of an inch cut on skin.' },
    { min: 6, label: '6 to 12', tier: 'T5', name: 'Normal', reqRT: 0, desc: 'Goes as far from 0.5 to 1 inch into the body or leaves a normal to large hematoma, depending on the attack\'s weight. It causes visible bleeding.' },
    { min: 13, label: '13 to 20', tier: 'T6', name: 'Moderate', reqRT: 0, desc: 'Slices deeply through the body, but not always close to the bone. For blunts, it cracks/fractures the bone, provided they aren\'t major ones.' },
    { min: 21, label: '21 to 30', tier: 'T7', name: 'Severe', reqRT: 1, desc: 'Causes deep lacerations or cleanly fractures or snaps major bones. A lot of trauma.' },
    { min: 31, label: '31 or higher', tier: 'T8', name: 'Lethal', reqRT: 2, desc: 'Smashes through bone or dismembers limbs. Anything at 42+ will essentially pulverize an opponent.' },
  ],
  damageNote: 'All results assume a hit to the TORSO (chest). Durable areas like forearms, thighs or biceps usually halve the damage.',
  clash: [
    { min: 0, label: '0-3', tier: '', name: 'Equal', reqRT: 0, desc: 'Both attacks come to a standstill. Nobody is pushed back.' },
    { min: 4, label: '4-8', tier: '', name: 'Pushback', reqRT: 0, desc: 'The loser is pushed back, but isn\'t hurt by the attack, though their limbs wielding the weapon of choice might feel weaker than before. Ranged (Qi Blasts): the rebounding shockwave affects the loser\'s whole body and leaves them momentarily shook and weakened, but not stunned.' },
    { min: 9, label: '9-16', tier: '', name: 'Deflection', reqRT: 0, desc: 'The loser\'s blade is likely knocked aside. It may create an opening, but it does not mean a free hit. Ranged: the shockwave freezes the loser up for a slight moment.' },
    { min: 17, label: '17-25', tier: '', name: 'Disarm', reqRT: 0, desc: 'The loser will certainly lose grip of their weapon; their hands hurt enough that wielding it properly again is difficult if not impossible. Ranged: the shockwave practically stuns them, giving a great opening.' },
    { min: 26, label: '26+', tier: '', name: 'Overwhelmed', reqRT: 0, desc: 'The loser\'s weapon is virtually ignored and loses all its power, as if the loser had done nothing at all. Ranged: the winner\'s Qi Blast pushes through as if nothing was there.' },
  ],
  clashNote: 'Clash is mainly for Skills clashing. Attacks without skills may only use it as a last resort or a yardstick.',
  mobility: [
    { min: 0, label: '0-3', tier: 'T1', name: 'Equal', reqRT: 0, desc: 'Virtually anything can be reacted to under normal circumstances.' },
    { min: 4, label: '4-8', tier: 'T2', name: 'Slight', reqRT: 0, desc: 'Faster character has a slight advantage, with a tiny edge in reaction time.' },
    { min: 9, label: '9-15', tier: 'T3', name: 'Advantageous', reqRT: 0, desc: 'Fast attacks from the faster character may feel like blurs, but the defender can still react if they have a rough idea of what is coming their way.' },
    { min: 16, label: '16-24', tier: 'T4', name: 'Very Advantageous', reqRT: 0, desc: 'Faster character is consistently a blur, where prediction is hardly effective, being essentially twice as fast as the enemy.' },
    { min: 25, label: '25-35', tier: 'T5', name: 'Extremely Advantageous', reqRT: 1, desc: 'Slower character is basically blind to movement. It\'s virtually impossible to block anything unless there already was a defense before the attack started.' },
    { min: 36, label: '36+', tier: 'T6', name: 'Blitz', reqRT: 2, desc: 'The slower character can\'t react at all. Movements are practically teleportation.' },
  ],
};

// Extra Qi Bars from the amount of Qi a character has (on top of the realm's Qi Bars).
const QI_BAR_BONUSES = [
  { minQi: 26, bars: 1 },
  { minQi: 101, bars: 2 },
  { minQi: 201, bars: 3 },
  { minQi: 351, bars: 4 },
  { minQi: 551, bars: 5 },
  { minQi: 751, bars: 6 },
];

function normalizeArt(a = {}) {
  const kind = ART_KINDS.includes(a.kind) ? a.kind : 'generic';
  return {
    id: a.id || slug(a.name || newId('art-')),
    name: String(a.name || 'Unnamed art').trim(),
    kind,
    description: a.description || '',
    // martial arts
    replacesCore: !!a.replacesCore,
    shareable: !!a.shareable,
    shareLimit: Math.max(0, Math.floor(num(a.shareLimit))),
    // cultivation methods & qi cores
    baseAbsorption: kind === 'cultivation' ? Math.max(0, num(a.baseAbsorption, 100)) : null,
    absorption: num(a.absorption),
    affinities: Object.fromEntries(Object.entries(a.affinities || {}).map(([k, v]) => [k, num(v)]).filter(([, v]) => v !== 0)),
    impurityReduction: num(a.impurityReduction),
    scriptId: a.scriptId || '',
  };
}

const QI_GATHERING_DESCRIPTION = 'The most basic cultivation method in the Jianghu. It gathers ambient Qi, but wastes much of it.\n\n**Absorption Rate**: 50% — only half of a pill\'s yield is absorbed.\n**Affinity**: _None._';

const ARTS = [
  { id: 'qi-gathering', name: 'Qi Gathering', kind: 'cultivation', baseAbsorption: 50, description: QI_GATHERING_DESCRIPTION },
  { id: 'normal-qi-core', name: 'Normal Qi Core', kind: 'qicore', description: 'An ordinary Qi Core with no special properties.' },
  { id: 'plum-blossom-sword', name: 'Plum Blossom Sword', kind: 'core', description: 'Mount Hua\'s sword style, known for fluid and precise attacks.' },
];

const DEFAULT_SETTINGS = {
  currencyName: 'Nyang',
  currencyEmoji: '🪙',
  startingFlexPoints: 50,
  startingNyang: 0,
  startingRolls: 0,
  defaultCultivationMethods: ['Qi Gathering'],
  defaultQiCore: 'Normal Qi Core',
  maxSingleStatPercent: 50,
  allocationWindowMinutes: 5,
  maxItems: 300,
  maxCharactersPerUser: 1,
  softCapGainMultiplier: 0.5,
  discardPointsPastHardCap: true,
  breakthroughCooldownHours: 0,
  breakthroughFailureImpurity: 0,
  maxBreakthroughBonus: 20,
  // Item rating weights (dashboard → Items → Quick edit & ratings). "PP" = power points.
  rating: { qi: 4, stat: 1, points: 1, flex: 1.5, breakthrough: 2, impurity: 0.15, referenceAbsorption: 100, maxUses: 10 },
  impurity: { yieldPenaltyAt: 50, yieldPenaltyPercent: 50, debuffAt: 75, debuffPercent: 25, burstAt: 100, burstPercent: 25 },
  monthlyImpurityReset: true,
  staffQiResetsImpurity: true,
  pillQiResetsImpurity: false,
  maxCultivationMethods: 2,
  martialArtLimits: { generic: 3, core: 1, special: 1, forbidden: 1 },
  elements: ELEMENTS,
  channels: { submissions: '', progress: '', announcements: '', log: '', consumption: '', world: '', diplomacy: '', war: '' },
  staffRoleIds: [],
  approvedRoleIds: [],
  shopSellbackPercent: 50,
  marketFeePercent: 0,
  tradeExpiryMinutes: 15,
  autoBackupHours: 24,
  maxBackups: 30,
  maxChangelog: 5000,
  titles: TITLES,
  qiBarBonuses: QI_BAR_BONUSES,
  defaultWeaponId: DEFAULT_WEAPON_ID,
  ui: { emojis: {}, buttons: {} },
  menuPublicByDefault: false,
  announceRolls: true,
  announceCrafting: true,
  announceBreakthroughs: true,
};

function normalizeItem(i = {}) {
  const now = new Date().toISOString();
  return {
    id: i.id || newId('it-'),
    name: String(i.name || 'Unnamed item').trim(),
    rarity: i.rarity || 'Earthly',
    type: ITEM_TYPES.includes(i.type) ? i.type : 'misc',
    emoji: i.emoji || '',
    description: i.description || '',
    tradeable: i.tradeable !== false,
    marketable: i.marketable !== false,
    consumable: typeof i.consumable === 'boolean' ? i.consumable : ['poison', 'purification'].includes(i.type),
    useEffect: i.useEffect || '',
    inDropPool: i.inDropPool !== false,
    dropWeight: num(i.dropWeight, 1),
    shop: { enabled: false, price: 0, stock: -1, ...(i.shop || {}) },
    sellPrice: numOrNull(i.sellPrice),
    manual: { artId: i.manual?.artId || '' },
    weapon: { grade: WEAPON_GRADES.includes(i.weapon?.grade) ? i.weapon.grade : 'Default' },
    bonuses: Object.fromEntries(BONUS_KEYS.map((k) => [k, num(i.bonuses?.[k])])),
    pill: { yieldType: 'none', yieldAmount: 0, impurity: 0, element: '', breakthroughBonus: 0, keepOnFail: 0, tolerance: 0, monthlyLimit: 0, peakRealm: null, realmFalloff: 50, ...(i.pill || {}) },
    poison: { tier: 1, element: '', impurity: 10, debuff: '', gimmick: '', activation: '', repeatable: false, triggersBurst: false, ...(i.poison || {}) },
    purification: { tier: 1, element: '', gimmick: '', ...(i.purification || {}) },
    scriptId: i.scriptId || '',
    // World economy: tradeGood links the item to a regional trade good (bought/sold in /world markets);
    // economy.good + sensitivity lets the good's average price across the realm move this item's shop price (bounded in World settings).
    tradeGood: i.tradeGood || '',
    economy: { good: i.economy?.good || '', sensitivity: Math.max(0, Math.min(1, num(i.economy?.sensitivity))) },
    createdAt: i.createdAt || now,
    updatedAt: i.updatedAt || now,
  };
}

function normalizeRecipe(r = {}) {
  const rows = (v) => arr(v).map((x) => ({ itemId: String(x.itemId || ''), qty: Math.max(1, Math.floor(num(x.qty, 1))) })).filter((x) => x.itemId);
  return {
    id: r.id || newId('rc-'),
    name: String(r.name || 'Unnamed recipe').trim(),
    description: r.description || '',
    inputs: rows(r.inputs),
    outputs: rows(r.outputs),
    nyangCost: Math.max(0, num(r.nyangCost)),
    successChance: Math.max(0, Math.min(100, num(r.successChance, 100))),
    consumeOnFail: r.consumeOnFail !== false,
    minRealm: Math.max(0, Math.floor(num(r.minRealm))),
    enabled: r.enabled !== false,
  };
}

/** Old saves stored titles as prefix/stem/suffix. */
function legacyTitle(t) {
  if (!t || typeof t !== 'object') return '';
  return [t.prefix, t.stem, t.suffix].filter(Boolean).join(' ');
}

function normalizeCharacter(c = {}) {
  return {
    id: c.id || newId('ch-'),
    ownerId: String(c.ownerId || ''),
    ownerTag: c.ownerTag || '',
    name: String(c.name || 'Unnamed').trim(),
    sect: c.sect || '',
    gender: c.gender || '',
    title: typeof c.title === 'string' ? c.title : legacyTitle(c.titles),
    weaponId: c.weaponId || '',
    joinedSects: arr(c.joinedSects),
    realm: Number.isInteger(c.realm) ? c.realm : 0,
    stats: { strength: 0, endurance: 0, mobility: 0, qi: 0, ...(c.stats || {}) },
    pools: { normal: 0, flex: 0, ...(c.pools || {}) },
    bonusQiBars: num(c.bonusQiBars),
    impurity: num(c.impurity),
    burstApplied: !!c.burstApplied,
    breakthroughBonus: num(c.breakthroughBonus),
    breakthroughPills: arr(c.breakthroughPills),
    pillUses: c.pillUses && typeof c.pillUses === 'object' ? c.pillUses : {},
    pillUsesMonth: c.pillUsesMonth || '',
    lastBreakthroughAt: c.lastBreakthroughAt || null,
    traits: arr(c.traits),
    cultivationMethods: arr(c.cultivationMethods),
    qiCore: c.qiCore || null,
    martialArts: { core: [], special: [], forbidden: [], generic: [], ...(c.martialArts || {}) },
    inventory: c.inventory && typeof c.inventory === 'object' ? c.inventory : {},
    nyang: num(c.nyang),
    rolls: num(c.rolls),
    docLink: c.docLink || '',
    status: c.status || 'active',
    notes: c.notes || '',
    approvedBy: c.approvedBy || null,
    approvedAt: c.approvedAt || null,
    // World: the region the player last posted in (only picks what /world shows first), marriage and sworn bonds.
    location: c.location || '',
    spouseId: c.spouseId || '',
    bonds: arr(c.bonds),
    createdAt: c.createdAt || new Date().toISOString(),
  };
}

function defaultWeaponItem() {
  return normalizeItem({
    id: DEFAULT_WEAPON_ID,
    name: 'Default Weapon',
    rarity: 'Earthly',
    type: 'weapon',
    emoji: '🗡️',
    description: DEFAULT_WEAPON_DESCRIPTION,
    tradeable: false,
    marketable: false,
    inDropPool: false,
    weapon: { grade: 'Default' },
  });
}

function createDefaultState() {
  const month = new Date().toISOString().slice(0, 7);
  return {
    version: 2,
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    rarities: JSON.parse(JSON.stringify(RARITIES)),
    realms: JSON.parse(JSON.stringify(REALMS)),
    sects: JSON.parse(JSON.stringify(SECTS)),
    traits: JSON.parse(JSON.stringify(TRAITS)),
    scripts: JSON.parse(JSON.stringify(SCRIPTS)),
    items: [defaultWeaponItem()],
    arts: [
      ...ARTS,
      { id: 'three-hearts-cultivation', name: 'Three Hearts Cultivation Method', kind: 'cultivation', description: THREE_HEARTS_DESCRIPTION, scriptId: 'three-hearts' },
    ].map(normalizeArt),
    characters: [],
    recipes: [],
    combat: JSON.parse(JSON.stringify(COMBAT)),
    templates: {},
    commandAccess: {},
    users: {},
    applications: [],
    progress: [],
    trades: [],
    market: [],
    changelog: [],
    dashboardUsers: [],
    meta: { createdAt: new Date().toISOString(), lastImpurityResetMonth: month, lastAutoBackupAt: null },
  };
}

module.exports = {
  ART_KINDS, ART_KIND_LABEL, normalizeArt, THREE_HEARTS_DESCRIPTION, ITEM_TYPES, MANUAL_CATEGORIES, YIELD_TYPES, ELEMENTS, REALMS, RARITIES, SECTS, TITLES, TRAITS, SCRIPTS,
  WEAPON_GRADES, BONUS_KEYS, DEFAULT_WEAPON_ID, defaultWeaponItem, DEFAULT_SETTINGS, COMBAT, QI_BAR_BONUSES, normalizeItem, normalizeCharacter, normalizeRecipe, createDefaultState,
};
