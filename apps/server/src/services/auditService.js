import crypto from 'node:crypto';
import prisma from '@chamber/db';
import { getClient, isBotOnline } from '../lib/botState.js';
import { publish } from '../lib/events.js';
import { logger } from '../logger.js';
import { logPanel } from '../bot/panels.js';
import { sendCv2 } from '../lib/ui.js';
import { fetchChannelById } from '../lib/discord.js';

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(`chamber:${ip}`).digest('hex').slice(0, 32);
}

function requestIp(req) {
  if (!req) return null;
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

async function mirrorToLogChannel(entry) {
  if (!entry.guildId || !isBotOnline()) return;
  try {
    const config = await prisma.guildConfig.findUnique({ where: { guildId: entry.guildId } });
    if (!config?.logChannelId) return;
    const guild = getClient().guilds.cache.get(entry.guildId);
    if (!guild) return;
    const channel = await fetchChannelById(guild, config.logChannelId);
    if (!channel?.isTextBased?.()) return;
    await sendCv2(
      channel,
      logPanel({
        action: entry.action,
        actorName: entry.actorName,
        actorId: entry.actorId,
        target: entry.targetId,
        metadata: entry.metadata,
        guildName: guild.name,
      }),
    );
  } catch (error) {
    logger.debug({ err: error }, 'Failed to mirror audit log to Discord');
  }
}

export async function writeAudit({
  guildId = null,
  actorId = null,
  actorName = null,
  action,
  category = 'SYSTEM',
  targetType = null,
  targetId = null,
  metadata = null,
  req = null,
}) {
  try {
    if (actorId) {
      await prisma.user
        .upsert({
          where: { id: actorId },
          create: { id: actorId, username: actorName ?? null },
          update: {},
        })
        .catch(() => null);
    }
    const entry = await prisma.auditLog.create({
      data: {
        guildId,
        actorId,
        actorName,
        action,
        category,
        targetType,
        targetId,
        metadata: metadata ?? undefined,
        ipHash: hashIp(requestIp(req)),
        userAgent: req?.headers?.['user-agent']?.slice(0, 250) ?? null,
      },
    });
    publish('audit.created', {
      id: entry.id,
      guildId,
      action,
      category,
      actorId,
      actorName,
      targetType,
      targetId,
      metadata,
      createdAt: entry.createdAt,
    });
    void mirrorToLogChannel({ ...entry, metadata });
    return entry;
  } catch (error) {
    logger.error({ err: error, action, guildId }, 'Failed to write audit log');
    return null;
  }
}

export async function listAuditLogs(guildId, { page = 1, pageSize = 25, category, search } = {}) {
  const where = { guildId };
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { action: { contains: search, mode: 'insensitive' } },
      { actorName: { contains: search, mode: 'insensitive' } },
      { targetId: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export default { writeAudit, listAuditLogs };
