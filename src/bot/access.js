'use strict';
/**
 * Who may use which command — managed from the dashboard (Commands tab).
 * Rules are stored in state.commandAccess under the command name ("give") or
 * "command subcommand" ("give item"). A subcommand rule overrides its command.
 *
 * rule = {
 *   enabled: true,
 *   access: 'everyone' | 'staff' | 'roles' | 'inherit' (subcommands only),
 *   roleIds: [],            // used when access = 'roles'
 *   channelIds: [],         // empty = any channel
 *   hidden: false,          // hide from members without "Manage Server" in Discord's slash menu
 *   description: ''         // custom description shown in Discord
 * }
 * Members with Manage Server / Administrator can always use enabled commands.
 */
const { PermissionFlagsBits } = require('discord.js');
const store = require('../store');

const staffDefaults = new Set(); // filled by the bot from command modules flagged `staff: true`

function defaultRule(name) {
  const staff = staffDefaults.has(name);
  return { enabled: true, access: staff ? 'staff' : 'everyone', roleIds: [], channelIds: [], hidden: staff, description: '' };
}

function ruleFor(name) {
  return { ...defaultRule(name), ...(store.state.commandAccess?.[name] || {}) };
}

function subRule(name, sub) {
  const r = store.state.commandAccess?.[`${name} ${sub}`];
  return { enabled: true, access: 'inherit', roleIds: [], channelIds: [], description: '', ...(r || {}) };
}

function memberRoleIds(member) {
  if (!member) return [];
  return member.roles?.cache ? [...member.roles.cache.keys()] : Array.isArray(member.roles) ? member.roles : [];
}

function isAdmin(member) {
  const p = member?.permissions;
  return !!(p && typeof p.has === 'function' && (p.has(PermissionFlagsBits.ManageGuild) || p.has(PermissionFlagsBits.Administrator)));
}

function isStaff(member) {
  if (isAdmin(member)) return true;
  const roles = memberRoleIds(member);
  return (store.state.settings.staffRoleIds || []).some((r) => roles.includes(r));
}

/** Returns null when allowed, or a message explaining why not. */
function check(member, channelId, name, sub) {
  const top = ruleFor(name);
  const sr = sub ? subRule(name, sub) : null;
  if (top.enabled === false || (sr && sr.enabled === false)) return 'This command is turned off.';
  if (isAdmin(member)) return null;
  const rule = sr && sr.access && sr.access !== 'inherit' ? sr : top;
  const roles = memberRoleIds(member);
  if (rule.access === 'staff' && !isStaff(member)) return "You don't have permission to use this.";
  if (rule.access === 'roles' && !(rule.roleIds || []).some((r) => roles.includes(r))) return "You don't have the role needed for this.";
  const channels = sr && sr.channelIds?.length ? sr.channelIds : top.channelIds || [];
  if (channels.length && channelId && !channels.includes(channelId)) return `Use this in ${channels.map((c) => `<#${c}>`).join(' or ')}.`;
  return null;
}

module.exports = { staffDefaults, defaultRule, ruleFor, subRule, check, isStaff, isAdmin };
