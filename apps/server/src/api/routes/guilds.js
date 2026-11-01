import express from 'express';
import { ChannelType } from 'discord.js';
import prisma from '@chamber/db';
import {
  guildConfigUpdateSchema,
  triggerInputSchema,
  voiceCategoryInputSchema,
} from '@chamber/shared';
import { ChannelType as DiscordChannelType } from 'discord.js';
import { logger } from '../../logger.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { currentUserId, guildAccess, requireBot } from '../middleware.js';
import { getActiveRoomStats, updateConfig } from '../../services/guildService.js';
import { getTemplate } from '../../services/templateService.js';
import { getRoomType } from '../../services/roomTypeService.js';
import { writeAudit } from '../../services/auditService.js';

const router = express.Router();

function channelExists(guild, channelId, types = null) {
  if (!guild || !channelId) return false;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return false;
  return types ? types.includes(channel.type) : true;
}

function serializeConfig(config) {
  return config;
}

router.get('/:guildId', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const { guild, config, access, discordGuild, botOnline } = req.guildContext;
    const guildId = guild.id;
    const [counts, triggerCount, categoryCount, templateCount, roomTypeCount, reservationCount] = await Promise.all([
      getActiveRoomStats(guildId),
      prisma.triggerChannel.count({ where: { guildId } }),
      prisma.voiceCategory.count({ where: { guildId } }),
      prisma.roomTemplate.count({ where: { guildId } }),
      prisma.roomType.count({ where: { guildId } }),
      prisma.reservation.count({ where: { guildId, status: 'SCHEDULED' } }),
    ]);
    res.json({
      guild: {
        id: guildId,
        name: discordGuild?.name ?? guild.name,
        icon: discordGuild?.iconURL({ size: 128 }) ?? guild.icon,
        memberCount: discordGuild?.memberCount ?? null,
        ownerId: discordGuild?.ownerId ?? guild.ownerId,
        botPresent: botOnline,
      },
      config: serializeConfig(config),
      access,
      bot: {
        online: botOnline,
        tag: req.app.locals.botTag ?? null,
      },
      counts: {
        ...counts,
        triggers: triggerCount,
        categories: categoryCount,
        templates: templateCount,
        roomTypes: roomTypeCount,
        scheduledReservations: reservationCount,
      },
      setup: {
        completed: config.setupCompleted,
        hasTriggers: triggerCount > 0,
        hasCategory: Boolean(config.defaultCategoryId),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/channels', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const { discordGuild, config } = req.guildContext;
    if (!discordGuild) {
      return res.json({ offline: true, categories: [], text: [], voice: [], roles: [], guildRoles: [] });
    }
    const categories = [];
    const text = [];
    const voice = [];
    for (const channel of discordGuild.channels.cache.values()) {
      const entry = {
        id: channel.id,
        name: channel.name,
        parentId: channel.parentId ?? null,
        position: channel.rawPosition ?? channel.position ?? 0,
      };
      if (channel.type === DiscordChannelType.GuildCategory) categories.push(entry);
      else if (channel.type === DiscordChannelType.GuildText || channel.type === DiscordChannelType.GuildAnnouncement) {
        text.push(entry);
      } else if (channel.type === DiscordChannelType.GuildVoice || channel.type === DiscordChannelType.GuildStageVoice) {
        voice.push(entry);
      }
    }
    const roles = [...discordGuild.roles.cache.values()]
      .filter((role) => role.id !== discordGuild.id && !role.managed)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({ id: role.id, name: role.name, color: role.hexColor, position: role.position }));
    res.json({
      offline: false,
      categories: categories.sort((a, b) => a.position - b.position),
      text: text.sort((a, b) => a.position - b.position),
      voice: voice.sort((a, b) => a.position - b.position),
      roles,
      lobbyChannelId: config.lobbyChannelId,
      waitingRoomChannelId: config.waitingRoomChannelId,
      logChannelId: config.logChannelId,
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:guildId/config', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild, config, discordGuild } = req.guildContext;
    const patch = guildConfigUpdateSchema.parse(req.body);

    if (discordGuild) {
      const channelFields = [
        ['lobbyChannelId', [DiscordChannelType.GuildText, DiscordChannelType.GuildAnnouncement]],
        ['waitingRoomChannelId', [DiscordChannelType.GuildText, DiscordChannelType.GuildAnnouncement]],
        ['logChannelId', [DiscordChannelType.GuildText, DiscordChannelType.GuildAnnouncement]],
        ['defaultCategoryId', [DiscordChannelType.GuildCategory]],
      ];
      for (const [field, types] of channelFields) {
        const value = patch[field];
        if (value && !channelExists(discordGuild, value, types)) {
          throw new AppError(`${field} references a channel that does not exist or has the wrong type.`);
        }
      }
      if (patch.defaultTriggerChannelId && !channelExists(discordGuild, patch.defaultTriggerChannelId, [DiscordChannelType.GuildVoice])) {
        throw new AppError('defaultTriggerChannelId must be a voice channel.');
      }
      if (patch.defaultTemplateId) {
        const template = await getTemplate(guild.id, patch.defaultTemplateId);
        if (!template) throw new AppError('Default template not found.');
      }
      const allRoleIds = [...(patch.staffRoleIds ?? []), ...(patch.adminRoleIds ?? []), ...(patch.queuePriorityRoleIds ?? [])];
      for (const roleId of allRoleIds) {
        if (!discordGuild.roles.cache.has(roleId)) throw new AppError(`Role ${roleId} does not exist.`);
      }
    }

    const updated = await updateConfig(guild.id, patch, {
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'config.updated',
      category: 'CONFIG',
      targetType: 'guild',
      targetId: guild.id,
      metadata: { fields: Object.keys(patch) },
      req,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/triggers', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const triggers = await prisma.triggerChannel.findMany({
      where: { guildId: req.guildContext.guild.id },
      orderBy: { createdAt: 'asc' },
    });
    const roomTypes = await prisma.roomType.findMany({
      where: { OR: [{ guildId: req.guildContext.guild.id }, { guildId: null }] },
      select: { key: true, name: true, emoji: true },
    });
    const typeMap = new Map(roomTypes.map((type) => [type.key, type]));
    res.json(
      triggers.map((trigger) => ({
        ...trigger,
        roomTypeName: trigger.roomTypeKey ? typeMap.get(trigger.roomTypeKey)?.name ?? null : null,
        roomTypeEmoji: trigger.roomTypeKey ? typeMap.get(trigger.roomTypeKey)?.emoji ?? null : null,
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/triggers', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild, discordGuild, config } = req.guildContext;
    const input = triggerInputSchema.parse(req.body);
    if (discordGuild && !channelExists(discordGuild, input.channelId, [DiscordChannelType.GuildVoice])) {
      throw new AppError('Choose a voice channel that exists in this server.');
    }
    if (input.templateId) {
      const template = await getTemplate(guild.id, input.templateId);
      if (!template) throw new AppError('Template not found.');
    }
    if (input.roomTypeKey) {
      const roomType = await getRoomType(guild.id, input.roomTypeKey);
      if (!roomType) throw new AppError('Room type not found.');
    }
    const trigger = await prisma.triggerChannel.upsert({
      where: { guildId_channelId: { guildId: guild.id, channelId: input.channelId } },
      create: {
        guildId: guild.id,
        channelId: input.channelId,
        name: input.name ?? discordGuild?.channels.cache.get(input.channelId)?.name ?? null,
        categoryId: input.categoryId ?? null,
        templateId: input.templateId ?? null,
        roomTypeKey: input.roomTypeKey ?? null,
        enabled: input.enabled ?? true,
      },
      update: {
        name: input.name ?? null,
        categoryId: input.categoryId ?? null,
        templateId: input.templateId ?? null,
        roomTypeKey: input.roomTypeKey ?? null,
        enabled: input.enabled ?? true,
      },
    });
    if (!config.defaultTriggerChannelId) {
      await updateConfig(guild.id, { defaultTriggerChannelId: trigger.channelId });
    }
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'trigger.created',
      category: 'CONFIG',
      targetType: 'channel',
      targetId: trigger.channelId,
      metadata: { templateId: input.templateId ?? null },
      req,
    });
    res.status(201).json(trigger);
  } catch (error) {
    next(error);
  }
});

router.patch('/:guildId/triggers/:triggerId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild, discordGuild } = req.guildContext;
    const input = triggerInputSchema.partial().parse(req.body);
    const existing = await prisma.triggerChannel.findUnique({ where: { id: req.params.triggerId } });
    if (!existing || existing.guildId !== guild.id) throw new NotFoundError('Trigger not found.');
    if (input.channelId && discordGuild && !channelExists(discordGuild, input.channelId, [DiscordChannelType.GuildVoice])) {
      throw new AppError('Choose a valid voice channel.');
    }
    if (input.templateId) {
      const template = await getTemplate(guild.id, input.templateId);
      if (!template) throw new AppError('Template not found.');
    }
    const updated = await prisma.triggerChannel.update({
      where: { id: existing.id },
      data: {
        channelId: input.channelId ?? existing.channelId,
        name: input.name ?? existing.name,
        categoryId: input.categoryId ?? existing.categoryId,
        templateId: input.templateId === undefined ? existing.templateId : input.templateId,
        roomTypeKey: input.roomTypeKey === undefined ? existing.roomTypeKey : input.roomTypeKey,
        enabled: input.enabled ?? existing.enabled,
      },
    });
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'trigger.updated',
      category: 'CONFIG',
      targetType: 'channel',
      targetId: updated.channelId,
      req,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete('/:guildId/triggers/:triggerId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild, config } = req.guildContext;
    const existing = await prisma.triggerChannel.findUnique({ where: { id: req.params.triggerId } });
    if (!existing || existing.guildId !== guild.id) throw new NotFoundError('Trigger not found.');
    await prisma.triggerChannel.delete({ where: { id: existing.id } });
    if (config.defaultTriggerChannelId === existing.channelId) {
      await updateConfig(guild.id, { defaultTriggerChannelId: null });
    }
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'trigger.deleted',
      category: 'CONFIG',
      targetType: 'channel',
      targetId: existing.channelId,
      req,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/categories', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const categories = await prisma.voiceCategory.findMany({
      where: { guildId: req.guildContext.guild.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/categories', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild, discordGuild } = req.guildContext;
    const input = voiceCategoryInputSchema.parse(req.body);
    if (discordGuild && !channelExists(discordGuild, input.categoryId, [DiscordChannelType.GuildCategory])) {
      throw new AppError('Choose a category that exists in this server.');
    }
    if (input.templateId) {
      const template = await getTemplate(guild.id, input.templateId);
      if (!template) throw new AppError('Template not found.');
    }
    const category = await prisma.voiceCategory.upsert({
      where: { guildId_categoryId: { guildId: guild.id, categoryId: input.categoryId } },
      create: {
        guildId: guild.id,
        categoryId: input.categoryId,
        name: input.name ?? discordGuild?.channels.cache.get(input.categoryId)?.name ?? null,
        templateId: input.templateId ?? null,
        maxRooms: input.maxRooms ?? 0,
        enabled: input.enabled ?? true,
      },
      update: {
        name: input.name ?? null,
        templateId: input.templateId ?? null,
        maxRooms: input.maxRooms ?? 0,
        enabled: input.enabled ?? true,
      },
    });
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'category.created',
      category: 'CONFIG',
      targetType: 'channel',
      targetId: category.categoryId,
      req,
    });
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

router.patch('/:guildId/categories/:categoryId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild } = req.guildContext;
    const existing = await prisma.voiceCategory.findUnique({ where: { id: req.params.categoryId } });
    if (!existing || existing.guildId !== guild.id) throw new NotFoundError('Category not found.');
    const input = voiceCategoryInputSchema.partial().parse(req.body);
    const updated = await prisma.voiceCategory.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? existing.name,
        templateId: input.templateId === undefined ? existing.templateId : input.templateId,
        maxRooms: input.maxRooms ?? existing.maxRooms,
        enabled: input.enabled ?? existing.enabled,
      },
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete('/:guildId/categories/:categoryId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const { guild } = req.guildContext;
    const existing = await prisma.voiceCategory.findUnique({ where: { id: req.params.categoryId } });
    if (!existing || existing.guildId !== guild.id) throw new NotFoundError('Category not found.');
    await prisma.voiceCategory.delete({ where: { id: existing.id } });
    await writeAudit({
      guildId: guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: 'category.deleted',
      category: 'CONFIG',
      targetType: 'channel',
      targetId: existing.categoryId,
      req,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
