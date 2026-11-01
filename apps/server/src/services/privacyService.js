import bcrypt from 'bcryptjs';
import prisma from '@chamber/db';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { sendChannelPanel, sendUserPanel } from '../lib/notify.js';
import { publish } from '../lib/events.js';
import { logger } from '../logger.js';
import { displayName, fetchChannelById, fetchMemberById } from '../lib/discord.js';
import { noticePanel, waitingCard } from '../bot/panels.js';
import { applyPermissions, ensureUserRecord, getRoomById, refreshPanel } from './roomService.js';
import { ensureConfig } from './guildService.js';
import { writeAudit } from './auditService.js';

function activeBans(room, now = Date.now()) {
  return (room.bans ?? []).filter((ban) => !ban.expiresAt || new Date(ban.expiresAt).getTime() > now);
}

function hasAllow(room, userId, now = Date.now()) {
  return (room.permissions ?? []).some(
    (rule) =>
      rule.targetType === 'USER' &&
      rule.targetId === userId &&
      (!rule.expiresAt || new Date(rule.expiresAt).getTime() > now),
  );
}

export async function requestRoomAccess({ client, guild, room, user, message = null }) {
  if (!['REQUEST', 'PRIVATE'].includes(room.privacy)) {
    throw new AppError('This room is not accepting access requests.', { status: 409 });
  }
  if (room.ownerId === user.id) return { alreadyOwner: true };
  if (hasAllow(room, user.id)) throw new ConflictError('You already have access to this room.');
  if (activeBans(room).some((ban) => ban.userId === user.id)) {
    throw new ForbiddenError('You cannot request access to this room.');
  }
  const config = await ensureConfig(room.guildId);
  const existing = await prisma.waitingRequest.findFirst({
    where: { roomId: room.id, userId: user.id, status: 'PENDING' },
  });
  if (existing && new Date(existing.expiresAt).getTime() > Date.now()) {
    return { request: existing, alreadyPending: true };
  }
  const expiresAt = new Date(Date.now() + config.waitingRequestExpiryMinutes * 60000);
  const request = await prisma.waitingRequest.create({
    data: { roomId: room.id, userId: user.id, message: message?.slice(0, 300) ?? null, expiresAt },
  });
  await ensureUserRecord(user);
  const member = await fetchMemberById(guild, user.id);
  const card = waitingCard(request, {
    room,
    requesterId: user.id,
    requesterName: member ? displayName(member) : user.username,
    expiresAt,
  });
  const delivered = await sendUserPanel(client, room.ownerId, card);
  if (!delivered) {
    await sendChannelPanel(guild, room.channelId, card);
  }
  await writeAudit({
    guildId: room.guildId,
    actorId: user.id,
    actorName: user.username,
    action: 'waiting.requested',
    category: 'PRIVACY',
    targetType: 'room',
    targetId: room.id,
    metadata: { requestId: request.id },
  });
  publish('waiting.created', { guildId: room.guildId, roomId: room.id, requestId: request.id });
  return { request };
}

export async function resolveWaitingRequest({
  client,
  guild,
  room,
  requestId,
  accept,
  actorId,
  actorName,
}) {
  const config = await ensureConfig(room.guildId);
  const request = await prisma.waitingRequest.findUnique({ where: { id: requestId } });
  if (!request || request.roomId !== room.id) throw new NotFoundError('Access request not found.');
  if (request.status !== 'PENDING') throw new ConflictError('This request has already been resolved.');
  if (new Date(request.expiresAt).getTime() <= Date.now()) {
    await prisma.waitingRequest.update({
      where: { id: request.id },
      data: { status: 'EXPIRED', resolvedAt: new Date() },
    });
    throw new AppError('This request has expired.', { status: 410 });
  }

  const now = new Date();
  if (!accept) {
    await prisma.waitingRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', resolvedAt: now, resolvedById: actorId },
    });
    await sendUserPanel(
      client,
      request.userId,
      noticePanel({
        title: 'Access request declined',
        accentColor: '#fb7185',
        body: `Your request to join **${room.name}** was declined.`,
      }),
    );
    await writeAudit({
      guildId: room.guildId,
      actorId,
      actorName,
      action: 'waiting.resolved',
      category: 'PRIVACY',
      targetType: 'room',
      targetId: room.id,
      metadata: { requestId: request.id, result: 'rejected' },
    });
    publish('waiting.resolved', { guildId: room.guildId, roomId: room.id, requestId: request.id, accepted: false });
    await refreshPanel(client, room.id).catch(() => null);
    return { accepted: false };
  }

  const expiresAt =
    config.permissionsExpireMinutes > 0
      ? new Date(Date.now() + config.permissionsExpireMinutes * 60000)
      : null;
  await prisma.$transaction([
    prisma.roomPermission.upsert({
      where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'USER', targetId: request.userId } },
      create: {
        roomId: room.id,
        targetType: 'USER',
        targetId: request.userId,
        allowConnect: true,
        createdBy: actorId,
        expiresAt,
      },
      update: { allowConnect: true, expiresAt },
    }),
    prisma.waitingRequest.update({
      where: { id: request.id },
      data: { status: 'ACCEPTED', resolvedAt: now, resolvedById: actorId },
    }),
  ]);
  await applyPermissions(guild, room.id);
  const member = await fetchMemberById(guild, request.userId);
  if (member?.voice?.channelId && member.voice.channelId !== room.channelId) {
    await member.voice.setChannel(room.channelId, 'Chamber: access granted').catch(() => null);
  }
  await sendUserPanel(
    client,
    request.userId,
    noticePanel({
      title: 'Access granted',
      accentColor: '#34d399',
      body: `**${actorName || 'The owner'}** accepted your request to join **${room.name}**.\nOpen <#${room.channelId}> to join.`,
    }),
  );
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'waiting.resolved',
    category: 'PRIVACY',
    targetType: 'room',
    targetId: room.id,
    metadata: { requestId: request.id, result: 'accepted', userId: request.userId },
  });
  publish('waiting.resolved', { guildId: room.guildId, roomId: room.id, requestId: request.id, accepted: true });
  await refreshPanel(client, room.id).catch(() => null);
  return { accepted: true };
}

export async function verifyRoomPassword({ client, guild, room, user, password }) {
  if (room.privacy !== 'PASSWORD' || !room.passwordHash) {
    throw new AppError('This room is not password protected.', { status: 409 });
  }
  if (room.ownerId === user.id) return { ok: true, alreadyOwner: true };
  if (hasAllow(room, user.id)) return { ok: true, alreadyAllowed: true };
  if (activeBans(room).some((ban) => ban.userId === user.id)) {
    throw new ForbiddenError('You cannot join this room.');
  }
  const config = await ensureConfig(room.guildId);
  const attempt = await prisma.passwordAttempt.findUnique({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
  });
  if (attempt?.lockedUntil && new Date(attempt.lockedUntil).getTime() > Date.now()) {
    throw new AppError('Too many incorrect attempts. Try again later.', { status: 429 });
  }
  const valid = await bcrypt.compare(String(password), room.passwordHash);
  if (!valid) {
    const attempts = (attempt?.attempts ?? 0) + 1;
    const locked = attempts >= config.passwordMaxAttempts;
    await prisma.passwordAttempt.upsert({
      where: { roomId_userId: { roomId: room.id, userId: user.id } },
      create: {
        roomId: room.id,
        userId: user.id,
        attempts,
        lockedUntil: locked ? new Date(Date.now() + config.passwordLockoutMinutes * 60000) : null,
      },
      update: {
        attempts,
        lockedUntil: locked ? new Date(Date.now() + config.passwordLockoutMinutes * 60000) : null,
      },
    });
    if (locked) {
      await writeAudit({
        guildId: room.guildId,
        actorId: user.id,
        actorName: user.username,
        action: 'room.password.locked',
        category: 'PRIVACY',
        targetType: 'room',
        targetId: room.id,
        metadata: { attempts },
      });
    }
    return { ok: false, attempts, remaining: Math.max(0, config.passwordMaxAttempts - attempts), locked };
  }

  await prisma.passwordAttempt.deleteMany({ where: { roomId: room.id, userId: user.id } });
  const expiresAt =
    config.permissionsExpireMinutes > 0
      ? new Date(Date.now() + config.permissionsExpireMinutes * 60000)
      : null;
  await prisma.roomPermission.upsert({
    where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'USER', targetId: user.id } },
    create: { roomId: room.id, targetType: 'USER', targetId: user.id, allowConnect: true, expiresAt },
    update: { allowConnect: true, expiresAt },
  });
  await applyPermissions(guild, room.id);
  const member = await fetchMemberById(guild, user.id);
  if (member?.voice?.channelId && member.voice.channelId !== room.channelId) {
    await member.voice.setChannel(room.channelId, 'Chamber: password verified').catch(() => null);
  }
  await writeAudit({
    guildId: room.guildId,
    actorId: user.id,
    actorName: user.username,
    action: 'room.password.verified',
    category: 'PRIVACY',
    targetType: 'room',
    targetId: room.id,
    metadata: null,
  });
  publish('room.access.granted', { guildId: room.guildId, roomId: room.id, userId: user.id });
  await refreshPanel(client, room.id).catch(() => null);
  return { ok: true };
}

export async function expireWaitingRequests() {
  const now = new Date();
  const expired = await prisma.waitingRequest.findMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    select: { id: true, roomId: true },
    take: 100,
  });
  if (expired.length === 0) return 0;
  await prisma.waitingRequest.updateMany({
    where: { id: { in: expired.map((request) => request.id) }, status: 'PENDING' },
    data: { status: 'EXPIRED', resolvedAt: now },
  });
  for (const request of new Set(expired.map((entry) => entry.roomId))) {
    const room = await getRoomById(request).catch(() => null);
    if (room?.guildId) publish('waiting.expired', { guildId: room.guildId, roomId: room.id });
  }
  logger.debug({ count: expired.length }, 'Expired waiting room requests');
  return expired.length;
}

export default {
  requestRoomAccess,
  resolveWaitingRequest,
  verifyRoomPassword,
  expireWaitingRequests,
};
