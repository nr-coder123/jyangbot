'use strict';
/**
 * Message templates. Every embed the bot shows — menu panels and announcements — is a
 * Discohook-compatible message ({ content, embeds:[...] }) editable in the dashboard → Messages.
 * {placeholders} are filled when the message is sent; {e.key} inserts an emoji from Emojis & Buttons.
 * Fields whose value ends up empty are left out automatically.
 */
const ui = require('./ui');
const { clone, truncate } = require('../utils');

const E = (embed, content = '') => ({ content, embeds: [embed] });
const NAV = ['sheet', 'stats', 'inventory', 'market', 'realm'];

const SAMPLE_CHAR = {
  name: 'Chung Myung', nameAndTitle: 'Chung Myung, "Rising Dragon"', title: 'Rising Dragon', sect: 'Mount Hua Sect',
  player: '<@100000000000000001>', staff: '<@100000000000000002>', owner: '<@100000000000000001>', approvedBy: 'StaffMember',
  currency: 'Nyang', nyang: '120', rolls: '2', realm: '2nd Rate', qi: '__34__', qiBars: '__4.5__', impurity: '20',
  strength: '__40__', endurance: '30', mobility: '28', statTotal: '93',
};

const DEFS = {
  // ---------------- menu panels ----------------
  characterSheet: {
    group: 'Menu', label: 'Character Sheet (/menu → Sheet)',
    buttons: [NAV],
    placeholders: ['nameAndTitle', 'name', 'title', 'sect', 'weapon', 'weaponGrade', 'weaponDescription', 'strength', 'endurance', 'mobility', 'qi', 'qiBars', 'impurity', 'realm',
      'cultivationMethods', 'qiCore', 'traits', 'nyang', 'currency', 'rolls', 'coreArts', 'specialArts', 'forbiddenArts', 'genericArts', 'statTotal', 'unspent', 'nextRealm',
      'bonuses', 'caps', 'effects', 'owner', 'approvedBy'],
    help: 'Stats changed by a weapon or an effect are __underlined__ automatically, and explained in {bonuses}.',
    sample: {
      ...SAMPLE_CHAR, weapon: 'Plum Blossom Sword — Spiritual Treasure', weaponGrade: 'Spiritual Treasure', weaponDescription: 'A sword carved from a plum tree said to bloom in winter.',
      cultivationMethods: 'Qi Gathering\nThree Hearts Cultivation Method', qiCore: 'Normal Qi Core', traits: 'Sword Sense, Mentor',
      coreArts: 'Plum Blossom Sword Style', specialArts: '', forbiddenArts: '', genericArts: 'Surface Steps Qi',
      unspent: '0 stat points (Strength/Endurance/Mobility) · 5 flexible points (any stat, incl. Qi) — press 📊 Stats in /menu',
      nextRealm: 'Next Realm: **1st Rate —** needs 100 Stat Points & 40 Qi.',
      bonuses: '+5 Strength — Plum Blossom Sword (Spiritual Treasure)\n+0.5 Qi Bars — Plum Blossom Sword (Spiritual Treasure)', caps: '', effects: '',
    },
    default: E({
      title: '[CHARACTER SHEET]',
      color: 13867776,
      fields: [
        { name: 'Name & Title', value: '{nameAndTitle}', inline: true },
        { name: 'Sect', value: '{sect}', inline: true },
        { name: '**[__Main Weapon__]**', value: '{weapon}\n-# {weaponDescription}', inline: false },
        { name: '**[``Stats``]**', value: '**Strength**: {strength}\n**Mobility**: {mobility}\n**Endurance**: {endurance}', inline: true },
        { name: '**[``Qi/Impurity``]**', value: '**Qi**: {qi}\n**Qi Bars**: {qiBars}\n**Impurity**: {impurity}', inline: true },
        { name: '[__Realm__]', value: '{realm}', inline: true },
        { name: '**[``Cultivation Methods``]**', value: '{cultivationMethods}', inline: true },
        { name: '**[``Special Traits``]**', value: '{traits}', inline: true },
        { name: '[__Purse__]', value: '{e.nyang} {nyang} {currency}\n{e.rolls} {rolls} drop roll(s)', inline: true },
        { name: '**[``Martial Arts``]**', value: '**Core**: {coreArts}\n**Special**: {specialArts}\n**Forbidden/Heavenly**: {forbiddenArts}\n**Generic**: {genericArts}', inline: false },
        { name: '**[``Bonuses``]**', value: '{bonuses}', inline: false },
        { name: '[__``𝗣𝗥𝗢𝗚𝗥𝗘𝗦𝗦𝗜𝗢𝗡``__]', value: '**Stat Total**: {statTotal} (Qi not counted)\n**Unspent**: {unspent}\n\n_{nextRealm}_', inline: false },
        { name: '**[``Caps``]**', value: '{caps}', inline: false },
        { name: '**[``Active Effects``]**', value: '{effects}', inline: false },
      ],
    }),
  },
  statsPanel: {
    group: 'Menu', label: 'Stats panel (/menu → Stats)',
    buttons: [NAV, ['addStat:1:strength', 'addStat:1:endurance', 'addStat:1:mobility', 'addStat:1:qi'], ['addStat:5:strength', 'addStat:5:endurance', 'addStat:5:mobility', 'addStat:5:qi'], ['spend', 'typeChat', 'undo']],
    placeholders: ['name', 'strength', 'endurance', 'mobility', 'qi', 'qiBars', 'statTotal', 'normalPoints', 'flexPoints', 'maxPerStat', 'percentRule', 'realm', 'capSummary', 'caps', 'hint'],
    sample: { ...SAMPLE_CHAR, normalPoints: '10', flexPoints: '5', maxPerStat: '54', percentRule: '50', capSummary: 'Stats: soft 100 / hard 110 · Qi: soft 40 / hard 55', caps: '', hint: 'Tap +1 / +5, or ✏️ Spend to enter several stats at once.' },
    default: E({
      title: '{e.stats} {name} — Stats',
      color: 0xb3261e,
      description: '{e.strength} **Strength** {strength}\n{e.endurance} **Endurance** {endurance}\n{e.mobility} **Mobility** {mobility}\n{e.qi} **Qi** {qi}\nStat total: **{statTotal}** *(Qi not counted)* · {e.qiBars} Qi Bars: **{qiBars}**\n\n**Points to spend**\n• **{normalPoints}** stat points — Strength / Endurance / Mobility\n• **{flexPoints}** flexible points — any stat, including Qi\nNo stat may go above **{maxPerStat}** ({percentRule}% rule).\n\nCaps for {realm}: {capSummary}\n{caps}',
      footer: { text: '{hint}' },
    }),
  },
  inventoryPanel: {
    group: 'Menu', label: 'Inventory (/menu → Inventory)',
    buttons: [NAV, ['select:Pick an item to see, use, learn, equip or sell'], ['roll', 'craft', 'rates']],
    placeholders: ['name', 'items', 'weapon', 'nyang', 'currency', 'rolls'],
    sample: { ...SAMPLE_CHAR, weapon: 'Plum Blossom Sword', items: '**🟨 Immortal**\n💠 **Three Hearts Cultivation Method** ×1 · *cultivation*\n**🟩 Earthly**\n🗡️ **Default Weapon** ×1 · *weapon*\n💊 **Qi Gathering Pill** ×3 · *pill*' },
    default: E({
      title: '{e.inventory} {name}\'s Inventory',
      color: 0x7a5c2e,
      description: '{items}',
      fields: [{ name: '{e.weapon} Main weapon', value: '{weapon}', inline: false }],
      footer: { text: '{nyang} {currency} · {rolls} drop roll(s) · pick an item below to see or use it' },
    }),
  },
  itemInfo: {
    group: 'Menu', label: 'Item details (inventory, /item)',
    buttons: [NAV, ['consume', 'learn', 'equip', 'sellShop', 'list'], ['back']],
    help: 'The embed color is the rarity color unless you set one here.',
    placeholders: ['item', 'emoji', 'rarity', 'rarityEmoji', 'type', 'description', 'details', 'trading', 'owned'],
    sample: { item: 'Qi Gathering Pill', emoji: '💊', rarity: 'Earthly', rarityEmoji: '🟩', type: 'pill', description: 'A basic pill that gathers ambient Qi.', details: 'Yield: **+5 Qi**\nImpurity: **10**\nAffinity: Wood', trading: 'Shop: **50** Nyang · Tradeable · Can be sold on the player market', owned: '×3' },
    default: E({
      title: '{emoji} {item}',
      description: '{description}',
      fields: [
        { name: 'Rarity', value: '{rarityEmoji} {rarity}', inline: true },
        { name: 'Type', value: '{type}', inline: true },
        { name: 'Owned', value: '{owned}', inline: true },
        { name: 'Details', value: '{details}', inline: false },
        { name: 'Trading', value: '{trading}', inline: false },
      ],
    }),
  },
  marketPanel: {
    group: 'Menu', label: 'Market (/menu → Market, /market)',
    buttons: [NAV, ['select:Pick something to buy'], ['filterAll', 'filterPlayers', 'filterShop', 'prev', 'next']],
    placeholders: ['filter', 'entries', 'page', 'pages', 'nyang', 'currency'],
    sample: { filter: 'Everything', entries: '🏮 💊 **Qi Gathering Pill** — 🪙 50 · Shop\n👥 🟦 **Plum Blossom Sword Manual** ×1 — 🪙 900 · by Baek Cheon', page: '1', pages: '1', nyang: '120', currency: 'Nyang' },
    default: E({
      title: '{e.market} Market — {filter}',
      color: 0x16a085,
      description: '{entries}',
      footer: { text: 'Page {page}/{pages} · Your purse: {nyang} {currency} · Sell your items from Inventory → List on market' },
    }),
  },
  marketEntry: {
    group: 'Menu', label: 'Market — item for sale',
    buttons: [NAV, ['buy1', 'buyAmount', 'unlist', 'back']],
    placeholders: ['item', 'emoji', 'rarity', 'description', 'price', 'seller', 'available', 'details', 'nyang', 'currency'],
    sample: { item: 'Plum Blossom Sword Manual', emoji: '🟦', rarity: 'Heavenly', description: 'A sword style known for fluid and precise attacks.', price: '🪙 900 Nyang each', seller: 'Baek Cheon', available: '1', details: 'Core martial art', nyang: '1200', currency: 'Nyang' },
    default: E({
      title: '{emoji} {item}',
      description: '{description}',
      fields: [
        { name: 'Price', value: '{price}', inline: true },
        { name: 'Seller', value: '{seller}', inline: true },
        { name: 'Available', value: '{available}', inline: true },
        { name: 'Details', value: '{details}', inline: false },
      ],
      footer: { text: 'Your purse: {nyang} {currency}' },
    }),
  },
  realmPanel: {
    group: 'Menu', label: 'Realm (/menu → Realm)',
    buttons: [NAV, ['breakthrough']],
    placeholders: ['name', 'realm', 'qiBars', 'statTotal', 'qi', 'capSummary', 'caps', 'next', 'ladder'],
    sample: { ...SAMPLE_CHAR, capSummary: 'Stats: soft 100 / hard 110 · Qi: soft 40 / hard 55', caps: '', ladder: '· 3rd Rate\n▶ **2nd Rate**\n　1st Rate\n　Expert', next: '**Next realm: 1st Rate**\n✅ 100 stat points\n❌ 40 Qi\n\n**Breakthrough chance: 90%**\n-# Base 85% · pills +5%' },
    default: E({
      title: '{e.realm} {name} — {realm}',
      color: 0x6a4c93,
      description: 'Qi Bars: **{qiBars}** · Stat total: **{statTotal}** · Qi: **{qi}**\n{capSummary}\n{caps}\n\n{next}',
      fields: [{ name: 'Realms', value: '{ladder}', inline: false }],
    }),
  },
  craftPanel: {
    group: 'Menu', label: 'Crafting list (/menu → Inventory → Crafting)',
    buttons: [NAV, ['select:Pick a recipe'], ['prev', 'next', 'back']],
    placeholders: ['recipes', 'page', 'pages'],
    sample: { recipes: '✅ **Qi Gathering Pill** — 3× Spirit Herb → 1× Qi Gathering Pill (80%)\n▫️ **Iron Sword** — 2× Iron Ore + 50 Nyang → 1× Iron Sword', page: '1', pages: '1' },
    default: E({ title: '{e.craft} Crafting', color: 0x2e8b57, description: '{recipes}', footer: { text: '✅ = you can craft it now · Page {page}/{pages}' } }),
  },
  recipePanel: {
    group: 'Menu', label: 'Crafting — one recipe',
    buttons: [NAV, ['craftDo', 'back']],
    placeholders: ['recipe', 'description', 'needs', 'makes', 'chance'],
    sample: { recipe: 'Qi Gathering Pill', description: 'Refine herbs into a pill.', needs: '✅ 3× Spirit Herb *(you have 4)*', makes: '1× Qi Gathering Pill', chance: 'Success chance: **80%** — materials are lost on failure' },
    default: E({ title: '{e.craft} {recipe}', color: 0x2e8b57, description: '{description}\n**Needs**\n{needs}\n\n**Makes**\n{makes}\n\n{chance}' }),
  },
  dropRates: {
    group: 'Menu', label: 'Drop rates (/menu → Inventory → Drop rates)',
    buttons: [NAV, ['back']],
    placeholders: ['rates', 'note'],
    sample: { rates: '🟩 **Earthly** — 75% · 12 item(s) can drop\n🟦 **Heavenly** — 20% · 5 item(s) can drop\n🟨 **Immortal** — 5% · 1 item(s) can drop', note: 'Each roll uses one drop roll.' },
    default: E({ title: '📈 Drop rates', color: 0x7a5c2e, description: '{rates}', footer: { text: '{note}' } }),
  },
  consumeResult: {
    group: 'Menu', label: 'Pill consumed (menu, /consume)',
    placeholders: ['name', 'player', 'item', 'lines'],
    sample: { name: 'Chung Myung', player: '<@100000000000000001>', item: 'Qi Gathering Pill', lines: '**Yield:** 10 Qi\n**Absorption:** +20% (Wood +20%) → +2 Qi\n**Gained:** +12 Qi (now 46)\n**Impurity:** 15 − 30% (cultivation) → 10.5 · now **30.5** *(4.5 shaved off)*' },
    default: E({ title: '{e.pill} {name} consumed {item}', color: 0x8e44ad, description: '{lines}' }),
  },
  compare: {
    group: 'Commands', label: 'Stat comparison (/compare)',
    placeholders: ['first', 'second', 'header', 'firstHits', 'secondHits', 'clash', 'clashWinner', 'speed', 'faster', 'notes'],
    sample: { first: 'Chung Myung', second: 'Baek Cheon', header: '**Chung Myung** — 2nd Rate · **Baek Cheon** — 2nd Rate · Same realm tier\n💪 Strength: 40 vs 25\n🛡️ Endurance: 30 vs 28', firstHits: 'STR 40 − END 28 = **+12** → **T5 Normal**\nGoes 0.5 to 1 inch into the body…', secondHits: 'STR 25 − END 30 = **−5** → **T3 Minor**', clash: '**Deflection** *(+15)*\nThe loser\'s blade is likely knocked aside…', clashWinner: ' — Chung Myung wins', speed: '**T2 Slight** *(+5)*', faster: ' — Chung Myung is faster', notes: 'All results assume a hit to the TORSO.' },
    default: E({
      title: '⚔️ {first} vs {second}',
      color: 0xb3261e,
      description: '{header}',
      fields: [
        { name: '🗡️ {first} hits {second}', value: '{firstHits}', inline: false },
        { name: '🗡️ {second} hits {first}', value: '{secondHits}', inline: false },
        { name: '💥 Clash{clashWinner}', value: '{clash}', inline: false },
        { name: '{e.mobility} Speed{faster}', value: '{speed}', inline: false },
      ],
      footer: { text: '{notes}' },
    }),
  },

  // ---------------- announcements ----------------
  progressionReport: {
    group: 'Announcements', label: 'Progression Report (/give, progress rewards)',
    placeholders: ['player', 'character', 'summary', 'details', 'staff', 'reason'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', summary: '+50 Stat Points', details: 'Spendable on Strength / Endurance / Mobility.', staff: '<@100000000000000002>', reason: 'Won the duel at Mount Hua' },
    default: E({ color: 0xd9a441, description: '## Progression Report\n{summary} to {player}\n{details}\n## Approved by\n{staff}', footer: { text: '{reason}' } }, '{player}'),
  },
  deductionReport: {
    group: 'Announcements', label: 'Deduction Report (/take)',
    placeholders: ['player', 'character', 'summary', 'details', 'staff', 'reason'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', summary: '-5 Strength', details: '↩️ Refunded as 5 unspent stat points.', staff: '<@100000000000000002>', reason: 'Respec' },
    default: E({ color: 0x8b1e1e, description: '## Deduction Report\n{summary} from {player}\n{details}\n## Issued by\n{staff}', footer: { text: '{reason}' } }, '{player}'),
  },
  applicationPost: {
    group: 'Announcements', label: 'New application (submissions channel)',
    placeholders: ['player', 'character', 'sect', 'document', 'id'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', sect: 'Mount Hua Sect', document: 'https://docs.google.com/…', id: 'A1b2c3d4' },
    buttons: [['approveBtn', 'rejectBtn']],
    default: E({ color: 0xd4a017, title: '📜 Character Application — {character}', description: '**Player:** {player}\n**Sect:** {sect}\n**Document:** {document}', footer: { text: 'Application {id}' } }),
  },
  applicationApproved: {
    group: 'Announcements', label: 'Character approved',
    placeholders: ['player', 'character', 'sect', 'staff', 'points', 'perks', 'roles'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', sect: 'Mount Hua Sect', staff: '<@100000000000000002>', points: '50', perks: 'Core art: **Plum Blossom Sword**', roles: 'Roles: <@&100000000000000003>' },
    default: E({ color: 0x3aa55d, title: '✅ {character} has been approved!', description: 'Approved by {staff}.\nYou have **{points}** starting points to spend anywhere (Qi included).\nType **/menu** and press **{e.stats} Stats** to build your sheet.\n{perks}\n{roles}' }, '{player}'),
  },
  applicationRejected: {
    group: 'Announcements', label: 'Character rejected (sent by DM)',
    placeholders: ['player', 'character', 'staff', 'reason'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', staff: '<@100000000000000002>', reason: 'Please add a backstory.' },
    default: E({ color: 0xc0392b, title: '❌ Application not approved', description: 'Your application for **{character}** was not approved by {staff}.\n{reason}' }, '{player}'),
  },
  progressPost: {
    group: 'Announcements', label: 'Progress submission (progress channel)',
    placeholders: ['player', 'character', 'link', 'summary', 'breakthrough', 'id'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', link: 'https://discord.com/channels/…', summary: 'Fought the bandit leader.', breakthrough: '🌟 **Breakthrough requested (Qi)**', id: 'P1a2b3c4' },
    buttons: [['grantBtn', 'dismissBtn']],
    default: E({ color: 0xd4a017, title: '⚔️ Progress — {character}', description: '**Player:** {player}\n**Link:** {link}\n{breakthrough}\n{summary}', footer: { text: 'Submission {id}' } }),
  },
  breakthroughSuccess: {
    group: 'Announcements', label: 'Realm Breakthrough — success',
    placeholders: ['player', 'character', 'from', 'realm', 'chance', 'roll'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', from: '1st Rate', realm: 'Expert', chance: '75', roll: '42.1' },
    default: E({ color: 0xf1c40f, title: '🌟 {character} broke through to {realm}!', description: 'From **{from}** to **{realm}**.\nChance: **{chance}%** · Rolled **{roll}**' }, '{player}'),
  },
  breakthroughFail: {
    group: 'Announcements', label: 'Realm Breakthrough — failure',
    placeholders: ['player', 'character', 'from', 'realm', 'chance', 'roll'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', from: '1st Rate', realm: 'Expert', chance: '75', roll: '88.4' },
    default: E({ color: 0x7f8c8d, title: '💢 {character} failed to reach {realm}', description: 'Chance: **{chance}%** · Rolled **{roll}**\nPill bonuses were spent. Gather yourself and try again.' }),
  },
  rollResult: {
    group: 'Announcements', label: 'Drop roll result',
    placeholders: ['player', 'character', 'item', 'rarity', 'emoji', 'description'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', item: 'Plum Blossom Sword Manual', rarity: 'Heavenly', emoji: '🟦', description: 'A sword style known for fluid and precise attacks.' },
    default: E({ title: '{e.rolls} {character} found {emoji} {item}!', description: '**Rarity:** {rarity}\n{description}' }),
  },
  craftSuccess: {
    group: 'Announcements', label: 'Crafting — success',
    placeholders: ['player', 'character', 'recipe', 'items'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', recipe: 'Qi Gathering Pill', items: '1× Qi Gathering Pill' },
    default: E({ color: 0x2e8b57, title: '{e.craft} {character} crafted {recipe}!', description: 'Obtained: {items}' }),
  },
  craftFail: {
    group: 'Announcements', label: 'Crafting — failure',
    placeholders: ['player', 'character', 'recipe', 'items'],
    sample: { player: '<@100000000000000001>', character: 'Chung Myung', recipe: 'Qi Gathering Pill', items: '1× Qi Gathering Pill' },
    default: E({ color: 0x7f8c8d, title: '💥 {character} failed to craft {recipe}', description: 'The materials were lost.' }),
  },

  // ---------------- world (/world) ----------------
  worldRegion: {
    group: 'World', label: 'Region (/world → Region)',
    buttons: [['wRegion', 'wMarket', 'wPolitics', 'wWar']],
    placeholders: ['region', 'province', 'hanzi', 'controller', 'terrain', 'population', 'prosperity', 'prosperityBar', 'security', 'fort', 'buildings', 'coffers', 'calendar', 'events', 'decrees', 'you', 'notes', 'armies', 'currency', 'trend'],
    help: '{prosperityBar} is a ten-block bar.',
    sample: { region: 'Luoyang', province: 'Henan', hanzi: '洛阳', controller: '🪷 Shaolin Sect', terrain: '🌾 Plains', population: '21', prosperity: '64', prosperityBar: '🟩🟩🟩🟩🟩🟩⬛⬛⬛⬛', security: '61', fort: '4', buildings: 'Granary · City Walls (damaged)', coffers: '1,240', calendar: '🌸 Spring, day 3 · Year 428', events: '🎪 Great Trade Fair (3 turns left)', decrees: '🪖 Conscription (5 turns left)', notes: 'Ancient capital: sword manors and the great market.', armies: '', currency: 'Nyang', trend: '📈 +0.4 / turn' },
    default: E({
      title: '{region} · {hanzi}',
      description: '-# {province} · {calendar}\n{notes}',
      color: 0xc0a062,
      fields: [
        { name: 'Ruled by', value: '{controller}', inline: true },
        { name: 'Land', value: '{terrain} · Walls {fort}', inline: true },
        { name: 'People', value: '{population}k households', inline: true },
        { name: 'Prosperity', value: '{prosperityBar} **{prosperity}**\n-# {trend}', inline: false },
        { name: 'Security', value: '{security}', inline: true },
        { name: 'Buildings', value: '{buildings}', inline: true },
        { name: 'Merchants\' purse', value: '{e.nyang} {coffers}', inline: true },
        { name: 'Happening now', value: '{events}', inline: false },
        { name: 'Decrees', value: '{decrees}', inline: false },
        { name: 'Armies here', value: '{armies}', inline: false },
      ],
    }),
  },
  worldMarket: {
    group: 'World', label: 'Regional market (/world → Market)',
    buttons: [['wRegion', 'wMarket', 'wPolitics', 'wWar']],
    placeholders: ['region', 'goods', 'nyang', 'currency', 'coffers'],
    sample: { region: 'Luoyang', goods: '🌾 **Grain** 4.2 ▲ · stock ●●●○\n🧂 **Salt** 13.1 ▼ · stock ●○○○', nyang: '120', currency: 'Nyang', coffers: '1,240' },
    default: E({
      title: '🏪 Market of {region}',
      description: '{goods}',
      color: 0xc0a062,
      footer: { text: 'Prices per unit in this province — merchants and guild caravans trade here. Trade goods you own sell from your inventory at the realm-wide price.' },
    }),
  },
  worldEvent: {
    group: 'World', label: 'World event announcement',
    placeholders: ['text', 'name', 'emoji', 'description', 'regions', 'turns', 'calendar'],
    sample: { text: '☀️ **Drought** in **Henan**. No rain for weeks. Fields crack and wells run dry.', name: 'Drought', emoji: '☀️', description: 'No rain for weeks. Fields crack and wells run dry.', regions: 'Henan', turns: '8', calendar: '☀️ Summer, day 4 · Year 428' },
    default: E({ color: 0xb3261e, description: '{text}', footer: { text: '{calendar}' } }),
  },
  worldInfoPost: {
    group: 'World', label: 'Region information post (#place-information)',
    help: 'Posted once when staff press Send (Regions tab or the region\'s panel). People press the button and see the region\'s live information, only to them — nothing is edited afterwards.',
    buttons: [['wInfo']],
    placeholders: ['region', 'province', 'hanzi', 'notes'],
    sample: { region: 'Luoyang', province: 'Henan', hanzi: '洛阳', notes: 'Ancient capital: sword manors and the great market.' },
    default: E({ title: '{region} · {hanzi}', description: '-# {province}\n{notes}\n\nPress **Information** to see who rules it, how it is doing, its buildings, events and armies — only you will see it.', color: 0xc0a062 }),
  },
  worldNews: {
    group: 'World', label: 'World news (diplomacy, decrees, wars)',
    placeholders: ['text', 'calendar'],
    sample: { text: '🤝 **Propose Trade Agreement** — **Wudang Sect** and **Shaolin Sect**.', calendar: '🌸 Spring, day 3 · Year 428' },
    default: E({ color: 0x2980b9, description: '{text}', footer: { text: '{calendar}' } }),
  },
  worldProposal: {
    group: 'World', label: 'Diplomatic proposal (diplomacy channel)',
    buttons: [['wAccept', 'wDecline']],
    placeholders: ['action', 'emoji', 'from', 'to', 'proposer', 'description', 'note', 'step', 'characters', 'expires', 'pings'],
    sample: { action: 'Political Marriage', emoji: '💍', from: 'Mount Hua Sect', to: 'Namgoong Clan', proposer: 'Chung Myung (<@100000000000000001>)', description: 'Marry a character of your house to one of theirs.', note: 'May our houses be joined in spring.', step: 'Waiting for a Namgoong Clan representative.', characters: 'Yoon Jong ⇄ Namgoong Dowi', expires: '<t:1900000000:R>', pings: '<@100000000000000002>' },
    default: E({
      title: '{emoji} {action}',
      description: '**{from}** → **{to}**\n{description}\n\n> {note}',
      color: 0x8e44ad,
      fields: [
        { name: 'Proposed by', value: '{proposer}', inline: true },
        { name: 'Characters', value: '{characters}', inline: true },
        { name: 'Next', value: '{step}', inline: false },
      ],
      footer: { text: 'Expires {expires}' },
    }, '{pings}'),
  },
  worldBattle: {
    group: 'World', label: 'Battle (war channel)',
    buttons: [['wJoinA', 'wJoinD', 'wPlan', 'wDuel']],
    placeholders: ['region', 'attacker', 'defender', 'attackerArmy', 'defenderArmy', 'resolves', 'duels', 'champions', 'terrain', 'fort'],
    sample: { region: 'Kaifeng', attacker: 'Blood Cult', defender: 'Shaolin Sect', attackerArmy: '1,200 Spearmen · 400 Crossbowmen\nFormation: Arrowhead · Duel dice +1\nCommander: Baek Cheon (fire 2 · shock 3 · maneuver 1)', defenderArmy: '900 Shield & Sabre · 150 Sect Disciples\nFormation: Square', resolves: '<t:1900000000:R>', duels: '🤺 Chung Myung defeated Baek Cheon', champions: 'Attacker: Baek Cheon\nDefender: Chung Myung', terrain: 'Rivers & Lakes (attacker -1 dice) · width 25k', fort: '3' },
    default: E({
      title: '⚔️ Battle of {region}',
      description: '**{attacker}** attacks **{defender}** · {terrain} · walls {fort}\nThe battle begins {resolves}. Until then champions may duel in RP; staff record the result with **Record duel**.',
      color: 0x8b0000,
      fields: [
        { name: '🗡️ {attacker}', value: '{attackerArmy}', inline: true },
        { name: '🛡️ {defender}', value: '{defenderArmy}', inline: true },
        { name: 'Champions', value: '{champions}', inline: false },
        { name: 'Duels', value: '{duels}', inline: false },
      ],
    }),
  },
  worldBattleResult: {
    group: 'World', label: 'Battle report',
    placeholders: ['region', 'winner', 'attacker', 'defender', 'rounds', 'losses', 'summary'],
    sample: { region: 'Kaifeng', winner: 'Shaolin Sect', attacker: 'Blood Cult', defender: 'Shaolin Sect', rounds: '**Day 1–3 · 🏹 Fire** — dice 4 vs 6 · losses 210 / 160 · morale 52 / 58\n**Day 4–6 · ⚔️ Shock** — dice 8 vs 3 · losses 140 / 390 · morale 41 / 22', losses: 'Blood Cult lost 430 · Shaolin Sect lost 310', summary: 'Blood Cult broke and fled after 9 days.' },
    default: E({ title: '📜 Battle of {region} — {winner} victorious', description: '{summary}\n\n{rounds}', color: 0x8b0000, fields: [{ name: 'Losses', value: '{losses}', inline: false }] }),
  },
};

function get(state, key) {
  return clone(state.templates?.[key] || DEFS[key]?.default || { content: '', embeds: [] });
}

function fill(str, vars) {
  return String(str ?? '').replace(/\{([\w.]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? '') : m));
}

/** Render a template into a Discord message payload ({ content?, embeds }). Empty parts are dropped. */
function render(state, key, vars = {}, { color } = {}) {
  vars = { ...ui.emojiVars(state), ...vars };
  const t = get(state, key);
  // Drop lines left empty by placeholders (e.g. "-# {weaponDescription}" with no description), collapse blank runs.
  const tidy = (s) => s.split('\n').filter((l) => !/^\s*(-#|#{1,3}|>|[-*•])\s*$/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const embeds = (t.embeds || []).slice(0, 10).map((e) => {
    const o = {};
    if (e.title) o.title = truncate(tidy(fill(e.title, vars)), 256);
    if (e.url) o.url = fill(e.url, vars);
    if (e.description) o.description = truncate(tidy(fill(e.description, vars)), 4096);
    const col = e.color ?? color;
    if (col !== undefined && col !== null && col !== '') o.color = typeof col === 'string' ? parseInt(col.replace('#', ''), 16) || 0 : col;
    if (e.author?.name) o.author = { name: truncate(fill(e.author.name, vars), 256), ...(e.author.icon_url ? { icon_url: fill(e.author.icon_url, vars) } : {}), ...(e.author.url ? { url: fill(e.author.url, vars) } : {}) };
    if (e.footer?.text) {
      const text = tidy(fill(e.footer.text, vars));
      if (text) o.footer = { text: truncate(text, 2048), ...(e.footer.icon_url ? { icon_url: fill(e.footer.icon_url, vars) } : {}) };
    }
    if (e.thumbnail?.url) o.thumbnail = { url: fill(e.thumbnail.url, vars) };
    if (e.image?.url) o.image = { url: fill(e.image.url, vars) };
    if (e.timestamp) o.timestamp = Number.isNaN(Date.parse(e.timestamp)) ? new Date().toISOString() : e.timestamp;
    // A field is dropped when its value came out empty (e.g. {bonuses} with no bonuses).
    const fields = (e.fields || []).map((f) => {
      const value = tidy(fill(f.value, vars));
      return { name: truncate(tidy(fill(f.name, vars)) || '​', 256), value: truncate(value, 1024), inline: !!f.inline, drop: !value.replace(/[\s\-#*_`>|~]/g, '') };
    }).filter((f) => !f.drop).map(({ drop, ...f }) => f);
    if (fields.length) o.fields = fields.slice(0, 25);
    return o;
  }).filter((o) => o.title || o.description || o.fields || o.image || o.author);
  const content = tidy(fill(t.content || '', vars));
  return { content: content || undefined, embeds };
}

/** Accept Discohook JSON ({messages:[{data}]}), a single message ({content, embeds}) or a bare embed. */
function normalizeImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a JSON object.');
  if (Array.isArray(obj.messages)) obj = obj.messages[0]?.data || {};
  if (!obj.embeds && (obj.title || obj.description || obj.fields)) obj = { embeds: [obj] };
  return { content: typeof obj.content === 'string' ? obj.content : '', embeds: Array.isArray(obj.embeds) ? obj.embeds.slice(0, 10) : [] };
}

module.exports = { DEFS, get, render, fill, normalizeImport };
