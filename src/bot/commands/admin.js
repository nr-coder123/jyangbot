'use strict';
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const store = require('../../store');
const config = require('../../config');
const { EPH, requireStaff, actor } = require('../util');

const backup = new SlashCommandBuilder()
  .setName('backup')
  .setDescription('[Staff] Save everything and create a backup now')
  .addStringOption((o) => o.setName('label').setDescription('Label for the backup'));

async function executeBackup(i) {
  requireStaff(i);
  await i.deferReply({ flags: EPH });
  const meta = await store.createBackup(i.options.getString('label') || `Backup by ${i.user.username}`, actor(i));
  return i.editReply(`💾 Saved and backed up: **${meta.label}** (\`${meta.id}\`). Restore it from the dashboard → Backups.`);
}

const dashboard = new SlashCommandBuilder().setName('dashboard').setDescription('[Staff] Get the dashboard link');
async function executeDashboard(i) {
  requireStaff(i);
  return i.reply({ content: config.publicUrl ? `🖥️ Dashboard: ${config.publicUrl}` : '🖥️ The dashboard runs on the same address as this bot on Render (set PUBLIC_URL to show it here).', flags: EPH });
}

const help = new SlashCommandBuilder().setName('help').setDescription('How to use the bot');
async function executeHelp(i) {
  const s = store.state.settings;
  const e = new EmbedBuilder().setTitle('📜 Jianghu Bot — Commands').setColor('#b3261e').addFields(
    { name: 'Characters', value: '`/character submit` send your doc · `/sheet` · `/character list` · `/character switch`\n`/title list` · `/title stem` pick your stem' },
    { name: 'Stats', value: `\`/stats allocate\` then type \`strength 5\` (several lines allowed) for ${s.allocationWindowMinutes} min · \`/stats add\` · \`/stats points\`\nNo stat may exceed ${s.maxSingleStatPercent}% of your stat points (Qi not counted).` },
    { name: 'Progress', value: '`/progress submit` a finished RP/fight · `/realm info` · `/realm chance` · `/realm breakthrough` · `/realm list`\n`/impurity check` · `/purify` Feng Shui calculator' },
    { name: 'Items', value: '`/roll` · `/droprates` · `/inventory` · `/item info` · `/item use` (pills) · `/item learn` (manuals) · `/item forget`' },
    { name: `Economy (${s.currencyName})`, value: '`/shop view|buy|sell` · `/pay` · `/trade` · `/market list|view|buy|cancel`' },
    { name: 'Staff', value: '`/character approve|reject|pending` · `/give all|allqi|qi|nyang|rolls|qibars|item` · `/impurity add|remove|reset` · `/title set` · `/backup` · `/dashboard`\n`all` = points for Strength/Endurance/Mobility · `allqi` = points usable in Qi too · `qi` = a Breakthrough (resets Impurity)' },
  );
  return i.reply({ embeds: [e], flags: EPH });
}

module.exports = {
  commands: [
    { data: backup, execute: executeBackup },
    { data: dashboard, execute: executeDashboard },
    { data: help, execute: executeHelp },
  ],
};
