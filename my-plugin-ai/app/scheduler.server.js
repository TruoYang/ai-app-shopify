/* eslint-env node, es2020 */
// Scheduled retraining: shops that chose "weekly" or "monthly" are retrained when their
// last training is older than that. Checked once an hour inside the app server.
// Set DISABLE_SCHEDULER=1 to turn it off (for example when several app instances run).

import prisma from "./db.server";
import { runTraining } from "./training.server";

const CHECK_EVERY_MS = 60 * 60_000;
const INTERVAL_DAYS = { weekly: 7, monthly: 30 };

export function isDue(settings, now = new Date()) {
  const days = INTERVAL_DAYS[settings.retrainSchedule];
  if (!days) return false;
  if (!settings.lastTrainedAt) return true;
  return now - new Date(settings.lastTrainedAt) >= days * 24 * 60 * 60_000;
}

export async function runDueTrainings(getAdmin, now = new Date()) {
  const shops = await prisma.shopSettings.findMany({ where: { retrainSchedule: { in: Object.keys(INTERVAL_DAYS) } } });
  const results = [];
  for (const settings of shops.filter((row) => isDue(row, now))) {
    try {
      const adminForSync = await getAdmin(settings.shop).catch(() => null);
      const response = await runTraining({ shop: settings.shop, adminForSync });
      const body = await response.json();
      results.push({ shop: settings.shop, success: body.success, rules: body.stats?.totalRules ?? 0 });
      console.log(`[scheduler] retrained ${settings.shop} (${settings.retrainSchedule}):`, body.success ? `${body.stats.totalRules} rules` : body.error);
    } catch (error) {
      results.push({ shop: settings.shop, success: false, error: error.message });
      console.error(`[scheduler] retraining ${settings.shop} failed:`, error);
    }
  }
  return results;
}

// Starts the hourly check once per process.
export function startScheduler(getAdmin) {
  if (process.env.DISABLE_SCHEDULER === "1" || globalThis.__smartcartScheduler) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueTrainings(getAdmin);
    } finally {
      running = false;
    }
  };
  globalThis.__smartcartScheduler = setInterval(tick, CHECK_EVERY_MS);
  setTimeout(tick, 60_000);
}
