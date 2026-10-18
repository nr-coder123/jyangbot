'use strict';
/** Embeds for /world. Region, market and announcements use editable templates (dashboard → Messages → World). */
const { EmbedBuilder } = require('discord.js');
const store = require('../store');
const templates = require('../engine/templates');
const ui = require('../engine/ui');
const W = require('../world');
const { fmt, truncate, num, r2 } = require('../utils');

const { geo, economy: E, common: C, military: M, politics: P, diplomacy: D, territory: T, realm: R } = W;
const st = () => store.state;
const msg = (key, vars, opts) => templates.render(st(), key, vars, opts);
const cur = () => st().settings.currencyName;
const nyang = () => ui.emoji(st(), 'nyang');
const big = (n) => Math.round(num(n)).toLocaleString('en-US');

function bar(v, n = 10) {
  const k = Math.max(0, Math.min(n, Math.round(num(v) / 100 * n)));
  const col = v >= 60 ? '🟩' : v >= 35 ? '🟨' : '🟥';
  return col.repeat(k) + '⬛'.repeat(n - k);
}
function spark(list) {
  const chars = '▁▂▃▄▅▆▇█';
  if (!list?.length) return '';
  const lo = Math.min(...list); const hi = Math.max(...list);
  return list.slice(-12).map((v) => chars[hi === lo ? 3 : Math.round((v - lo) / (hi - lo) * 7)]).join('');
}
const factionLabel = (f) => (f ? `${f.icon || ''} ${f.name}`.trim() : '—');
const regionName = (key) => geo.label(st(), key);

// Where a player last posted only picks which region /world opens on; nothing a player buys, sells or earns depends on it.
function youLine() { return ''; }

function regionPanel(key, c) {
  const state = st();
  const w = state.world;
  key = geo.marketOf(state, key);
  const r = w.regions[key];
  const g = geo.get(key);
  const f = C.faction(state, r.controller);
  const occ = r.occupiedBy ? ` · 🏴 occupied by ${factionLabel(C.faction(state, r.occupiedBy))}` : '';
  const events = w.activeEvents.filter((e) => e.regions.includes(key)).map((ae) => {
    const ev = w.events.find((x) => x.id === ae.eventId);
    return `${ev?.emoji || '•'} **${ev?.name || ae.eventId}** — ${truncate(ev?.description || '', 120)} *(${Math.max(0, ae.endTurn - w.turn)} turns left)*`;
  });
  const policies = C.activePolicyIds(state, key).map((id) => w.policies.find((p) => p.id === id)).filter(Boolean).map((p) => `${p.emoji} ${p.name}`);
  const armies = w.armies.filter((a) => a.region === key && a.status !== 'disbanded').map((a) => `${factionLabel(C.faction(state, a.factionId))}: **${big(M.men(a))}** men${a.status === 'marching' ? ' (marching)' : a.status === 'battle' ? ' (in battle)' : ''}`);
  const t = w.terrains[r.terrain] || {};
  const dP = num(r.last?.dP);
  const buildings = (r.buildings || []).map((b) => { const bt = R.buildingType(state, b.typeId); return `${bt?.name || b.typeId}${b.level > 1 ? ` Lv ${b.level}` : ''}${b.status === 'building' ? ` (ready turn ${b.readyTurn})` : b.hp < 100 ? ` (${Math.round(b.hp)}%)` : ''}`; });
  return msg('worldRegion', {
    region: geo.label(state, key), province: key.includes('/') ? regionName(geo.provinceOf(key)) : (g?.historicalName || ''), hanzi: g?.hanzi || '',
    controller: factionLabel(f) + occ, terrain: `${t.emoji || ''} ${t.label || r.terrain}`, population: fmt(r2(r.population)), prosperity: fmt(Math.round(r.prosperity)),
    prosperityBar: bar(r.prosperity), security: fmt(Math.round(r.security)), fort: fmt(Math.round(C.wallsOf(state, key))), buildings: buildings.join(' · ') || 'None',
    coffers: big(r.coffers), calendar: C.calendar(state).text, events: events.join('\n'), policies: policies.join(' · '), armies: armies.join('\n'),
    you: youLine(c, key), notes: r.notes || g?.description || '', currency: cur(),
    trend: `${dP >= 0.3 ? '📈' : dP <= -0.3 ? '📉' : '➖'} ${dP >= 0 ? '+' : ''}${fmt(r2(dP))} / turn${r.last?.food !== undefined && r.last.food < 0.9 ? ` · 🥣 food ${Math.round(r.last.food * 100)}%` : ''}`,
  }, { color: f?.color });
}

function stockDots(r, gid) {
  const ratio = num(r.stock[gid]) / Math.max(1, num(r.targets?.[gid], 1));
  const n = ratio >= 1.5 ? 4 : ratio >= 0.9 ? 3 : ratio >= 0.5 ? 2 : ratio >= 0.15 ? 1 : 0;
  return '●'.repeat(n) + '○'.repeat(4 - n);
}
function trendArrow(r, gid) {
  const h = r.priceHistory?.[gid] || [];
  if (h.length < 2) return '';
  const a = h[h.length - 1]; const b = h[Math.max(0, h.length - 5)];
  return a > b * 1.05 ? '▲' : a < b * 0.95 ? '▼' : '';
}

function marketPanel(key, c) {
  const state = st();
  const r = state.world.regions[key];
  const lines = state.world.goods.map((g) => `${g.emoji} **${g.name}** ${fmt(r.prices[g.id])} ${trendArrow(r, g.id)} · ${stockDots(r, g.id)}`);
  return msg('worldMarket', { region: regionName(key), goods: truncate(lines.join('\n'), 4000), nyang: fmt(c.nyang), currency: cur(), coffers: big(r.coffers) });
}

function goodPanel(key, c, gid) {
  const state = st();
  const r = state.world.regions[key];
  const g = E.good(state, gid);
  if (!g || !r) return { content: 'Unknown good.', embeds: [] };
  const it = E.itemForGood(state, gid);
  const have = it ? num(c.inventory[it.id]) : 0;
  const list = geo.marketKeys(state).map((k) => ({ k, p: num(state.world.regions[k]?.prices?.[gid]) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
  const fmtList = (xs) => xs.map((x) => `${regionName(x.k)} **${fmt(x.p)}**`).join(' · ');
  const sell = it ? require('../engine/economy').shopSellPrice(state, it) : 0;
  const e = new EmbedBuilder().setTitle(`${g.emoji} ${g.name} — ${regionName(key)}`).setColor(0xc0a062)
    .setDescription([
      g.description ? `-# ${g.description}` : '',
      `**Price here:** ${fmt(r.prices[gid])} ${trendArrow(r, gid)} · base ${fmt(g.basePrice)} · ${spark(r.priceHistory?.[gid])}`,
      `**Stock here:** ${stockDots(r, gid)} ${big(r.stock[gid])} (the market wants ~${big(r.targets?.[gid])})`,
      `**Across the realm:** ${fmt(E.realmPrice(state, gid))} on average`,
      `**Dearest:** ${fmtList(list.slice(0, 3)) || '—'}`,
      `**Cheapest:** ${fmtList(list.slice(-3).reverse()) || '—'}`,
      '',
      have ? `You have **${fmt(have)}** — sell them from \`/menu\` → Inventory for ${fmt(sell)} each (the realm price, wherever you are).` : '',
      '-# Province markets are traded by merchants and faction caravans; players don\'t buy or sell here.',
    ].filter(Boolean).join('\n'));
  return { embeds: [e] };
}

const powerWord = { free: 'on your own', staff: 'with staff approval', none: 'not allowed' };
const sideNames = (state, list) => list.map((id) => C.faction(state, id)?.name || '?').join(', ');
const perkLine = (t) => D.perkText(t) || 'terms agreed in role-play';

/** The realm screen (CK3-style): who leads, what we own, who we stand with — and what you may do. */
function realmPanel(c, member) {
  const state = st();
  const w = state.world;
  const f = C.factionOfChar(state, c);
  if (!f) {
    let rec = '';
    try { rec = W.power.report(state).recommend.map((x) => `**${x.name}**`).join(' · '); } catch {}
    return { embeds: [new EmbedBuilder().setTitle('Realm').setDescription(`Your character has no sect, so no realm to serve. Join a sect to take part.${rec ? `\n\nSects looking for disciples right now: ${rec}` : ''}`).setColor(0x7f8c8d)] };
  }
  const nameOf = (id) => state.characters.find((x) => x.id === id && x.status === 'active')?.name;
  const council = f.representatives.map((id) => (nameOf(id) ? `${nameOf(id)} (${R.rank(state, f.repRanks?.[id] || w.settings.defaultRepRank)?.name || 'Representative'})` : null)).filter(Boolean);
  const lands = C.controlled(state, f.id);
  const builds = lands.flatMap((r) => (r.buildings || []).map((b) => ({ r, b })));
  const al = C.allianceOf(state, f.id);
  const wars = C.warsOf(state, f.id);
  const ags = w.agreements.filter((t) => t.parties.includes(f.id));
  const pols = P.factionPolicies(state, f).map((x) => `${x.def.name}${x.region ? ` (${regionName(x.region)})` : ''}`);
  const inc = f.lastIncome || {};
  const net = Object.entries(inc).reduce((a, [, v]) => a + num(v), 0);
  const lines = [
    `**Leader** ${nameOf(f.leaderCharId) || '—'}${council.length ? ` · **Council** ${council.join(', ')}` : ''}`,
    `**Treasury** ${nyang()} ${big(f.treasury)} *(${net >= 0 ? '+' : ''}${fmt(r2(net))} last turn)*${num(f.taxPending) > 0 ? ` · taxes due ${big(f.taxPending)}` : ''}${num(f.stipendRate) ? ` · stipends ${fmt(f.stipendRate)}%` : ''}`,
    (() => { const partners = w.factions.filter((o) => o.id !== f.id && C.hasPerk(state, f.id, o.id, 'freeTrade')).map((o) => o.name); const cv = w.caravans.filter((x) => x.auto && x.owner?.id === f.id && x.status === 'travelling').length; return `**Trade** ${partners.length ? `free trade with ${partners.join(', ')}` : 'no free-trade partners (merchants still trade, paying tariffs)'}${cv ? ` · ${cv} caravan${cv === 1 ? '' : 's'} on the road` : ''}${f.embargoes?.length ? ` · embargo on ${f.embargoes.map((id) => C.faction(state, id)?.name).filter(Boolean).join(', ')}` : ''}`; })(),
    `**Lands** ${lands.map((r) => regionName(r.key)).join(', ') || '*none — a wandering sect*'}`,
    builds.length ? `**Buildings** ${builds.map(({ r, b }) => `${R.buildingType(state, b.typeId)?.name || b.typeId}${b.status === 'building' ? ' (building)' : b.hp < 100 ? ` (${Math.round(b.hp)}%)` : ''} in ${regionName(r.key)}`).join(' · ')}` : '',
    `**Alliance** ${al ? `**${al.name}** — ${sideNames(state, al.members.filter((m) => m !== f.id)) || 'no other members yet'}` : '*none*'}`,
    `**War** ${wars.length ? wars.map((x) => `${x.name}: ${sideNames(state, x.attackers)} vs ${sideNames(state, x.defenders)}`).join('\n') : '*at peace*'}`,
    ags.length ? `**Agreements** ${ags.map((t) => `${t.name} (${perkLine(t)})`).join(' · ')}` : '',
    pols.length ? `**Policies** ${pols.join(' · ')}` : '',
  ].filter(Boolean);
  const e = new EmbedBuilder().setTitle(`${f.name}${f.hanzi ? ` ${f.hanzi}` : ''}`).setColor(f.color ? parseInt(f.color.replace('#', ''), 16) : 0x2980b9).setDescription(truncate(lines.join('\n'), 4000));
  const ps = R.powerSummary(state, f, c, member);
  if (ps) e.addFields({ name: `Your office: ${ps.rank.name}${ps.rank.hanzi ? ` ${ps.rank.hanzi}` : ''}`, value: truncate([ps.free.length ? `On your own: ${ps.free.join(', ')}` : '', ps.staff.length ? `With staff approval: ${ps.staff.join(', ')}` : '', `Spend up to ${big(ps.rank.spendLimit)} without approval.`].filter(Boolean).join('\n'), 1024) });
  else e.setFooter({ text: 'Only the leader and representatives act for the realm. Everything else is role-play.' });
  return { embeds: [e], faction: f, rep: !!ps, powers: ps };
}

/** One faction seen from another: where we stand, and what can be offered. */
function relationsWith(c, fromF, toF) {
  const state = st();
  const w = state.world;
  const stance = C.stance(state, fromF.id, toF.id);
  const ags = C.agreementsBetween(state, fromF.id, toF.id);
  const al = C.allianceOf(state, toF.id);
  const x = C.warBetween(state, fromF.id, toF.id);
  const e = new EmbedBuilder().setTitle(`${fromF.name} → ${toF.name}`).setColor(toF.color ? parseInt(toF.color.replace('#', ''), 16) : 0x8e44ad).setDescription([
    `**Standing** ${C.STANCE_LABEL[stance]}${x ? ` — ${x.name}` : ''}`,
    `**Their alliance** ${al ? al.name : '*none*'}`,
    `**Agreements** ${ags.map((t) => `${t.name} (${perkLine(t)})`).join(' · ') || '*none*'}`,
    `**Their lands** ${C.controlled(state, toF.id).map((r) => regionName(r.key)).join(', ') || '*none*'}`,
    '',
    '-# Talk it out in role-play first; then record what was agreed here. The other side\'s representative accepts.',
  ].join('\n'));
  void w;
  return { embeds: [e] };
}

function alliancePanel(c, f) {
  const state = st();
  const al = C.allianceOf(state, f.id);
  if (!al) return { embeds: [new EmbedBuilder().setTitle('Alliance').setDescription('Your faction is in no alliance. Found one (and invite others), or ask a member of an existing alliance to let you in from **Diplomacy**.').setColor(0x7f8c8d)] };
  const terms = W.defaults.PERKS.filter((p) => al.terms[p.id]).map((p) => p.name);
  const e = new EmbedBuilder().setTitle(`${al.name}${al.hanzi ? ` ${al.hanzi}` : ''}`).setColor(parseInt(al.color.replace('#', ''), 16)).setDescription([
    `**Leader** ${C.faction(state, al.leader)?.name || '—'}`,
    `**Members** ${al.members.map((m) => C.faction(state, m)?.name).join(', ')}`,
    `**Terms between all members** ${terms.join(' · ') || '*none*'}${al.tribute ? ` · members pay the leader ${al.tribute}% of their taxes` : ''}`,
    al.note ? `\n${truncate(al.note, 1500)}` : '',
  ].filter(Boolean).join('\n'));
  return { embeds: [e], alliance: al };
}

function buildPanel(c, f) {
  const state = st();
  const lands = C.controlled(state, f.id);
  const lines = lands.map((r) => `**${regionName(r.key)}** — ${(r.buildings || []).map((b) => { const t = R.buildingType(state, b.typeId); return `${t?.name || b.typeId}${num(t?.maxLevel, 1) > 1 ? ` Lv ${b.level}` : ''}${b.status === 'building' ? ` (ready turn ${b.readyTurn})` : b.hp < 100 ? ` (${Math.round(b.hp)}%)` : ''}${b.lastProfit ? ` · ${b.lastProfit > 0 ? '+' : ''}${fmt(b.lastProfit)}/turn` : ''}`; }).join(', ') || '*nothing built*'}`);
  const types = state.world.buildingTypes.map((t) => `**${t.name}**${t.hanzi ? ` ${t.hanzi}` : ''} — ${big(t.cost)}, ${t.turns} turns${E.isProducer(t) ? `, makes ${Object.entries(t.outputs || {}).map(([g, q]) => `${q} ${E.good(state, g)?.name}`).join(' + ') || 'coin'}${Object.keys(t.inputs || {}).length ? ` from ${Object.entries(t.inputs).map(([g, q]) => `${q} ${E.good(state, g)?.name}`).join(' + ')}` : ''}` : `, ${fmt(t.upkeep)}/turn`} · ${t.description}`);
  const e = new EmbedBuilder().setTitle(`Buildings — ${f.name}`).setColor(0x8d6e63).setDescription(truncate([
    lines.join('\n') || '*You rule no land to build on.*', '', types.join('\n'), '',
    `-# Paid from the treasury (${big(f.treasury)}). Production buildings earn (or lose) every turn; others cost upkeep. If a region is taken, its buildings may be razed; battles fought there damage them.`,
  ].join('\n'), 4000));
  return { embeds: [e], lands };
}

function tradePanel(c, f) {
  const state = st();
  const w = state.world;
  const mine = w.caravans.filter((cv) => cv.owner?.type === 'faction' && cv.owner.id === f.id).slice(-8).reverse();
  const ok = R.canRunCaravans(state, f);
  const rights = geo.marketKeys(state).filter((k) => R.tradeRight(state, f, k));
  const e = new EmbedBuilder().setTitle(`Trade caravans — ${f.name}`).setColor(0xc0a062).setDescription(truncate([
    ok ? 'Buy goods with the treasury in one market and sell them in another. Caravans need **trade rights** in both: unclaimed land, your own, or a ruler you have **free trade** with.' : `${f.name} doesn't run trade caravans. Trade guilds do (World settings decide who may).`,
    '',
    mine.map((cv) => (cv.status === 'travelling' ? `On the road: ${cv.qty} ${cv.goodName || cv.good} → **${regionName(cv.to)}** (turn ${cv.arriveTurn})` : `Arrived: ${cv.qty} ${cv.goodName || cv.good} → ${regionName(cv.to)} · profit **${fmt(cv.result?.profit)}**${cv.result?.lost ? ` (raided ${Math.round(cv.result.lost * 100)}%)` : ''}`)).join('\n') || '*No caravans yet.*',
    '',
    ok ? `-# Trade rights in ${rights.length} markets.` : '',
  ].join('\n'), 4000));
  return { embeds: [e], ok, rights };
}

function warPanel(c, member) {
  const state = st();
  const w = state.world;
  const f = C.factionOfChar(state, c);
  const armies = f ? w.armies.filter((a) => a.factionId === f.id && a.status !== 'disbanded') : [];
  const unitLine = (a) => Object.entries(a.units).map(([id, n]) => `${big(n)} ${M.unitType(state, id)?.name || id}`).join(' · ');
  const battles = w.battles.filter((b) => b.status === 'preparing' && (!f || [b.sides.A.factionId, b.sides.D.factionId].includes(f.id) || true)).slice(0, 5);
  const wars = f ? C.warsOf(state, f.id).map((x) => `${x.name} (${sideNames(state, x.attackers)} vs ${sideNames(state, x.defenders)})`) : [];
  const e = new EmbedBuilder().setTitle(`⚔️ War${f ? ` — ${f.name}` : ''}`).setColor(0x8b0000).setDescription([
    `**Wars:** ${wars.join('\n') || 'at peace'}`,
    '',
    '**Armies**',
    armies.map((a) => `🚩 **${a.name}** in ${regionName(a.region)} — ${unitLine(a)}\n-# morale ${Math.round(a.morale)} · supply ${Math.round(a.supply)} · ${M.formation(state, a.formationId)?.emoji || ''} ${M.formation(state, a.formationId)?.name || ''} · ${a.status}${a.march ? ` → ${regionName(a.march.path[a.march.path.length - 1])}` : ''}`).join('\n') || '*No armies.*',
    '',
    '**Battles about to begin**',
    battles.map((b) => `⚔️ ${regionName(b.region)}: ${C.faction(state, b.sides.A.factionId)?.name} vs ${C.faction(state, b.sides.D.factionId)?.name} — <t:${Math.floor(Date.parse(b.resolveAt) / 1000)}:R>`).join('\n') || '*None.*',
    '',
    '-# Representatives with the army power recruit and march armies. Fighters join a battle as champions from its post in the war channel.',
  ].join('\n'));
  return { embeds: [e], faction: f, armies };
}

function armyPanel(a) {
  const state = st();
  const f = C.faction(state, a.factionId);
  const units = Object.entries(a.units).map(([id, n]) => { const u = M.unitType(state, id); return `${u?.emoji || ''} ${big(n)} ${u?.name || id} *(fire ${num(u?.fireOff)}/${num(u?.fireDef)} · shock ${num(u?.shockOff)}/${num(u?.shockDef)}${num(u?.power, 1) !== 1 ? ` · ×${u.power}` : ''})*`.trim(); }).join('\n');
  const fm = M.formation(state, a.formationId);
  const cmd = state.characters.find((c) => c.id === a.commanderId);
  const pips = cmd ? M.generalPips(state, cmd) : null;
  const e = new EmbedBuilder().setTitle(`🚩 ${a.name}`).setColor(f?.color ? parseInt(f.color.replace('#', ''), 16) : 0x8b0000).setDescription([
    `${factionLabel(f)} · in **${regionName(a.region)}** · ${a.status}${a.march ? ` → **${regionName(a.march.path[a.march.path.length - 1])}**` : ''}`,
    `Morale **${Math.round(a.morale)}** · Supply **${Math.round(a.supply)}** · Strength **${big(M.armyStrength(state, a))}**`,
    cmd ? `Commander: **${cmd.name}** — fire ${pips.fire} · shock ${pips.shock} · maneuver ${pips.maneuver} · siege ${pips.siege}` : 'Commander: *none* (no general pips)',
    `Formation: ${fm?.emoji || ''} **${fm?.name || a.formationId}** — ${fm?.description || ''}`,
    '',
    units || '*No troops.*',
  ].join('\n'));
  return { embeds: [e] };
}

function battleVars(b) {
  const state = st();
  const side = (k) => {
    const s = b.sides[k];
    const units = M.sideUnits(state, b, k);
    const fm = M.formation(state, s.formationId);
    const cmd = state.characters.find((c) => c.id === s.commanderId);
    const pips = cmd && !s.commanderFallen ? M.generalPips(state, cmd) : null;
    return `${Object.entries(units).map(([id, n]) => `${big(n)} ${M.unitType(state, id)?.name || id}`).join(' · ') || '—'}\nFormation: ${fm?.emoji || ''} ${fm?.name || ''}${s.momentum ? ` · Duel dice +${fmt(s.momentum)}` : ''}${s.moraleShock ? ` · Morale −${s.moraleShock}` : ''}${cmd ? `\nCommander: ${cmd.name}${pips ? ` (fire ${pips.fire} · shock ${pips.shock} · maneuver ${pips.maneuver})` : ' — fallen'}` : ''}`.trim();
  };
  const champs = (k) => b.sides[k].champions.map((id) => state.characters.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || '—';
  const r = state.world.regions[b.region];
  const t = state.world.terrains[r?.terrain] || {};
  return {
    region: regionName(b.region), attacker: C.faction(state, b.sides.A.factionId)?.name || '?', defender: C.faction(state, b.sides.D.factionId)?.name || '?',
    attackerArmy: side('A'), defenderArmy: side('D'), resolves: `<t:${Math.floor(Date.parse(b.resolveAt) / 1000)}:R>`,
    duels: b.duels.map((d) => `🤺 ${state.characters.find((c) => c.id === d.winner)?.name} defeated ${state.characters.find((c) => c.id === d.loser)?.name}${d.note ? ` — ${d.note}` : ''}`).join('\n'),
    champions: `🗡️ ${champs('A')}\n🛡️ ${champs('D')}`, terrain: `${t.emoji || ''} ${t.label || ''}${num(t.attackerPenalty) ? ` (attacker ${t.attackerPenalty} dice)` : ''} · width ${fmt(num(t.width, 30))}k`.trim(), fort: fmt(Math.round(num(r?.fort))),
  };
}
const battlePost = (b) => msg('worldBattle', battleVars(b));

function battleReport(b) {
  const state = st();
  const A = C.faction(state, b.sides.A.factionId)?.name || 'Attacker'; const Dn = C.faction(state, b.sides.D.factionId)?.name || 'Defender';
  const ph = (b.phases || []).map((p, i) => {
    const last = (b.phases[i + 1]?.day || (b.days.length + 1)) - 1;
    const days = b.days.filter((d) => d.day >= p.day && d.day <= last);
    if (!days.length) return '';
    const la = days.reduce((x, d) => x + d.lost.A, 0); const ld = days.reduce((x, d) => x + d.lost.D, 0); const end = days[days.length - 1];
    return `**Day ${p.day}${last > p.day ? `–${last}` : ''} · ${p.phase === 'fire' ? '🏹 Fire' : '⚔️ Shock'}** — dice ${fmt(p.dice.A)} vs ${fmt(p.dice.D)} · losses ${big(la)} / ${big(ld)} · morale ${Math.round(end.morale.A)} / ${Math.round(end.morale.D)}${p.notes?.length ? `\n-# ${p.notes.join(' ')}` : ''}`;
  }).filter(Boolean);
  const rounds = ph.join('\n');
  const res = b.result || {};
  const loser = res.winner === 'A' ? Dn : A;
  const how = res.routed?.A || res.routed?.D ? `${loser} broke and fled after ${res.days} day${res.days === 1 ? '' : 's'}${res.pursuit ? ` — the pursuit cost them ${big(res.pursuit)} more` : ''}.` : `Neither side broke in ${res.days} days; ${res.winner === 'A' ? A : Dn} held the stronger position.`;
  return msg('worldBattleResult', { region: regionName(b.region), winner: res.winner === 'A' ? A : Dn, attacker: A, defender: Dn, rounds: truncate(rounds, 3500), losses: `${A} lost ${big(res.lost?.A)} · ${Dn} lost ${big(res.lost?.D)}`, summary: how });
}

function proposalPost(p) {
  const state = st();
  const kind = D.KINDS[p.kind] || { name: p.kind };
  const from = C.faction(state, p.from); const to = C.faction(state, p.to);
  const proposer = state.characters.find((c) => c.id === p.proposerCharId);
  const subj = state.characters.find((c) => c.id === p.payload?.subjectCharId); const targ = state.characters.find((c) => c.id === p.payload?.targetCharId);
  const repIds = (f) => [f?.leaderCharId, ...(f?.representatives || [])].map((id) => state.characters.find((c) => c.id === id)?.ownerId).filter(Boolean);
  const pl = p.payload || {};
  const detail = p.kind === 'agreement' ? [W.defaults.PERKS.filter((x) => pl.perks?.[x.id]).map((x) => x.name).join(', '), pl.tribute && (num(pl.tribute.percent) || num(pl.tribute.fixed)) ? `${pl.tribute.who === 'to' ? to?.name : from?.name} pays tribute (${num(pl.tribute.percent) ? `${pl.tribute.percent}% of taxes` : ''}${num(pl.tribute.fixed) ? ` ${pl.tribute.fixed}/turn` : ''})` : '', pl.duration ? `for ${pl.duration} turns` : ''].filter(Boolean).join(' · ')
    : p.kind === 'alliance-invite' || p.kind === 'alliance-join' ? (state.world.alliances.find((a) => a.id === pl.allianceId)?.name || '')
      : p.kind === 'alliance-found' ? `“${pl.name}”` : p.kind === 'marriage' ? `${subj?.name || '?'} ⇄ ${targ?.name || '?'}` : p.kind === 'peace' ? (state.world.wars.find((x) => x.id === pl.warId)?.name || '') : '';
  const step = p.status === 'awaiting-target' ? `Waiting for a **${to?.name}** representative.` : p.status === 'awaiting-character' ? `Waiting for **${targ?.name}**'s player (<@${targ?.ownerId}>) to consent.` : p.status === 'awaiting-staff' ? 'Waiting for staff approval.' : p.status === 'done' ? 'Agreed.' : `${p.status}${p.rejectedBy ? ` by ${p.rejectedBy}` : ''}.`;
  const pings = p.status === 'awaiting-target' ? repIds(to) : p.status === 'awaiting-character' && targ ? [targ.ownerId] : [];
  return {
    ...msg('worldProposal', {
      action: kind.name, emoji: '', from: from?.name || '?', to: to?.name || '?', proposer: proposer ? `${proposer.name} (<@${proposer.ownerId}>)` : 'Staff',
      description: detail, note: p.note || '—', step, characters: subj || targ ? `${subj?.name || '—'} ⇄ ${targ?.name || '—'}` : '', expires: `<t:${Math.floor(Date.parse(p.expiresAt) / 1000)}:R>`,
      pings: [...new Set(pings)].map((u) => `<@${u}>`).join(' '),
    }),
    pings,
  };
}

function requestPost(q) {
  const state = st();
  const f = C.faction(state, q.factionId);
  const lines = [
    `**${f?.name || '?'}** — ${q.byName ? `${q.byName} wants to ` : ''}**${q.summary}**`,
    `-# ${q.why}`,
    q.status === 'pending' ? 'Staff: approve or reject.' : `**${q.status}**${q.decidedBy ? ` by ${q.decidedBy}` : ''}${q.result ? ` — ${q.result}` : ''}`,
  ];
  return { content: truncate(lines.join('\n'), 1900) };
}

module.exports = { youLine, bar, spark, regionPanel, marketPanel, goodPanel, realmPanel, relationsWith, alliancePanel, buildPanel, tradePanel, requestPost, warPanel, armyPanel, battlePost, battleVars, battleReport, proposalPost, regionName, factionLabel, big };
