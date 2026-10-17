'use strict';
/**
 * Entry point: loads data, starts the dashboard web server and the Discord bot in one process
 * (one Render "Web Service" runs both).
 */
const config = require('./config');
const store = require('./store');

const SYSTEM = { name: 'system', source: 'system' };

async function housekeeping() {
  const st = store.state;
  const s = st.settings;
  // Monthly impurity reset
  const month = new Date().toISOString().slice(0, 7);
  if (s.monthlyImpurityReset && st.meta.lastImpurityResetMonth !== month) {
    let n = 0;
    for (const c of st.characters) {
      if (c.impurity > 0 || c.burstApplied) {
        c.impurity = 0;
        c.burstApplied = false;
        n++;
      }
    }
    st.meta.lastImpurityResetMonth = month;
    store.log(SYSTEM, 'impurity.monthly-reset', `New month ${month}: reset impurity for ${n} character(s)`);
  }
  // Expire old trades
  const now = Date.now();
  for (const t of st.trades) if (t.status === 'pending' && Date.parse(t.expiresAt) < now) t.status = 'expired';
  // Automatic backup
  const hours = Number(s.autoBackupHours) || 0;
  if (hours > 0 && (!st.meta.lastAutoBackupAt || now - Date.parse(st.meta.lastAutoBackupAt) > hours * 3600e3)) {
    st.meta.lastAutoBackupAt = new Date().toISOString();
    await store.createBackup('Automatic backup', SYSTEM, true);
  }
  store.markDirty();
}

(async () => {
  await store.init();
  const bot = require('./bot');
  const app = require('./dashboard/server').create(bot);
  const server = app.listen(config.port, () => console.log(`[dashboard] listening on port ${config.port}${config.publicUrl ? ` — ${config.publicUrl}` : ''}`));

  bot.start().catch((e) => console.error('[bot] failed to start:', e.message));

  require('./world/runner').start();
  housekeeping().catch((e) => console.error('[housekeeping]', e));
  setInterval(() => housekeeping().catch((e) => console.error('[housekeeping]', e)), 10 * 60000);

  let stopping = false;
  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`[app] ${sig} received — saving and shutting down`);
    try {
      await store.save();
    } catch (e) {
      console.error('[app] final save failed', e);
    }
    await bot.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})().catch((e) => {
  console.error('[app] fatal startup error', e);
  process.exit(1);
});
