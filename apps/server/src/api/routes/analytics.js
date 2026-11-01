import express from 'express';
import { analyticsQuerySchema, paginationSchema } from '@chamber/shared';
import prisma from '@chamber/db';
import { guildAccess, requireBot } from '../middleware.js';
import { getActiveRoomStats } from '../../services/guildService.js';
import { getAnalytics } from '../../services/analyticsService.js';
import { listActiveRooms, refreshLobby } from '../../services/roomService.js';
import { listAuditLogs } from '../../services/auditService.js';
import { isBotOnline, getBotState } from '../../lib/botState.js';

const router = express.Router();

router.get('/:guildId/overview', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const { range } = analyticsQuerySchema.parse(req.query);
    const { guild } = req.guildContext;
    const [analytics, counts, activeRooms, recentLogs, scheduledReservations, pendingWaiting] = await Promise.all([
      getAnalytics(guild.id, range),
      getActiveRoomStats(guild.id),
      listActiveRooms(guild.id, {}),
      prisma.auditLog.findMany({
        where: { guildId: guild.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          action: true,
          category: true,
          actorId: true,
          actorName: true,
          targetId: true,
          createdAt: true,
        },
      }),
      prisma.reservation.count({ where: { guildId: guild.id, status: 'SCHEDULED' } }),
      prisma.waitingRequest.count({ where: { room: { guildId: guild.id }, status: 'PENDING' } }),
    ]);
    res.json({
      ...analytics,
      counts: {
        ...counts,
        activeRooms: activeRooms.length,
        scheduledReservations,
        pendingWaiting,
      },
      activeRooms: activeRooms.slice(0, 6),
      recentLogs,
      bot: {
        online: isBotOnline(),
        tag: getBotState().tag,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/analytics', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const { range } = analyticsQuerySchema.parse(req.query);
    res.json(await getAnalytics(req.guildContext.guild.id, range));
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/logs', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const { page, pageSize, search, category } = paginationSchema.parse(req.query);
    const logs = await listAuditLogs(req.guildContext.guild.id, {
      page,
      pageSize,
      search,
      category: category || null,
    });
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/lobby/refresh', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const message = await refreshLobby(guild.client, guild.id);
    res.json({ ok: true, messageId: message?.id ?? null });
  } catch (error) {
    next(error);
  }
});

export default router;
