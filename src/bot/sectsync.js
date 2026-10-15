'use strict';
/**
 * Keeps each character's sect in line with the member's Discord roles (Dashboard → Sects → role).
 * Runs on every interaction from a member, when a member's roles change (needs the Server Members
 * intent), when someone else's menu is opened, and for everyone when the bot starts.
 */
const store = require('../store');
const chars = require('../engine/characters');

function roleIdsOf(member) {
  if (!member) return [];
  return member.roles?.cache ? [...member.roles.cache.keys()] : Array.isArray(member.roles) ? member.roles : [];
}

/** Sync all active characters of a member. Returns the list of changes. */
function syncMember(member) {
  const id = member?.user?.id || member?.id;
  if (!id) return [];
  const st = store.state;
  if (!st.sects.some((s) => s.roleId)) return [];
  const roles = roleIdsOf(member);
  const changes = [];
  for (const c of st.characters.filter((x) => x.ownerId === id && x.status === 'active')) {
    const r = chars.syncSectFromRoles(st, c, roles);
    if (r && r.changed) {
      changes.push({ c, ...r });
      const perks = [r.coreArt && `core art ${r.coreArt}`, r.nyang && `+${r.nyang} ${st.settings.currencyName}`].filter(Boolean).join(', ');
      store.log({ name: 'role sync', source: 'discord' }, 'sect.sync', `${c.name}: ${r.before || 'Rogue'} → ${r.after || 'Rogue'} (Discord roles)${perks ? ` · ${perks}` : ''}`);
    }
  }
  return changes;
}

/** Fetch a member by id in the interaction's guild and sync them (used when viewing someone else). */
async function syncUserId(guild, userId) {
  if (!guild || !userId) return;
  try {
    syncMember(await guild.members.fetch(userId));
  } catch {}
}

/** Give the member the role of `sectName` and remove the roles of every other sect. */
async function applySectRoles(client, userId, sectName) {
  const st = store.state;
  const linked = st.sects.filter((s) => s.roleId);
  if (!linked.length || !client) return { ok: false, reason: 'no sect roles linked' };
  const target = chars.sectOf(st, sectName);
  let done = false;
  for (const guild of client.guilds.cache.values()) {
    let member;
    try { member = await guild.members.fetch(userId); } catch { continue; }
    const remove = linked.filter((s) => s.roleId !== target?.roleId && member.roles.cache.has(s.roleId)).map((s) => s.roleId);
    if (remove.length) await member.roles.remove(remove).catch((e) => console.warn('[sects] remove role failed', e.message));
    if (target?.roleId && !member.roles.cache.has(target.roleId)) await member.roles.add(target.roleId).catch((e) => console.warn('[sects] add role failed', e.message));
    done = true;
  }
  return { ok: done };
}

module.exports = { roleIdsOf, syncMember, syncUserId, applySectRoles };
