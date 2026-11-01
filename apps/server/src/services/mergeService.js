import prisma from '@chamber/db';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { fetchChannelById, displayName } from '../lib/discord.js';
import { sendChannelPanel, sendUserPanel } from '../lib/notify.js';
import { mergeRequestPanel, noticePanel } from '../bot/panels.js';
import { publish } from '../lib/events.js';
import { logger } from '../logger.js';
import { ensureConfig } from './guildService.js';
import { applyPermissions, deleteRoom, getRoomById, refreshPanel } from './roomService.js';
import { writeAudit } from './auditService.js';

export async function requestMerge({ client, guild, requesterRoom, targetRoomId, requester }) {
  const config = await ensureConfig(requesterRoom.guildId);
  if (!config.mergingEnabled) throw new AppError('Room merging is disabled on this server.', { status: 409 });
  if (requesterRoom.ownerId !== requester.id) throw new ForbiddenError('Only the room owner can request a merge.');
  const target = await getRoomById(targetRoomId);
  if (!target || target.guildId !== requesterRoom.guildId || target.status !== 'ACTIVE') {
    throw new NotFoundError('Target room not found.');
  }
  if (target.id === requesterRoom.id) throw new AppError('Choose a different room to merge with.');
  if (target.ownerId === requester.id) throw new AppError('You already own both rooms.');
  const existing = await prisma.mergeRequest.findFirst({
    where: {
      status: 'PENDING',
      OR: [
        { requesterRoomId: requesterRoom.id, targetRoomId: target.id },
        { requesterRoomId: target.id, targetRoomId: requesterRoom.id },
      ],
    },
  });
  if (existing) throw new ConflictError('A merge request between these rooms is already pending.');
  const merge = await prisma.mergeRequest.create({
    data: {
      guildId: requesterRoom.guildId,
      requesterRoomId: requesterRoom.id,
      targetRoomId: target.id,
      requesterId: requester.id,
      targetOwnerId: target.ownerId,
      expiresAt: new Date(Date.now() + 30 * 60000),
    },
  });
  const card = mergeRequestPanel(merge, {
    requesterRoom,
    targetRoom: target,
    requesterName: requester.username,
  });
  const delivered = await sendUserPanel(client, target.ownerId, card);
  if (!delivered) await sendChannelPanel(guild, target.channelId, card);
  await writeAudit({
    guildId: requesterRoom.guildId,
    actorId: requester.id,
    actorName: requester.username,
    action: 'merge.requested',
    category: 'ROOM',
    targetType: 'room',
    targetId: requesterRoom.id,
    metadata: { mergeId: merge.id, targetRoomId: target.id, targetOwnerId: target.ownerId },
  });
  publish('merge.requested', { guildId: requesterRoom.guildId, mergeId: merge.id });
  return merge;
}

export async function resolveMerge({ client, guild, mergeId, userId, accept }) {
  const merge = await prisma.mergeRequest.findUnique({
    where: { id: mergeId },
    include: { requesterRoom: true, targetRoom: true },
  });
  if (!merge) throw new NotFoundError('Merge request not found.');
  if (merge.status !== 'PENDING') throw new ConflictError('This merge request is no longer pending.');
  if (new Date(merge.expiresAt).getTime() <= Date.now()) {
    await prisma.mergeRequest.update({ where: { id: mergeId }, data: { status: 'EXPIRED', resolvedAt: new Date() } });
    throw new AppError('This merge request has expired.', { status: 410 });
  }
  if (merge.targetOwnerId !== userId) throw new ForbiddenError('Only the target room owner can respond.');
  if (!merge.requesterRoom || !merge.targetRoom) {
    await prisma.mergeRequest.update({ where: { id: mergeId }, data: { status: 'EXPIRED', resolvedAt: new Date() } });
    throw new NotFoundError('One of the rooms no longer exists.');
  }
  if (!accept) {
    await prisma.mergeRequest.update({
      where: { id: mergeId },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });
    await sendUserPanel(
      client,
      merge.requesterId,
      noticePanel({
        title: 'Merge declined',
        accentColor: '#fb7185',
        body: `Your merge request for **${merge.requesterRoom.name}** was declined.`,
      }),
    );
    await writeAudit({
      guildId: merge.guildId,
      actorId: userId,
      actorName: 'Room owner',
      action: 'merge.rejected',
      category: 'ROOM',
      targetType: 'room',
      targetId: merge.targetRoomId,
      metadata: { mergeId },
    });
    publish('merge.resolved', { guildId: merge.guildId, mergeId, accepted: false });
    return { accepted: false };
  }

  const source = merge.requesterRoom;
  const target = merge.targetRoom;
  const sourceChannel = await fetchChannelById(guild, source.channelId);
  const targetChannel = await fetchChannelById(guild, target.channelId);
  if (!sourceChannel || !targetChannel) throw new NotFoundError('One of the rooms no longer exists.');

  const perms = await prisma.roomPermission.findMany({ where: { roomId: source.id } });
  const bans = await prisma.roomBan.findMany({ where: { roomId: source.id } });
  if (perms.length > 0) {
    await prisma.roomPermission.createMany({
      data: perms.map((rule) => ({
        roomId: target.id,
        targetType: rule.targetType,
        targetId: rule.targetId,
        allowConnect: rule.allowConnect,
        expiresAt: rule.expiresAt,
        createdBy: rule.createdBy,
      })),
      skipDuplicates: true,
    });
  }
  if (bans.length > 0) {
    await prisma.roomBan.createMany({
      data: bans.map((ban) => ({
        roomId: target.id,
        userId: ban.userId,
        moderatorId: ban.moderatorId,
        kind: ban.kind,
        reason: ban.reason,
        expiresAt: ban.expiresAt,
      })),
      skipDuplicates: true,
    });
  }
  await prisma.roomMember.upsert({
    where: { roomId_userId: { roomId: target.id, userId: source.ownerId } },
    create: { roomId: target.id, userId: source.ownerId, role: 'ADMIN' },
    update: {},
  });

  let moved = 0;
  for (const member of [...sourceChannel.members.values()]) {
    if (member.user.bot) continue;
    try {
      await member.voice.setChannel(targetChannel, 'Chamber: rooms merged');
      moved += 1;
    } catch (error) {
      logger.debug({ err: error, userId: member.id }, 'Merge member move failed');
    }
  }
  await applyPermissions(guild, target.id);
  await prisma.mergeRequest.update({
    where: { id: mergeId },
    data: { status: 'COMPLETED', resolvedAt: new Date() },
  });
  const remaining = [...sourceChannel.members.values()].filter((member) => !member.user.bot).length;
  if (remaining === 0) {
    const freshSource = await getRoomById(source.id);
    if (freshSource) {
      await deleteRoom({
        guild,
        room: freshSource,
        actorId: userId,
        actorName: 'Room merge',
        reason: 'Merged into another room',
        emptyOnly: true,
      });
    }
  }
  await refreshPanel(client, target.id).catch(() => null);
  const summary = `**${source.name}** was merged into **${target.name}** (${moved} ${moved === 1 ? 'member' : 'members'} moved).`;
  await sendUserPanel(
    client,
    target.ownerId,
    noticePanel({ title: '🔀 Merge complete', accentColor: '#34d399', body: summary }),
  );
  await sendUserPanel(
    client,
    source.ownerId,
    noticePanel({
      title: '🔀 Merge complete',
      accentColor: '#34d399',
      body: `${summary}\nYou are now an administrator in <#${target.channelId}>.`,
    }),
  );
  await writeAudit({
    guildId: merge.guildId,
    actorId: userId,
    actorName: 'Room owner',
    action: 'room.merged',
    category: 'ROOM',
    targetType: 'room',
    targetId: target.id,
    metadata: { sourceRoomId: source.id, membersMoved: moved, remaining },
  });
  publish('merge.resolved', { guildId: merge.guildId, mergeId, accepted: true, targetRoomId: target.id });
  return { accepted: true, moved, remaining };
}

export async function expireMergeRequests() {
  const result = await prisma.mergeRequest.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED', resolvedAt: new Date() },
  });
  return result.count;
}

export default { requestMerge, resolveMerge, expireMergeRequests };
