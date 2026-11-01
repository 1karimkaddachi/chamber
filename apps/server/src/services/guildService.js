import prisma from '@chamber/db';
import { publish } from '../lib/events.js';
import { hasAnyRole, isGuildAdmin, isGuildOwner } from '../lib/discord.js';

export async function ensureGuildRecord({ id, name, icon = null, ownerId = null, botPresent = true }) {
  return prisma.guild.upsert({
    where: { id },
    create: { id, name: name || 'Discord server', icon, ownerId, botPresent },
    update: { name: name || 'Discord server', icon, ownerId, botPresent },
  });
}

export async function ensureConfig(guildId) {
  return prisma.guildConfig.upsert({
    where: { guildId },
    create: { guildId },
    update: {},
  });
}

export async function getGuildBundle(guildId) {
  let guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) return null;
  let config = guild.config ?? null;
  if (!config) config = await ensureConfig(guildId);
  return { guild, config };
}

export async function updateConfig(guildId, patch, { actorId = null, actorName = null } = {}) {
  await ensureConfig(guildId);
  const config = await prisma.guildConfig.update({ where: { guildId }, data: patch });
  publish('config.updated', { guildId, config, actorId, actorName });
  return config;
}

export function computeAccess(member, config, guild) {
  const owner = Boolean(guild && member && guild.ownerId === member.id);
  const admin = owner || isGuildAdmin(member) || hasAnyRole(member, config?.adminRoleIds ?? []);
  const staff = admin || hasAnyRole(member, config?.staffRoleIds ?? []);
  return {
    owner,
    admin,
    staff,
  };
}

export async function syncGuildsFromClient(client) {
  const ids = [];
  for (const guild of client.guilds.cache.values()) {
    ids.push(guild.id);
    await ensureGuildRecord({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ size: 128 }),
      ownerId: guild.ownerId,
      botPresent: true,
    }).catch(() => null);
  }
  if (ids.length > 0) {
    await prisma.guild.updateMany({ where: { id: { notIn: ids } }, data: { botPresent: false } }).catch(() => null);
  }
  return ids.length;
}

export async function markGuildOffline(guildId) {
  await prisma.guild.update({ where: { id: guildId }, data: { botPresent: false } }).catch(() => null);
}

export async function getActiveRoomStats(guildId) {
  const [activeRooms, members] = await Promise.all([
    prisma.activeRoom.count({ where: { guildId, status: 'ACTIVE' } }),
    prisma.roomMember.count({ where: { room: { guildId, status: 'ACTIVE' } } }),
  ]);
  return { activeRooms, members };
}

export default {
  ensureGuildRecord,
  ensureConfig,
  getGuildBundle,
  updateConfig,
  computeAccess,
  syncGuildsFromClient,
  markGuildOffline,
  getActiveRoomStats,
};
