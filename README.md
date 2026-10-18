# ☯ Jianghu Bot — Murim / Cultivation RP bot + dashboard

A Discord bot (discord.js v14) with a web dashboard for a Murim / Jianghu / Cultivation text-roleplay server.
One Node.js process runs **both** the bot and the dashboard, so a single Render Web Service is enough.

**What it does**

- **`/menu`** — one button-driven menu per player. It opens on the **character sheet**, then: Stats (tap +1 / +5, or type several stats at once), Inventory (consume pills, learn manuals, equip weapons, sell, list on the market, roll drops, crafting), Market, and Realm (Realm Breakthrough)
- **`/submit`** a character → staff approve with a button in a staff-only channel, or `/approve @player` (their own submission is used) → stat sheet created (who approved it is recorded)
- **Sects follow Discord roles**: link a role to each sect; having the role makes that the character's sect, losing it makes them Rogue. A sect can hand out its Core martial art and a one-time Nyang bonus
- **Arts & Traits library**: martial arts (Core / Special / Forbidden-Heavenly / Generic), cultivation methods (Qi Gathering absorbs 50%), Qi Cores and special traits, each with optional custom code. Manuals are items that teach an art, so arts can drop and be sold; Qi Cores and traits never can
- The **50% rule**, soft caps and hard caps are enforced automatically; Qi gives extra Qi Bars (26+ Qi = +1 … 751+ = +6)
- **Weapons**: everyone starts with a *Default Weapon*; staff add Spiritual / Dharma / Numinous / Immortal Treasures that can raise stats or Qi Bars while equipped (`/equip`). Boosted stats are __underlined__ on the sheet and explained in a Bonuses field
- **Pills** (`/consume`) show every step: absorption from cultivation methods, impurity shaved off, caps, Qi overflow
- Staff rewards and deductions: `/give` and `/take` for points, Qi, Nyang, rolls, Qi Bars, items and single stats — each posts a **Progression Report** / Deduction Report
- **Titles** are typed by staff (`/title @player Rising Dragon`); players can't pick them
- 12 editable realms with requirements, caps, Qi Bars and breakthrough chances; pills can raise the chance
- Impurity (50: pill yields −50% · 75: stats −25% · 100: meridians burst), poisons that don't burst meridians, detox pills, Feng Shui `/purify` calculator
- Items (up to 300) with rarity, type, description, drop weight, shop price, pill yield / impurity / affinity, poison & purification tiers, weapon grade & bonuses
- Drops by rarity: Earthly 75% · Heavenly 20% · Immortal 5% (editable, plus per-sect bonuses)
- **Market**: the shop and player listings in one place, with a *Player market* filter. Each item has a "can be sold on the player market" switch
- **Crafting** recipes, **`/compare @player`** (damage, clash, speed with the Realm Tier rules), trades and gifts
- **Custom code** for special items/traits, with a full reference in the dashboard
- **Dashboard control of every command**: who can use it, which channels, on/off, description
- **Every panel is editable**: the character sheet, stats, inventory, market, realm, crafting, compare and all announcements are templates with a live Discord-style preview (Discohook import/export). **Every emoji and button** can be changed or removed, including custom server emojis
- Save / load / backups, and a changelog of every edit
- **The World** (`/world` + dashboard Map, Economy, Events, Politics, War, Balance): the Murim Map Studio map of all 34 provinces and 455 prefectures; regional markets with supply & demand, production buildings, a normal market between realms with border tariffs, automatic trade caravans for free-trade partners, coffers and prosperity cycles; low-fantasy random events; policies; a diplomacy map with Representatives, stipends and political marriages; takeovers; EU4-style battles fought in the region's terrain that RP duels can swing; balance formulas that recommend sects to new players — all hookable with custom code

---

## 1. Create the Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy it (this is `DISCORD_TOKEN`).
3. Still in **Bot**, turn on **Message Content Intent** (for the optional "Type in chat" stat mode) and **Server Members Intent** (instant sect sync when roles change).
   If you leave them off, everything else works.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; permissions
   *View Channels, Send Messages, Embed Links, Read Message History, Manage Roles*.
   Open the generated link and add the bot to your server.
5. In Discord: Settings → Advanced → enable **Developer Mode**. Right-click your server → **Copy Server ID** (this is `GUILD_ID`).
6. Server Settings → Roles: drag the bot's role **above** the roles it should hand out on approval.

## 2. Put the code on GitHub

1. Create a new repository on <https://github.com/new> (private is fine).
2. Click **uploading an existing file**, drag in **everything inside this folder** (keep the `src`, `scripts` folders), and commit.
   Or with git:
   ```bash
   git init && git add . && git commit -m "Jianghu bot"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   git push -u origin main
   ```
   `.gitignore` already keeps `node_modules`, `.env` and local data out of GitHub.

## 3. Free database (strongly recommended)

Render's free plan has an **ephemeral filesystem** — anything saved to disk is lost on every restart or redeploy.
Use a free MongoDB Atlas cluster so characters and items survive:

1. <https://www.mongodb.com/cloud/atlas> → create a free cluster.
2. **Database Access** → add a user + password. **Network Access** → allow `0.0.0.0/0` (Render's IPs change).
3. **Connect → Drivers** → copy the connection string and put your password in it. This is `MONGODB_URI`.

(Without `MONGODB_URI` the bot saves to `data/db.json` — fine on your own PC or a Render paid instance with a Disk.)

## 4. Deploy on Render

**Easiest — Blueprint:** Render dashboard → **New → Blueprint** → choose your repo. `render.yaml` sets everything up; fill in the values it asks for.

**Or manually:** **New → Web Service** → your repo, then:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/health` |

Environment variables:

| Key | Value |
|---|---|
| `DISCORD_TOKEN` | your bot token |
| `GUILD_ID` | your server ID |
| `MONGODB_URI` | your Atlas connection string |
| `ADMIN_USERNAME` | dashboard login name (default `admin`) |
| `ADMIN_PASSWORD` | dashboard password (default `jianghu` — change it!) |
| `SESSION_SECRET` | any long random text |
| `NODE_VERSION` | `20` |

Open the service URL (e.g. `https://jianghu-bot.onrender.com`) → that's the dashboard. Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
Anyone who knows those can log in; you can also create one account per editor in **Accounts**, so the changelog shows who did what.

> **Free plan sleeping:** a free Render web service spins down after 15 minutes without web traffic, which takes the bot offline.
> Either point a free uptime monitor (e.g. UptimeRobot) at `https://YOUR-URL/health` every 5 minutes, or use the Starter plan.
> One always-on free service fits in Render's 750 free hours per month.

**Forgot the dashboard password?** Set `ADMIN_RESET=true` on Render, redeploy once (the admin password becomes `ADMIN_PASSWORD` again), then remove `ADMIN_RESET`.

## 5. First setup in the dashboard

1. **Settings → Discord**: pick the character submissions channel (make it staff-only in Discord), progress channel, announcements channel, optional log channel, staff roles, and roles given on approval.
2. **Commands**: decide who can use what (e.g. set `/approve` to your *Character Approver* role).
3. **Sects**: optionally link a Discord role to each sect (given on approval).
4. **Items**: add your items (manuals, pills, poisons…). Tick *Can drop from drop rolls* and/or *Sold in the shop*.
5. **Drop Rates**: change the 75 / 20 / 5 split if you want.
6. **Realms & Qi Bars**: adjust requirements, caps, breakthrough chances and the Qi → Qi Bar table any time.
7. **Messages**: restyle the announcements if you like.

---

## Commands

20 commands — most things happen through buttons in `/menu` and `/world`.

### Players
| Command | What it does |
|---|---|
| `/submit name document [sect]` | Send your character for approval |
| `/menu [player] [public]` | Your character sheet + tabs: **Sheet · Stats · Inventory · Market · Realm** |
| `/market [show]` | Opens the menu on the Market (everything / player market / shop) |
| `/world [tab] [region]` | The world: **Region · Market · Caravans · Realm · War** (see *The World* below) |
| `/consume pill` | Consume one of your pills or elixirs |
| `/equip weapon` | Choose your main weapon |
| `/progress link summary [breakthrough]` | Submit a finished RP or fight for rewards |
| `/trade player …` | Trade items / Nyang. Ask for nothing in return to **gift** |
| `/compare player [against]` | Damage, Clash and Speed between your character and theirs (or two other players) |
| `/item name` | Read any item's description |
| `/purify` | Feng Shui purification calculator |
| `/help` | How to play |

**Inside `/menu`:**
- **Sheet** — the full character sheet.
- **Stats** — `+1` / `+5` buttons for each stat, **Spend points…** (a form with all four stats), **Type in chat** (5 minutes of typing `strength 5` lines), **Undo**, remaining points and the 50% limit. Also "Forget a martial art".
- **Inventory** — pick an item to **Consume**, **Learn**, **Equip**, **Sell to shop** or **List on market**; **Roll** for a drop; **Crafting**; **Drop rates**.
- **Market** — shop items and player listings together; filter buttons **All / Player market / Shop**. Pick an entry to buy 1 or any amount; your own listings have **Take down**.
- **Realm** — requirements with ✅/❌, the exact breakthrough chance, and **Attempt Realm Breakthrough** (asks to confirm).

`/menu` is private by default (only you see it); `public:true` shows it in the channel. Only the person who opened a menu can press its buttons.

### Staff
(Defaults — change them in **Dashboard → Commands**.)

| Command | What it does |
|---|---|
| Approve / Reject buttons on applications, or `/approve @player [sect]` | Approves the player's own submission (no need to retype the name). Creates the sheet, gives starting points, the Default Weapon, base roles, the sect role, the sect's Core art and join Nyang. `name`/`document` are only for players who never used `/submit` |
| `/give all @player 25` | 25 points for Strength / Endurance / Mobility only |
| `/give allqi @player 25` | 25 points usable in any stat, **including Qi** |
| `/give qi @player 1` | A Breakthrough: Qi directly, resets Impurity |
| `/give nyang · rolls · qibars · item` | Currency, drop rolls, bonus Qi Bars, items (only staff can hand out items) |
| `/take all · allqi · stat · nyang · rolls · qibars · item` | Remove any of those. `/take stat` lowers a stat; `refund:true` gives the points back to re-spend |
| **Grant reward** button on progress posts | Same as `/give`, from a form |
| `/impurity add · remove · reset` | `poison:true` never bursts meridians unless `can_burst:true` |
| `/title player title` | Set a title exactly as typed (`none` removes it) |
| `/admin backup · dashboard · sync` | Backup now, dashboard link, re-send commands to Discord |
| `/admin event event region [turns]` | Force a world event (drought, flood, trade fair, bandits…) in a region |
| `/admin turn [count]` | Advance the world by hand |
| `/takeover give region faction [reason]` | Hand a province or prefecture to another faction right now (`none` = unclaimed). Announced, kept on record |
| `/takeover approve · reject · revert` | Answer a representative's land claim or a long occupation; undo an approved takeover |
| `/office character representative · leader · member [rank]` | Appoint a faction's leader or representatives with a rank (what they may do alone / with staff approval) and give them the Representative role |
| **Approve / Reject** on requests, offers and takeover posts · **Record duel** on battle posts | Staff steps of the realm, land and war |

## Pill limits, consumables and the item pack

Pills have optional anti-spam limits (item editor → *Pill limits*):
- **Tolerance %** — each one taken this month is weaker (30% → 2nd pill 70%, 3rd 49%…).
- **Max per month** — hard limit. Counters reset at the start of every month.
- **Made for realm** + **% weaker per realm above** — cheap pills stay usable later, just less efficient (applies to yield and breakthrough bonus).
- **% kept if the attempt fails** (breakthrough pills) — that part of the bonus survives one failed attempt.
- **Settings → Max stored pill bonus** caps how much breakthrough chance pills can stack (default +20%).

Non-pill items marked **Can be used up** (poisons, antidotes, talismans, smoke pellets…) get a **Use** button and work with `/consume`. Their *Effect* text is shown and every use is logged like a pill, so staff can check items used mid-fight.

**Items → 📊 Quick edit & ratings** (toggle) turns the Items tab into a grid of every pill/elixir and cultivation method: edit prices, yields, impurity, limits and absorption inline (changed rows are saved together), and see three ratings per row:
- Pills — **① Power** = yield × type weight + BT% × weight − impurity × weight; **② PP / 100 Nyang** = Power ÷ price × 100 (tagged cheap / fair / pricey against your median); **③ Monthly max** = what one player can get out of it in a month given tolerance, monthly limit and the Impurity 50 penalty.
- Cultivation methods — **① Pill ×** (share of every yield kept), **② Impurity ×** (share of every pill's impurity taken), **③ Purity index** = ① ÷ ②.
The weights (PP per Qi, per stat, per +1% breakthrough, cost per Impurity…) are in **Settings → Item rating weights**.

**Items → ⬇ Export / ⬆ Import** moves items between servers or backups, together with the arts their manuals teach, their custom code and their crafting recipes. Import previews what will be created/updated first and makes a safety backup.

`examples/item-pack-murim-30.json` is a ready-made pack of 30 items for 3rd Rate to Peak (Qi pills, stat pills, detox, breakthrough aids, poisons, antidotes, combat consumables, crafting materials and 4 recipes), with 9 custom-code gimmicks. Import it from the dashboard and adjust prices to your economy.

## The World (Dashboard → Map · Economy · Events · Politics · War · Balance)

Everything here runs in **turns** (default: one every 6 real hours, 28 turns a season, 4 seasons a year). Staff can pause, advance or tune it in **Economy → ⚙️ World settings**. Battle preparation runs on real time.

**Map** (works like the Murim Map Studio, github.com/nr-coder123/myumyu). Pick a faction on the left (or click it in the *Factions* list), then **click or drag over the land to paint it**; the **eraser** unclaims. Drag the sea (or hold Space / Shift, or use the middle mouse button) to move, wheel or pinch to zoom, **Ctrl+Z / Ctrl+Y** undo and redo every stroke. Keys: B paint · E erase · I inspect · W walls · A alliance · L landmark · F frontier line. The **walls tool** (W) shows every region's fortifications and sets them with a click (pick 0–10, or +1 / −1 per click); a region's panel also has − / + buttons for its walls. 0 is open country, 3 a walled city, 6 a great fortress, 10 an impregnable pass; City Walls buildings add +1 per level on top. Walls only help a defender fighting on its own land. The right panel has five tabs: **Factions** (inline colour, washed / vivid tone, region counts, + New), **Alliances** (pick one, then click regions with the Alliance tool: their rulers join or leave; Edit sets terms, colour, border and fill), **Region** (the inspector: ruler, market, workshops, Discord category & channels, custom code, force an event), **Claims** (takeovers) and **Map** (map modes: prosperity, food, security, price of a good, alliances & wars of a faction, events, terrain; names in English / 漢字 / both / historical; layers; split provinces; export SVG / PNG; Discord & Map Studio import; *Clear all territory*). The map draws only parchment, borders, rivers, peaks and names — one faction name per stretch of land, no emoji, no seats. **Split provinces** (Henan, Shaanxi, Sichuan and Hubei by default) are shown and painted prefecture by prefecture; whoever holds most of one taxes its provincial market. Everywhere else a prefecture simply follows its province.

**Nothing is preset.** Factions (one per sect, plus any you add with + New) start with no land, no seat, no alliance and no agreements: you paint and decide everything. Old saves are cleaned up once (seeded lands, seats, icons and relations removed; the old Imperial Court and Merchant Guild removed if nobody touched them; anything staff changed is kept).

**Takeovers.** Painting is the quickest way to move land. A *takeover* is the same change announced in Discord and kept on record: staff use `/takeover give` or Map → Takeovers → *Transfer now*; representatives claim land from `/world` → Politics → *Claim a region* (posted in the log channel with Approve / Reject buttons for staff); an army that occupies enemy land for 12 turns asks for a takeover too (or takes it automatically if staff allow). Every approved takeover can be **reverted** in one click (dashboard) or with `/takeover revert`.

**Regions and markets.** Every province is a market. Only the prefectures you mark ★ special get their own market (a share of the province's people and production moves there) — use them for sect seats, great cities and passes; the defaults include each sect's seat plus Luoyang, Kaifeng, Chang'an, Yangzhou, Hangzhou, Canton, Wuchang, Jiayu Pass, Jingdezhen, Bozhou and Cangzhou. Each market has population, terrain, walls, prosperity, security (bandits), buildings, a tax rate, coffers, production of 23 trade goods, and buildings (the map starts with some already: breweries, smithies, apothecaries, paper mills, inns, market halls, walls, granaries…).

**Economy** (inspired by Bannerlord's supply-chain mods):
- `price = base × (target ÷ stock)^elasticity` — the target is what the people, production buildings and armies there need for a few turns. Every unit a player buys or sells moves the price, so there is no free arbitrage.
- **Production buildings** turn inputs into outputs (Brewery: grain → wine, Smithy: iron + timber → arms, Apothecary: herbs → medicine, Alchemy Hall: herbs + spirit herbs + cinnabar → elixir stock, Silk Weavery, Kiln, Paper Mill, Horse Ranch) or earn from customers (Inns & Teahouses, Escort Agency). They have 3 levels (×1 / ×1.8 / ×2.5 output) and their profit goes to whoever rules the region (in unclaimed land it stays in the town's coffers). They used to be player *workshops*; old saves convert them automatically and refund players what theirs cost.
- **Peddlers** move goods along every road from plenty to scarcity; **merchant caravans** travel 2–4 roads away (a guild faction, if you add one, keeps a share of their profit). Bandits (low security, bandit events) raid them.
- **The normal market crosses borders on its own** — nobody has to sign a deal for realms to trade. Goods entering another faction's land pay a **border tariff** (5%, World settings) to that ruler. War stops trade between the two sides, and a faction can declare an **embargo** on another (`/world` → Realm → Diplomacy, or the dashboard realm card) to shut its borders to it.
- **Trade agreements** make it easier: *free trade* (in a one-on-one agreement or an alliance's terms) removes the tariff and opens each other's markets to the partner's merchant houses. With **automatic trade** on (default), every faction sends up to 2 caravans a turn (+1 per free-trade partner, max 6) between its own and its partners' markets, paid from the treasury (at most 8% of it a turn) wherever the margin is at least 15%; guilds also work unclaimed land. Nobody has to send them by hand — the profit shows as *trade* in the realm's income.
- **Coffers**: households spend into the merchants' purse; imports and buying from players drain it, so a market can only absorb so much. The ruling faction takes the taxes — collected every turn and paid into the treasury every turn, or every 2, 3… turns (World settings → *Taxes reach the treasury every … turns*).
- **Prosperity** rises with food, salt/cloth/tea, luxuries, trade and safety, and is dragged down by its own weight; famine, war and disasters knock it down. Population grows only as far as the land can feed.
- Players: `/world` → **Market** shows the prices where their character stands and sells trade goods they own. Trade goods are cargo: they can only change hands in the same region. Each character can move at most 3,000 Nyang through the markets per turn (World settings; 0 = no limit), which stops arbitrage farming.
- **Travel is text RP** and the bot stays out of it: a character is simply wherever its player last posted (or used `/world`) in a region's channel or category. There are no travel times or *Go here* buttons.
- **One shop, one price for everyone.** There are no per-sect shops and no local prices: in a text RP anyone can post in any channel, so prices never depend on where a character is. An item linked to a trade good (item editor → *World economy*, e.g. pills follow Elixir Stock) follows that good's average price across the whole realm, weighted by population, capped at ±25%.

**Events** (Events tab, or `/admin event`): drought, flood, locusts, epidemic, harsh winter, earthquake, wildfire, famine (only where grain really runs out), bumper harvest, trade fair, silver shortage, salt crackdown, guild boycott, mine collapse, new vein, spirit herb bloom, tax levy, refugees, bandits, river pirates, Murim tournament, Lantern Festival, succession dispute, rumours of a hidden master. Each has conditions (season, terrain, prosperity, shortages…), effects, chains (drought → famine → epidemic) and spreading (epidemics, locusts). All editable.

**Politics** (kept simple, like the realm screens of Crusader Kings / Europa Universalis). This is text role-play: how factions feel about each other is role-played, so there are **no relation numbers**, no unrest and no corruption. The bot records only what was agreed:
- **Wars** — sides, start, reason. Declaring war calls in allies: a *defensive pact* brings them to the defender's side, a *call to arms* to the attacker's. Peace ends it.
- **Alliances** — one bloc instead of many one-on-one deals. Its **terms** (military access, free trade, non-aggression, defensive pact, call to arms, tribute to the leader) hold between every pair of members, and it is **drawn on the map** like in the Map Studio: a hatched or dotted wash over the members' land, one thick border around the bloc and its name. A faction is in one alliance at a time.
- **One-on-one agreements** — the same perks plus tribute and a note of whatever else was agreed in RP; optional duration and custom code.
- **Political marriages** (the other character's player consents).

Dashboard → **Politics**: a staff inbox (requests, offers waiting for staff, land claims) with Approve / Reject; a card per realm (click for Overview · Council · Buildings · Policies); alliances; wars; agreements; marriages. The rules (representative ranks, policies, buildings) sit in a folded section. Discord → `/world` → **Realm**: one screen with the leader, council, treasury, lands, buildings, alliance, wars and agreements, and a single menu: Diplomacy · Our alliance · Build · Policies · Trade caravans · Stipends · Claim a region. Offers are posted in the diplomacy channel for the other side's representative.

**Representatives and their powers.** Each faction has a leader and a council of representatives (5 by default, set in Politics → Rules; appointed with `/office character representative rank` or in the realm's Council tab; the Representative role is given automatically). Each representative has a **rank**, and each rank gives every power — diplomacy, alliances, war & peace, armies, policies, buildings, trade, treasury, land claims — one of three levels: **on their own**, **with staff approval**, or **not at all**, plus a spending limit (anything costing more goes to staff too). Defaults: Sect Leader (almost everything alone, wars via staff, 5,000), Grand Elder (daily affairs alone, alliances / war / policies / treasury via staff, 2,500), Envoy (talks only, spends nothing), Steward (buildings and trade, 1,500), War Elder (armies, 1,500) — all editable. A request that needs staff is posted in the log channel with Approve / Reject buttons (and shows in the dashboard inbox); the representative gets a DM with the answer. So an angry player can't wreck their sect out of character. Policies now cost treasury only (influence is gone).

**Buildings.** Factions spend their treasury on buildings in the regions they rule: Granary, Market Hall, City Walls (+1 walls in battle per level, up to level 3), Post Stations, Training Grounds, Alchemy Hall, Herb Gardens, Smithy Quarter, Branch Hall, Inns & Teahouses, plus the production buildings above (all editable, with effects, build time, upkeep, levels, inputs / outputs and custom code). Production buildings can be **upgraded** to level 3. They belong to whoever rules the region. When a region is **taken** (an approved takeover), each building may be **razed** (50% by default); **battles** fought there **damage** them (below half strength they work at half effect; at 0 they are gone); repairs cost a share of the price. Unpaid upkeep makes them decay.

**Trade.** Players don't buy grain and silk from province markets any more (World settings can allow it again); they can still sell trade goods they own. Caravans are run by **trade factions** — a "Trade Guild" (a faction of kind *guild*, or any faction given a trade charter) with no land of its own: its representatives buy goods with the treasury where it has **trade rights** (unclaimed land, its own, or a ruler it has *free trade* with — usually won in role-play), and sell them in another market a few turns later; the profit goes to its treasury. Players' own caravans are off by default. Ordinary sects don't need any of this: their merchants trade automatically (see *Economy* above).

**Where the money goes.** A region's **coffers** are its merchants' and households' purse — they pay players who sell there and fill when players buy. Each turn the ruler taxes part of it into the faction **treasury** (plus a little from donations and members), which pays armies, policies, diplomacy and officials (1.5 % a turn, so hoarding melts). Members get nothing automatically; a representative can set **stipends**: `stipendRate`% of each turn's net income goes into a fund, paid out every season by weight (member 1 · representative 2 · leader 3) with a **soft cap**: `paid = cap × (1 − e^(−share ÷ cap))`, `cap = 150 × weight × (1 + ln(members) ÷ 4)`. However rich a tiny faction is, each member gets at most their cap per season; the rest returns to the treasury.

**War** (Europa Universalis style). Representatives recruit troops in their regions (equipment is bought from the local market — a shortage of arms or horses makes armies expensive) and march them; armies cost upkeep, eat local grain and lose supply abroad. When enemies meet, a **battle opens for 24 h**: each side picks a **formation** and a **commander**, characters join as champions, and staff **record RP duels** (each win = +1 die, max 2; a beaten commander leaves the field and shakes his army). Then the battle is fought **day by day in that region**: 3-day *fire* and *shock* phases, a die roll each phase, the commander's **general pips** (Qi → fire, Strength → shock, Mobility → maneuver, Endurance → siege), the terrain's **attacker penalty** and **combat width**, river crossings, walls (for a defender on its own land), each troop type's fire/shock pips and *power* (a sect disciple is worth five soldiers). Armies march at the pace of their slowest troops, but **Pathfinder Scouts** (+50%) and **Sect Disciples** (+25%) speed the whole army up when they make up at least 5% of it, formations' multipliers and morale; an army at 0 morale routs and cavalry pursue. The report shows every phase. Armies, factions, formations and regions can carry **custom code** (`battleRound` each phase: extra dice, damage, morale; `armyTick` each turn). Formations (Square, Fish Scale, Crane Wing, Arrowhead, Long Snake, Crescent Moon, Wild Geese, Yoke, Eight Trigrams, Scattered Stars), troop types and terrain are all editable, and the **battle simulator** (with a day-by-day morale chart) tests them.
**Balance.** Three formulas per faction: **① Power Index** (military, economy, politics and cultivation shares — every sect counts 300 rank-and-file disciples, and each member adds what their realm is worth in disciples: a 3rd Rate fighter is worth 1, a 1st Rate 5, a Master 30, a Transcendent 400… up to 10,000 at Life and Death, so one weak cultivator barely moves the needle while a true master does; representatives don't count as fighters; all editable in World settings), **② gap to the fair share** with the HHI concentration index, **③ Recruitment Need**. The top three playable sects are recommended in `/help` and to sectless characters, and an optional join bonus can reward joining them.

**Custom code** works everywhere: `regionTick` (regions, policies, buildings, alliances, agreements), `factionTick`, `treatyTick` (agreements), `eventStart`, `diplomacy`, `battleRound`, `armyTick` (see Custom Code → reference). Pills can read the season and the region (`ctx.world`).

`examples/item-pack-world-expansion.json` adds 63 items for 2nd Rate to Transcendent: the 23 trade goods, 5 materials, Qi / stat / breakthrough / detox pills (several with seasonal, regional or impurity gimmicks), 6 poisons, 6 antidotes and 16 recipes that use trade goods. (The 23 trade-good items are also created automatically the first time the world starts.)

## Sects & Discord roles (Dashboard → Sects)

Each sect can have:
- a **Discord role** — the role decides the sect. Give a member the Mount Hua role and their sheet says Mount Hua; remove it and they become Rogue. Sects without a role are left alone. Approving (or changing the sect in the dashboard) gives the role and removes other sect roles.
- a **Core martial art** — given automatically if the character has no Core art yet (Mount Hua → Plum Blossom Sword).
- **Nyang on joining** — paid once per sect per character.

Sync happens whenever the player uses the bot, when anyone opens their menu, and instantly when roles change if **Server Members Intent** is on in the Discord developer portal (Bot tab). Every change appears in the changelog as `sect.sync`.

## Arts & Traits (Dashboard → Arts & Traits)

Four lists: **Martial Arts**, **Cultivation Methods**, **Qi Cores**, **Special Traits**. Each can have a description and custom code.
- Martial arts: type (Core / Special / Forbidden-Heavenly / Generic), "replaces Core", shareable + limit.
- Cultivation methods: **Absorption Rate** (how much of a pill's yield is absorbed — Qi Gathering 50%, default 100%; a character uses their best rate), bonus %, per-element affinity %, pill impurity reduction %.
- Qi Cores: bonus %, affinities, impurity reduction, custom code. Set on characters by staff; never items, never sold.
- To put a martial art or cultivation method into the game, press **+ Manual item that teaches it**: that item can drop, be crafted, sold in the shop or the player market. Reading it (Inventory → Learn) teaches the art.

Old saves are converted automatically: cultivation-method and manual items become arts plus a manual item that teaches them; old "core" items become Qi Cores.

## Weapons

- Item type **weapon** with a **grade** (Default, Spiritual Treasure, Dharma Treasure, Numinous Treasure, Immortal Treasure) and optional **bonuses while equipped** (Strength, Endurance, Mobility, Qi, Qi Bars). Anything more complex: attach custom code to the weapon.
- New characters receive the **Default Weapon** and have it equipped. Pick a different default in Settings.
- Players equip from `/equip` or Inventory → item → **Equip**. If they trade the weapon away, they fall back to the Default Weapon.
- Bonuses only change the *shown* stats (they don't count toward caps or the 50% rule). Changed stats are __underlined__ and listed in the sheet's **Bonuses** field.

## Pills, absorption and impurity

`/consume` (or Inventory → Consume) shows each step, for example:
```
Yield: 10 Qi
Absorption: +20% (Wood +20%) → +2 Qi
Gained: +12 Qi (now 46)
Impurity: 15 − 30% (cultivation) → 10.5 · now 30.5 (4.5 shaved off)
```
Yield absorbed = raw × (Absorption Rate + bonuses)%. Example: Qi Gathering (50%) with a Wood +20% core eating a Wood pill absorbs 70%. Bonuses, affinities and impurity reduction combine as best positive value + all negatives. At **Impurity 50+** pill yields are halved (all yield types, not just Qi; editable in Settings). A pill with negative impurity is a detox pill and removes impurity.

Every pill consumed is in the changelog (`item.consume`, with the channel it happened in). Set **Settings → Consumption log** to also post each one in a staff channel, so a pill taken mid-fight is easy to check. **Settings → Changelog channel** posts every change of any kind.

## Command permissions (Dashboard → Commands)

Every command and subcommand can be set to:
- **Everyone**, **Staff** (staff roles from Settings + anyone with Manage Server) or **Only these roles** (e.g. a *Character Approver* role for `/approve`)
- **Only in these channels** (e.g. `/compare` only in a combat channel)
- **On / off**, and a **custom description**
- **Hide** — staff commands are hidden from the slash menu of members without Manage Server. If you give a role access, either untick Hide or allow that role for the command in Server Settings → Integrations.

The Approve/Reject buttons follow the `/approve` rule; the progress **Grant reward** button follows the `/give` rule.
Make the submissions channel visible only to staff / approvers in Discord's channel permissions. Approvals are announced in the **announcements channel** (Settings) or sent to the player by DM.

## Messages (Dashboard → Messages)

Every panel — the **character sheet**, stats, inventory, item details, market, realm, crafting, drop rates, pill results, `/compare` — and every announcement can be redesigned:
- Edit text, embed color, author, title, description, fields, images and footer with a **live Discord-style preview**.
- Click a placeholder chip like `{player}` to insert it; it's filled in when the bot sends the message.
- **Open in Discohook** opens the current design in discohook.app; design it there, copy the JSON from Discohook's *JSON Data Editor* and use **Import JSON**. Placeholders survive the round trip.
- **Send test** posts a sample in a channel (mentions never ping), **Reset to default** restores the original.
- Fields whose value comes out empty are hidden automatically (e.g. *Bonuses* when there are none).
- The preview also shows the panel's **buttons**.

**Emojis & Buttons** (top of the Messages tab): change or remove every emoji (Strength, Qi, Qi Bars, Impurity, Nyang…) and every button's label and emoji. For a custom server emoji, type `\:name:` in Discord, send it, and paste the result (`<:name:123456789012345678>`). In any message, `{e.strength}`, `{e.qi}` etc. insert those emojis.

Default Progression Report:
```
## Progression Report
+50 Stat Points to @Player
## Approved by
@Staff
```

## Crafting (Dashboard → Crafting)

A recipe = input items (+ optional Nyang) → output items, with a success chance, an optional minimum realm, and whether materials are lost on failure. Players craft from `/menu → ⚒️ Craft`.

## Stat comparison (Dashboard → Stat Comparison)

`/compare` uses three editable tables, filled in with your server's rules:
- **Damage** = attacker Strength − defender Endurance → T1 Nothing … T8 Lethal (T7 needs +1 Realm Tier, T8 +2)
- **Clash** = Strength vs Strength → Equal, Pushback, Deflection, Disarm, Overwhelmed
- **Speed** = Mobility vs Mobility → T1 Equal … T6 Blitz (T5 needs +1 Realm Tier, T6 +2)

If the realm difference isn't enough, the result is capped at the best row allowed and the embed says so. Effective stats are used (impurity and temporary bonuses included).

## How the rules are implemented

**Stat points.** "Stat total" = Strength + Endurance + Mobility. Qi never counts.
Two kinds of unspent points: **stat points** (from `/give all`, only S/E/M) and **flexible points** (starting points and `/give allqi`, any stat including Qi).
Starting points are 50 by default (*Settings → New characters*).

**50% rule.** No single stat may exceed 50% of (current stat total + unspent points). Spending into Qi re-checks every stat, because Qi doesn't count towards the total. The whole message is all-or-nothing.

**Soft / hard caps.** Each realm has a soft and hard cap for stats and for Qi. Past the stat soft cap, each point spent is worth 50% (setting). Qi is never reduced, but stops at its Qi hard cap. When rewarding, the bot shows what the points will really be worth and discards anything past the hard cap (can be turned off).
Defaults (editable): 2nd Rate soft 100 / hard 110 stats, soft 40 / hard 55 Qi — exactly as specified — and similar margins for the other realms.

**Qi Bars.** Realm Qi Bars + Qi bonus (26–100 Qi: +1 · 101–200: +2 · 201–350: +3 · 351–550: +4 · 551–750: +5 · 751+: +6) + staff bonus Qi Bars + trait effects (e.g. Heavenly Martial Meridian +4; No Meridians = 0).

**Realm Breakthrough.** `/menu → ☯️ Realm` checks the next realm's requirements, then rolls against *realm chance + pill bonuses + script effects*. Pills with a *Breakthrough bonus* must be consumed first; the bonus is used up on the attempt.

| Realm | Qi Bars | Needs stats / Qi | Soft cap | Hard cap | Chance to advance |
|---|---|---|---|---|---|
| 3rd Rate | 2 | — | 70 / 30 | 80 / 40 | 100% |
| 2nd Rate | 2.5 | 70 / 30 | 100 / 40 | 110 / 55 | 95% |
| 1st Rate | 3 | 100 / 40 | 150 / 65 | 165 / 80 | 85% |
| Expert | 3.5 | 150 / 65 | 195 / 90 | 215 / 105 | 75% |
| Master | 4 | 195 / 90 | 245 / 100 | 270 / 125 | 65% |
| Peak | 4.5 | 245 / 100 | 325 / 170 | 355 / 190 | 55% |
| Supreme Peak | 5 | 325 / 170 | 400 / 225 | 440 / 260 | 45% |
| Transcendent | 5.5 | 400 / 225 | 480 / 325 | 525 / 355 | 35% |
| Unrestrained | 6 | 480 / 325 | 555 / 400 | 610 / 440 | 25% |
| Enlightened | 6.5 | 555 / 400 | 600 / 510 | 660 / 545 | 18% |
| Celestial | 7 | 600 / 510 | 700 / 575 | 770 / 630 | 12% |
| Life and Death | 7.5 | 700 / 575 | none | none | final |

**Impurity.** 50 → pill yields −50% · 75 → −25% stats (temporary) · 100 → meridians burst: −25% stats and Qi, permanently, once until the next reset.
Resets monthly and whenever the character receives Qi from staff (`/give qi`, or spending `allqi` points into Qi). Whether Qi from pills also resets it is a setting (off by default, otherwise a Qi pill would cancel its own impurity).
Poison impurity (`/impurity add poison:true`) never triggers the burst unless `can_burst:true`.

**Absorption & affinity.** Cultivation methods and Qi Cores have a general absorption % and per-element %. Per element the best positive value is used, then every negative value is added (Wood 10 + 15 → 15; Metal 5 and −25 → −20). A pill's yield is `raw × (1 + (general + element)%)`.

**Purification.** `/purify` applies the Feng Shui cycle (weak → useless; boosts → −1 tier) and the T1/T2/T3 table.

---

## Custom code (Custom Code tab)

Some items and traits need real mechanics. Write a script in the dashboard, then attach it to an item (*Items → Custom code*) or a trait (*Special Traits*). It runs for every character who has the trait, knows the cultivation method / qi core / martial art, has the weapon equipped, or is consuming the pill. **The Custom Code tab has a complete reference** (every hook, every field of `ctx`, `fx` and pill results, plus ready-made recipes), so staff never need to look at GitHub.

```js
hooks.effects = (ctx, fx) => {            // sheet effects & impurity drawbacks
  if (ctx.character.impurity >= 50) {
    fx.qiRegenDisabled = false;
    fx.notes.push('Heart of Essence — Qi regen is not disabled.');
  }
  return fx;
};
hooks.qiGain = (ctx, amount) => amount * 0.75;       // Qi actually received
hooks.breakthroughChance = (ctx, chance) => chance + 5;
hooks.consume = (ctx, result) => result;             // change a pill's result
```

`fx` fields: `qiRegenDisabled`, `statMultiplier`, `preventMeridianBurst`, `tempStats.{strength,endurance,mobility,qi}`, `tempQiBars`, `qiBarBonus`, `qiBarsOverride`, `notes`.
The **Test** panel runs your code against any character at any impurity before you save. Included examples: *Three Hearts Cultivation* (attached to the Three Hearts Cultivation Method item), *No Meridians*, *Heavenly Martial Meridian*, and a *Template*.

Scripts run in an isolated sandbox with a time limit and only receive copies of data. It is not a hard security boundary, so only give dashboard logins to people you trust.

---

## Saving, backups, changelog

The dashboard checks for changes every 5 seconds. Lists (characters, items, applications, changelog…) update by themselves; editor screens show a **↻ New changes** button instead so nobody loses unsaved work.

- Changes save automatically (about a second after each edit) to MongoDB or `data/db.json`.
- **Save & Backups** tab: save now, reload, create/restore/download/delete backups, download the full save, import a save file.
- An automatic backup is made every 24 h (setting); `/backup` makes one from Discord.
- Restoring or importing makes a safety backup first and never touches dashboard logins.
- **Changelog** tab: every edit from the dashboard and Discord — who, what, when, with before → after values. Optionally mirrored to a Discord channel.

## Running locally

```bash
npm install
cp .env.example .env   # fill in DISCORD_TOKEN etc.
npm start              # dashboard at http://localhost:3000
npm run check          # offline self-test of the game rules
```

Requires Node.js 18.17 or newer.

## Project layout

```
src/
  index.js            starts storage, dashboard and bot; monthly reset & auto-backup
  config.js           environment variables
  defaults.js         default realms, rarities, sects, titles, traits, example scripts
  store.js            in-memory state, MongoDB/file saving, backups, changelog
  engine/             game rules (no Discord code): stats, effects, scripts, characters,
                      economy, rolls, affinity, fengshui, grants, crafting, combat, templates
  bot/                Discord client, permissions (access.js), embeds, the stat typing window,
                      commands/: menu, submit, progress, trade, tools, staff, world
  world/              the world: geo (map graph), state, economy, events, politics, diplomacy,
                      military, power (balance), tick, runner; mapdata.json (built from myumyu)
  dashboard/          Express API (server.js, world-api.js), login (auth.js), web app (public/: app.js, world.js)
scripts/selftest.js   rule tests
scripts/map/          rebuilds src/world/mapdata.json from the Murim Map Studio data
scripts/packs/        item pack generators
render.yaml           Render blueprint
```
