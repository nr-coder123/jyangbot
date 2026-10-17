'use strict';
/**
 * Staff tools for the world map:
 *   /takeover give region faction [reason]   — hand a region to a faction right now (or "none" to unclaim it)
 *   /takeover approve|reject request          — answer a pending claim or conquest
 *   /takeover revert takeover                 — undo an approved takeover
 *   /office character office                  — make a character their faction's representative or leader
 * Everything here can also be done (and undone) in the dashboard: World → Map → Takeovers, World → Politics.
 */
const { SlashCommandBuilder } = require('discord.js');
const store = require('../../store');
const W = require('../../world');
const { EPH, actor } = require('../util');
const { UserError, norm, truncate } = require('../../utils');

const { geo, common: C, territory: T } = W;
const st = () => store.state;

const takeover = new SlashCommandBuilder().setName('takeover').setDescription('Staff: move control of a region to another faction')
  .addSubcommand((s) => s.setName('give').setDescription('Give a province or prefecture to a faction now')
    .addStringOption((o) => o.setName('region').setDescription('Province or prefecture').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('faction').setDescription('New ruler ("none" = unclaimed)').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('reason').setDescription('Shown in the announcement')))
  .addSubcommand((s) => s.setName('approve').setDescription('Approve a pending claim or conquest')
    .addStringOption((o) => o.setName('request').setDescription('Pending takeover').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('reject').setDescription('Reject a pending claim or conquest')
    .addStringOption((o) => o.setName('request').setDescription('Pending takeover').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('revert').setDescription('Undo an approved takeover')
    .addStringOption((o) => o.setName('request').setDescription('Approved takeover').setRequired(true).setAutocomplete(true)));

const office = new SlashCommandBuilder().setName('office').setDescription('Staff: appoint a faction representative or leader')
  .addStringOption((o) => o.setName('character').setDescription('Character').setRequired(true).setAutocomplete(true))
  .addStringOption((o) => o.setName('office').setDescription('Office').setRequired(true).addChoices(
    { name: 'Representative — leads diplomacy, trade and politics (usually does not fight)', value: 'representative' },
    { name: 'Leader — head of the faction', value: 'leader' },
    { name: 'Member — no office', value: 'member' },
  ))
  .addStringOption((o) => o.setName('rank').setDescription('Representative rank (what they may do; see World settings)').setAutocomplete(true));

const allRegions = () => [...geo.provinces(), ...geo.prefectures()].map((x) => x.key);
function findRegion(text) {
  const s = st();
  const q = norm(text);
  return allRegions().find((k) => k === text || norm(geo.label(s, k)) === q || norm(geo.fullLabel(s, k)) === q || geo.get(k)?.hanzi === text)
    || allRegions().find((k) => norm(geo.fullLabel(s, k)).includes(q)) || null;
}
const takeoverLabel = (t) => {
  const s = st();
  return truncate(`${t.regions.map((k) => geo.label(s, k)).join(', ')} → ${C.faction(s, t.to)?.name || 'unclaimed'}${t.reason ? ` · ${t.reason}` : ''}`, 100);
};

async function execTakeover(i) {
  const s = st();
  if (!s.world?.settings?.enabled) throw new UserError('The world is turned off (dashboard → World → Settings).');
  const sub = i.options.getSubcommand();
  const by = { id: i.user.id, name: i.user.username };
  const world = require('./world');
  if (sub === 'give') {
    const key = findRegion(i.options.getString('region'));
    if (!key) throw new UserError('Unknown region.');
    const fv = i.options.getString('faction');
    const f = /^(none|-|unclaimed|nobody)$/i.test(fv) ? null : C.faction(s, fv) || s.world.factions.find((x) => norm(x.name) === norm(fv));
    if (!f && !/^(none|-|unclaimed|nobody)$/i.test(fv)) throw new UserError('Unknown faction.');
    const prev = T.controllerOf(s, key);
    const t = T.forceTakeover(s, { regions: [key], to: f?.id || null, reason: i.options.getString('reason') || '', by });
    store.log(actor(i), 'world.takeover', `${geo.fullLabel(s, key)}: ${C.faction(s, prev)?.name || 'unclaimed'} → ${f?.name || 'unclaimed'}`);
    store.markDirty();
    require('../../world/runner').step();
    return i.reply({ content: `👑 **${geo.fullLabel(s, key)}** now belongs to **${f?.name || 'no one'}** (was ${C.faction(s, prev)?.name || 'unclaimed'}).\n-# Undo: \`/takeover revert\` or the dashboard (World → Map → Takeovers). Id \`${t.id}\`.`, flags: EPH });
  }
  const id = i.options.getString('request');
  const fn = { approve: T.approveTakeover, reject: T.rejectTakeover, revert: T.revertTakeover }[sub];
  const t = fn(s, id, by);
  store.log(actor(i), 'world.takeover', `${sub}: ${takeoverLabel(t)}`);
  store.markDirty();
  await world.postTakeover(i.client, t).catch(() => {});
  require('../../world/runner').step();
  return i.reply({ content: sub === 'approve' ? `👑 Approved: ${takeoverLabel(t)}` : sub === 'reject' ? `✖️ Rejected: ${takeoverLabel(t)}` : `↩️ Reverted: ${takeoverLabel(t)}`, flags: EPH });
}

function autoTakeover(i) {
  const s = st();
  const focused = i.options.getFocused(true);
  const q = norm(focused.value);
  if (focused.name === 'region') {
    return i.respond(allRegions().map((k) => ({ k, name: `${geo.fullLabel(s, k)} ${geo.get(k)?.hanzi || ''} — ${C.faction(s, T.controllerOf(s, k))?.name || 'unclaimed'}` }))
      .filter((x) => !q || norm(x.name).includes(q)).slice(0, 25).map((x) => ({ name: truncate(x.name, 100), value: x.k })));
  }
  if (focused.name === 'faction') {
    return i.respond([{ id: 'none', name: 'None (unclaimed)' }, ...s.world.factions].filter((f) => !q || norm(f.name).includes(q)).slice(0, 25).map((f) => ({ name: truncate(f.name, 100), value: f.id })));
  }
  const sub = i.options.getSubcommand();
  const want = sub === 'revert' ? 'approved' : 'pending';
  return i.respond(s.world.takeovers.filter((t) => t.status === want).filter((t) => !q || norm(takeoverLabel(t)).includes(q)).slice(0, 25).map((t) => ({ name: takeoverLabel(t), value: t.id })));
}

async function execOffice(i) {
  const s = st();
  const c = s.characters.find((x) => x.id === i.options.getString('character')) || s.characters.find((x) => x.status === 'active' && norm(x.name) === norm(i.options.getString('character')));
  if (!c) throw new UserError('Character not found.');
  const o = i.options.getString('office');
  const f = T.setOffice(s, c, o);
  const rk = i.options.getString('rank');
  if (o === 'representative') { const r = W.realm.rank(s, rk || s.world.settings.defaultRepRank); if (!r) throw new UserError('Unknown rank.'); f.repRanks[c.id] = r.id; }
  store.log(actor(i), 'world.office', `${c.name} is now ${o} of ${f.name}`);
  store.markDirty();
  const sync = await syncOffice(i.client, c).catch(() => null);
  const rank = W.realm.rankOf(s, f, c);
  return i.reply({ content: `**${c.name}** is now ${o === 'member' ? 'an ordinary member' : o === 'leader' ? 'the leader' : `a representative — **${rank?.name}**`} of **${f.name}**.${rank ? `\n-# ${W.realm.powerSummary(s, f, c).free.join(', ') || 'nothing'} on their own; ${W.realm.powerSummary(s, f, c).staff.join(', ') || 'nothing'} with staff approval; spend up to ${rank.spendLimit}.` : ''}${sync?.note ? `\n-# ${sync.note}` : ''}`, flags: EPH });
}
function autoOffice(i) {
  const s = st();
  const focused = i.options.getFocused(true);
  if (focused.name === 'rank') return i.respond(W.realm.ranks(s).filter((r) => !focused.value || norm(r.name).includes(norm(focused.value))).slice(0, 25).map((r) => ({ name: truncate(`${r.name} — ${r.description || ''}`, 100), value: r.id })));
  const q = norm(focused.value);
  return i.respond(s.characters.filter((c) => c.status === 'active' && (!q || norm(c.name).includes(q))).slice(0, 25).map((c) => ({ name: truncate(`${c.name} — ${c.sect || 'no sect'} (${T.officeOf(s, c)})`, 100), value: c.id })));
}

/** Give or take the representative role (faction's own role, else the global one from World → Settings). */
async function syncOffice(client, c) {
  const s = st();
  const f = C.factionOfChar(s, c);
  const roleId = f?.repRoleId || (s.world.settings.representativeRoleIds || [])[0];
  if (!client || !roleId || !c.ownerId) return { note: roleId ? '' : 'Tip: set a Representative role (World → Settings) and the bot gives it automatically.' };
  const office = T.officeOf(s, c);
  for (const g of client.guilds.cache.values()) {
    const role = g.roles.cache.get(roleId);
    if (!role) continue;
    const m = await g.members.fetch(c.ownerId).catch(() => null);
    if (!m) continue;
    const others = s.characters.some((x) => x.id !== c.id && x.ownerId === c.ownerId && x.status === 'active' && T.officeOf(s, x) !== 'member');
    if (office !== 'member') await m.roles.add(role).catch(() => {});
    else if (!others) await m.roles.remove(role).catch(() => {});
    return { note: `Role ${office !== 'member' ? 'given' : 'removed'}: @${role.name}` };
  }
  return { note: '' };
}

module.exports = {
  commands: [
    { data: takeover, execute: execTakeover, autocomplete: autoTakeover, staff: true },
    { data: office, execute: execOffice, autocomplete: autoOffice, staff: true },
  ],
  syncOffice,
};
