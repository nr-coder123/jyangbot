'use strict';
/**
 * Default world content: goods, workshops, terrain, province economies, factions, events, policies,
 * diplomacy actions, treaty types, troops, formations and tactics. Everything here can be edited
 * in the dashboard; these are only starting values.
 *
 * ── Effect blocks ─────────────────────────────────────────────────────────────────────────────
 * Events, policies and treaties all use the same "effects" block, applied every turn to each region
 * they touch (numbers are per turn unless noted):
 *   prosperity, security, unrest, corruption      + / − points
 *   population                                    % change
 *   production / demand / price                   { goodId | category | "*": multiplier }
 *   stockLoss                                     { goodId | category | "*": fraction of stock lost }
 *   caravanRisk                                   + chance per hop that a caravan is raided (0.1 = +10%)
 *   income                                        × household spending that fills the market coffers
 *   tax                                           × taxes the controlling faction collects
 *   tariff                                        + % charged on player trades in the region
 *   coffers                                       + / − Nyang in the market coffers
 *   supply, attrition                             army supply points / % of men lost (armies standing there)
 *   recruitCost                                   × recruitment cost
 *   treasury, influence                           + / − to the controlling faction (or the adopting faction)
 *   relation                                      drift with every other faction (policies)
 * "onStart" uses the same keys once, when the event begins (stock = fraction change, e.g. {grain: -0.4}).
 */

// ─────────────────────────── Goods ───────────────────────────
// perPop: units each population point consumes per turn. lux: demand grows with prosperity.
// elasticity: how hard prices react to shortages. perish: share of stock that spoils per turn.
const G = (id, name, emoji, category, basePrice, perPop, o = {}) => ({
  id, name, emoji, category, basePrice, perPop,
  elasticity: o.e ?? ({ food: 0.85, staple: 0.65, raw: 0.55, refined: 0.55, luxury: 0.5, military: 0.6, medicine: 0.7, rare: 0.45 }[category] ?? 0.6),
  lux: o.lux ?? (category === 'luxury' ? 1 : 0),
  perish: o.perish ?? 0.01,
  weight: o.weight ?? 1,
  winterDemand: o.winter ?? 1,
  seasonal: o.seasonal ?? null,
  itemId: o.itemId ?? `good-${id}`,
  description: o.description ?? '',
});
const GOODS = [
  G('grain', 'Grain', '🌾', 'food', 4, 1.0, { perish: 0.01, seasonal: [0.7, 1.0, 1.6, 0.7], description: 'Rice, wheat and millet. Everyone eats; shortages starve regions.' }),
  G('meat', 'Meat & Fish', '🐟', 'food', 9, 0.15, { perish: 0.03, description: 'Livestock from the steppe, fish from the lakes and coast.' }),
  G('salt', 'Salt', '🧂', 'staple', 10, 0.15, { perish: 0, description: 'Sea salt, well salt and lake salt. A state monopoly in most dynasties.' }),
  G('tea', 'Tea', '🍵', 'staple', 14, 0.1, { perish: 0.01, description: 'Pressed bricks and loose leaf. Traded for horses on the Tea-Horse Road.' }),
  G('cloth', 'Cotton & Hemp Cloth', '🧶', 'staple', 12, 0.12, { perish: 0, winter: 1.3 }),
  G('timber', 'Timber', '🪵', 'raw', 5, 0.15, { perish: 0, weight: 2 }),
  G('iron', 'Iron', '⛏️', 'raw', 9, 0.05, { perish: 0, weight: 2 }),
  G('herbs', 'Medicinal Herbs', '🌿', 'raw', 12, 0.03, { perish: 0.02 }),
  G('rawsilk', 'Raw Silk', '🐛', 'raw', 14, 0, { perish: 0.01, description: 'Cocoons and reeled thread, woven into silk in the weaveries.' }),
  G('wine', 'Wine', '🍶', 'refined', 16, 0.05, { perish: 0 }),
  G('paper', 'Paper & Ink', '📜', 'refined', 10, 0.03, { perish: 0 }),
  G('medicine', 'Medicine', '💊', 'medicine', 28, 0.02, { perish: 0.01, description: 'Prepared remedies. Demand explodes during epidemics.' }),
  G('arms', 'Arms & Armour', '⚔️', 'military', 45, 0.01, { perish: 0, weight: 2, description: 'Spears, blades, crossbows and lamellar. Armies need it to recruit.' }),
  G('horses', 'Horses', '🐎', 'military', 70, 0.004, { perish: 0.01, weight: 3, description: 'Steppe and highland horses. Cavalry needs them.' }),
  G('silk', 'Silk', '🧵', 'luxury', 40, 0.015),
  G('porcelain', 'Porcelain', '🏺', 'luxury', 30, 0.01),
  G('spices', 'Spices', '🌶️', 'luxury', 30, 0.015, { perish: 0.005 }),
  G('furs', 'Furs', '🦊', 'luxury', 35, 0.008, { winter: 2 }),
  G('jade', 'Jade', '💎', 'luxury', 120, 0.003, { perish: 0 }),
  G('pearls', 'Pearls', '🦪', 'luxury', 110, 0.0025, { perish: 0 }),
  G('spiritherbs', 'Spirit Herbs', '🍃', 'rare', 45, 0.003, { perish: 0.02, description: 'Rare roots and fungi that grow where Qi gathers: old ginseng, snow lotus, lingzhi.' }),
  G('cinnabar', 'Cinnabar', '🔴', 'rare', 38, 0.002, { perish: 0, description: 'Mercury ore, the base of most alchemy.' }),
  G('elixirs', 'Elixir Stock', '⚗️', 'rare', 90, 0.004, { perish: 0.005, description: 'Refined alchemical stock that pill makers buy. Sect shop pills linked to it get cheaper or dearer with it.' }),
];
const GOOD_CATEGORIES = ['food', 'staple', 'raw', 'refined', 'medicine', 'military', 'luxury', 'rare'];

// ─────────────────────────── Workshops ───────────────────────────
// Per level-1 workshop per turn. Levels: ×1, ×1.8, ×2.5. Output is scaled by the region's prosperity.
// Balanced so a workshop earns about 1.2% of its cost per turn at base prices and prosperity 50
// (it pays for itself in roughly 3–4 weeks of 6-hour turns; shortages and booms change that).
// service: coin earned per turn at population 20 instead of making goods (grows with population, max ×1.6).
const WORKSHOP_TYPES = [
  { id: 'brewery', name: 'Brewery', emoji: '🍶', inputs: { grain: 30 }, outputs: { wine: 10 }, cost: 900, upkeep: 30, requires: {}, description: 'Turns grain into wine. Drinks up grain in famines.' },
  { id: 'smithy', name: 'Smithy & Armoury', emoji: '⚒️', inputs: { iron: 10, timber: 4 }, outputs: { arms: 3.7 }, cost: 1400, upkeep: 40, requires: {}, description: 'Forges arms. Needed by every army that recruits.' },
  { id: 'apothecary', name: 'Apothecary', emoji: '🏥', inputs: { herbs: 9 }, outputs: { medicine: 5.4 }, cost: 1100, upkeep: 30, requires: {}, description: 'Prepares medicine from herbs.' },
  { id: 'alchemy', name: 'Alchemy Furnace', emoji: '⚗️', inputs: { herbs: 4, spiritherbs: 0.8, cinnabar: 0.6 }, outputs: { elixirs: 2.2 }, cost: 2600, upkeep: 60, requires: {}, description: 'Refines elixir stock. Sect shops with pills linked to Elixir Stock depend on it.' },
  { id: 'weavery', name: 'Silk Weavery', emoji: '🧵', inputs: { rawsilk: 12 }, outputs: { silk: 5.5 }, cost: 1600, upkeep: 35, requires: { anyProduction: ['rawsilk'] }, description: 'Weaves raw silk into silk.' },
  { id: 'kiln', name: 'Porcelain Kiln', emoji: '🏺', inputs: { timber: 8 }, outputs: { porcelain: 3.1 }, cost: 1500, upkeep: 35, requires: {}, description: 'Fires porcelain; burns a lot of timber.' },
  { id: 'papermill', name: 'Paper Mill', emoji: '📜', inputs: { timber: 10 }, outputs: { paper: 8 }, cost: 800, upkeep: 20, requires: {}, description: 'Paper and ink for scholars, officials and sect libraries.' },
  { id: 'ranch', name: 'Horse Ranch', emoji: '🐎', inputs: { grain: 24 }, outputs: { horses: 2.3 }, cost: 2000, upkeep: 40, requires: { terrains: ['steppe', 'highland', 'plains'] }, description: 'Breeds horses on grain. Best on the steppe.' },
  { id: 'teahouse', name: 'Teahouse & Inn', emoji: '🏮', inputs: { tea: 3, wine: 2.5 }, outputs: {}, service: 125, cost: 1000, upkeep: 25, requires: {}, description: 'Serves travellers. Earns coin from the region\'s prosperity instead of making goods. A good rumour mill for RP.' },
  { id: 'escort', name: 'Escort Agency', emoji: '🚩', inputs: {}, outputs: {}, service: 67, security: 3, caravanRisk: -0.06, cost: 1800, upkeep: 45, requires: {}, description: 'Guards caravans through the region (lower raid risk, more security) and earns protection fees.' },
];

// ─────────────────────────── Terrain ───────────────────────────
const TERRAINS = {
  // attackerPenalty: dice taken from an attacker fighting here (EU4-style); width: thousands of men who can fight at once.
  plains: { label: 'Plains', emoji: '', attackerPenalty: 0, width: 30, cavalry: 1.2, supply: 0, defense: 1 },
  hills: { label: 'Hills', emoji: '', attackerPenalty: -1, width: 25, cavalry: 0.9, supply: 0, defense: 1.1 },
  mountains: { label: 'Mountains', emoji: '', attackerPenalty: -2, width: 20, cavalry: 0.6, supply: -2, defense: 1.25 },
  river: { label: 'Rivers & Lakes', emoji: '', attackerPenalty: -1, width: 25, cavalry: 0.85, supply: 1, defense: 1.1, riverCrossing: true },
  coast: { label: 'Coast', emoji: '', attackerPenalty: 0, width: 30, cavalry: 0.9, supply: 1, defense: 1 },
  forest: { label: 'Forest', emoji: '', attackerPenalty: -1, width: 22, cavalry: 0.7, supply: -1, defense: 1.1 },
  steppe: { label: 'Steppe', emoji: '', attackerPenalty: 0, width: 35, cavalry: 1.35, supply: -2, defense: 0.95 },
  desert: { label: 'Desert', emoji: '', attackerPenalty: 0, width: 30, cavalry: 1.2, supply: -4, defense: 0.95 },
  highland: { label: 'Highland', emoji: '', attackerPenalty: -1, width: 22, cavalry: 0.8, supply: -3, defense: 1.15 },
};

// ─────────────────────────── Provinces ───────────────────────────
// terrain · population · fort (0–5) · production per turn (at prosperity 50)
const P = (terrain, population, fort, production) => ({
  terrain, population, fort,
  production: Object.fromEntries(production.split(',').filter(Boolean).map((x) => { const [k, v] = x.split(':'); return [k.trim(), Number(v)]; })),
});
const PROVINCES = {
  '河南': P('plains', 120, 3, 'grain:237.5,cloth:33,herbs:12.8,jade:0.5,iron:5.2,wine:6'),
  '山东': P('plains', 110, 2, 'grain:212.5,salt:40,meat:20,cloth:33,rawsilk:5,iron:13,wine:6'),
  '江苏': P('river', 110, 2, 'grain:212.5,salt:80,meat:20,cloth:49.5,rawsilk:25,wine:6'),
  '浙江': P('hills', 100, 2, 'grain:125,salt:30,tea:40,meat:20,cloth:22,rawsilk:30,timber:15,herbs:8,wine:9'),
  '四川': P('mountains', 100, 3, 'grain:187.5,salt:40,tea:30,timber:45,iron:13,herbs:40,rawsilk:15,spiritherbs:2.1,cinnabar:1,spices:4.2,cloth:16.5,wine:7.2'),
  '河北': P('plains', 100, 3, 'grain:150,salt:20,iron:39,cloth:33,wine:4.8'),
  '湖北': P('river', 90, 3, 'grain:175,meat:25,timber:22.5,iron:19.5,herbs:16,tea:10,spiritherbs:1.4,cloth:22,wine:4.8'),
  '湖南': P('hills', 90, 2, 'grain:187.5,tea:25,meat:15,timber:37.5,herbs:12.8,cinnabar:3,wine:3.6'),
  '安徽': P('plains', 85, 2, 'grain:150,tea:35,iron:19.5,herbs:12.8,cloth:11'),
  '江西': P('hills', 80, 2, 'grain:137.5,tea:15,meat:10,timber:37.5,iron:13'),
  '广东': P('coast', 90, 2, 'grain:125,salt:20,tea:10,meat:20,rawsilk:8,spices:8.4,pearls:1.88'),
  '福建': P('hills', 60, 2, 'grain:50,salt:10,tea:45,meat:15,timber:37.5,spices:4.2'),
  '陕西': P('mountains', 70, 4, 'grain:87.5,cloth:11,timber:15,spiritherbs:0.7'),
  '山西': P('mountains', 65, 4, 'grain:62.5,salt:25,iron:52,wine:6'),
  '北京': P('plains', 60, 5, 'grain:12.5'),
  '天津': P('coast', 30, 3, 'grain:18.8,salt:40,meat:5'),
  '上海': P('coast', 30, 2, 'grain:18.8,cloth:27.5,meat:5'),
  '重庆': P('river', 50, 3, 'grain:50,salt:10,herbs:8'),
  '广西': P('hills', 50, 2, 'grain:62.5,timber:37.5,herbs:19.2,cinnabar:1,spices:4.2,pearls:2.5'),
  '贵州': P('mountains', 35, 3, 'grain:31.2,tea:10,timber:37.5,herbs:24,cinnabar:4,wine:4.8'),
  '云南': P('mountains', 45, 3, 'grain:43.8,tea:35,timber:45,herbs:40,spiritherbs:2.1,spices:4.2,horses:1.5,jade:1'),
  '甘肃': P('desert', 35, 4, 'grain:25,meat:15,herbs:12.8,horses:3,iron:6.5'),
  '宁夏': P('steppe', 15, 3, 'grain:18.8,salt:8,meat:10,horses:2'),
  '青海': P('highland', 12, 2, 'grain:7.5,salt:20,meat:20,horses:3'),
  '西藏': P('highland', 10, 3, 'grain:7.5,meat:15,herbs:12.8,spiritherbs:2.8,horses:1.5,furs:1.4'),
  '新疆': P('desert', 20, 3, 'grain:18.8,meat:25,cloth:16.5,horses:4,jade:4,furs:2.8'),
  '内蒙古': P('steppe', 18, 1, 'grain:12.5,salt:12,meat:50,horses:7.5,furs:4.2'),
  '辽宁': P('plains', 45, 3, 'grain:75,salt:10,iron:39,jade:1'),
  '吉林': P('forest', 25, 2, 'grain:50,meat:10,timber:75,herbs:16,spiritherbs:2.8,furs:5.6'),
  '黑龙江': P('forest', 20, 2, 'grain:50,meat:15,timber:90,horses:1.5,furs:8.4'),
  '海南': P('coast', 12, 1, 'grain:15,salt:10,meat:10,spices:7,pearls:1.88'),
  '台湾': P('coast', 15, 1, 'grain:25,tea:8,meat:8,timber:22.5,spices:2.8'),
  '香港': P('coast', 5, 1, 'grain:2.5,spices:4.2,pearls:0.62'),
  '澳门': P('coast', 3, 1, 'grain:1.2,spices:5.6'),
};
// Starting workshops (owned by the region unless an owner is given). [region, type, level, ownerFaction]
const START_WORKSHOPS = [
  ['浙江', 'weavery', 3], ['江苏', 'weavery', 3], ['四川', 'weavery', 2], ['广东', 'weavery', 1],
  ['江西/景德镇', 'kiln', 3], ['河北', 'kiln', 1], ['浙江', 'kiln', 2], ['湖南', 'kiln', 1], ['福建', 'kiln', 2], ['河南', 'kiln', 1],
  ['安徽', 'papermill', 2], ['四川', 'papermill', 1], ['浙江', 'papermill', 1], ['福建', 'papermill', 1], ['江西', 'papermill', 1], ['北京', 'papermill', 1], ['江苏', 'papermill', 1], ['湖北', 'papermill', 1],
  ['山西', 'brewery', 1], ['四川', 'brewery', 1], ['贵州', 'brewery', 1], ['浙江', 'brewery', 1], ['山东', 'brewery', 1], ['江苏', 'brewery', 1], ['河南', 'brewery', 1], ['北京', 'brewery', 1],
  ['河南', 'apothecary', 1], ['湖北', 'apothecary', 1], ['四川', 'apothecary', 1], ['安徽/亳州', 'apothecary', 2], ['湖南', 'apothecary', 1], ['江苏', 'apothecary', 1], ['河北', 'apothecary', 1], ['浙江', 'apothecary', 1], ['广东', 'apothecary', 1], ['北京', 'apothecary', 1],
  ['山西', 'smithy', 1], ['河北', 'smithy', 1], ['北京', 'smithy', 2], ['四川', 'smithy', 1],
  ['湖北/十堰', 'alchemy', 1], ['河南/郑州', 'alchemy', 1], ['四川/成都', 'alchemy', 1], ['陕西/渭南', 'alchemy', 1], ['云南/西双版纳', 'alchemy', 1],
  ['内蒙古', 'ranch', 1], ['甘肃', 'ranch', 1],
  ['河南/洛阳', 'teahouse', 1], ['浙江/杭州', 'teahouse', 1], ['陕西/西安', 'teahouse', 1], ['江苏/扬州', 'teahouse', 1],
  ['河北/沧州', 'escort', 1], ['河南/开封', 'escort', 1], ['湖北/武汉', 'escort', 1],
];
// Special prefectures: each is its own market. [key, population share taken from the province, note]
const SPECIAL = [
  ['湖北/十堰', 0.12, 'Mount Wudang. Home of the Wudang Sect.'],
  ['河南/郑州', 0.15, 'Dengfeng and Mount Song. Shaolin Temple stands here.'],
  ['陕西/渭南', 0.12, 'Huayin, at the foot of Mount Hua.'],
  ['湖南/岳阳', 0.15, 'Yueyang Tower and Junshan Isle on Dongting Lake. The Beggar Sect gathers here.'],
  ['山东/临沂', 0.12, 'Langya. Seat of the Jaegal Clan of strategists.'],
  ['四川/成都', 0.25, 'Chengdu. The Tang Clan\'s poison halls are in the city\'s shadow.'],
  ['河北/保定', 0.15, 'The Peng Clan\'s manor.'],
  ['安徽/合肥', 0.15, 'Hefei. The wealthy Namgoong Clan.'],
  ['山西/长治', 0.15, 'Taihang mountains. Seat of the 72 Strongholds.'],
  ['黑龙江/黑河', 0.15, 'The frozen north. The Ice Palace.'],
  ['浙江/舟山', 0.08, 'Islands of the eastern sea. The Sun Palace.'],
  ['新疆/伊犁', 0.2, 'Beyond the Tianshan. The Sword Palace.'],
  ['云南/西双版纳', 0.15, 'Southern jungles. The Beast Palace.'],
  ['贵州/遵义', 0.2, 'Misty valleys of the Hao Sect.'],
  ['青海/海西', 0.3, 'The Qaidam basin. The Blood Cult hides in its salt flats.'],
  ['河南/洛阳', 0.18, 'Luoyang, ancient capital: sword manors and the great market.'],
  ['河南/开封', 0.15, 'Kaifeng: canals, escort agencies and gambling dens.'],
  ['陕西/西安', 0.25, "Chang'an: the gate to the Silk Road."],
  ['江苏/扬州', 0.15, 'Yangzhou: salt merchants and the Grand Merchant Guild.'],
  ['浙江/杭州', 0.15, 'Hangzhou: West Lake, silk and tea.'],
  ['广东/广州', 0.2, 'Canton: the great southern port.'],
  ['湖北/武汉', 0.2, 'Wuchang: where the Han meets the Yangtze. River trade hub.'],
  ['甘肃/酒泉', 0.2, 'Jiayu Pass: the end of the Great Wall.'],
  ['江西/景德镇', 0.12, 'Jingdezhen: the porcelain capital.'],
  ['安徽/亳州', 0.15, 'Bozhou: the great herb market.'],
  ['河北/沧州', 0.12, 'Cangzhou: homeland of martial artists and escort agencies.'],
];
// Extra routes the borders don't give (sea lanes). Staff can add roads/rivers too.
const ROUTES = [
  { a: '海南', b: '广东', kind: 'sea' }, { a: '台湾', b: '福建', kind: 'sea' }, { a: '香港', b: '广东', kind: 'sea' },
  { a: '澳门', b: '香港', kind: 'sea' }, { a: '天津', b: '上海', kind: 'sea' }, { a: '上海', b: '福建', kind: 'sea' }, { a: '福建', b: '广东', kind: 'sea' },
];

// ─────────────────────────── Factions ───────────────────────────
// One per sect (linked by name), plus a few non-player powers.
// One faction per sect (linked by name). Only a colour and the sect's 漢字 are preset: no lands, seats,
// relations or treaties — staff paint and decide all of that.
const FACTION_SEEDS = {
  'Wudang Sect': { color: '#5b8fb9', hanzi: '武當' },
  'Shaolin Sect': { color: '#d4a017', hanzi: '少林' },
  'Mount Hua Sect': { color: '#c2577a', hanzi: '華山' },
  'Beggar Sect': { color: '#8d6e4f', hanzi: '丐幫' },
  'Jaegal Clan': { color: '#4f7f6f', hanzi: '諸葛' },
  'Tang Clan': { color: '#6b8e23', hanzi: '唐門' },
  'Peng Clan': { color: '#a0522d', hanzi: '彭家' },
  'Namgoong Clan': { color: '#2f6fb0', hanzi: '南宮' },
  'Moyong Clan': { color: '#7a7a7a', hanzi: '慕容', active: false },
  'The 72 Strongholds': { color: '#5d4037', hanzi: '綠林七十二寨' },
  'Ice Palace': { color: '#7fb8d8', hanzi: '北海冰宮' },
  'Sun Palace': { color: '#e8892a', hanzi: '東海日宮' },
  'Sword Palace': { color: '#9e9e9e', hanzi: '西域劍宮' },
  'Beast Palace': { color: '#558b2f', hanzi: '南蠻野獸宮' },
  'Hao Sect': { color: '#4a148c', hanzi: '郝家' },
  'Blood Cult': { color: '#8b0000', hanzi: '血教' },
  'Demon Cult': { color: '#212121', hanzi: '天魔神教', active: false },
};
// Optional presets (not created automatically): add them from Politics → New faction → preset.
const EXTRA_FACTIONS = [
  { id: 'imperial-court', name: 'Imperial Court', hanzi: '皇室', kind: 'court', alignment: 'Imperial', color: '#c9ab6b', icon: '', hq: '', npc: true, treasury: 20000, influence: 300, description: 'The Emperor and his officials. Governs every province no martial power has claimed, collects the grain tax and keeps the peace on the roads — when it can.' },
  { id: 'merchant-guild', name: 'Grand Merchant Guild', hanzi: '天下商會', kind: 'guild', alignment: 'Neutral', color: '#c0a062', icon: '', hq: '', npc: true, treasury: 8000, influence: 120, description: 'Salt merchants, bankers and caravan masters. Runs the merchant caravans that keep markets supplied, and profits from every shortage.' },
];

// ─────────────────────────── Events ───────────────────────────
const E = (id, name, emoji, category, o) => ({
  id, name, emoji, category, enabled: true,
  description: o.description || '',
  announcement: o.announcement || `${emoji} **${name}** in **{region}**. ${o.description || ''}`,
  scope: o.scope || 'region', // region | province | neighbors | global | faction
  weight: o.weight ?? 1, // relative chance per region per turn (× Settings → Event rate)
  conditions: o.conditions || {},
  duration: o.duration || [4, 8],
  cooldown: o.cooldown ?? 40,
  effects: o.effects || {},
  onStart: o.onStart || {},
  chain: o.chain || [], // [{ eventId, chance (0-1), delay (turns) }]
  spread: o.spread || null, // { chance per turn, maxRegions }
  scriptId: '',
});
const EVENTS = [
  // Disasters
  E('drought', 'Drought', '☀️', 'disaster', { description: 'No rain for weeks. Fields crack and wells run dry.', weight: 1.2, conditions: { seasons: [1, 2], terrains: ['plains', 'hills', 'steppe', 'desert', 'highland'] }, duration: [6, 12], effects: { production: { grain: 0.45, meat: 0.8, tea: 0.7 }, prosperity: -0.6, unrest: 0.6 }, chain: [{ eventId: 'famine', chance: 0.35, delay: 4 }, { eventId: 'wildfire', chance: 0.15, delay: 2 }] }),
  E('flood', 'Great Flood', '🌊', 'disaster', { description: 'The river breaks its dykes. Villages and granaries are swept away.', weight: 1, conditions: { seasons: [1], terrains: ['river', 'plains', 'coast'] }, duration: [3, 6], onStart: { stock: { grain: -0.35, salt: -0.2 }, population: -1.5, prosperity: -4 }, effects: { production: { food: 0.6, '*': 0.85 }, prosperity: -0.8, unrest: 0.8, security: -1, caravanRisk: 0.05 }, chain: [{ eventId: 'epidemic', chance: 0.3, delay: 2 }, { eventId: 'refugees', chance: 0.4, delay: 1 }] }),
  E('locusts', 'Locust Swarm', '🦗', 'disaster', { description: 'A dark cloud of locusts devours the crops.', weight: 0.7, conditions: { seasons: [1, 2], terrains: ['plains', 'steppe', 'hills'] }, duration: [3, 5], onStart: { stock: { grain: -0.15 } }, effects: { production: { grain: 0.3 }, prosperity: -0.5, unrest: 0.5 }, spread: { chance: 0.35, maxRegions: 4 }, chain: [{ eventId: 'famine', chance: 0.4, delay: 3 }] }),
  E('epidemic', 'Epidemic', '🤒', 'disaster', { description: 'A fever spreads through the towns. Physicians are overwhelmed.', weight: 0.6, conditions: { minPopulation: 20 }, duration: [5, 9], effects: { population: -0.4, demand: { medicine: 4, herbs: 1.5 }, production: { '*': 0.85 }, prosperity: -0.7, unrest: 0.5 }, spread: { chance: 0.25, maxRegions: 3 } }),
  E('harsh-winter', 'Harsh Winter', '🌨️', 'disaster', { description: 'Snow buries the roads and the cold kills the weak.', weight: 1.1, conditions: { seasons: [3], terrains: ['steppe', 'forest', 'highland', 'mountains', 'desert', 'plains'], north: true }, duration: [4, 8], effects: { demand: { furs: 1.8, cloth: 1.4, timber: 1.3, grain: 1.1 }, production: { meat: 0.7 }, caravanRisk: 0.08, attrition: 1.5, prosperity: -0.3 } }),
  E('earthquake', 'Earthquake', '🏚️', 'disaster', { description: 'The earth shakes; walls and temples crack.', weight: 0.2, conditions: { terrains: ['mountains', 'highland', 'hills'] }, duration: [2, 4], onStart: { prosperity: -6, population: -1, coffers: -0.2 }, effects: { production: { '*': 0.8 }, security: -2, unrest: 0.6 }, chain: [{ eventId: 'refugees', chance: 0.3, delay: 1 }] }),
  E('wildfire', 'Wildfire', '🔥', 'disaster', { description: 'Fire races through the dry forests.', weight: 0.4, conditions: { seasons: [1, 2], terrains: ['forest', 'mountains', 'hills'] }, duration: [2, 4], onStart: { stock: { timber: -0.3 } }, effects: { production: { timber: 0.4, herbs: 0.6, spiritherbs: 0.5 }, prosperity: -0.4 } }),
  E('famine', 'Famine', '🥣', 'disaster', { description: 'The granaries are empty. People eat bark and flee the countryside.', weight: 0.15, conditions: { shortage: 'grain' }, duration: [5, 10], effects: { population: -0.6, prosperity: -1.2, unrest: 1.8, security: -1.5, demand: { grain: 1.2 }, price: { grain: 1.25 } }, chain: [{ eventId: 'revolt', chance: 0.25, delay: 3 }, { eventId: 'refugees', chance: 0.5, delay: 1 }, { eventId: 'bandits', chance: 0.3, delay: 2 }] }),
  // Economic
  E('bumper-harvest', 'Bumper Harvest', '🌾', 'blessing', { description: 'Gentle rains and warm sun: the best harvest in years.', weight: 1.2, conditions: { seasons: [2], terrains: ['plains', 'river', 'hills'] }, duration: [3, 6], effects: { production: { grain: 1.6, meat: 1.2 }, prosperity: 0.6, unrest: -0.4 } }),
  E('trade-fair', 'Great Trade Fair', '🎪', 'economic', { description: 'Merchants from every province gather for a great fair.', weight: 0.8, conditions: { minProsperity: 40 }, duration: [3, 5], effects: { income: 1.25, demand: { luxury: 1.5, wine: 1.3, tea: 1.2 }, prosperity: 0.5, tariff: -3 } }),
  E('silver-shortage', 'Silver Shortage', '🪙', 'economic', { description: 'Silver is hoarded; merchants refuse credit and luxury sales collapse.', weight: 0.4, scope: 'province', duration: [5, 9], effects: { income: 0.75, demand: { luxury: 0.6 }, price: { luxury: 0.85 }, prosperity: -0.3 } }),
  E('salt-crackdown', 'Salt Smuggling Crackdown', '🧂', 'economic', { description: 'Officials hunt salt smugglers. Honest salt is dear and scarce.', weight: 0.5, conditions: { requiresProduction: 'salt' }, duration: [4, 8], effects: { production: { salt: 0.6 }, price: { salt: 1.3 }, security: 1, unrest: 0.3 } }),
  E('guild-boycott', 'Merchant Guild Boycott', '🚫', 'economic', { description: 'The Grand Merchant Guild refuses to trade here until its demands are met.', weight: 0.3, duration: [4, 8], effects: { income: 0.85, price: { luxury: 1.25, rare: 1.2 }, prosperity: -0.4, noGuildCaravans: 1 } }),
  E('mine-collapse', 'Mine Collapse', '⛏️', 'disaster', { description: 'A mine shaft collapses, burying dozens of miners.', weight: 0.5, conditions: { requiresProduction: 'iron' }, duration: [4, 8], onStart: { population: -0.3 }, effects: { production: { iron: 0.4, jade: 0.5, cinnabar: 0.5 }, unrest: 0.4 } }),
  E('new-vein', 'Rich Vein Discovered', '💎', 'blessing', { description: 'Prospectors strike a rich new vein.', weight: 0.35, conditions: { terrains: ['mountains', 'hills', 'highland', 'desert'] }, duration: [8, 14], effects: { production: { iron: 1.6, jade: 1.8, cinnabar: 1.5 }, prosperity: 0.3, security: -0.5 } }),
  E('herb-bloom', 'Spirit Herb Bloom', '🍃', 'blessing', { description: 'In a hidden valley, old spirit herbs have bloomed all at once. Herbalists and sects rush in.', weight: 0.3, conditions: { terrains: ['mountains', 'forest', 'highland'] }, duration: [3, 6], effects: { production: { spiritherbs: 3, herbs: 1.4 }, security: -1.5 } }),
  // Political
  E('tax-levy', 'Imperial Tax Levy', '📜', 'political', { description: 'The court demands an extra levy for the frontier armies.', weight: 0.5, scope: 'province', duration: [4, 6], onStart: { coffers: -0.25 }, effects: { income: 0.85, unrest: 0.7, prosperity: -0.3 } }),
  E('inspector', 'Imperial Inspector', '🔍', 'political', { description: 'An incorruptible censor arrives from the capital to audit the officials.', weight: 0.4, conditions: { minCorruption: 30 }, duration: [4, 7], effects: { corruption: -2.5, unrest: -0.3, income: 0.95 } }),
  E('corrupt-magistrate', 'Corrupt Magistrate', '💰', 'political', { description: 'The new magistrate takes bribes for everything — and protects bandits who pay him.', weight: 0.5, conditions: { minProsperity: 45 }, duration: [8, 14], effects: { corruption: 1.5, security: -1, tax: 0.8, unrest: 0.4 } }),
  E('revolt', 'Peasant Revolt', '🔥', 'political', { description: 'Starving peasants take up hoes and spears and storm the yamen.', weight: 0.2, conditions: { minUnrest: 65 }, duration: [4, 8], onStart: { coffers: -0.3, security: -15 }, effects: { production: { '*': 0.7 }, tax: 0.3, prosperity: -1, unrest: -1.5, caravanRisk: 0.15 }, chain: [{ eventId: 'bandits', chance: 0.4, delay: 2 }] }),
  E('refugees', 'Refugee Wave', '🧳', 'social', { description: 'Refugees from a stricken neighbour pour in, begging for food.', weight: 0.1, scope: 'neighbors', duration: [3, 6], effects: { population: 0.3, demand: { grain: 1.15 }, unrest: 0.6, security: -0.5 } }),
  E('bandits', 'Bandit Uprising', '🏴', 'military', { description: 'Bandit gangs block the roads and raid caravans.', weight: 0.9, conditions: { maxSecurity: 55 }, duration: [5, 10], effects: { caravanRisk: 0.18, security: -1.5, prosperity: -0.4, income: 0.92 } }),
  E('river-pirates', 'River Pirates', '🛶', 'military', { description: 'Water fortresses prey on the river barges.', weight: 0.6, conditions: { terrains: ['river', 'coast'], maxSecurity: 60 }, duration: [5, 9], effects: { caravanRisk: 0.14, income: 0.92, security: -1 } }),
  // Murim & social
  E('tournament', 'Murim Tournament', '🏆', 'social', { description: 'Martial artists of every sect gather to compete. Inns overflow and old grudges flare.', weight: 0.35, conditions: { minProsperity: 45 }, duration: [3, 5], effects: { income: 1.2, demand: { wine: 1.5, medicine: 1.3, tea: 1.3 }, prosperity: 0.4, unrest: 0.2 } }),
  E('lantern-festival', 'Lantern Festival', '🏮', 'social', { description: 'Lanterns light every street; families feast.', weight: 0.8, conditions: { seasons: [0] }, duration: [2, 3], cooldown: 100, effects: { income: 1.15, demand: { wine: 1.4, meat: 1.3, paper: 1.5 }, unrest: -1, prosperity: 0.3 } }),
  E('succession', 'Succession Dispute', '👑', 'political', { description: 'Rival heirs of the ruling house split the officials and garrisons.', weight: 0.15, scope: 'faction', duration: [6, 12], effects: { security: -1, unrest: 0.8, tax: 0.8, influence: -1 } }),
  E('master-sighting', 'Rumours of a Hidden Master', '🍂', 'social', { description: 'Travellers whisper of a nameless master seen in the mountains. Young martial artists set out to find them.', weight: 0.25, duration: [3, 5], effects: { income: 1.05 } }),
];

// ─────────────────────────── Policies ───────────────────────────
// scope: 'region' (adopted for one region the faction controls) or 'faction' (all regions it controls).
// fatigue: effects lose this share of strength every turn after `grace` turns (never below `floor`).
// upkeep is paid from the faction treasury / influence every turn.
const PO = (id, name, emoji, scope, o) => ({
  id, name, emoji, scope, enabled: true,
  description: o.description || '',
  kinds: o.kinds || [], // faction kinds that may adopt it (empty = any)
  cost: { influence: o.influence ?? 20, treasury: o.treasury ?? 0 },
  upkeep: { influence: o.upkeepInfluence ?? 0, treasury: o.upkeep ?? 0 },
  effects: o.effects || {},
  fatigue: o.fatigue ?? 0, grace: o.grace ?? 10, floor: o.floor ?? 0.4,
  exclusive: o.exclusive || [],
  shopAccess: o.shopAccess || null,
  minTurns: o.minTurns ?? 4,
  scriptId: '',
});
const POLICIES = [
  PO('grain-reserves', 'Ever-Normal Granaries', '🏛️', 'region', { description: 'Buy grain cheap in good years and release it in bad ones. Steadies grain prices and blunts famines.', upkeep: 25, effects: { price: { grain: 0.85 }, demand: { grain: 0.95 }, unrest: -0.2 }, influence: 15 }),
  PO('salt-monopoly', 'Salt Monopoly', '🧂', 'faction', { description: 'Only licensed merchants may sell salt. A fortune for the treasury, misery for the poor.', effects: { price: { salt: 1.4 }, treasury: 8, unrest: 0.35, corruption: 0.3 }, exclusive: ['open-markets'], influence: 25 }),
  PO('open-markets', 'Open Markets', '🏪', 'faction', { description: 'Low tariffs and free passage for merchants. Trade flourishes; the treasury earns less.', effects: { tariff: -4, income: 1.08, tax: 0.85, prosperity: 0.15 }, exclusive: ['salt-monopoly', 'tariffs'], influence: 20 }),
  PO('tariffs', 'Protective Tariffs', '🧱', 'faction', { description: 'Heavy duties on outside goods and traders.', effects: { tariff: 6, tax: 1.15, income: 0.95 }, exclusive: ['open-markets'], influence: 15 }),
  PO('martial-law', 'Martial Law', '🪖', 'region', { description: 'Curfews, checkpoints and soldiers on every corner. Crushes unrest — for a while.', upkeep: 35, effects: { security: 3, unrest: -1.5, prosperity: -0.4, income: 0.9 }, fatigue: 0.04, grace: 6, floor: 0.2, influence: 20 }),
  PO('bandit-suppression', 'Bandit Suppression Campaign', '🏹', 'region', { description: 'Hunt the bandits in the hills. Expensive, and it works less once the easy camps are burned.', upkeep: 40, effects: { security: 2.5, caravanRisk: -0.12 }, fatigue: 0.03, grace: 8, floor: 0.35, influence: 10 }),
  PO('conscription', 'Conscription', '📯', 'faction', { description: 'Every household sends a son. Cheaper troops, emptier fields.', effects: { recruitCost: 0.7, production: { '*': 0.92 }, unrest: 0.4 }, influence: 25 }),
  PO('tax-relief', 'Tax Relief', '🤲', 'region', { description: 'Forgive the year\'s taxes. The people bless your name.', effects: { tax: 0.5, unrest: -0.8, prosperity: 0.35 }, influence: 10 }),
  PO('heavy-taxes', 'Heavy Taxation', '⚖️', 'faction', { description: 'Squeeze every coin from the people.', effects: { tax: 1.35, prosperity: -0.25, unrest: 0.5 }, exclusive: ['tax-relief'], influence: 10 }),
  PO('alchemy-patronage', 'Patronage of Alchemists', '⚗️', 'faction', { description: 'Fund furnaces and herb gardens. More elixir stock, hungrier herb markets.', upkeep: 30, effects: { production: { elixirs: 1.35, medicine: 1.15 }, demand: { herbs: 1.2, spiritherbs: 1.2 } }, influence: 20 }),
  PO('escort-charter', 'Escort Agency Charter', '🚩', 'faction', { description: 'License escort agencies to guard the roads.', upkeep: 20, effects: { caravanRisk: -0.08, security: 1, income: 1.03 }, influence: 15 }),
  PO('closed-gates', 'Closed Gates', '🚪', 'faction', { kinds: ['sect', 'clan', 'palace', 'cult'], description: 'Seal the sect from the outside world. The shop serves members only, the mountain is safe — and every other faction slowly forgets you.', effects: { security: 1.5, relation: -0.25, influence: -0.5 }, shopAccess: 'members', influence: 10 }),
  PO('open-recruitment', 'Open Recruitment', '📣', 'faction', { kinds: ['sect', 'clan', 'palace', 'cult'], description: 'Welcome wanderers and commoners. Influence grows with the hall.', upkeep: 15, effects: { influence: 1.2, unrest: -0.2 }, influence: 5 }),
  PO('temple-charity', 'Temple Charity', '🪷', 'region', { description: 'Soup kitchens and free physicians at the temples.', upkeep: 25, effects: { unrest: -0.6, population: 0.05, demand: { grain: 1.03, medicine: 1.1 }, prosperity: 0.15 }, influence: 10 }),
  PO('censors', 'Imperial Censors', '🔍', 'faction', { kinds: ['court'], description: 'Send censors to audit the provinces.', upkeep: 60, effects: { corruption: -1.2, tax: 1.05 }, influence: 20 }),
  PO('corvee', 'Corvée Labour', '🧱', 'region', { description: 'Draft peasants to rebuild walls and dykes. Fortifications rise; so does anger.', effects: { fortGrowth: 0.08, unrest: 0.6, production: { food: 0.92 } }, fatigue: 0.02, influence: 15 }),
];

// ─────────────────────────── Diplomacy ───────────────────────────
// Each action is a node in the Diplomacy map. `requires` lists what must be true; `unlocks` are the
// arrows to the actions it opens up. Effects apply when the other side accepts.
const TREATY_TYPES = [
  { id: 'nap', name: 'Non-Aggression Pact', emoji: '🕊️', drift: 0.15, effects: {}, description: 'Neither side may declare war while it lasts.' },
  { id: 'trade', name: 'Trade Agreement', emoji: '🤝', drift: 0.1, effects: {}, tariffFree: true, shopTier: 'ally', caravanRisk: -0.03, description: 'No tariffs between the parties; their sect shops treat each other as allies; their caravans travel safer.' },
  { id: 'access', name: 'Military Access', emoji: '🚩', drift: 0.05, effects: {}, description: 'Armies may cross each other\'s territory without supply penalties.' },
  { id: 'defensive', name: 'Defensive Alliance', emoji: '🛡️', drift: 0.2, effects: {}, shopTier: 'ally', description: 'An attack on one is an attack on both.' },
  { id: 'alliance', name: 'Full Alliance', emoji: '⚜️', drift: 0.3, effects: {}, shopTier: 'ally', description: 'Joint wars, shared enemies, allied prices in every shop.' },
  { id: 'marriage', name: 'Marriage Bond', emoji: '💍', drift: 0.35, effects: {}, description: 'Two houses joined by a political marriage. Relations improve while both spouses live and stay married.' },
  { id: 'vassal', name: 'Vassalage', emoji: '🙇', drift: 0.05, effects: {}, tribute: 10, description: 'The vassal pays a share of its income to its overlord and follows it to war.' },
  { id: 'tribute', name: 'Tribute', emoji: '🎁', drift: -0.05, effects: {}, tribute: 6, description: 'A one-way payment every turn, for peace.' },
  { id: 'truce', name: 'Truce', emoji: '🏳️', drift: 0.05, effects: {}, description: 'A fragile peace after war. No war can be declared until it ends.' },
  { id: 'embargo', name: 'Embargo', emoji: '⛔', drift: -0.2, effects: {}, description: 'One side refuses all trade with the other: no caravans, no shop access, double tariffs.' },
  { id: 'exchange', name: 'Disciple Exchange', emoji: '🎓', drift: 0.2, effects: {}, description: 'Disciples train at each other\'s halls. Members may buy from each other\'s shops at ally prices.', shopTier: 'ally' },
  { id: 'custom', name: 'Custom Agreement', emoji: '📝', drift: 0, effects: {}, description: 'Anything else. Give it effects or custom code in the dashboard.' },
];
const A = (id, name, emoji, category, o) => ({
  id, name, emoji, category, enabled: true,
  description: o.description || '',
  requires: { minRelation: -100, maxRelation: 100, atWar: null, treaties: [], noTreaties: [], ...(o.requires || {}) },
  costInfluence: o.costInfluence ?? 0,
  costTreasury: o.costTreasury ?? 0,
  needsCharacters: o.needsCharacters || false,
  staffApproval: o.staffApproval ?? false,
  unilateral: o.unilateral ?? false,
  onAccept: o.onAccept || {},
  onReject: o.onReject || { relation: -3 },
  unlocks: o.unlocks || [],
  cooldown: o.cooldown ?? 8,
  scriptId: '',
});
const DIPLOMACY_ACTIONS = [
  A('gift', 'Send Gifts', '🎁', 'courtesy', { description: 'Send rare goods and silver to win favour. The other side always accepts.', unilateral: true, costTreasury: 300, onAccept: { relation: 8, transfer: 300 }, unlocks: ['trade', 'exchange', 'nap'], cooldown: 4 }),
  A('envoy', 'Send an Envoy', '🧑‍💼', 'courtesy', { description: 'A formal visit by a representative. Cheap and slow, but it opens doors.', unilateral: true, costInfluence: 5, onAccept: { relation: 4 }, unlocks: ['gift', 'trade', 'nap', 'mediate'], cooldown: 6 }),
  A('trade', 'Propose Trade Agreement', '🤝', 'trade', { description: 'No tariffs, safer caravans, ally prices in each other\'s shops.', requires: { minRelation: 0, atWar: false, noTreaties: ['trade', 'embargo'] }, costInfluence: 10, onAccept: { relation: 5, treaty: { type: 'trade', duration: 120 } }, unlocks: ['joint-venture', 'defensive'] }),
  A('joint-venture', 'Joint Venture', '🏗️', 'trade', { description: 'Co-own a new workshop in one side\'s territory. Profits are split.', requires: { minRelation: 20, treaties: ['trade'] }, costInfluence: 15, costTreasury: 800, staffApproval: true, onAccept: { relation: 5, treaty: { type: 'custom', name: 'Joint Venture', duration: 0 } } }),
  A('embargo', 'Impose Embargo', '⛔', 'trade', { description: 'Stop all trade with them.', unilateral: true, requires: { noTreaties: ['embargo', 'alliance', 'defensive'] }, costInfluence: 15, onAccept: { relation: -15, treaty: { type: 'embargo', duration: 60 }, breaks: ['trade'] }, unlocks: ['lift-embargo'] }),
  A('lift-embargo', 'Lift Embargo', '✅', 'trade', { description: 'End the embargo.', unilateral: true, requires: { treaties: ['embargo'] }, onAccept: { relation: 5, breaks: ['embargo'] } }),
  A('exchange', 'Disciple Exchange', '🎓', 'murim', { description: 'Send disciples to train at each other\'s halls.', requires: { minRelation: 15, atWar: false }, costInfluence: 15, onAccept: { relation: 6, treaty: { type: 'exchange', duration: 80 } }, unlocks: ['marriage', 'brotherhood'] }),
  A('nap', 'Non-Aggression Pact', '🕊️', 'alliance', { description: 'Promise not to attack each other.', requires: { minRelation: -10, atWar: false, noTreaties: ['nap'] }, costInfluence: 10, onAccept: { relation: 6, treaty: { type: 'nap', duration: 100 } }, unlocks: ['defensive', 'access'] }),
  A('access', 'Military Access', '🚩', 'alliance', { description: 'Let each other\'s armies pass.', requires: { minRelation: 20, atWar: false }, costInfluence: 10, onAccept: { relation: 2, treaty: { type: 'access', duration: 60 } } }),
  A('defensive', 'Defensive Alliance', '🛡️', 'alliance', { description: 'Come to each other\'s defence.', requires: { minRelation: 35, atWar: false, treaties: ['nap'] }, costInfluence: 25, onAccept: { relation: 8, treaty: { type: 'defensive', duration: 160 } }, unlocks: ['alliance'] }),
  A('alliance', 'Full Alliance', '⚜️', 'alliance', { description: 'Fight as one.', requires: { minRelation: 60, atWar: false, treaties: ['defensive'] }, costInfluence: 40, staffApproval: true, onAccept: { relation: 10, treaty: { type: 'alliance', duration: 0 } }, unlocks: ['call-to-arms', 'vassal'] }),
  A('call-to-arms', 'Call to Arms', '📯', 'alliance', { description: 'Ask an ally to join your war.', requires: { treaties: ['alliance'] }, costInfluence: 10, onAccept: { relation: 3, joinWar: true }, onReject: { relation: -12 } }),
  A('marriage', 'Political Marriage', '💍', 'marriage', { description: 'Marry a character of your house to one of theirs. Both players must agree, and staff approve.', requires: { minRelation: 10, atWar: false }, needsCharacters: true, staffApproval: true, costInfluence: 20, onAccept: { relation: 15, treaty: { type: 'marriage', duration: 0 }, marry: true }, unlocks: ['defensive', 'vassal'], cooldown: 20 }),
  A('annul', 'Annul a Marriage', '💔', 'marriage', { description: 'Dissolve a marriage bond. Insulting.', unilateral: true, requires: { treaties: ['marriage'] }, onAccept: { relation: -20, breaks: ['marriage'], unmarry: true } }),
  A('brotherhood', 'Sworn Brotherhood', '🍶', 'murim', { description: 'Two characters swear brotherhood under the peach trees. Both players must agree.', requires: { minRelation: 0 }, needsCharacters: true, costInfluence: 5, onAccept: { relation: 6, bond: 'sworn' } }),
  A('vassal', 'Offer Vassalage', '🙇', 'court', { description: 'Become their vassal (or demand they become yours).', requires: { minRelation: 30 }, staffApproval: true, costInfluence: 10, onAccept: { relation: 5, treaty: { type: 'vassal', duration: 0 } } }),
  A('tribute', 'Offer Tribute', '💰', 'court', { description: 'Pay them every turn for peace.', requires: {}, onAccept: { relation: 10, treaty: { type: 'tribute', duration: 40 }, endsWar: true } }),
  A('demand-tribute', 'Demand Tribute', '🫴', 'court', { description: 'Demand they pay you. If they refuse, relations sour.', requires: { maxRelation: 40 }, costInfluence: 15, onAccept: { relation: -10, treaty: { type: 'tribute', duration: 40, reverse: true } }, onReject: { relation: -10 } }),
  A('denounce', 'Denounce', '📢', 'hostile', { description: 'Publicly condemn them before the Murim.', unilateral: true, costInfluence: 5, onAccept: { relation: -12, influence: 4 }, unlocks: ['war', 'embargo'], cooldown: 6 }),
  A('war', 'Declare War', '⚔️', 'hostile', { description: 'Open war. Breaks pacts (and your reputation, if you had any).', unilateral: true, requires: { atWar: false, noTreaties: ['truce', 'alliance', 'defensive', 'marriage'] }, costInfluence: 30, staffApproval: true, onAccept: { relation: -40, war: true, breaks: ['trade', 'exchange', 'access', 'nap'] }, unlocks: ['ceasefire', 'peace'] }),
  A('ceasefire', 'Propose Truce', '🏳️', 'hostile', { description: 'Stop the fighting for a while.', requires: { atWar: true }, costInfluence: 5, onAccept: { relation: 8, endsWar: true, treaty: { type: 'truce', duration: 40 } }, unlocks: ['peace', 'nap'] }),
  A('peace', 'Peace with Reparations', '📜', 'hostile', { description: 'End the war; the loser pays.', requires: { atWar: true }, costInfluence: 10, staffApproval: true, onAccept: { relation: 12, endsWar: true, treaty: { type: 'truce', duration: 60 }, reparations: 1500 } }),
  A('mediate', 'Mediate a Dispute', '⚖️', 'murim', { description: 'Your representative mediates between two other factions (choose the second in the dashboard or RP). Improves your standing with both.', unilateral: true, requires: { minRelation: 0 }, costInfluence: 10, onAccept: { relation: 5, influence: 6 } }),
  A('break', 'Break a Treaty', '✂️', 'hostile', { description: 'Tear up a treaty. Everyone sees you as untrustworthy.', unilateral: true, requires: {}, costInfluence: 10, onAccept: { relation: -15, breaksAny: true, reputation: -8 } }),
];

// ─────────────────────────── Armies ───────────────────────────
// Stats per soldier. counters: × attack against armies made of that role. needs: goods per 100 men.
const UNIT_TYPES = [
  // EU4-style pips: fire = ranged phase, shock = melee phase; off = damage dealt, def = damage resisted (0–5).
  // morale: × the army's morale; counters: × damage against armies made of that role.
  // power: how many ordinary soldiers one of these is worth (hits harder, takes more to kill). Default 1.
  { id: 'militia', name: 'Militia', emoji: '', role: 'infantry', fireOff: 0, fireDef: 0, shockOff: 1, shockDef: 1, morale: 0.8, attack: 1, defense: 1, speed: 1, cost: 20, upkeep: 1, needs: { arms: 0.5 }, counters: {} },
  { id: 'spearmen', name: 'Spearmen', emoji: '', role: 'spear', fireOff: 0, fireDef: 1, shockOff: 1, shockDef: 3, morale: 1, attack: 2, defense: 3, speed: 1, cost: 45, upkeep: 2, needs: { arms: 1.5 }, counters: { cavalry: 1.5 } },
  { id: 'swordsmen', name: 'Shield & Sabre', emoji: '', role: 'infantry', fireOff: 0, fireDef: 2, shockOff: 2, shockDef: 2, morale: 1, attack: 3, defense: 3, speed: 1, cost: 55, upkeep: 2.5, needs: { arms: 2 }, counters: {} },
  { id: 'crossbows', name: 'Crossbowmen', emoji: '', role: 'ranged', fireOff: 3, fireDef: 1, shockOff: 0, shockDef: 0, morale: 0.9, attack: 3, defense: 1, speed: 1, cost: 60, upkeep: 2.5, needs: { arms: 2 }, counters: {} },
  { id: 'light-cav', name: 'Light Cavalry', emoji: '', role: 'cavalry', power: 1.3, fireOff: 1, fireDef: 1, shockOff: 3, shockDef: 1, morale: 1.1, attack: 3, defense: 2, speed: 2, cost: 80, upkeep: 4, needs: { arms: 1, horses: 1 }, counters: { ranged: 1.5 }, pursuit: 1.5 },
  { id: 'heavy-cav', name: 'Armoured Cavalry', emoji: '', role: 'cavalry', power: 1.8, fireOff: 0, fireDef: 1, shockOff: 4, shockDef: 2, morale: 1.2, attack: 5, defense: 4, speed: 1.5, cost: 140, upkeep: 6, needs: { arms: 3, horses: 1 }, counters: { ranged: 1.3, infantry: 1.15 }, pursuit: 1.2 },
  { id: 'disciples', name: 'Sect Disciples', emoji: '', role: 'martial', power: 5, fireOff: 2, fireDef: 2, shockOff: 5, shockDef: 3, morale: 1.4, attack: 9, defense: 7, speed: 1.6, cost: 300, upkeep: 8, needs: { arms: 1, medicine: 1 }, counters: {}, kinds: ['sect', 'clan', 'palace', 'cult'], description: 'Trained martial artists of the Third and Second Rate. Few, but each is worth a squad.' },
  { id: 'engineers', name: 'Siege Engineers', emoji: '', role: 'siege', fireOff: 1, fireDef: 0, shockOff: 0, shockDef: 0, morale: 0.7, attack: 1, defense: 1, speed: 0.6, cost: 90, upkeep: 3, needs: { timber: 4, iron: 1 }, counters: {}, siege: 0.25, description: 'Ignore part of the defender\'s walls.' },
];
// Formations (EU4-style modifiers). fire / shock: × damage dealt in that phase. defense: damage taken is divided by it.
// morale: × morale. maneuver: + general maneuver pips (beats terrain and the enemy's maneuver). width: × combat width.
// vsRole: × damage against roles. requires: { minMen, roles: { role: minimum share }, commanderRealm (0 = 3rd Rate), commanderSect: [...] }
const F = (id, name, hanzi, o) => ({ id, name, hanzi, emoji: '', fire: 1, shock: 1, defense: 1, morale: 1, maneuver: 0, width: 1, vsRole: {}, requires: {}, description: '', scriptId: '', ...o });
const FORMATIONS = [
  F('square', 'Square', '方陣', { defense: 1.2, fire: 0.9, shock: 0.9, vsRole: { cavalry: 1.15 }, description: 'Shields outward on every side. Hard to break; cavalry breaks on it.' }),
  F('fish-scale', 'Fish Scale', '魚鱗', { shock: 1.15, description: 'Overlapping wedges that punch through the centre. Better in melee.' }),
  F('crane-wing', 'Crane Wing', '鶴翼', { shock: 1.1, width: 1.2, defense: 0.95, requires: { minMen: 1500 }, description: 'Wings sweep around the enemy: more men can fight at once. Needs numbers.' }),
  F('arrowhead', 'Arrowhead', '鋒矢', { shock: 1.25, defense: 0.85, description: 'Everything into one spearpoint. Devastating — or suicidal.' }),
  F('long-snake', 'Long Snake', '長蛇', { maneuver: 1, defense: 0.95, description: 'A column that turns like a snake: +1 maneuver (shrugs off bad terrain).' }),
  F('crescent', 'Crescent Moon', '偃月', { shock: 1.1, defense: 1.05, requires: { roles: { cavalry: 0.15 } }, description: 'A strong centre with cavalry horns. Balanced.' }),
  F('wild-geese', 'Wild Geese', '雁行', { fire: 1.3, shock: 0.95, requires: { roles: { ranged: 0.25 } }, description: 'Staggered lines so every crossbow has a clear shot. Better in the fire phase.' }),
  F('yoke', 'Yoke', '衡軛', { defense: 1.1, fire: 1.1, vsRole: { cavalry: 1.1 }, description: 'Spearmen yoked in front of crossbows. A moving wall.' }),
  F('eight-trigrams', 'Eight Trigrams', '八卦陣', { defense: 1.25, fire: 1.05, shock: 1.05, morale: 1.1, maneuver: 1, requires: { commanderRealm: 3, minMen: 800 }, description: 'Eight gates, one way out. Needs a commander of the Expert realm or higher.' }),
  F('scattered', 'Scattered Stars', '散星', { fire: 0.9, defense: 1.1, maneuver: 1, requires: { roles: { martial: 0.1 } }, description: 'Martial artists fight in small loose groups: arrows find no wall to hit, terrain matters less.' }),
];
// Tactics, chosen per round. beats: × attack when the enemy chose that tactic this round.
const TACTICS = [
  { id: 'hold', name: 'Hold the Line', emoji: '🛡️', attack: 0.8, defense: 1.3, beats: { charge: 1.2, flank: 1.0 }, description: 'Stand firm and let them come.' },
  { id: 'charge', name: 'Charge', emoji: '🐎', attack: 1.35, defense: 0.85, beats: { volley: 1.25, feint: 0.75 }, description: 'All-out assault.' },
  { id: 'volley', name: 'Volley', emoji: '🏹', attack: 1.0, defense: 1.0, ranged: 1.6, melee: 0.6, beats: { hold: 1.25 }, description: 'Ranged units fire everything; melee waits.' },
  { id: 'flank', name: 'Flank', emoji: '↪️', attack: 1.15, defense: 0.95, cavalry: 1.4, beats: { hold: 1.2, volley: 1.15 }, description: 'Send the cavalry around.' },
  { id: 'feint', name: 'Feint', emoji: '🎭', attack: 0.75, defense: 1.1, beats: { charge: 1.3 }, exposes: 0.85, description: 'Fake a retreat; their next defence is 15% weaker.' },
  { id: 'ambush', name: 'Ambush', emoji: '🌲', attack: 1.6, defense: 1.0, firstRoundOnly: true, needsAmbush: true, moraleHit: 10, description: 'Only in the first round, and only where the land hides you (hills, forest, mountains, highland). Shocks the enemy.' },
  { id: 'fire', name: 'Fire Attack', emoji: '🔥', attack: 1.4, defense: 0.95, seasons: [1, 2], moraleHit: 6, backfire: 0.2, beats: { hold: 1.3 }, description: 'Summer and autumn only. 20% chance the wind turns.' },
  { id: 'retreat', name: 'Retreat', emoji: '🏃', attack: 0.3, defense: 1.2, retreat: true, description: 'Withdraw. The battle ends after this round; their cavalry pursues.' },
];

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON_EMOJI = ['🌸', '☀️', '🍂', '❄️'];

const DEFAULT_WORLD_SETTINGS = {
  enabled: true,
  paused: false,
  turnHours: 6,
  turnsPerSeason: 28,
  startYear: 428,
  eraName: 'Murim Calendar',
  eventRate: 1,
  maxNewEventsPerTurn: 2,
  stockTurns: 5,
  minStockValue: 300,
  minPriceMul: 0.35,
  maxPriceMul: 4,
  spread: 8,
  baseTariff: 3,
  travelHoursPer100: 1.5,
  caravanHoursPer100: 2,
  maxPlayerCaravans: 2,
  caravanCapacity: 120,
  escortCost: 0.08,
  maxWorkshopsPerCharacter: 2,
  workshopSlotsBase: 2,
  npcCaravansPerTurn: 20,
  peddlerRate: 0.5,
  supplyResponse: 0.4,
  guildShare: 0.1,
  adminCost: 1.5,
  householdIncome: 1,
  spendingToCoffers: 0.9,
  maxCoffersPerPop: 60,
  shopSwingMax: 25,
  shopTiers: { member: -15, ally: -5, neutral: 10, rival: 30, war: null },
  rivalBelow: -30,
  battlePrepHours: 24,
  battleDays: 30,
  pipStat: 30,
  championDicePer: 600,
  maxChampionDice: 2,
  duelMomentum: 1,
  maxMomentum: 2,
  casualtyScale: 0.5,
  moraleScale: 400,
  wallStrength: 0.2,
  // Champion power in battle = (Strength + Endurance + Mobility) × this multiplier for their realm (3rd Rate first).
  // A Peak master (≈250 stats × 6.5) is worth about 800 spearmen.
  championRealmMult: [1, 1.5, 2, 3, 4.5, 6.5, 9, 12, 16, 21, 27, 35],
  championScale: 1,
  autoConquest: false,
  occupationTurns: 12,
  startRegion: '河南/洛阳',
  underdogBonus: 0,
  powerWeights: { military: 0.35, economy: 0.3, politics: 0.2, cultivation: 0.15 },
  includeNpcInBalance: false,
  representativeRoleIds: [],
  postTurnSummary: false,
  travelMode: 'channel',
  kmPerPx: 5,
  travelSpeeds: [{ id: 'foot', label: 'On foot', kmPerDay: 30 }, { id: 'horse', label: 'By horse', kmPerDay: 60 }, { id: 'qinggong', label: 'Qinggong', kmPerDay: 150 }],
  maxTradePerTurn: 3000,
  maxRepresentatives: 2,
  representativesFight: false,
  baseIncome: 5,
  memberIncome: 3,
  stipendEveryTurns: 28,
  maxStipendRate: 30,
  stipendSoftCap: 150,
  repWeight: 2,
  leaderWeight: 3,
};

module.exports = {
  GOODS, GOOD_CATEGORIES, WORKSHOP_TYPES, TERRAINS, PROVINCES, START_WORKSHOPS, SPECIAL, ROUTES,
  FACTION_SEEDS, EXTRA_FACTIONS, EVENTS, POLICIES, TREATY_TYPES, DIPLOMACY_ACTIONS, UNIT_TYPES, FORMATIONS, TACTICS,
  SEASONS, SEASON_EMOJI, DEFAULT_WORLD_SETTINGS,
};
