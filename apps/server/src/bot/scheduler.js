import prisma from '@chamber/db';
import { isBotOnline } from '../lib/botState.js';
import { logger } from '../logger.js';
import { ensureConfig } from '../services/guildService.js';
import { processRoomLifecycle } from '../services/roomService.js';
import { processReservations } from '../services/reservationService.js';
import { processRoomEvents } from '../services/eventService.js';
import { expireWaitingRequests } from '../services/privacyService.js';
import { expireQueueEntries } from '../services/queueService.js';
import { expireMergeRequests } from '../services/mergeService.js';
import { pruneAnalytics, recordPeakConcurrent } from '../services/analyticsService.js';

const TICK_MS = 30000;
let interval = null;
let running = false;
let lastPruneDay = null;

async function tick(client) {
  if (running) return;
  running = true;
  try {
    if (isBotOnline()) {
      await processReservations(client).catch((error) => logger.error({ err: error }, 'Reservation tick failed'));
      await processRoomLifecycle(client).catch((error) => logger.error({ err: error }, 'Room lifecycle tick failed'));
      await processRoomEvents(client).catch((error) => logger.error({ err: error }, 'Event tick failed'));

      const grouped = await prisma.activeRoom
        .groupBy({ by: ['guildId'], where: { status: 'ACTIVE' }, _count: { _all: true } })
        .catch(() => []);
      for (const row of grouped) {
        await recordPeakConcurrent(row.guildId, row._count._all);
      }

      const now = new Date();
      const dayKey = now.toISOString().slice(0, 10);
      if (now.getUTCHours() === 4 && lastPruneDay !== dayKey) {
        lastPruneDay = dayKey;
        const configs = await prisma.guildConfig.findMany({ select: { guildId: true, retentionDays: true } });
        for (const config of configs) {
          await pruneAnalytics(config.guildId, config.retentionDays).catch(() => null);
        }
        logger.info('Daily analytics retention cleanup finished');
      }
    }

    await expireWaitingRequests().catch(() => null);
    await expireQueueEntries().catch(() => null);
    await expireMergeRequests().catch(() => null);
  } catch (error) {
    logger.error({ err: error }, 'Scheduler tick failed');
  } finally {
    running = false;
  }
}

export function startScheduler(client) {
  if (interval) clearInterval(interval);
  void tick(client);
  interval = setInterval(() => void tick(client), TICK_MS);
  interval.unref?.();
  return () => {
    if (interval) clearInterval(interval);
    interval = null;
  };
}

export default startScheduler;
