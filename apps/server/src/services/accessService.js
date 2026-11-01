import prisma from '@chamber/db';
import { computeAccess } from './guildService.js';
import { ForbiddenError } from '../lib/errors.js';

export async function getRoomAccess(client, room, userId, config) {
  const guild = client?.guilds?.cache?.get(room.guildId) ?? null;
  if (!guild) {
    return {
      guild: null,
      member: null,
      isOwner: room.ownerId === userId,
      roomAdmin: false,
      guildAdmin: false,
      staff: false,
      canModerate: false,
      canConfigure: false,
    };
  }
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  const access = computeAccess(member, config, guild);
  const row = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: room.id, userId } },
  });
  const roomAdmin =
    row?.role === 'ADMIN' && (!row.tempAdminUntil || new Date(row.tempAdminUntil).getTime() > Date.now());
  const isOwner = room.ownerId === userId;
  const memberInRoom = Boolean(guild.channels.cache.get(room.channelId)?.members?.has(userId));
  return {
    guild,
    member,
    memberInRoom,
    isOwner,
    roomAdmin,
    guildAdmin: access.admin,
    staff: access.staff,
    canModerate: isOwner || roomAdmin || access.staff,
    canConfigure: isOwner || access.admin,
  };
}

export function assertRoomLevel(access, level = 'moderate') {
  if (level === 'owner' && !access.canConfigure) {
    throw new ForbiddenError('Only the room owner or a server administrator can do that.');
  }
  if (level === 'moderate' && !access.canModerate) {
    throw new ForbiddenError('Only the room owner, a room administrator or server staff can do that.');
  }
  if (level === 'member' && !access.isOwner && !access.roomAdmin && !access.staff && !access.memberInRoom) {
    throw new ForbiddenError('You need to be in this room to do that.');
  }
}

export async function requireRoomAccess(client, room, userId, config, level = 'moderate') {
  const access = await getRoomAccess(client, room, userId, config);
  assertRoomLevel(access, level);
  return access;
}

export default { getRoomAccess, assertRoomLevel, requireRoomAccess };
