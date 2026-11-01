import prisma from '@chamber/db';
import { BUILTIN_ROOM_TYPES } from '@chamber/shared';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

export function utcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function rangeDays(range) {
  return RANGE_DAYS[range] ?? 30;
}

export async function recordRoomCreated(guildId, { participants = 0 } = {}) {
  const day = utcDay();
  await prisma.roomAnalytics
    .upsert({
      where: { guildId_day: { guildId, day } },
      create: { guildId, day, roomsCreated: 1, totalParticipants: participants },
      update: {
        roomsCreated: { increment: 1 },
        totalParticipants: { increment: participants },
      },
    })
    .catch(() => null);
}

export async function recordRoomDeleted(guildId) {
  const day = utcDay();
  await prisma.roomAnalytics
    .upsert({
      where: { guildId_day: { guildId, day } },
      create: { guildId, day, roomsDeleted: 1 },
      update: { roomsDeleted: { increment: 1 } },
    })
    .catch(() => null);
}

export async function recordParticipants(guildId, delta = 1, minutes = 0) {
  const day = utcDay();
  const voiceMinutes = Math.max(0, Math.round(minutes));
  await prisma.roomAnalytics
    .upsert({
      where: { guildId_day: { guildId, day } },
      create: { guildId, day, totalParticipants: delta, totalVoiceMinutes: voiceMinutes },
      update: {
        totalParticipants: { increment: delta },
        totalVoiceMinutes: { increment: voiceMinutes },
      },
    })
    .catch(() => null);
}

export async function recordPeakConcurrent(guildId, count) {
  const day = utcDay();
  try {
    const existing = await prisma.roomAnalytics.findUnique({
      where: { guildId_day: { guildId, day } },
    });
    if (!existing) {
      await prisma.roomAnalytics.create({
        data: { guildId, day, peakConcurrent: count },
      });
    } else if (existing.peakConcurrent < count) {
      await prisma.roomAnalytics.update({
        where: { guildId_day: { guildId, day } },
        data: { peakConcurrent: count },
      });
    }
  } catch {
    // Analytics is best-effort and must never interfere with room operations.
  }
}

function typeName(key) {
  const builtin = BUILTIN_ROOM_TYPES.find((type) => type.key === key);
  if (builtin) return { key, name: builtin.name, emoji: builtin.emoji };
  return { key: key || 'custom', name: key ? key.replace(/-/g, ' ') : 'Custom', emoji: '🎧' };
}

export async function getAnalytics(guildId, range = '30d') {
  const days = rangeDays(range);
  const since = utcDay(new Date(Date.now() - (days - 1) * 86400000));

  const [
    analyticsRows,
    activeRooms,
    memberCount,
    historyAggregate,
    historyByType,
    activeByType,
    topOwnerRows,
    allTimeAggregate,
    livePeak,
    recentHistory,
  ] = await Promise.all([
    prisma.roomAnalytics.findMany({
      where: { guildId, day: { gte: since } },
      orderBy: { day: 'asc' },
    }),
    prisma.activeRoom.count({ where: { guildId, status: 'ACTIVE' } }),
    prisma.roomMember.count({ where: { room: { guildId, status: 'ACTIVE' } } }),
    prisma.roomHistory.aggregate({
      where: { guildId, endedAt: { gte: since } },
      _avg: { durationSeconds: true },
      _count: { _all: true },
    }),
    prisma.roomHistory.groupBy({
      by: ['roomTypeKey'],
      where: { guildId, endedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.activeRoom.groupBy({
      by: ['roomTypeKey'],
      where: { guildId, status: 'ACTIVE' },
      _count: { _all: true },
    }),
    prisma.roomHistory.groupBy({
      by: ['ownerId'],
      where: { guildId, endedAt: { gte: since } },
      _count: { ownerId: true },
      orderBy: { _count: { ownerId: 'desc' } },
      take: 5,
    }),
    prisma.roomAnalytics.aggregate({
      where: { guildId },
      _sum: { roomsCreated: true, roomsDeleted: true },
    }),
    prisma.roomAnalytics.aggregate({
      where: { guildId, day: { gte: since } },
      _max: { peakConcurrent: true },
    }),
    prisma.roomHistory.findMany({
      where: { guildId },
      orderBy: { endedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        name: true,
        ownerId: true,
        ownerName: true,
        roomTypeKey: true,
        durationSeconds: true,
        peakMembers: true,
        endedAt: true,
        endReason: true,
      },
    }),
  ]);

  const byDay = new Map(analyticsRows.map((row) => [dayKey(row.day), row]));
  const series = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(since.getTime() + index * 86400000);
    const key = dayKey(date);
    const row = byDay.get(key);
    series.push({
      day: key,
      roomsCreated: row?.roomsCreated ?? 0,
      roomsDeleted: row?.roomsDeleted ?? 0,
      peakConcurrent: row?.peakConcurrent ?? 0,
      totalParticipants: row?.totalParticipants ?? 0,
      totalVoiceMinutes: row?.totalVoiceMinutes ?? 0,
    });
  }

  const typeCounts = new Map();
  for (const row of historyByType) {
    const key = row.roomTypeKey || 'custom';
    typeCounts.set(key, (typeCounts.get(key) || 0) + row._count._all);
  }
  for (const row of activeByType) {
    const key = row.roomTypeKey || 'custom';
    typeCounts.set(key, (typeCounts.get(key) || 0) + row._count._all);
  }
  const popularTypes = [...typeCounts.entries()]
    .map(([key, count]) => ({ ...typeName(key), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topOwnerIds = topOwnerRows.map((row) => row.ownerId);
  const users = topOwnerIds.length
    ? await prisma.user.findMany({ where: { id: { in: topOwnerIds } }, select: { id: true, username: true, globalName: true } })
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const topOwners = topOwnerRows.map((row) => ({
    id: row.ownerId,
    name: usersById.get(row.ownerId)?.globalName || usersById.get(row.ownerId)?.username || row.ownerId,
    rooms: row._count.ownerId,
  }));

  const totals = {
    roomsCreated: series.reduce((sum, row) => sum + row.roomsCreated, 0),
    roomsDeleted: series.reduce((sum, row) => sum + row.roomsDeleted, 0),
    participants: series.reduce((sum, row) => sum + row.totalParticipants, 0),
    voiceMinutes: series.reduce((sum, row) => sum + row.totalVoiceMinutes, 0),
    peakConcurrent: Math.max(livePeak._max.peakConcurrent ?? 0, activeRooms),
    activeRooms,
    membersInRooms: memberCount,
    completedRooms: historyAggregate._count._all,
    avgLifetimeSeconds: Math.round(historyAggregate._avg.durationSeconds ?? 0),
    allTimeRoomsCreated: allTimeAggregate._sum.roomsCreated ?? 0,
    allTimeRoomsDeleted: allTimeAggregate._sum.roomsDeleted ?? 0,
  };

  return {
    range,
    days,
    series,
    totals,
    popularTypes,
    topOwners,
    recentHistory,
  };
}

export async function recordRoomSession(entry) {
  try {
    return await prisma.roomHistory.create({ data: entry });
  } catch {
    return null;
  }
}

export async function pruneAnalytics(guildId, retentionDays) {
  if (!retentionDays || retentionDays < 7) return;
  const cutoff = new Date(Date.now() - retentionDays * 86400000);
  await prisma.roomHistory.deleteMany({ where: { guildId, endedAt: { lt: cutoff } } }).catch(() => null);
  await prisma.roomAnalytics.deleteMany({ where: { guildId, day: { lt: cutoff } } }).catch(() => null);
  await prisma.auditLog.deleteMany({ where: { guildId, createdAt: { lt: cutoff } } }).catch(() => null);
}

export default {
  recordRoomCreated,
  recordRoomDeleted,
  recordParticipants,
  recordPeakConcurrent,
  getAnalytics,
  recordRoomSession,
  pruneAnalytics,
};
