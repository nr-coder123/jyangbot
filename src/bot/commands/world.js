'use strict';
/**
 * /world — the map, the economy, politics and war, as one panel with tabs:
 *   Region · Market · Caravans · Workshops · Politics · War
 *
 * Custom ids:  w:<v|a|s>:<viewer>:<name>[:<arg>[:<arg2>]]      (view / action / select)
 *              wm:<modal>:<viewer>[:<arg>[:<arg2>]]
 *              wd:<proposalId>:<yes|no>                        (diplomacy posts — anyone may click; rights are checked)
 *              wb:<battleId>:<joinA|joinD|plan|duel>           (battle posts)
 */
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, parseEmoji,
} = require('discord.js');
const store = require('../../store');
const ui = require('../../engine/ui');
const W = require('../../world');
const WP = require('../worldpanels');
const { EPH, actor, requireChar, requireAccess, isStaff, sendToChannel } = require('../util');
const { UserError, fmt, truncate, num, norm } = require('../../utils');

const { geo, economy: E, common: C, military: M, politics: P, diplomacy: D, events: EV, territory: T } = W;
const st = () => store.state;

const cmd = new SlashCommandBuilder()
  .setName('world')
  .setDescription('The Murim world: your region, its market, caravans, workshops, politics and war')
  .addStringOption((o) => o.setName('tab').setDescription('Open on this tab').addChoices(
    { name: 'Region', value: 'region' }, { name: 'Market', value: 'market' }, { name: 'Caravans', value: 'caravans' },
    { name: 'Workshops', value: 'workshops' }, { name: 'Politics', value: 'politics' }, { name: 'War', value: 'war' },
  ))
  .addStringOption((o) => o.setName('region').setDescription('Look at another region').setAutocomplete(true))
  .addBooleanOption((o) => o.setName('public').setDescription('Show it in the channel'));

// ---------- helpers ----------
const cid = (kind, ctx, name, ...args) => ['w', kind, ctx.viewer, name, ...args.map((a) => (a === undefined || a === null ? '' : a))].join(':').replace(/:+$/, '').slice(0, 100);
const row = (...comps) => { const list = comps.filter(Boolean); return list.length ? new ActionRowBuilder().addComponents(...list.slice(0, 5)) : null; };
function btn(id, key, { style = ButtonStyle.Secondary, disabled = false, label } = {}) {
  const look = ui.button(st(), key);
  const b = new ButtonBuilder().setCustomId(id).setStyle(style).setDisabled(!!disabled);
  if (label || look.label) b.setLabel(truncate(label || look.label, 80));
  if (look.emoji) { try { b.setEmoji(look.emoji); } catch {} }
  if (!label && !look.label && !look.emoji) b.setLabel(key);
  return b;
}
function select(id, placeholder, options) {
  if (!options.length) return null;
  return new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(truncate(placeholder, 150)).addOptions(options.slice(0, 25).map((o) => {
    const opt = { label: truncate(o.label, 100), value: String(o.value).slice(0, 100), ...(o.description ? { description: truncate(o.description, 100) } : {}) };
    const em = o.emoji && parseEmoji(o.emoji);
    if (em && (em.id || em.name)) opt.emoji = em.id ? { id: em.id, name: em.name } : { name: em.name };
    return opt;
  }));
}
const input = (id, label, { value = '', required = true, style = TextInputStyle.Short, placeholder = '' } = {}) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(truncate(label, 45)).setStyle(style).setRequired(required);
  if (value) t.setValue(String(value).slice(0, 4000));
  if (placeholder) t.setPlaceholder(truncate(placeholder, 100));
  return new ActionRowBuilder().addComponents(t);
};
function dedupe(rows) {
  const seen = new Map();
  for (const r of rows) for (const c of r.components) { const id = c.data.custom_id; if (!id) continue; const n = seen.get(id) || 0; seen.set(id, n + 1); if (n) c.setCustomId(`${id}~${n}`.slice(0, 100)); }
  return rows;
}
function requireWorld() { if (!st().world?.settings?.enabled) throw new UserError('The world is turned off (dashboard → World → Settings).'); }
const here = (c) => geo.marketOf(st(), E.locationOf(st(), c));

function navRow(ctx, active) {
  const b = (view, key) => btn(cid('v', ctx, view), key, { style: view === active ? ButtonStyle.Primary : ButtonStyle.Secondary });
  return row(b('region', 'wRegion'), b('market', 'wMarket'), b('caravans', 'wCaravans'), b('workshops', 'wWorkshops'), b('politics', 'wPolitics'));
}
const warRow = (ctx, active) => row(btn(cid('v', ctx, 'war'), 'wWar', { style: active === 'war' ? ButtonStyle.Primary : ButtonStyle.Secondary }));

/** Markets near `from`, nearest first, as select options with travel time. */
function nearbyOptions(c, from, { exclude = [], hoursPer = 'travelHoursPer100' } = {}) {
  const s = st();
  const list = [...geo.within(s, from, 6).entries()].filter(([k]) => !exclude.includes(k)).map(([k, hops]) => {
    const rt = geo.route(s, from, k);
    return { k, hops, h: rt ? rt.distance / 100 * num(s.world.settings[hoursPer], 1.5) : 0 };
  }).sort((a, b) => a.h - b.h);
  const rp = T.channelMode(s);
  return list.slice(0, 25).map((x) => {
    const trip = rp ? T.rpTravel(s, from, x.k) : null;
    const how = trip ? `${fmt(trip.km)} km · ~${trip.days[0]?.days} d ${trip.days[0]?.label.toLowerCase()}` : `~${fmt(Math.round(x.h * 10) / 10)} h`;
    return { label: geo.fullLabel(s, x.k), value: x.k, description: `${x.hops} stage(s) · ${how} · prosperity ${Math.round(s.world.regions[x.k].prosperity)}` };
  });
}

// ---------- views ----------
const VIEWS = {};

VIEWS.region = (ctx, key) => {
  const s = st(); const { c } = ctx;
  const loc = here(c);
  key = key ? geo.marketOf(s, key) : ctx.channelRegion && geo.marketOf(s, ctx.channelRegion) !== loc ? geo.marketOf(s, ctx.channelRegion) : loc;
  const p = WP.regionPanel(key, c);
  const rows = [navRow(ctx, 'region'), warRow(ctx)];
  if (ctx.isOwner) {
    rows[1] = row(
      btn(cid('v', ctx, 'war'), 'wWar'),
      key !== loc && !E.isTravelling(c) ? btn(cid('a', ctx, 'travel', key), 'wTravel', { style: ButtonStyle.Success, label: T.channelMode(s) ? 'Go here (RP)' : `Travel here (~${fmt(Math.round(E.travelInfo(s, c, key).hours * 10) / 10)} h)` }) : null,
      key !== loc ? btn(cid('v', ctx, 'region', loc), 'back', { label: 'Where I am' }) : null,
      E.isTravelling(c) ? btn(cid('a', ctx, 'stoptravel'), 'cancel', { label: 'Turn back' }) : null,
    );
    rows.push(row(select(cid('s', ctx, 'look'), '🔭 Look at a nearby region…', nearbyOptions(c, key, { exclude: [key] }))));
  }
  return { ...p, components: rows };
};

VIEWS.market = (ctx) => {
  const s = st(); const { c } = ctx;
  const key = here(c);
  const p = WP.marketPanel(key, c);
  const r = s.world.regions[key];
  const opts = s.world.goods.map((g) => ({ label: `${g.name} — ${fmt(r.prices[g.id])}`, value: g.id, emoji: g.emoji, description: `stock ${Math.round(num(r.stock[g.id]))} · base ${g.basePrice}` }));
  return { ...p, components: [navRow(ctx, 'market'), row(select(cid('s', ctx, 'good'), '📦 Pick a good to trade…', opts)), warRow(ctx)] };
};

VIEWS.good = (ctx, gid) => {
  const { c } = ctx;
  const key = here(c);
  const p = WP.goodPanel(key, c, gid);
  return {
    ...p,
    components: [navRow(ctx, 'market'), row(
      btn(cid('a', ctx, 'buy', gid), 'wBuy', { style: ButtonStyle.Success, disabled: !ctx.isOwner || E.isTravelling(c) }),
      btn(cid('a', ctx, 'sell', gid), 'wSell', { disabled: !ctx.isOwner || E.isTravelling(c) }),
      btn(cid('v', ctx, 'market'), 'back'),
    )],
  };
};

VIEWS.caravans = (ctx) => {
  const s = st(); const { c } = ctx;
  const p = WP.caravansPanel(c);
  const goods = s.world.goods.filter((g) => { const it = E.itemForGood(s, g.id); return it && num(c.inventory[it.id]) > 0; });
  return {
    ...p,
    components: [navRow(ctx, 'caravans'), ctx.isOwner ? row(select(cid('s', ctx, 'cvgood'), '🐫 Send a caravan with…', goods.map((g) => ({ label: `${g.name} (you have ${num(c.inventory[E.itemForGood(s, g.id).id])})`, value: g.id, emoji: g.emoji })))) : null, warRow(ctx)].filter(Boolean),
  };
};

VIEWS.cvdest = (ctx, gid) => {
  const s = st(); const { c } = ctx;
  const from = here(c);
  const g = E.good(s, gid);
  const list = [...geo.within(s, from, 6).keys()].filter((k) => k !== from).map((k) => ({ k, p: num(s.world.regions[k].prices[gid]), rt: geo.route(s, from, k) })).sort((a, b) => b.p - a.p).slice(0, 25);
  const opts = list.map((x) => ({ label: `${geo.fullLabel(s, x.k)} — pays ~${fmt(x.p)}`, value: x.k, description: `~${fmt(Math.round(x.rt.distance / 100 * num(s.world.settings.caravanHoursPer100, 2) * 10) / 10)} h · raid risk ~${Math.round(x.rt.path.slice(1).reduce((a, k) => 1 - (1 - a) * (1 - E.raidRisk(s, k)), 0) * 100)}%` }));
  return {
    content: `🐫 Where should the **${g.emoji} ${g.name}** go? Here it sells for **${fmt(s.world.regions[from].prices[gid])}**.`,
    embeds: [],
    components: [navRow(ctx, 'caravans'), row(select(cid('s', ctx, 'cvto', gid), '📍 Destination…', opts)), row(btn(cid('v', ctx, 'caravans'), 'back'))],
  };
};

VIEWS.workshops = (ctx) => {
  const s = st(); const { c } = ctx;
  const key = here(c);
  const p = WP.workshopsPanel(key, c);
  const mine = E.ownedWorkshops(s, c);
  const types = s.world.workshopTypes.map((t) => { const l = WP.workshopTypeLine(s, t, key); return { label: `${t.name} — ${l.cost} ${s.settings.currencyName}`, value: t.id, emoji: t.emoji, description: l.text }; });
  return {
    ...p,
    components: [navRow(ctx, 'workshops'),
      ctx.isOwner && !E.isTravelling(c) ? row(select(cid('s', ctx, 'wsbuild'), `🏗️ Build a workshop in ${WP.regionName(key)}…`, types)) : null,
      ctx.isOwner && mine.length ? row(select(cid('s', ctx, 'wsmine'), '🔧 Manage one of yours…', mine.map(({ key: k, ws }) => ({ label: `${s.world.workshopTypes.find((t) => t.id === ws.typeId)?.name} Lv ${ws.level} — ${WP.regionName(k)}`, value: ws.id, description: `last turn ${fmt(ws.lastProfit)}` })))) : null,
      warRow(ctx)].filter(Boolean),
  };
};

VIEWS.wsmanage = (ctx, wsId) => {
  const s = st(); const { c } = ctx;
  const found = E.ownedWorkshops(s, c).find((x) => x.ws.id === wsId);
  if (!found) return VIEWS.workshops(ctx);
  const t = s.world.workshopTypes.find((x) => x.id === found.ws.typeId);
  const up = Math.round(t.cost * (found.ws.level === 1 ? 0.9 : 1.2));
  return {
    content: `${t.emoji} **${t.name}** Lv ${found.ws.level} in **${WP.regionName(found.key)}** — last turn ${fmt(found.ws.lastProfit)}, total ${fmt(found.ws.totalProfit)}.\n-# ${t.description}`,
    embeds: [],
    components: [navRow(ctx, 'workshops'), row(
      btn(cid('a', ctx, 'wsup', wsId), 'wBuild', { style: ButtonStyle.Success, disabled: found.ws.level >= 3, label: found.ws.level >= 3 ? 'Max level' : `Upgrade (${up})` }),
      btn(cid('a', ctx, 'wssell', wsId), 'cancel', { style: ButtonStyle.Danger, label: 'Sell to the town' }),
      btn(cid('v', ctx, 'workshops'), 'back'),
    )],
  };
};

VIEWS.politics = (ctx) => {
  const s = st(); const { c } = ctx;
  const p = WP.politicsPanel(c, ctx.member);
  const rows = [navRow(ctx, 'politics')];
  if (p.rep && ctx.isOwner) {
    const others = s.world.factions.filter((f) => f.active && f.id !== p.faction.id);
    rows.push(row(select(cid('s', ctx, 'dipto'), '🕊️ Diplomacy with…', others.map((f) => ({ label: f.name, value: f.id, emoji: f.icon, description: `relations ${Math.round(C.relation(s, p.faction.id, f.id).value)} · ${C.STANCE_LABEL[C.stance(s, p.faction.id, f.id)].replace(/^\S+ /, '')}` })))));
    const adopted = P.factionPolicies(s, p.faction);
    const pol = s.world.policies.filter((x) => x.enabled !== false && (!x.kinds?.length || x.kinds.includes(p.faction.kind)));
    rows.push(row(select(cid('s', ctx, 'policy'), '🏛️ Adopt or revoke a policy…', [
      ...adopted.map((x) => ({ label: `Revoke: ${x.def.name}${x.region ? ` (${WP.regionName(x.region)})` : ''}`, value: `-${x.def.id}|${x.region}`, emoji: '✖️' })),
      ...pol.filter((x) => !adopted.some((a) => a.def.id === x.id && x.scope !== 'region')).map((x) => ({ label: `${x.name} — ${x.cost.influence} infl${x.upkeep.treasury ? `, ${x.upkeep.treasury}/turn` : ''}`, value: `+${x.id}`, emoji: x.emoji, description: truncate(x.description, 100) })),
    ])));
    rows.push(row(
      btn(cid('a', ctx, 'claim'), 'wPolitics', { label: 'Claim a region (staff approve)' }),
      btn(cid('a', ctx, 'stipend'), 'wPolitics', { label: `Stipends (${fmt(p.faction.stipendRate)}%)` }),
    ));
  }
  const mineToAnswer = s.world.proposals.filter((x) => x.status.startsWith('awaiting') && ((x.status === 'awaiting-target' && p.rep && x.to === p.faction?.id) || (x.status === 'awaiting-character' && s.characters.find((ch) => ch.id === x.targetCharId)?.ownerId === ctx.viewer)));
  if (mineToAnswer.length) rows.push(row(select(cid('s', ctx, 'answer'), `📨 ${mineToAnswer.length} proposal(s) waiting for you…`, mineToAnswer.map((x) => ({ label: `${D.action(s, x.actionId)?.name} from ${C.faction(s, x.from)?.name}`, value: x.id, emoji: D.action(s, x.actionId)?.emoji })))));
  rows.push(warRow(ctx));
  return { embeds: p.embeds, components: rows.filter(Boolean) };
};

VIEWS.dip = (ctx, toId) => {
  const s = st(); const { c } = ctx;
  const fromF = C.factionOfChar(s, c); const toF = C.faction(s, toId);
  if (!fromF || !toF) return VIEWS.politics(ctx);
  const p = WP.diplomacyPanel(c, fromF, toF);
  const avail = p.options.filter((x) => x.available);
  return { embeds: p.embeds, components: [navRow(ctx, 'politics'), row(select(cid('s', ctx, 'dipact', toId), avail.length ? '📜 Choose an action…' : 'Nothing is possible right now', avail.map((x) => ({ label: x.action.name, value: x.action.id, emoji: x.action.emoji, description: truncate(x.action.description, 100) })))), row(btn(cid('v', ctx, 'politics'), 'back'))].filter(Boolean) };
};

VIEWS.answer = (ctx, pid) => {
  const s = st();
  const p = s.world.proposals.find((x) => x.id === pid);
  if (!p) return VIEWS.politics(ctx);
  const post = WP.proposalPost(p);
  return { content: '', embeds: post.embeds, components: [navRow(ctx, 'politics'), row(btn(`wd:${p.id}:yes`, 'wAccept', { style: ButtonStyle.Success }), btn(`wd:${p.id}:no`, 'wDecline', { style: ButtonStyle.Danger }), btn(cid('v', ctx, 'politics'), 'back'))] };
};

VIEWS.war = (ctx) => {
  const s = st(); const { c } = ctx;
  const p = WP.warPanel(c, ctx.member);
  const rows = [navRow(ctx), warRow(ctx, 'war')];
  const canLead = p.faction && (C.isRepresentative(s, p.faction, c, ctx.member) || p.armies.some((a) => a.commanderId === c.id));
  if (ctx.isOwner && canLead) {
    if (p.armies.length) rows.push(row(select(cid('s', ctx, 'army'), '🚩 Command an army…', p.armies.map((a) => ({ label: `${a.name}`, value: a.id, description: `${WP.big(M.men(a))} men in ${WP.regionName(a.region)} · ${a.status}` })))));
    if (C.isRepresentative(s, p.faction, c, ctx.member)) rows.push(row(select(cid('s', ctx, 'recruit'), '🪖 Recruit troops…', s.world.unitTypes.filter((u) => !u.kinds?.length || u.kinds.includes(p.faction.kind)).map((u) => ({ label: `${u.name} — ${u.cost} per 100`, value: u.id, emoji: u.emoji, description: `fire ${num(u.fireOff)}/${num(u.fireDef)} · shock ${num(u.shockOff)}/${num(u.shockDef)} · needs ${Object.entries(u.needs || {}).map(([g, q]) => `${q} ${E.good(s, g)?.name}`).join(', ')} per 100` })))));
  }
  return { embeds: p.embeds, components: rows.filter(Boolean) };
};

VIEWS.army = (ctx, armyId) => {
  const s = st();
  const a = M.army(s, armyId);
  if (!a) return VIEWS.war(ctx);
  const p = WP.armyPanel(a);
  return {
    ...p,
    components: [navRow(ctx), row(
      select(cid('s', ctx, 'march', a.id), '🚩 March to…', nearbyOptions(ctx.c, a.region, { exclude: [a.region] }).map((o) => ({ ...o, description: o.description.replace(/~[\d.]+ h · /, '') }))),
    ), row(select(cid('s', ctx, 'formation', a.id), '🧭 Formation…', s.world.formations.map((f) => ({ label: `${f.name}${f.hanzi ? ` (${f.hanzi})` : ''}`, value: f.id, emoji: f.emoji, description: truncate(f.description, 100) })))),
    row(btn(cid('a', ctx, 'cmd', a.id), 'wPlan', { label: 'Take command' }), btn(cid('a', ctx, 'halt', a.id), 'cancel', { label: 'Halt' }), btn(cid('v', ctx, 'war'), 'back'))].filter(Boolean),
  };
};

function render(ctx, view, arg, notice) {
  const v = (VIEWS[view] || VIEWS.region)(ctx, arg);
  return { content: notice ? truncate(notice, 2000) : v.content || '', embeds: (v.embeds || []).slice(0, 10), components: dedupe((v.components || []).filter(Boolean).slice(0, 5)), allowedMentions: { parse: [] } };
}

// ---------- command ----------
async function execute(i) {
  requireWorld();
  const c = requireChar(i.user.id);
  if (T.notePresence(st(), c, i.channel)) store.markDirty();
  const ctx = { viewer: i.user.id, c, isOwner: true, member: i.member, channelRegion: geo.regionOfChannel(st(), i.channel) };
  const region = i.options.getString('region');
  const tab = i.options.getString('tab') || 'region';
  return i.reply({ ...render(ctx, region ? 'region' : tab, region || undefined), flags: i.options.getBoolean('public') ? undefined : EPH });
}

function autocomplete(i) {
  const q = norm(i.options.getFocused());
  const s = st();
  const list = geo.marketKeys(s).map((k) => ({ k, name: geo.fullLabel(s, k), hz: geo.get(k)?.hanzi || '' })).filter((x) => !q || norm(x.name).includes(q) || x.hz.includes(q)).slice(0, 25);
  return i.respond(list.map((x) => ({ name: truncate(`${x.name} ${x.hz}`, 100), value: x.k })));
}

// ---------- interactions ----------
const parse = (i) => i.customId.replace(/~\d+$/, '').split(':');
function ctxFrom(i, viewer) {
  if (viewer !== i.user.id) throw new UserError('This panel belongs to someone else — open your own with `/world`.');
  return { viewer, c: requireChar(i.user.id), isOwner: true, member: i.member, channelRegion: geo.regionOfChannel(st(), i.channel) };
}
const log = (i, action, text) => store.log(actor(i), action, text);

function repOf(s, c, member) {
  const f = C.factionOfChar(s, c);
  if (!f || !C.isRepresentative(s, f, c, member)) throw new UserError('Only your sect\'s representatives can do that.');
  return f;
}

async function onComponent(i) {
  requireAccess(i, 'world');
  requireWorld();
  const parts = parse(i);
  const [, kind, viewer, name, arg, arg2] = parts;
  const ctx = ctxFrom(i, viewer);
  const s = st(); const { c } = ctx;
  if (kind === 'v') return i.update(render(ctx, name, arg));
  if (kind === 's') {
    const v = i.values[0];
    switch (name) {
      case 'look': return i.update(render(ctx, 'region', v));
      case 'good': return i.update(render(ctx, 'good', v));
      case 'cvgood': return i.update(render(ctx, 'cvdest', v));
      case 'cvto': {
        const g = E.good(s, arg); const it = E.itemForGood(s, arg);
        return i.showModal(new ModalBuilder().setCustomId(['wm', 'caravan', viewer, arg, v].join(':')).setTitle(truncate(`${g.name} → ${geo.label(s, v)}`, 45)).addComponents(
          input('qty', `How many? (you have ${num(c.inventory[it?.id])})`, { value: String(num(c.inventory[it?.id])) }),
          input('escort', 'Hire an escort? (yes / no)', { value: 'no', required: false }),
        ));
      }
      case 'wsbuild': {
        const r = E.buildWorkshop(s, c, v);
        log(i, 'world.workshop', `${c.name} built a ${v} in ${geo.label(s, r.key)} for ${r.cost}`);
        return i.update(render(ctx, 'workshops', null, `🏗️ You built a **${s.world.workshopTypes.find((t) => t.id === v)?.name}** in **${WP.regionName(r.key)}** for ${fmt(r.cost)}. It runs every turn.`));
      }
      case 'wsmine': return i.update(render(ctx, 'wsmanage', v));
      case 'dipto': return i.update(render(ctx, 'dip', v));
      case 'dipact': {
        const a = D.action(s, v);
        const fields = [];
        if (a.needsCharacters) {
          fields.push(input('mine', `Your character (${C.factionOfChar(s, c)?.name})`, { value: c.name }));
          fields.push(input('theirs', `Their character (${C.faction(s, arg)?.name})`, { placeholder: 'Character name' }));
        }
        if (a.id === 'break') fields.push(input('treaty', 'Which treaty? (name)', { placeholder: C.treatiesBetween(s, C.factionOfChar(s, c)?.id, arg).map((t) => t.name).join(', ') || '—' }));
        fields.push(input('note', 'Message for them (optional)', { required: false, style: TextInputStyle.Paragraph }));
        return i.showModal(new ModalBuilder().setCustomId(['wm', 'propose', viewer, arg, v].join(':')).setTitle(truncate(`${a.name}`, 45)).addComponents(...fields));
      }
      case 'answer': return i.update(render(ctx, 'answer', v));
      case 'policy': {
        const f = repOf(s, c, ctx.member);
        if (v.startsWith('-')) {
          const [pid, region] = v.slice(1).split('|');
          P.revokePolicy(s, f, pid, region);
          log(i, 'world.policy', `${f.name} revoked ${pid}`);
          return i.update(render(ctx, 'politics', null, '✖️ Policy revoked.'));
        }
        const def = P.policyDef(s, v.slice(1));
        if (def.scope === 'region') {
          return i.showModal(new ModalBuilder().setCustomId(['wm', 'policy', viewer, def.id].join(':')).setTitle(truncate(def.name, 45)).addComponents(
            input('region', 'Which of your regions?', { value: here(c) && s.world.regions[here(c)]?.controller === f.id ? geo.label(s, here(c)) : '', placeholder: C.controlled(s, f.id).map((r) => geo.label(s, r.key)).join(', ').slice(0, 100) }),
          ));
        }
        P.adoptPolicy(s, f, def.id);
        log(i, 'world.policy', `${f.name} adopted ${def.name}`);
        return i.update(render(ctx, 'politics', null, `${def.emoji} **${def.name}** is now in force.`));
      }
      case 'army': return i.update(render(ctx, 'army', v));
      case 'recruit': {
        const u = M.unitType(s, v);
        const f = repOf(s, c, ctx.member);
        const where = s.world.regions[here(c)]?.controller === f.id ? here(c) : f.hq;
        return i.showModal(new ModalBuilder().setCustomId(['wm', 'recruit', viewer, v].join(':')).setTitle(truncate(`Recruit ${u.name}`, 45)).addComponents(
          input('count', 'How many men? (multiples of 50)', { value: '500' }),
          input('region', 'Where? (a region your faction controls)', { value: where ? geo.label(s, where) : '' }),
          input('army', 'Into which army? (blank = garrison there)', { required: false }),
        ));
      }
      case 'march': case 'formation': {
        const a = M.army(s, arg);
        if (!a) throw new UserError('Army not found.');
        const f = C.faction(s, a.factionId);
        if (!M.canCommand(s, c, f, ctx.member) || C.factionOfChar(s, c)?.id !== f.id) throw new UserError('You do not command this army.');
        if (name === 'march') { const rt = M.marchTo(s, a, v); log(i, 'world.army', `${a.name} marches to ${geo.label(s, v)}`); return i.update(render(ctx, 'army', a.id, `🚩 Marching to **${WP.regionName(v)}** — ${rt.hops} stage(s); armies move on each world turn.`)); }
        const fm = M.formation(s, v); a.formationId = v; return i.update(render(ctx, 'army', a.id, `${fm.emoji || '🧭'} Formation set to **${fm.name}**.`));
      }
      default: throw new UserError('Unknown menu.');
    }
  }
  // actions
  switch (name) {
    case 'travel': {
      const r = E.startTravel(s, c, arg);
      log(i, 'world.travel', `${c.name}: ${geo.label(s, r.from)} → ${geo.label(s, arg)} (${r.hours} h)`);
      return i.update(render(ctx, 'region', arg, r.instant ? `📍 You are now in **${WP.regionName(arg)}**.${r.rp ? `\n-# The journey from ${WP.regionName(r.from)}: ${r.rp.text}. Role-play it however you like — nobody waits.` : ''}` : `🧭 You set out for **${WP.regionName(arg)}** — ${r.hops} stage(s), about ${fmt(r.hours)} h. You can't trade at a market while on the road.`));
    }
    case 'stoptravel': {
      if (!E.isTravelling(c)) throw new UserError('You are not travelling.');
      c.travel = null;
      return i.update(render(ctx, 'region', null, `↩️ You turn back and stay in **${WP.regionName(here(c))}**.`));
    }
    case 'buy': case 'sell': {
      const g = E.good(s, arg); const it = E.itemForGood(s, arg);
      return i.showModal(new ModalBuilder().setCustomId(['wm', name, viewer, arg].join(':')).setTitle(truncate(`${name === 'buy' ? 'Buy' : 'Sell'} ${g.name}`, 45)).addComponents(
        input('qty', name === 'buy' ? `How many? (${Math.floor(num(s.world.regions[here(c)].stock[arg]))} in the market)` : `How many? (you have ${num(c.inventory[it?.id])})`, { value: name === 'sell' ? String(num(c.inventory[it?.id])) : '10' }),
      ));
    }
    case 'wsup': {
      const r = E.upgradeWorkshop(s, c, arg);
      log(i, 'world.workshop', `${c.name} upgraded a workshop to Lv ${r.ws.level} for ${r.cost}`);
      return i.update(render(ctx, 'wsmanage', arg, `⬆️ Upgraded to level ${r.ws.level} for ${fmt(r.cost)}.`));
    }
    case 'wssell': {
      const r = E.sellWorkshop(s, c, arg);
      log(i, 'world.workshop', `${c.name} sold a workshop for ${r.paid}`);
      return i.update(render(ctx, 'workshops', null, `💰 Sold for ${fmt(r.paid)}.`));
    }
    case 'cmd': {
      const a = M.army(s, arg); const f = a && C.faction(s, a.factionId);
      if (!a || C.factionOfChar(s, c)?.id !== f?.id || !C.isRepresentative(s, f, c, ctx.member)) throw new UserError('Only your faction\'s representatives can name a commander.');
      a.commanderId = c.id; if (!a.champions.includes(c.id)) a.champions.push(c.id);
      return i.update(render(ctx, 'army', a.id, `🎖️ **${c.name}** now commands **${a.name}**.`));
    }
    case 'claim': {
      const f = repOf(s, c, ctx.member);
      return i.showModal(new ModalBuilder().setCustomId(['wm', 'claim', viewer].join(':')).setTitle(truncate(`${f.name}: claim land`, 45)).addComponents(
        input('region', 'Region (province or prefecture)', { value: geo.label(s, E.locationOf(s, c)) }),
        input('reason', 'Why? (staff read this)', { style: TextInputStyle.Paragraph, placeholder: 'e.g. ceded after the war, bought from the magistrate, our founder\'s homeland…' }),
      ));
    }
    case 'stipend': {
      const f = repOf(s, c, ctx.member);
      return i.showModal(new ModalBuilder().setCustomId(['wm', 'stipend', viewer].join(':')).setTitle(truncate(`${f.name}: stipends`, 45)).addComponents(
        input('rate', `% of each turn's income (0–${num(s.world.settings.maxStipendRate, 30)})`, { value: String(num(f.stipendRate)) }),
      ));
    }
    case 'halt': {
      const a = M.army(s, arg); if (!a) throw new UserError('Army not found.');
      if (!M.canCommand(s, c, C.faction(s, a.factionId), ctx.member)) throw new UserError('You do not command this army.');
      a.march = null; if (a.status === 'marching') a.status = 'garrison';
      return i.update(render(ctx, 'army', a.id, '🛑 Halted.'));
    }
    default: throw new UserError('Unknown button.');
  }
}

async function onModal(i) {
  requireAccess(i, 'world');
  requireWorld();
  const [, name, viewer, arg, arg2] = i.customId.split(':');
  const ctx = ctxFrom(i, viewer);
  const s = st(); const { c } = ctx;
  const val = (k) => { try { return String(i.fields.getTextInputValue(k) || '').trim(); } catch { return ''; } };
  const findRegion = (text) => {
    const q = norm(text);
    const k = geo.marketKeys(s).find((x) => norm(geo.label(s, x)) === q || norm(geo.fullLabel(s, x)) === q || geo.get(x)?.hanzi === text || x === text) || geo.marketKeys(s).find((x) => norm(geo.fullLabel(s, x)).includes(q));
    if (!k) throw new UserError(`No region called "${text}".`);
    return k;
  };
  switch (name) {
    case 'buy': case 'sell': {
      const qty = Math.floor(num(val('qty')));
      const r = name === 'buy' ? E.buyGood(s, c, arg, qty) : E.sellGood(s, c, arg, qty);
      log(i, `world.${name}`, `${c.name} ${name === 'buy' ? 'bought' : 'sold'} ${r.qty} ${arg} in ${geo.label(s, r.key)} for ${r.total}`);
      return i.update(render(ctx, 'good', arg, `${name === 'buy' ? '🛒 Bought' : '💰 Sold'} **${r.qty} ${E.good(s, arg).name}** for ${ui.emoji(s, 'nyang')} ${fmt(r.total)} (${fmt(r.each)} each${r.tariff ? `, ${fmt(r.tariff)}% tariff` : ''}). Purse: ${fmt(c.nyang)}.`));
    }
    case 'caravan': {
      const escort = /^(y|yes|sim|s|true|1)/i.test(val('escort'));
      const r = E.sendCaravan(s, c, arg2, arg, Math.floor(num(val('qty'))), { escort });
      log(i, 'world.caravan', `${c.name} sent ${r.cv.qty} ${arg} to ${geo.label(s, arg2)} (fee ${r.fee})`);
      return i.update(render(ctx, 'caravans', null, `🐫 Your caravan leaves for **${WP.regionName(arg2)}** — about ${fmt(r.hours)} h, raid risk ~${Math.round(r.cv.risk * 100)}%. Fee ${fmt(r.fee)}. You'll get a DM when it arrives.`));
    }
    case 'propose': {
      const f = repOf(s, c, ctx.member);
      const a = D.action(s, arg2);
      const args = { actionId: arg2, from: f.id, to: arg, proposer: c, note: val('note'), userId: i.user.id };
      if (a.needsCharacters) {
        const mine = s.characters.find((x) => x.status === 'active' && norm(x.name) === norm(val('mine')));
        const theirs = s.characters.find((x) => x.status === 'active' && norm(x.name) === norm(val('theirs')));
        if (!mine || !theirs) throw new UserError('Character not found — type the exact character names.');
        args.subjectCharId = mine.id; args.targetCharId = theirs.id;
        if (mine.ownerId !== i.user.id && mine.id !== c.id) {
          // Your own character, or one of your sect whose player agreed in RP — staff can verify in the changelog.
        }
      }
      if (a.id === 'break') { const t = C.treatiesBetween(s, f.id, arg).find((x) => norm(x.name) === norm(val('treaty'))) || C.treatiesBetween(s, f.id, arg)[0]; if (t) args.terms = { treatyId: t.id }; }
      const p = D.propose(s, args);
      log(i, 'world.diplomacy', `${f.name} → ${C.faction(s, arg)?.name}: ${a.name} (${p.status})`);
      await postProposal(i.client, p);
      return i.update(render(ctx, 'politics', null, p.status === 'done' ? `${a.emoji} **${a.name}** done.` : `${a.emoji} Proposal sent — ${p.status.replace('awaiting-', 'waiting for ')}.`));
    }
    case 'policy': {
      const f = repOf(s, c, ctx.member);
      const region = findRegion(val('region'));
      const def = P.adoptPolicy(s, f, arg, region);
      log(i, 'world.policy', `${f.name} adopted ${def.name} in ${geo.label(s, region)}`);
      return i.update(render(ctx, 'politics', null, `${def.emoji} **${def.name}** is now in force in **${WP.regionName(region)}**.`));
    }
    case 'recruit': {
      const f = repOf(s, c, ctx.member);
      const region = findRegion(val('region'));
      const r = M.recruit(s, f, region, arg, Math.floor(num(val('count')) / 50) * 50, { name: val('army') || undefined });
      log(i, 'world.recruit', `${f.name} recruited ${val('count')} ${arg} in ${geo.label(s, region)} (cost ${r.cost.total})`);
      const rushed = Object.entries(r.cost.rush || {}).filter(([, q]) => q > 0).map(([g, q]) => `${fmt(q)} ${E.good(s, g)?.name || g}`);
      return i.update(render(ctx, 'army', r.army.id, `🪖 Raised troops for ${fmt(r.cost.total)} (${fmt(r.cost.nyang)} pay + ${fmt(r.cost.goodsCost)} equipment bought from the market${rushed.length ? `; the market was short, so ${rushed.join(', ')} were ordered from the smiths at 2.5× base price` : ''}).`));
    }
    case 'claim': {
      const f = repOf(s, c, ctx.member);
      const q = norm(val('region'));
      const key = [...geo.provinces(), ...geo.prefectures()].map((x) => x.key).find((k) => norm(geo.label(s, k)) === q || norm(geo.fullLabel(s, k)) === q || geo.get(k)?.hanzi === val('region') || k === val('region'))
        || [...geo.provinces(), ...geo.prefectures()].map((x) => x.key).find((k) => norm(geo.fullLabel(s, k)).includes(q));
      if (!key) throw new UserError(`No region called "${val('region')}".`);
      if (T.controllerOf(s, key) === f.id) throw new UserError(`${f.name} already holds ${geo.label(s, key)}.`);
      const t = T.requestTakeover(s, { regions: [key], to: f.id, reason: val('reason'), by: { id: i.user.id, name: c.name, charId: c.id } });
      log(i, 'world.takeover', `${c.name} (${f.name}) claimed ${geo.label(s, key)}`);
      await postTakeover(i.client, t);
      return i.update(render(ctx, 'politics', null, `📜 Claim on **${geo.fullLabel(s, key)}** sent to staff.`));
    }
    case 'stipend': {
      const f = repOf(s, c, ctx.member);
      const rate = Math.max(0, Math.min(num(s.world.settings.maxStipendRate, 30), num(val('rate'))));
      f.stipendRate = rate;
      log(i, 'world.stipend', `${c.name} set ${f.name}'s stipend rate to ${rate}%`);
      const plan = T.stipendPlan(s, f);
      return i.update(render(ctx, 'politics', null, `💰 **${rate}%** of each turn's net income now goes to the stipend fund (paid to members every ${num(s.world.settings.stipendEveryTurns, 28)} turns). Fund: ${fmt(f.stipendFund)} · members ${plan.members}.`));
    }
    default: throw new UserError('Unknown form.');
  }
}

// ---------- takeover posts (staff approve in Discord) ----------
async function postTakeover(client, t) {
  const s = st();
  const ch = s.settings.channels.log || s.settings.channels.diplomacy || s.settings.channels.world;
  if (!ch) return;
  const to = C.faction(s, t.to);
  const lines = [
    `📜 **Takeover request** — ${t.regions.map((k) => `**${geo.fullLabel(s, k)}**`).join(', ')}`,
    `From ${[...new Set(t.from.map((id) => C.faction(s, id)?.name || 'unclaimed'))].join(', ')} → **${to?.name || 'unclaimed'}**`,
    `${t.source === 'conquest' ? '🏴 After a long occupation' : `By ${t.by.name || 'staff'}`}${t.reason ? ` — “${truncate(t.reason, 600)}”` : ''}`,
  ];
  const finished = t.status !== 'pending';
  const payload = { content: lines.join('\n') + (finished ? `\n**${t.status}**${t.decidedBy ? ` by ${t.decidedBy}` : ''}` : ''), components: finished ? [] : [row(btn(`wt:${t.id}:approve`, 'wAccept', { style: ButtonStyle.Success, label: 'Approve (staff)' }), btn(`wt:${t.id}:reject`, 'wDecline', { style: ButtonStyle.Danger, label: 'Reject' }))], allowedMentions: { parse: [] } };
  for (const m of t.messages || []) { try { const chan = await client.channels.fetch(m.channelId); const msg = await chan.messages.fetch(m.messageId); await msg.edit(payload); return; } catch {} }
  const sent = await sendToChannel(client, ch, payload);
  if (sent) t.messages = [{ channelId: sent.channelId, messageId: sent.id }];
}
async function onTakeoverButton(i) {
  requireWorld();
  if (!isStaff(i)) throw new UserError('Only staff can approve or reject takeovers.');
  const [, id, what] = i.customId.replace(/~\d+$/, '').split(':');
  const s = st();
  const by = { id: i.user.id, name: i.user.username };
  const t = what === 'approve' ? T.approveTakeover(s, id, by) : T.rejectTakeover(s, id, by);
  store.log(actor(i), 'world.takeover', `${what}: ${t.regions.map((k) => geo.label(s, k)).join(', ')} → ${C.faction(s, t.to)?.name || 'unclaimed'}`);
  store.markDirty();
  await i.deferUpdate().catch(() => {});
  await postTakeover(i.client, t);
  require('../../world/runner').step();
  return i.followUp({ content: what === 'approve' ? '👑 Approved — the map is updated. Undo it any time in the dashboard (World → Map → Takeovers).' : '✖️ Rejected.', flags: EPH }).catch(() => {});
}

// ---------- diplomacy posts ----------
async function postProposal(client, p) {
  const s = st();
  const post = WP.proposalPost(p);
  const finished = !p.status.startsWith('awaiting');
  const comps = finished ? [] : [row(btn(`wd:${p.id}:yes`, 'wAccept', { style: ButtonStyle.Success, label: p.status === 'awaiting-staff' ? 'Approve (staff)' : undefined }), btn(`wd:${p.id}:no`, 'wDecline', { style: ButtonStyle.Danger }))];
  const payload = { content: post.content, embeds: post.embeds, components: comps, allowedMentions: { users: post.pings } };
  const ch = s.settings.channels.diplomacy || s.settings.channels.world;
  for (const m of p.messages || []) {
    try { const chan = await client.channels.fetch(m.channelId); const msg = await chan.messages.fetch(m.messageId); await msg.edit(payload); return; } catch {}
  }
  const sent = await sendToChannel(client, ch, payload);
  if (sent) p.messages = [{ channelId: sent.channelId, messageId: sent.id }];
}

async function onProposalButton(i) {
  requireWorld();
  const [, pid, answer] = i.customId.replace(/~\d+$/, '').split(':');
  const s = st();
  const p = D.findProposal(s, pid);
  const c = s.characters.find((x) => x.ownerId === i.user.id && x.status === 'active' && C.factionOfChar(s, x)?.id === p.to) || require('../../engine/characters').activeCharacterOf(s, i.user.id);
  let who = null;
  const step = D.nextStep(s, p);
  if (step === 'staff') { if (!isStaff(i)) throw new UserError('Waiting for staff approval.'); who = { kind: 'staff', userId: i.user.id, name: i.user.username }; }
  else if (step === 'character') {
    const t = s.characters.find((x) => x.id === p.targetCharId);
    if (t?.ownerId === i.user.id) who = { kind: 'character', userId: i.user.id, name: t.name };
    else if (isStaff(i)) who = { kind: 'staff', userId: i.user.id, name: i.user.username };
    else throw new UserError(`Only ${t?.name || 'the other character'}'s player can answer this.`);
  } else if (step === 'target') {
    const f = C.faction(s, p.to);
    if (c && C.factionOfChar(s, c)?.id === f.id && C.isRepresentative(s, f, c, i.member)) who = { kind: 'target', userId: i.user.id, name: c.name, charId: c.id };
    else if (isStaff(i)) who = { kind: 'staff', userId: i.user.id, name: i.user.username };
    else throw new UserError(`Only a ${f?.name} representative can answer.`);
  } else throw new UserError(`This proposal is already ${p.status}.`);
  D.respond(s, pid, answer === 'yes', who);
  store.log(actor(i), 'world.diplomacy', `${who.name} ${answer === 'yes' ? 'accepted' : 'declined'} ${p.actionId} (${C.faction(s, p.from)?.name} → ${C.faction(s, p.to)?.name}) → ${p.status}`);
  store.markDirty();
  await i.deferUpdate().catch(() => {});
  await postProposal(i.client, p);
  if (i.message && !(p.messages || []).some((m) => m.messageId === i.message.id)) {
    try { const post = WP.proposalPost(p); await i.message.edit({ embeds: post.embeds, components: p.status.startsWith('awaiting') ? i.message.components : [] }); } catch {}
  }
  return i.followUp({ content: p.status === 'done' ? '✅ Agreed — it takes effect now.' : p.status.startsWith('awaiting') ? `👍 Recorded. Next: ${p.status.replace('awaiting-', '')}.` : `✖️ ${p.status}.`, flags: EPH }).catch(() => {});
}

// ---------- battle posts ----------
async function onBattleButton(i) {
  requireWorld();
  const [, bid, what] = i.customId.replace(/~\d+$/, '').split(':');
  const s = st();
  const b = M.battle(s, bid);
  if (what === 'duel') {
    if (!isStaff(i)) throw new UserError('Staff record duels after the RP fight.');
    const names = (k) => b.sides[k].champions.map((id) => s.characters.find((c) => c.id === id)?.name).filter(Boolean).join(', ');
    return i.showModal(new ModalBuilder().setCustomId(`wbm:${bid}:duel`).setTitle('Record a duel').addComponents(
      input('winner', 'Winner (character name)', { placeholder: truncate(`${names('A')} / ${names('D')}`, 100) }),
      input('loser', 'Loser (character name)'),
      input('note', 'Link to the RP or a short note', { required: false }),
    ));
  }
  const c = requireChar(i.user.id);
  const myF = C.factionOfChar(s, c);
  if (what === 'joinA' || what === 'joinD') {
    const k = what === 'joinA' ? 'A' : 'D';
    const sideF = b.sides[k].factionId;
    if (!myF || (myF.id !== sideF && C.stance(s, myF.id, sideF) !== 'allied' && !isStaff(i))) throw new UserError(`Only members of ${C.faction(s, sideF)?.name} (or their allies) can fight for them.`);
    M.joinAsChampion(s, b, k, c);
    store.log(actor(i), 'world.battle', `${c.name} joined the ${k === 'A' ? 'attackers' : 'defenders'} at ${geo.label(s, b.region)}`);
    await refreshBattle(i, b);
    return i.followUp({ content: `🥋 **${c.name}** joins the ${k === 'A' ? 'attackers' : 'defenders'} as a champion (power ${fmt(M.championPower(s, c))}).`, flags: EPH }).catch(() => {});
  }
  if (what === 'plan') {
    const k = M.sideOf(s, b, myF?.id);
    if (!k || (b.sides[k].commanderId !== c.id && !C.isRepresentative(s, myF, c, i.member))) throw new UserError('Only the commander or a representative of a side can set its plan.');
    const cmd = s.characters.find((x) => x.id === b.sides[k].commanderId);
    return i.showModal(new ModalBuilder().setCustomId(`wbm:${bid}:plan:${k}`).setTitle('Battle plan').addComponents(
      input('formation', 'Formation', { value: M.formation(s, b.sides[k].formationId)?.name || '', placeholder: s.world.formations.map((f) => f.name).join(', ').slice(0, 100) }),
      input('commander', 'Commander (character name, blank = none)', { value: cmd?.name || '', required: false, placeholder: 'Their Qi, Strength and Mobility become general pips' }),
    ));
  }
  throw new UserError('Unknown button.');
}

async function onBattleModal(i) {
  const [, bid, what, k] = i.customId.split(':');
  const s = st();
  const b = M.battle(s, bid);
  const val = (x) => { try { return String(i.fields.getTextInputValue(x) || '').trim(); } catch { return ''; } };
  if (what === 'duel') {
    if (!isStaff(i)) throw new UserError('Staff only.');
    const find = (n) => s.characters.find((c) => norm(c.name) === norm(n));
    const w = find(val('winner')); const l = find(val('loser'));
    if (!w || !l) throw new UserError('Character not found.');
    const text = M.recordDuel(s, b, w.id, l.id, val('note'), i.user.username);
    store.log(actor(i), 'world.duel', text);
    await i.deferUpdate().catch(() => {});
    await refreshBattle(i, b, true);
    return i.followUp({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }
  if (what === 'plan') {
    const fm = s.world.formations.find((f) => norm(f.name) === norm(val('formation')) || f.id === norm(val('formation')) || f.hanzi === val('formation'));
    let commanderId;
    if (val('commander')) {
      const cmd = s.characters.find((x) => x.status === 'active' && norm(x.name) === norm(val('commander')));
      if (!cmd) throw new UserError(`No character called "${val('commander')}".`);
      const sideF = b.sides[k].factionId;
      if (C.factionOfChar(s, cmd)?.id !== sideF && C.stance(s, C.factionOfChar(s, cmd)?.id, sideF) !== 'allied') throw new UserError(`${cmd.name} is not on this side.`);
      commanderId = cmd.id;
    } else commanderId = '';
    M.setPlan(s, b, k, { formationId: fm?.id, commanderId });
    const cmd = s.characters.find((x) => x.id === b.sides[k].commanderId);
    const pips = cmd ? M.generalPips(s, cmd) : null;
    store.log(actor(i), 'world.battle', `plan for ${k} at ${geo.label(s, b.region)}: ${fm?.name || '(same)'} · commander ${cmd?.name || 'none'}`);
    await i.deferUpdate().catch(() => {});
    await refreshBattle(i, b, true);
    return i.followUp({ content: `🗺️ Plan set: **${M.formation(s, b.sides[k].formationId)?.name}**${cmd ? ` · commander **${cmd.name}** (fire ${pips.fire} · shock ${pips.shock} · maneuver ${pips.maneuver} · siege ${pips.siege})` : ' · no commander'}.`, flags: EPH }).catch(() => {});
  }
}

function battleComponents(b) {
  if (b.status !== 'preparing') return [];
  return [row(btn(`wb:${b.id}:joinA`, 'wJoinA'), btn(`wb:${b.id}:joinD`, 'wJoinD'), btn(`wb:${b.id}:plan`, 'wPlan', { style: ButtonStyle.Primary }), btn(`wb:${b.id}:duel`, 'wDuel'))];
}
async function refreshBattle(i, b, deferred = false) {
  const post = WP.battlePost(b);
  const payload = { content: post.content, embeds: post.embeds, components: battleComponents(b), allowedMentions: { parse: [] } };
  if (!deferred && i.isButton?.()) { try { await i.update(payload); return; } catch {} }
  for (const m of b.messages || []) { try { const ch = await i.client.channels.fetch(m.channelId); const msg = await ch.messages.fetch(m.messageId); await msg.edit(payload); } catch {} }
}

module.exports = {
  commands: [{ data: cmd, execute, autocomplete }],
  buttons: { w: onComponent, wd: onProposalButton, wb: onBattleButton, wt: onTakeoverButton },
  modals: { wm: onModal, wbm: onBattleModal },
  postProposal, postTakeover, battleComponents, render, VIEWS,
};
