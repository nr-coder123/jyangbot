# ☯ Jianghu Bot — Murim / Cultivation RP bot + dashboard

A Discord bot (discord.js v14) with a web dashboard for a Murim / Jianghu / Cultivation text-roleplay server.
One Node.js process runs **both** the bot and the dashboard, so a single Render Web Service is enough.

**What it does**

- **`/menu`** — one button-driven menu per player. It opens on the **character sheet**, then: Stats (tap +1 / +5, or type several stats at once), Inventory (consume pills, learn manuals, equip weapons, sell, list on the market, roll drops, crafting), Market, and Realm (Realm Breakthrough)
- **`/submit`** a character → staff approve with a button in a staff-only channel → stat sheet created (who approved it is recorded)
- The **50% rule**, soft caps and hard caps are enforced automatically; Qi gives extra Qi Bars (26+ Qi = +1 … 751+ = +6)
- **Weapons**: everyone starts with a *Default Weapon*; staff add Spiritual / Dharma / Numinous / Immortal Treasures that can raise stats or Qi Bars while equipped (`/equip`). Boosted stats are __underlined__ on the sheet and explained in a Bonuses field
- **Pills** (`/consume`) show every step: absorption from cultivation methods, impurity shaved off, caps, Qi overflow
- Staff rewards and deductions: `/give` and `/take` for points, Qi, Nyang, rolls, Qi Bars, items and single stats — each posts a **Progression Report** / Deduction Report
- **Titles** are typed by staff (`/title @player Rising Dragon`); players can't pick them
- 12 editable realms with requirements, caps, Qi Bars and breakthrough chances; pills can raise the chance
- Impurity (50 / 75 / 100), poisons that don't burst meridians, detox pills, Feng Shui `/purify` calculator
- Items (up to 300) with rarity, type, description, drop weight, shop price, pill yield / impurity / affinity, poison & purification tiers, weapon grade & bonuses
- Drops by rarity: Earthly 75% · Heavenly 20% · Immortal 5% (editable, plus per-sect bonuses)
- **Market**: the shop and player listings in one place, with a *Player market* filter. Each item has a "can be sold on the player market" switch
- **Crafting** recipes, **`/compare @player`** (damage, clash, speed with the Realm Tier rules), trades and gifts
- **Custom code** for special items/traits, with a full reference in the dashboard
- **Dashboard control of every command**: who can use it, which channels, on/off, description
- **Every panel is editable**: the character sheet, stats, inventory, market, realm, crafting, compare and all announcements are templates with a live Discord-style preview (Discohook import/export). **Every emoji and button** can be changed or removed, including custom server emojis
- Save / load / backups, and a changelog of every edit

---

## 1. Create the Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy it (this is `DISCORD_TOKEN`).
3. Still in **Bot**, turn on **Message Content Intent** (only needed for the optional "Type in chat" stat mode).
   If you leave it off, everything else works — players use the buttons.
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

17 commands — most things happen through buttons in `/menu`.

### Players
| Command | What it does |
|---|---|
| `/submit name document [sect]` | Send your character for approval |
| `/menu [player] [public]` | Your character sheet + tabs: **Sheet · Stats · Inventory · Market · Realm** |
| `/market [show]` | Opens the menu on the Market (everything / player market only / shop only) |
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
| Approve / Reject buttons on applications, or `/approve player name` | Creates the sheet, gives starting points, the Default Weapon and base roles |
| `/give all @player 25` | 25 points for Strength / Endurance / Mobility only |
| `/give allqi @player 25` | 25 points usable in any stat, **including Qi** |
| `/give qi @player 1` | A Breakthrough: Qi directly, resets Impurity |
| `/give nyang · rolls · qibars · item` | Currency, drop rolls, bonus Qi Bars, items (only staff can hand out items) |
| `/take all · allqi · stat · nyang · rolls · qibars · item` | Remove any of those. `/take stat` lowers a stat; `refund:true` gives the points back to re-spend |
| **Grant reward** button on progress posts | Same as `/give`, from a form |
| `/impurity add · remove · reset` | `poison:true` never bursts meridians unless `can_burst:true` |
| `/title player title` | Set a title exactly as typed (`none` removes it) |
| `/admin backup · dashboard · sync` | Backup now, dashboard link, re-send commands to Discord |

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
Cultivation methods and Qi cores have a general **absorption %**, per-element **affinity %**, and a **pill impurity reduction %** (best positive value + all negatives, like absorption). A pill with negative impurity is a detox pill and removes impurity.

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

**Impurity.** 50 → no Qi regen in fights · 75 → −25% stats (temporary) · 100 → meridians burst: −25% stats and Qi, permanently, once until the next reset.
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
                      commands/: menu, submit, progress, trade, tools, staff
  dashboard/          Express API (server.js), login (auth.js), web app (public/)
scripts/selftest.js   rule tests
render.yaml           Render blueprint
```
