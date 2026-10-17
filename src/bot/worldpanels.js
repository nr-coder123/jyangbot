'use strict';
/** Embeds for /world. Region, market and announcements use editable templates (dashboard → Messages → World). */
const { EmbedBuilder } = require('discord.js');
const store = require('../store');
const templates = require('../engine/templates');
const ui = require('../engine/ui');
const W = require('../world');
const { fmt, truncate, num, r2 } = require('../utils');

const { geo, economy: E, common: C, military: M, politics: P, diplomacy: D, territory: T } = W;
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

function youLine(c, key) {
  if (!c) return '';
  if (E.isTravelling(c)) return `🧭 On the road to **${regionName(c.travel.to)}** — arrive <t:${Math.floor(Date.parse(c.travel.arriveAt) / 1000)}:R>.`;
  const loc = geo.marketOf(st(), E.locationOf(st(), c));
  if (loc === key) return `📍 **${c.name}** is here.`;
  if (T.channelMode(st())) { const trip = key ? T.rpTravel(st(), loc, key) : null; return `📍 **${c.name}** is in **${regionName(loc)}**${trip ? ` — ${trip.text}` : ''}.`; }
  return `📍 **${c.name}** is in **${regionName(loc)}**${key ? ` (${Math.round(num(E.travelInfo(st(), c, key).hours) * 10) / 10} h away)` : ''}.`;
}

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
  return msg('worldRegion', {
    region: geo.label(state, key), province: key.includes('/') ? regionName(geo.provinceOf(key)) : (g?.historicalName || ''), hanzi: g?.hanzi || '',
    controller: factionLabel(f) + occ, terrain: `${t.emoji || ''} ${t.label || r.terrain}`, population: fmt(r2(r.population)), prosperity: fmt(Math.round(r.prosperity)),
    prosperityBar: bar(r.prosperity), security: fmt(Math.round(r.security)), unrest: fmt(Math.round(r.unrest)), corruption: fmt(Math.round(r.corruption)), fort: fmt(Math.round(r.fort)),
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
  const lines = state.world.goods.map((g) => {
    const it = E.itemForGood(state, g.id);
    const have = it ? num(c.inventory[it.id]) : 0;
    return `${g.emoji} **${g.name}** ${fmt(r.prices[g.id])} ${trendArrow(r, g.id)} · ${stockDots(r, g.id)}${have ? ` · you ${fmt(have)}` : ''}`;
  });
  let tariff = '—';
  try { tariff = `${fmt(E.tariffFor(state, key, c))}%`; } catch (e) { tariff = '⛔ closed to you'; }
  return msg('worldMarket', { region: regionName(key), goods: truncate(lines.join('\n'), 4000), nyang: fmt(c.nyang), currency: cur(), tariff, coffers: big(r.coffers) });
}

function goodPanel(key, c, gid) {
  const state = st();
  const r = state.world.regions[key];
  const g = E.good(state, gid);
  const it = E.itemForGood(state, gid);
  const have = it ? num(c.inventory[it.id]) : 0;
  const q = (n, side) => { try { return E.quote(state, key, gid, n, side, c); } catch { return null; } };
  const b1 = q(1, 'buy'); const b10 = q(10, 'buy'); const s1 = have ? q(1, 'sell') : null; const s10 = have >= 10 ? q(10, 'sell') : null;
  const near = [...geo.within(state, key, 3).keys()].filter((k) => k !== key).map((k) => ({ k, p: num(state.world.regions[k].prices[gid]) })).sort((a, b) => b.p - a.p);
  const fmtNear = (list) => list.map((x) => `${regionName(x.k)} **${fmt(x.p)}**`).join(' · ');
  const e = new EmbedBuilder().setTitle(`${g.emoji} ${g.name} — ${regionName(key)}`).setColor(0xc0a062)
    .setDescription([
      g.description ? `-# ${g.description}` : '',
      `**Price:** ${fmt(r.prices[gid])} ${trendArrow(r, gid)} · base ${fmt(g.basePrice)} · ${spark(r.priceHistory?.[gid])}`,
      `**Stock:** ${stockDots(r, gid)} ${big(r.stock[gid])} (the market wants ~${big(r.targets?.[gid])})`,
      `**Buy:** 1 for ${b1 ? fmt(b1.total) : '—'} · 10 for ${b10 ? fmt(b10.total) : '—'}${b1?.tariff ? ` *(incl. ${fmt(b1.tariff)}% tariff)*` : ''}`,
      `**Sell:** ${s1 ? `1 for ${fmt(s1.total)}` : 'you have none'}${s10 ? ` · 10 for ${fmt(s10.total)}` : ''}`,
      `**You have:** ${fmt(have)} · ${nyang()} ${fmt(c.nyang)}`,
      '',
      `**Pays most nearby:** ${fmtNear(near.slice(0, 3)) || '—'}`,
      `**Cheapest nearby:** ${fmtNear(near.slice(-3).reverse()) || '—'}`,
      '-# Prices move as you trade: every unit bought raises the price, every unit sold lowers it.',
    ].filter(Boolean).join('\n'));
  return { embeds: [e] };
}

function caravansPanel(c) {
  const state = st();
  const list = state.world.caravans.filter((cv) => !cv.npc && cv.owner.id === c.id).slice(-10).reverse();
  const lines = list.map((cv) => {
    const g = E.good(state, cv.good);
    if (cv.status === 'travelling') return `🐫 ${cv.qty} ${g?.emoji || ''} ${g?.name} → **${regionName(cv.to)}** · arrives <t:${Math.floor(Date.parse(cv.arriveAt) / 1000)}:R> · raid risk ~${Math.round(num(cv.risk) * 100)}%${cv.escort ? ' · 🚩 escorted' : ''}`;
    const res = cv.result || {};
    return `✅ ${cv.qty} ${g?.name} → ${regionName(cv.to)}: ${res.lost ? `🏴 raided (${Math.round(res.lost * 100)}% lost) · ` : ''}${res.sold ? `sold ${res.sold} for ${fmt(res.earned)}` : ''}${res.kept ? ` · ${res.kept} kept in your inventory` : ''}`;
  });
  const e = new EmbedBuilder().setTitle('🐫 Your caravans').setColor(0xc0a062).setDescription([
    lines.join('\n') || '*No caravans yet.*',
    '',
    `Send trade goods from **${regionName(geo.marketOf(state, E.locationOf(state, c)))}** to another market without travelling. They are sold on arrival for whatever that market pays. Bandits may raid them on the way — an escort costs ${Math.round(num(state.world.settings.escortCost) * 100)}% of the cargo's value but cuts the risk.`,
    `-# At most ${state.world.settings.maxPlayerCaravans} caravans at a time.`,
  ].join('\n'));
  return { embeds: [e] };
}

function workshopsPanel(key, c) {
  const state = st();
  const r = state.world.regions[key];
  const mine = E.ownedWorkshops(state, c);
  const t = (id) => state.world.workshopTypes.find((x) => x.id === id);
  const owner = (ws) => (ws.owner.type === 'character' ? (state.characters.find((x) => x.id === ws.owner.id)?.name || '?') : ws.owner.type === 'faction' ? C.faction(state, ws.owner.id)?.name || '?' : 'the town');
  const e = new EmbedBuilder().setTitle(`🏭 Workshops — ${regionName(key)}`).setColor(0xc0a062).setDescription([
    `**Yours** (${mine.length}/${state.world.settings.maxWorkshopsPerCharacter})`,
    mine.map(({ key: k, ws }) => `${t(ws.typeId)?.emoji || ''} **${t(ws.typeId)?.name}** Lv ${ws.level} in ${regionName(k)} · last turn ${ws.lastProfit >= 0 ? '+' : ''}${fmt(ws.lastProfit)} · total ${fmt(ws.totalProfit)}${ws.throttled ? ' · ⚠️ running slow (unprofitable)' : ws.idle ? ' · 💤 idle (no inputs)' : ''}`).join('\n') || '*You own none.*',
    '',
    `**Here** (${(r.workshops || []).length}/${E.workshopSlots(state, r)} plots)`,
    (r.workshops || []).map((ws) => `${t(ws.typeId)?.emoji || ''} ${t(ws.typeId)?.name} Lv ${ws.level} — ${owner(ws)}`).join('\n') || '*None.*',
    '',
    '-# A workshop buys its inputs from this market and sells its output back every turn. Profit (or loss) goes to its owner. Build where inputs are cheap and the output sells well.',
  ].join('\n'));
  return { embeds: [e] };
}

function workshopTypeLine(state, t, key) {
  const r = state.world.regions[key];
  const cost = Math.round(t.cost * (0.7 + r.prosperity / 100 * 0.6));
  const ins = Object.entries(t.inputs || {}).map(([g, q]) => `${q} ${E.good(state, g)?.name}`).join(' + ') || 'nothing';
  const outs = t.service ? 'coin from customers' : Object.entries(t.outputs || {}).map(([g, q]) => `${q} ${E.good(state, g)?.name}`).join(' + ');
  return { cost, text: `${ins} → ${outs}` };
}

function politicsPanel(c, member) {
  const state = st();
  const w = state.world;
  const f = C.factionOfChar(state, c);
  if (!f) {
    let rec = '';
    try { rec = W.power.report(state).recommend.map((x) => `${x.icon || ''} **${x.name}**`).join(' · '); } catch {}
    return { embeds: [new EmbedBuilder().setTitle('📜 Politics').setDescription(`Your character has no sect, so no faction to speak for. Join a sect to take part in politics.${rec ? `\n\nSects looking for disciples right now: ${rec}` : ''}`).setColor(0x7f8c8d)] };
  }
  const rep = C.isRepresentative(state, f, c, member);
  const rels = w.factions.filter((o) => o.id !== f.id && o.active).map((o) => ({ o, v: C.relation(state, f.id, o.id).value, s: C.stance(state, f.id, o.id) })).sort((a, b) => b.v - a.v);
  const fmtRel = (x) => `${x.o.icon || ''} ${x.o.name} **${Math.round(x.v)}** ${C.STANCE_LABEL[x.s]}`;
  const treaties = w.treaties.filter((t) => t.parties.includes(f.id)).map((t) => `${w.treatyTypes.find((x) => x.id === t.type)?.emoji || '📜'} ${t.name} with ${t.parties.filter((p) => p !== f.id).map((p) => C.faction(state, p)?.name).join(', ')}${t.endTurn ? ` (${t.endTurn - w.turn} turns)` : ''}`);
  const pols = P.factionPolicies(state, f).map((x) => `${x.def.emoji} ${x.def.name}${x.region ? ` (${regionName(x.region)})` : ''}`);
  const pending = w.proposals.filter((p) => (p.from === f.id || p.to === f.id) && p.status.startsWith('awaiting')).slice(0, 6).map((p) => { const a = D.action(state, p.actionId); return `${a?.emoji || ''} ${a?.name}: ${C.faction(state, p.from)?.name} → ${C.faction(state, p.to)?.name} — *${p.status.replace('awaiting-', 'waiting for ')}*`; });
  const nameOf = (id) => state.characters.find((x) => x.id === id && x.status === 'active')?.name;
  const reps = [f.leaderCharId && nameOf(f.leaderCharId) ? `👑 ${nameOf(f.leaderCharId)} (leader)` : '', ...f.representatives.map(nameOf).filter(Boolean).map((n) => `🎐 ${n}`)].filter(Boolean);
  const inc = f.lastIncome || {};
  const every = num(w.settings.stipendEveryTurns, 28);
  const nextPay = every - (w.turn % every);
  const myPlan = T.stipendPlan(state, f).rows.find((x) => x.id === c.id);
  const e = new EmbedBuilder().setTitle(`📜 ${f.icon || ''} ${f.name}`).setColor(f.color ? parseInt(f.color.replace('#', ''), 16) : 0x2980b9)
    .addFields(
      { name: 'Treasury', value: `${nyang()} ${big(f.treasury)}\n-# last turn: taxes +${fmt(inc.taxes || 0)} · upkeep ${fmt(r2(num(inc.upkeep) + num(inc.armies) + num(inc.admin)))}`, inline: true },
      { name: 'Influence', value: `${fmt(Math.floor(f.influence))} (+${fmt(P.influenceIncome(state, f))}/turn)`, inline: true },
      { name: 'Reputation', value: `${fmt(Math.round(f.reputation))}/100`, inline: true },
      { name: 'Lands', value: C.controlled(state, f.id).map((r) => regionName(r.key)).join(', ') || '*None — a wandering sect.*', inline: false },
      { name: 'Representatives', value: reps.join(' · ') || '*None yet — staff appoint them with `/office` or in the dashboard.*', inline: false },
      { name: 'Stipends', value: num(f.stipendRate) > 0 ? `${fmt(f.stipendRate)}% of each turn's income → fund ${nyang()} ${big(f.stipendFund)} · paid in ${nextPay} turn${nextPay === 1 ? '' : 's'}${myPlan ? ` · your share now ≈ ${big(myPlan.paid)}` : ''}` : '*No stipends — a representative can set a rate.*', inline: false },
      { name: 'Relations', value: truncate([...rels.slice(0, 5).map(fmtRel), rels.length > 8 ? '…' : '', ...rels.slice(-3).map(fmtRel)].filter(Boolean).join('\n'), 1024) || '—', inline: false },
      { name: 'Treaties', value: truncate(treaties.join('\n'), 1024) || '*None.*', inline: false },
      { name: 'Policies', value: truncate(pols.join('\n'), 1024) || '*None.*', inline: false },
      { name: 'Pending', value: truncate(pending.join('\n'), 1024) || '*Nothing pending.*', inline: false },
    )
    .setFooter({ text: rep ? 'You are a representative: you lead diplomacy, policies, stipends and land claims (staff approve takeovers).' : 'Representatives lead the faction\'s diplomacy, trade and politics.' });
  return { embeds: [e], faction: f, rep };
}

function diplomacyPanel(c, fromF, toF) {
  const state = st();
  const opts = D.actionsFor(state, fromF.id, toF.id);
  const rel = C.relation(state, fromF.id, toF.id);
  const lines = opts.map((x) => `${x.available ? '✅' : '🔒'} ${x.action.emoji} **${x.action.name}**${x.action.staffApproval ? ' *(staff approve)*' : ''}${x.available ? '' : ` — ${x.reasons[0]}`}`);
  const e = new EmbedBuilder().setTitle(`🕊️ ${fromF.name} → ${toF.icon || ''} ${toF.name}`).setColor(0x8e44ad)
    .setDescription(`Relations **${Math.round(rel.value)}** · ${C.STANCE_LABEL[C.stance(state, fromF.id, toF.id)]} · ${fromF.name} has ${Math.floor(fromF.influence)} influence\n\n${truncate(lines.join('\n'), 3600)}`)
    .setFooter({ text: 'Pick an action below. Proposals are posted in the diplomacy channel for their representatives to answer.' });
  return { embeds: [e], options: opts };
}

function warPanel(c, member) {
  const state = st();
  const w = state.world;
  const f = C.factionOfChar(state, c);
  const armies = f ? w.armies.filter((a) => a.factionId === f.id && a.status !== 'disbanded') : [];
  const unitLine = (a) => Object.entries(a.units).map(([id, n]) => `${big(n)} ${M.unitType(state, id)?.name || id}`).join(' · ');
  const battles = w.battles.filter((b) => b.status === 'preparing' && (!f || [b.sides.A.factionId, b.sides.D.factionId].includes(f.id) || true)).slice(0, 5);
  const wars = f ? Object.entries(w.relations).filter(([k, r]) => r.war && k.split('|').includes(f.id)).map(([k]) => C.faction(state, k.split('|').find((x) => x !== f.id))?.name) : [];
  const e = new EmbedBuilder().setTitle(`⚔️ War${f ? ` — ${f.name}` : ''}`).setColor(0x8b0000).setDescription([
    `**At war with:** ${wars.join(', ') || 'no one'}`,
    '',
    '**Armies**',
    armies.map((a) => `🚩 **${a.name}** in ${regionName(a.region)} — ${unitLine(a)}\n-# morale ${Math.round(a.morale)} · supply ${Math.round(a.supply)} · ${M.formation(state, a.formationId)?.emoji || ''} ${M.formation(state, a.formationId)?.name || ''} · ${a.status}${a.march ? ` → ${regionName(a.march.path[a.march.path.length - 1])}` : ''}`).join('\n') || '*No armies.*',
    '',
    '**Battles about to begin**',
    battles.map((b) => `⚔️ ${regionName(b.region)}: ${C.faction(state, b.sides.A.factionId)?.name} vs ${C.faction(state, b.sides.D.factionId)?.name} — <t:${Math.floor(Date.parse(b.resolveAt) / 1000)}:R>`).join('\n') || '*None.*',
    '',
    '-# Representatives recruit and march armies. Anyone can join a battle as a champion from its post in the war channel.',
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
  const a = D.action(state, p.actionId);
  const from = C.faction(state, p.from); const to = C.faction(state, p.to);
  const proposer = state.characters.find((c) => c.id === p.proposerCharId);
  const subj = state.characters.find((c) => c.id === p.subjectCharId); const targ = state.characters.find((c) => c.id === p.targetCharId);
  const repIds = (f) => [f?.leaderCharId, ...(f?.representatives || [])].map((id) => state.characters.find((c) => c.id === id)?.ownerId).filter(Boolean);
  const step = p.status === 'awaiting-target' ? `Waiting for a **${to?.name}** representative.` : p.status === 'awaiting-character' ? `Waiting for **${targ?.name}**'s player (<@${targ?.ownerId}>) to consent.` : p.status === 'awaiting-staff' ? 'Waiting for staff approval.' : p.status === 'done' ? `✅ Done.${p.result?.length ? ` ${p.result.join('; ')}.` : ''}` : `✖️ ${p.status}${p.rejectedBy ? ` by ${p.rejectedBy}` : ''}${p.blockedReason ? ` — ${p.blockedReason}` : ''}.`;
  const pings = p.status === 'awaiting-target' ? repIds(to) : p.status === 'awaiting-character' && targ ? [targ.ownerId] : [];
  return {
    ...msg('worldProposal', {
      action: a?.name || p.actionId, emoji: a?.emoji || '📜', from: from?.name || '?', to: to?.name || '?', proposer: proposer ? `${proposer.name} (<@${proposer.ownerId}>)` : 'Staff',
      description: a?.description || '', note: p.note || '—', step, characters: subj || targ ? `${subj?.name || '—'} ⇄ ${targ?.name || '—'}` : '', expires: `<t:${Math.floor(Date.parse(p.expiresAt) / 1000)}:R>`,
      pings: [...new Set(pings)].map((u) => `<@${u}>`).join(' '),
    }),
    pings,
  };
}

module.exports = { youLine, bar, spark, regionPanel, marketPanel, goodPanel, caravansPanel, workshopsPanel, workshopTypeLine, politicsPanel, diplomacyPanel, warPanel, armyPanel, battlePost, battleVars, battleReport, proposalPost, regionName, factionLabel, big };
