import express from 'express';
import { z } from 'zod';
import prisma from '@chamber/db';
import {
  guildConfigUpdateSchema,
  templateInputSchema,
  triggerInputSchema,
  voiceCategoryInputSchema,
} from '@chamber/shared';
import { publish } from '../../lib/events.js';
import { AppError } from '../../lib/errors.js';
import { currentUserId, guildAccess, requireBot } from '../middleware.js';
import { ensureConfig, updateConfig } from '../../services/guildService.js';
import { cleanupGuildRooms, recoverActiveRooms } from '../../services/roomService.js';
import { importTemplates } from '../../services/templateService.js';
import { writeAudit } from '../../services/auditService.js';

const router = express.Router();

router.get('/:guildId/export', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild, config } = req.guildContext;
    const [triggers, categories, templates, roomTypes] = await Promise.all([
      prisma.triggerChannel.findMany({ where: { guildId: guild.id } }),
      prisma.voiceCategory.findMany({ where: { guildId: guild.id } }),
      prisma.roomTemplate.findMany({ where: { guildId: guild.id, isBuiltin: false } }),
      prisma.roomType.findMany({ where: { guildId: guild.id } }),
    ]);
    res.setHeader('Content-Disposition', `attachment; filename="chamber-${guild.id}.json"`);
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      guild: { id: guild.id, name: guild.name },
      config,
      triggers,
      categories,
      templates,
      roomTypes,
    });
  } catch (error) {
    next(error);
  }
});

const importSchema = z.object({
  config: guildConfigUpdateSchema.optional(),
  triggers: z.array(triggerInputSchema).max(100).optional(),
  categories: z.array(voiceCategoryInputSchema).max(100).optional(),
  templates: z.array(templateInputSchema).max(50).optional(),
});

router.post('/:guildId/import', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild } = req.guildContext;
    const input = importSchema.parse(req.body);
    const summary = { config: false, triggers: 0, categories: 0, templates: 0 };

    if (input.config) {
      await updateConfig(guild.id, input.config, {
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
      summary.config = true;
    }
    for (const trigger of input.triggers ?? []) {
      await prisma.triggerChannel.upsert({
        where: { guildId_channelId: { guildId: guild.id, channelId: trigger.channelId } },
        create: {
          guildId: guild.id,
          channelId: trigger.channelId,
          name: trigger.name ?? null,
          categoryId: trigger.categoryId ?? null,
          templateId: trigger.templateId ?? null,
          roomTypeKey: trigger.roomTypeKey ?? null,
          enabled: trigger.enabled ?? true,
        },
        update: {
          name: trigger.name ?? null,
          categoryId: trigger.categoryId ?? null,
          templateId: trigger.templateId ?? null,
          roomTypeKey: trigger.roomTypeKey ?? null,
          enabled: trigger.enabled ?? true,
        },
      });
      summary.triggers += 1;
    }
    for (const category of input.categories ?? []) {
      await prisma.voiceCategory.upsert({
        where: { guildId_categoryId: { guildId: guild.id, categoryId: category.categoryId } },
        create: {
          guildId: guild.id,
          categoryId: category.categoryId,
          name: category.name ?? null,
          templateId: category.templateId ?? null,
          maxRooms: category.maxRooms,
          enabled: category.enabled,
        },
        update: {
          name: category.name ?? null,
          templateId: category.templateId ?? null,
          maxRooms: category.maxRooms,
          enabled: category.enabled,
        },
      });
      summary.categories += 1;
    }
    if (input.templates) {
      const created = await importTemplates(guild.id, input.templates, {
        createdById: currentUserId(req),
      });
      summary.templates = created.length;
    }
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'config.imported',
      category: 'CONFIG',
      metadata: summary,
      req,
    });
    res.json({ ok: true, summary });
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/cleanup', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const config = await ensureConfig(guild.id);
    const result = await cleanupGuildRooms(guild.client, guild, config, { includeExpired: true });
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'cleanup.run',
      category: 'SYSTEM',
      metadata: result,
      req,
    });
    res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/reset', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild, discordGuild } = req.guildContext;
    const expected = (discordGuild?.name ?? guild.name).trim();
    if (String(req.body?.confirmName ?? '').trim() !== expected) {
      throw new AppError(`Type "${expected}" to confirm the reset.`);
    }
    await prisma.$transaction([
      prisma.triggerChannel.deleteMany({ where: { guildId: guild.id } }),
      prisma.voiceCategory.deleteMany({ where: { guildId: guild.id } }),
      prisma.roomType.deleteMany({ where: { guildId: guild.id } }),
      prisma.roomTemplate.deleteMany({ where: { guildId: guild.id } }),
      prisma.reservation.deleteMany({ where: { guildId: guild.id } }),
      prisma.guildConfig.deleteMany({ where: { guildId: guild.id } }),
    ]);
    const config = await ensureConfig(guild.id);
    publish('config.updated', { guildId: guild.id, config });
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'guild.reset',
      category: 'CONFIG',
      metadata: { roomsPreserved: true },
      req,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/recover', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const summary = await recoverActiveRooms(guild.client);
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'rooms.recovered',
      category: 'SYSTEM',
      metadata: summary,
      req,
    });
    res.json({ ok: true, summary });
  } catch (error) {
    next(error);
  }
});

export default router;
