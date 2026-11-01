import express from 'express';
import { z } from 'zod';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import prisma from '@chamber/db';
import config, { aiConfigured, botConfigured } from '../../config.js';
import { getBotState, isBotOnline, getClient } from '../../lib/botState.js';
import { logger } from '../../logger.js';
import { ensureCsrf, ensureUserPreference, requireAuth } from '../middleware.js';
import { aiStatus } from '../../services/aiService.js';

const router = express.Router();

const BOT_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.ManageEvents,
]).bitfield.toString();

function inviteUrl() {
  if (!config.discord.clientId) return null;
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    permissions: BOT_PERMISSIONS,
    scope: 'bot applications.commands',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function avatarUrl(user) {
  if (!user?.id) return null;
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

router.get('/health', async (_req, res) => {
  let database = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = 'error';
    logger.error({ err: error }, 'Health check database failure');
  }
  const bot = getBotState();
  res.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    bot: { online: bot.online, tag: bot.tag, guilds: bot.guildCount, startedAt: bot.startedAt },
    version: config.version,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.get('/meta', (_req, res) => {
  res.json({
    appName: 'Chamber',
    tagline: 'Temporary voice, perfectly orchestrated.',
    version: config.version,
    environment: config.env,
    devAuth: config.devAuth,
    botConfigured,
    oauthConfigured: Boolean(config.discord.clientId && config.discord.clientSecret),
    aiConfigured,
    ai: aiStatus(),
    inviteUrl: inviteUrl(),
    webOrigin: config.webOrigin,
  });
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const csrfToken = ensureCsrf(req);
    const guildIds = (req.session.guilds ?? []).map((guild) => guild.id);
    const rows = guildIds.length
      ? await prisma.guild.findMany({
          where: { id: { in: guildIds } },
          select: { id: true, botPresent: true, config: { select: { enabled: true, setupCompleted: true } } },
        })
      : [];
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const live = isBotOnline() ? getClient() : null;
    const guilds = (req.session.guilds ?? []).map((guild) => {
      const row = rowsById.get(guild.id);
      return {
        ...guild,
        botPresent: live ? Boolean(live.guilds.cache.has(guild.id)) : Boolean(row?.botPresent),
        enabled: row?.config?.enabled ?? false,
        setupCompleted: row?.config?.setupCompleted ?? false,
      };
    });
    const preferences = await ensureUserPreference(req.session.user.id);
    res.json({
      user: {
        ...req.session.user,
        avatarUrl: avatarUrl(req.session.user),
      },
      guilds,
      csrfToken,
      preferences,
    });
  } catch (error) {
    next(error);
  }
});

const preferenceSchema = z.object({
  theme: z.enum(['dark', 'midnight']).optional(),
  sidebarCollapsed: z.boolean().optional(),
  lastGuildId: z.string().regex(/^\d{5,25}$/).nullable().optional(),
  notifications: z.record(z.string(), z.boolean()).optional(),
});

router.patch('/me/preferences', requireAuth, async (req, res, next) => {
  try {
    const input = preferenceSchema.parse(req.body);
    await ensureUserPreference(req.session.user.id);
    const preference = await prisma.dashboardPreference.update({
      where: { userId: req.session.user.id },
      data: input,
    });
    res.json(preference);
  } catch (error) {
    next(error);
  }
});

export default router;
