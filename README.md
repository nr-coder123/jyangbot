# ☯ Jianghu Bot — Murim / Cultivation RP bot + dashboard

A Discord bot (discord.js v14) with a web dashboard for a Murim / Jianghu / Cultivation text-roleplay server.
One Node.js process runs **both** the bot and the dashboard, so a single Render Web Service is enough.

**What it does**

- Character applications → staff approval → stat sheet (who approved it is recorded)
- Players type `strength 5` / `mobility 5` (several lines at once) in a 5-minute window to spend points, with the **50% rule**, soft caps and hard caps enforced
- Staff rewards: `/give all` (stats only), `/give allqi` (any stat incl. Qi), `/give qi` (a Breakthrough — resets Impurity), Nyang, drop rolls, Qi Bars, items
- 12 editable realms with requirements, soft/hard caps, Qi Bars and Realm Breakthrough chances; pills can raise the chance
- Impurity (50 / 75 / 100 thresholds, monthly reset, reset on receiving Qi), poisons that don't burst meridians, Feng Shui purification calculator
- Cultivation absorption rates & elemental affinities (best positive + all negatives rule)
- Items (up to 300, configurable) with rarity, type, description, drop weight, shop price, pill yield / impurity / affinity, poison & purification tiers
- `/roll` drops by rarity: Earthly 75% · Heavenly 20% · Immortal 5% (editable, plus per-sect bonuses)
- Inventory, shop, player-to-player trades, a player market, Nyang payments
- Titles (Prefix + Stem + Suffix, "Mount Hua's Rising Dragon" / "Rogue Silent Viper")
- **Custom code** for special items/traits (Three Hearts Cultivation, No Meridians, Heavenly Martial Meridian included as examples) — written in the dashboard, no need to edit the bot
- Save / load / backups / import / export, and a changelog of every edit (who, what, when)

---

## 1. Create the Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy it (this is `DISCORD_TOKEN`).
3. Still in **Bot**, turn on **Message Content Intent** (needed for typing `strength 5` in chat).
   If you leave it off, the bot still works — players use `/stats add` instead.
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

1. **Settings → Discord**: pick the character submissions channel, progress channel, optional log channel, staff/approver roles, and roles given on approval.
2. **Sects**: optionally link a Discord role to each sect (given on approval).
3. **Items**: add your items (manuals, pills, poisons…). Tick *Can drop from /roll* and/or *Sold in the shop*.
4. **Drop Rates**: change the 75 / 20 / 5 split if you want.
5. **Realms**: adjust requirements, caps and breakthrough chances any time.

---

## Commands

### Players
| Command | What it does |
|---|---|
| `/character submit name document [sect]` | Send your character doc for approval |
| `/sheet [player]` | Show a stat sheet |
| `/stats allocate` | Open a 5-minute window. Then type e.g. `strength 5` (one or many lines). `points` · `undo` · `done` |
| `/stats add` / `/stats points` | Spend points with options / see what's left |
| `/progress submit link summary [breakthrough]` | Submit a finished RP or fight for rewards |
| `/realm info` · `/realm chance` · `/realm breakthrough` · `/realm list` | Realm progress and Realm Breakthroughs |
| `/item use` (pills) · `/item learn` (manuals) · `/item forget` · `/item info` | Items and descriptions |
| `/roll` · `/droprates` · `/inventory` | Drops and inventory |
| `/shop view/buy/sell` · `/pay` · `/trade` · `/market list/view/buy/cancel` | Economy (Nyang) |
| `/title list` · `/title stem` | Titles (players may pick their own stem once) |
| `/impurity check` · `/purify` | Impurity effects · Feng Shui purification calculator |
| `/help` | Command list |

### Staff
(Members with **Manage Server**, or a staff role set in the dashboard.)

| Command | What it does |
|---|---|
| Approve / Reject buttons on applications, or `/character approve player name` | Approve → creates the sheet, gives starting points and base roles |
| `/give all @player 25` | 25 points for Strength / Endurance / Mobility only |
| `/give allqi @player 25` | 25 points usable in any stat, **including Qi** |
| `/give qi @player 1` | A Breakthrough: Qi directly, resets Impurity |
| `/give nyang` · `/give rolls` · `/give qibars` · `/give item` | Currency, drop rolls, bonus Qi Bars, items (negative amounts take away) |
| **Grant reward** button on progress posts | Same as `/give`, from a form |
| `/impurity add/remove/reset` | `poison:true` never bursts meridians unless `can_burst:true` |
| `/title set` · `/roll player:@x` (free roll) · `/backup` · `/dashboard` | |

---

## How the rules are implemented

**Stat points.** "Stat total" = Strength + Endurance + Mobility. Qi never counts.
Two kinds of unspent points: **stat points** (from `/give all`, only S/E/M) and **flexible points** (starting points and `/give allqi`, any stat including Qi).
Starting points are 50 by default (*Settings → New characters*).

**50% rule.** No single stat may exceed 50% of (current stat total + unspent points). Spending into Qi re-checks every stat, because Qi doesn't count towards the total. The whole message is all-or-nothing.

**Soft / hard caps.** Each realm has a soft and hard cap for stats and for Qi. Past the stat soft cap, each point spent is worth 50% (setting). Qi is never reduced, but stops at its Qi hard cap. When rewarding, the bot shows what the points will really be worth and discards anything past the hard cap (can be turned off).
Defaults (editable): 2nd Rate soft 100 / hard 110 stats, soft 40 / hard 55 Qi — exactly as specified — and similar margins for the other realms.

**Realm Breakthrough.** `/realm breakthrough` checks the next realm's requirements, then rolls against *realm chance + pill bonuses + script effects*. Pills with a *Breakthrough bonus* must be consumed first; the bonus is used up on the attempt.

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

Some items and traits need real mechanics. Write a script in the dashboard, then attach it to an item (*Items → Custom code*) or a trait (*Special Traits*). It runs for every character who knows that item / has that trait.

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
                      economy, rolls, affinity, fengshui, grants
  bot/                Discord client, embeds, the 5-minute stat window, commands/*
  dashboard/          Express API (server.js), login (auth.js), web app (public/)
scripts/selftest.js   rule tests
render.yaml           Render blueprint
```
