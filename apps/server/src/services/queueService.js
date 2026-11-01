import prisma from '@chamber/db';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { fetchChannelById, fetchMemberById, hasAnyRole } from '../lib/discord.js';
import { sendChannelPanel, sendUserPanel } from '../lib/notify.js';
import { publish } from '../lib/events.js';
import { logger } from '../logger.js';
import { noticePanel } from '../bot/panels.js';
import { applyPermissions, refreshPanel, schedulePanelRefresh } from './roomService.js';
import { ensureConfig } from './guildService.js';
import { writeAudit } from './auditService.js';

const QUEUE_TTL_MINUTES = 120;

function humanCount(channel) {
  return channel ? channel.members.filter((member) => !member.user.bot).size : 0;
}

function activeBan(room, userId) {
  return (room.bans ?? []).some(
    (ban) => ban.userId === userId && (!ban.expiresAt || new Date(ban.expiresAt).getTime() > Date.now()),
  );
}

export async function listQueue(roomId) {
  return prisma.queueEntry.findMany({
    where: { roomId, status: 'WAITING' },
    orderBy: [{ priority: 'desc' }, { joinedAt: 'asc' }],
  });
}

export async function joinQueue({ client, guild, room, user, config = null }) {
  const resolvedConfig = config ?? (await ensureConfig(room.guildId));
  if (!resolvedConfig.queueEnabled) throw new AppError('The queue is disabled on this server.', { status: 409 });
  if (room.ownerId === user.id) throw new AppError('You own this room — you can join it directly.');
  if (activeBan(room, user.id)) throw new ForbiddenError('You cannot join this room.');
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel) throw new NotFoundError('This room no longer exists.');
  if (room.userLimit === 0) {
    throw new AppError('This room has no capacity limit, so you can join it directly.', { status: 409 });
  }
  if (humanCount(channel) < room.userLimit) {
    throw new AppError('The room is not full yet — open the channel and join directly.', { status: 409 });
  }
  const existing = await prisma.queueEntry.findFirst({
    where: { roomId: room.id, userId: user.id, status: 'WAITING' },
  });
  if (existing) throw new ConflictError('You are already in this queue.');
  if (resolvedConfig.queueMaxSize > 0) {
    const size = await prisma.queueEntry.count({ where: { roomId: room.id, status: 'WAITING' } });
    if (size >= resolvedConfig.queueMaxSize) throw new AppError('This queue is full.', { status: 409 });
  }
  const member = guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
  const priority = hasAnyRole(member, resolvedConfig.queuePriorityRoleIds) ? 1 : 0;
  const entry = await prisma.queueEntry.create({
    data: {
      roomId: room.id,
      userId: user.id,
      priority,
      expiresAt: new Date(Date.now() + QUEUE_TTL_MINUTES * 60000),
    },
  });
  const position = await prisma.queueEntry.count({
    where: {
      roomId: room.id,
      status: 'WAITING',
      OR: [{ priority: { gt: priority } }, { priority, joinedAt: { lt: entry.joinedAt } }],
    },
  });
  await sendUserPanel(
    client,
    room.ownerId,
    noticePanel({
      title: '⏳ New queue entry',
      body: `<@${user.id}> joined the queue for **${room.name}** (position **${position + 1}**).`,
      accentColor: '#fbbf24',
    }),
  ).catch(() => null);
  await writeAudit({
    guildId: room.guildId,
    actorId: user.id,
    actorName: user.username,
    action: 'queue.joined',
    category: 'QUEUE',
    targetType: 'room',
    targetId: room.id,
    metadata: { entryId: entry.id, position: position + 1 },
  });
  publish('queue.updated', { guildId: room.guildId, roomId: room.id });
  schedulePanelRefresh(client, room.id);
  return { entry, position: position + 1 };
}

export async function leaveQueue({ room, userId }) {
  const result = await prisma.queueEntry.updateMany({
    where: { roomId: room.id, userId, status: 'WAITING' },
    data: { status: 'LEFT' },
  });
  if (result.count === 0) throw new AppError('You are not in this queue.', { status: 409 });
  publish('queue.updated', { guildId: room.guildId, roomId: room.id });
  return { ok: true };
}

async function admitEntry({ client, guild, room, entry, actorId, actorName, config }) {
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel) throw new NotFoundError('This room no longer exists.');
  if (room.userLimit > 0 && humanCount(channel) >= room.userLimit) {
    throw new AppError('The room is still full. Free a spot before admitting someone.', { status: 409 });
  }
  const expiresAt =
    config.permissionsExpireMinutes > 0 ? new Date(Date.now() + config.permissionsExpireMinutes * 60000) : null;
  await prisma.$transaction([
    prisma.roomPermission.upsert({
      where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'USER', targetId: entry.userId } },
      create: {
        roomId: room.id,
        targetType: 'USER',
        targetId: entry.userId,
        allowConnect: true,
        createdBy: actorId,
        expiresAt,
      },
      update: { allowConnect: true, expiresAt },
    }),
    prisma.queueEntry.update({ where: { id: entry.id }, data: { status: 'ADMITTED', admittedAt: new Date() } }),
  ]);
  await applyPermissions(guild, room.id);
  const member = await fetchMemberById(guild, entry.userId);
  if (member?.voice?.channelId && member.voice.channelId !== room.channelId) {
    await member.voice.setChannel(room.channelId, 'Chamber: admitted from queue').catch(() => null);
  }
  await sendUserPanel(
    client,
    entry.userId,
    noticePanel({
      title: '✅ You have been admitted',
      accentColor: '#34d399',
      body: `A spot opened in **${room.name}**. Open <#${room.channelId}> to join.`,
    }),
  );
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'queue.admitted',
    category: 'QUEUE',
    targetType: 'user',
    targetId: entry.userId,
    metadata: { roomId: room.id, entryId: entry.id },
  });
  publish('queue.updated', { guildId: room.guildId, roomId: room.id });
  await refreshPanel(client, room.id).catch(() => null);
  return entry;
}

export async function admitNext({ client, guild, room, actorId, actorName, config = null }) {
  const resolvedConfig = config ?? (await ensureConfig(room.guildId));
  const [entry] = await listQueue(room.id);
  if (!entry) throw new AppError('The queue is empty.', { status: 409 });
  return admitEntry({ client, guild, room, entry, actorId, actorName, config: resolvedConfig });
}

export async function admitEntryById({ client, guild, room, entryId, actorId, actorName, config = null }) {
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.roomId !== room.id || entry.status !== 'WAITING') {
    throw new NotFoundError('Queue entry not found.');
  }
  const resolvedConfig = config ?? (await ensureConfig(room.guildId));
  return admitEntry({ client, guild, room, entry, actorId, actorName, config: resolvedConfig });
}

export async function onSlotAvailable({ client, guild, room, config = null }) {
  const resolvedConfig = config ?? (await ensureConfig(room.guildId));
  const [entry] = await listQueue(room.id);
  if (!entry) return null;
  if (resolvedConfig.queueAutoAdmit) {
    try {
      return await admitEntry({
        client,
        guild,
        room,
        entry,
        actorId: client.user?.id ?? null,
        actorName: 'Chamber automation',
        config: resolvedConfig,
      });
    } catch (error) {
      logger.debug({ err: error, roomId: room.id }, 'Auto-admit failed');
    }
  }
  await sendUserPanel(
    client,
    entry.userId,
    noticePanel({
      title: '🎟️ A spot is available',
      accentColor: '#22d3ee',
      body: `A spot opened in **${room.name}**. Ask the owner to admit you or wait in the queue — you are first in line.`,
    }),
  ).catch(() => null);
  await sendChannelPanel(
    guild,
    room.channelId,
    noticePanel({
      title: '🎟️ Queue',
      accentColor: '#22d3ee',
      body: `A spot opened. <@${room.ownerId}> — <@${entry.userId}> is next in the queue.`,
    }),
  ).catch(() => null);
  publish('queue.updated', { guildId: room.guildId, roomId: room.id });
  return entry;
}

export async function markJoinedFromQueue(roomId, userId) {
  await prisma.queueEntry.updateMany({
    where: { roomId, userId, status: 'WAITING' },
    data: { status: 'ADMITTED', admittedAt: new Date() },
  });
}

export async function expireQueueEntries() {
  const now = new Date();
  const result = await prisma.queueEntry.updateMany({
    where: { status: 'WAITING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

export async function getQueueStats(roomId) {
  const [waiting, admitted] = await Promise.all([
    prisma.queueEntry.count({ where: { roomId, status: 'WAITING' } }),
    prisma.queueEntry.count({ where: { roomId, status: 'ADMITTED' } }),
  ]);
  return { waiting, admitted };
}

export default {
  listQueue,
  joinQueue,
  leaveQueue,
  admitNext,
  admitEntryById,
  onSlotAvailable,
  markJoinedFromQueue,
  expireQueueEntries,
  getQueueStats,
};
