import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '@chamber/db';
import {
  aiSuggestionSchema,
  roomTypeInputSchema,
  templateImportSchema,
  templateInputSchema,
} from '@chamber/shared';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { currentUserId, guildAccess } from '../middleware.js';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  exportTemplates,
  importTemplates,
  listTemplates,
  updateTemplate,
} from '../../services/templateService.js';
import {
  createRoomType,
  deleteRoomType,
  listRoomTypes,
  updateRoomType,
} from '../../services/roomTypeService.js';
import { updateConfig } from '../../services/guildService.js';
import { generateSuggestions, aiStatus } from '../../services/aiService.js';
import { getRoomById } from '../../services/roomService.js';
import { getAnalytics } from '../../services/analyticsService.js';
import { writeAudit } from '../../services/auditService.js';

const router = express.Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many AI requests. Try again in a minute.' } },
});

function audit(req, action, targetType, targetId, metadata = null) {
  return writeAudit({
    guildId: req.guildContext.guild.id,
    actorId: currentUserId(req),
    actorName: req.session.user.username,
    action,
    category: 'TEMPLATE',
    targetType,
    targetId,
    metadata,
    req,
  });
}

router.get('/:guildId/templates', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    res.json(await listTemplates(req.guildContext.guild.id));
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/templates/export', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    res.json(await exportTemplates(req.guildContext.guild.id));
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/templates', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const input = templateInputSchema.parse(req.body);
    const template = await createTemplate(req.guildContext.guild.id, input, {
      createdById: currentUserId(req),
    });
    await audit(req, 'template.created', 'template', template.id, { name: template.name });
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/templates/import', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { templates } = templateImportSchema.parse(req.body);
    const created = await importTemplates(req.guildContext.guild.id, templates, {
      createdById: currentUserId(req),
    });
    await audit(req, 'template.imported', 'template', null, { count: created.length });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/templates/:templateId/duplicate', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const template = await duplicateTemplate(req.guildContext.guild.id, req.params.templateId, {
      createdById: currentUserId(req),
    });
    await audit(req, 'template.duplicated', 'template', template.id, { sourceId: req.params.templateId });
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

router.patch('/:guildId/templates/:templateId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const input = templateInputSchema.parse(req.body);
    const template = await updateTemplate(req.guildContext.guild.id, req.params.templateId, input);
    await audit(req, 'template.updated', 'template', template.id, { name: template.name });
    res.json(template);
  } catch (error) {
    next(error);
  }
});

router.delete('/:guildId/templates/:templateId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    await deleteTemplate(req.guildContext.guild.id, req.params.templateId);
    await audit(req, 'template.deleted', 'template', req.params.templateId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/room-types', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    res.json(await listRoomTypes(req.guildContext.guild.id));
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/room-types', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const input = roomTypeInputSchema.parse(req.body);
    const roomType = await createRoomType(req.guildContext.guild.id, input);
    await audit(req, 'room_type.created', 'roomType', roomType.id, { key: roomType.key });
    res.status(201).json(roomType);
  } catch (error) {
    next(error);
  }
});

router.patch('/:guildId/room-types/:roomTypeId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const input = roomTypeInputSchema.parse({ ...req.body, key: req.body.key ?? 'placeholder' });
    const roomType = await updateRoomType(req.guildContext.guild.id, req.params.roomTypeId, input);
    await audit(req, 'room_type.updated', 'roomType', roomType.id, { key: roomType.key });
    res.json(roomType);
  } catch (error) {
    next(error);
  }
});

router.delete('/:guildId/room-types/:roomTypeId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    await deleteRoomType(req.guildContext.guild.id, req.params.roomTypeId);
    await audit(req, 'room_type.deleted', 'roomType', req.params.roomTypeId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/ai/status', guildAccess({ staff: true }), async (req, res) => {
  res.json({ ...aiStatus(), enabled: req.guildContext.config.aiEnabled });
});

router.post('/:guildId/ai/suggest', aiLimiter, guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const { guild } = req.guildContext;
    const input = aiSuggestionSchema.parse(req.body);
    let currentRoom = null;
    if (input.roomId) {
      const room = await getRoomById(input.roomId);
      if (!room || room.guildId !== guild.id) throw new NotFoundError('Room not found.');
      currentRoom = { name: room.name, privacy: room.privacy, userLimit: room.userLimit };
    }
    const suggestion = await generateSuggestions({
      guildId: guild.id,
      input: { purpose: input.purpose, expectedMembers: input.expectedMembers, tone: input.tone },
      currentRoom,
    });
    res.json(suggestion);
  } catch (error) {
    next(error);
  }
});

const premiumPatchSchema = z
  .object({
    waitingRoom: z.boolean(),
    queue: z.boolean(),
    reservations: z.boolean(),
    events: z.boolean(),
    merging: z.boolean(),
    cloning: z.boolean(),
    password: z.boolean(),
    ai: z.boolean(),
  })
  .partial();

const PREMIUM_MAP = {
  waitingRoom: 'waitingRoomEnabled',
  queue: 'queueEnabled',
  reservations: 'reservationsEnabled',
  events: 'eventsEnabled',
  merging: 'mergingEnabled',
  cloning: 'cloningEnabled',
  password: 'passwordEnabled',
  ai: 'aiEnabled',
};

router.get('/:guildId/premium', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const { guild, config } = req.guildContext;
    const [counts, analytics] = await Promise.all([
      Promise.all([
        prisma.triggerChannel.count({ where: { guildId: guild.id } }),
        prisma.roomTemplate.count({ where: { guildId: guild.id } }),
        prisma.activeRoom.count({ where: { guildId: guild.id, status: 'ACTIVE' } }),
        prisma.queueEntry.count({ where: { room: { guildId: guild.id }, status: 'WAITING' } }),
      ]),
      getAnalytics(guild.id, '30d').catch(() => null),
    ]);
    const [triggers, templates, activeRooms, queued] = counts;
    res.json({
      selfHosted: true,
      note: 'Chamber is fully self-hosted. Every advanced feature is included; there is no billing or license gate.',
      features: Object.entries(PREMIUM_MAP).map(([key, field]) => ({
        key,
        label: {
          waitingRoom: 'Waiting room requests',
          queue: 'Voice queue',
          reservations: 'Scheduled reservations',
          events: 'Room events',
          merging: 'Room merging',
          cloning: 'Room cloning',
          password: 'Password-protected rooms',
          ai: 'AI assistant',
        }[key],
        enabled: Boolean(config[field]),
      })),
      limits: {
        maxRoomsPerUser: config.maxRoomsPerUser,
        maxRoomsPerGuild: config.maxRoomsPerGuild,
        queueMaxSize: config.queueMaxSize,
        reservationsPerUser: config.reservationsPerUser,
        reservationWindowDays: config.reservationWindowDays,
        retentionDays: config.retentionDays,
      },
      usage: {
        triggers,
        templates,
        activeRooms,
        queued,
        roomsThisMonth: analytics?.totals?.roomsCreated ?? 0,
        averageLifetimeSeconds: analytics?.totals?.avgLifetimeSeconds ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:guildId/premium', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const input = premiumPatchSchema.parse(req.body);
    const patch = {};
    for (const [key, value] of Object.entries(input)) {
      patch[PREMIUM_MAP[key]] = value;
    }
    const updated = await updateConfig(req.guildContext.guild.id, patch, {
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    await writeAudit({
      guildId: req.guildContext.guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'config.features.updated',
      category: 'CONFIG',
      targetType: 'guild',
      targetId: req.guildContext.guild.id,
      metadata: input,
      req,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
