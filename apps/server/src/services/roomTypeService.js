import prisma from '@chamber/db';
import { AppError, NotFoundError } from '../lib/errors.js';

export async function listRoomTypes(guildId) {
  const [builtins, custom] = await Promise.all([
    prisma.roomType.findMany({ where: { guildId: null, isBuiltin: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.roomType.findMany({ where: { guildId }, orderBy: { sortOrder: 'asc' } }),
  ]);
  return [...builtins, ...custom];
}

export async function getRoomType(guildId, key) {
  if (!key) return null;
  return prisma.roomType.findFirst({
    where: { key, OR: [{ guildId }, { guildId: null }] },
    orderBy: { guildId: 'desc' },
  });
}

export async function createRoomType(guildId, input) {
  const duplicate = await prisma.roomType.findFirst({ where: { key: input.key, OR: [{ guildId }, { guildId: null }] } });
  if (duplicate) throw new AppError('A room type with that key already exists.', { status: 409 });
  return prisma.roomType.create({
    data: {
      guildId,
      key: input.key,
      name: input.name,
      emoji: input.emoji,
      description: input.description ?? null,
      defaultPrivacy: input.defaultPrivacy,
      defaultLimit: input.defaultLimit,
      templateId: input.templateId ?? null,
      sortOrder: input.sortOrder,
      isBuiltin: false,
    },
  });
}

export async function updateRoomType(guildId, id, input) {
  const type = await prisma.roomType.findUnique({ where: { id } });
  if (!type || type.guildId !== guildId) throw new NotFoundError('Room type not found.');
  if (type.isBuiltin) throw new AppError('Built-in room types cannot be edited.', { status: 400 });
  return prisma.roomType.update({
    where: { id },
    data: {
      name: input.name,
      emoji: input.emoji,
      description: input.description ?? null,
      defaultPrivacy: input.defaultPrivacy,
      defaultLimit: input.defaultLimit,
      templateId: input.templateId ?? null,
      sortOrder: input.sortOrder,
    },
  });
}

export async function deleteRoomType(guildId, id) {
  const type = await prisma.roomType.findUnique({ where: { id } });
  if (!type || type.guildId !== guildId) throw new NotFoundError('Room type not found.');
  if (type.isBuiltin) throw new AppError('Built-in room types cannot be deleted.', { status: 400 });
  const inUse = await prisma.activeRoom.count({ where: { guildId, roomTypeKey: type.key } });
  if (inUse > 0) throw new AppError('This room type is in use by active rooms.', { status: 409 });
  await prisma.roomType.delete({ where: { id } });
}

export default { listRoomTypes, getRoomType, createRoomType, updateRoomType, deleteRoomType };
