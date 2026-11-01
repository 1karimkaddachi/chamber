import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} from 'discord.js';
import prisma from '@chamber/db';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { fetchChannelById, fetchMemberById, displayName } from '../lib/discord.js';
import { editCv2, sendCv2 } from '../lib/ui.js';
import { eventCard, noticePanel } from '../bot/panels.js';
import { publish } from '../lib/events.js';
import { logger } from '../logger.js';
import { sendUserPanel } from '../lib/notify.js';
import { writeAudit } from './auditService.js';

async function eventWithCount(eventId) {
  const event = await prisma.roomEvent.findUnique({
    where: { id: eventId },
    include: { _count: { select: { participants: true } }, room: true },
  });
  return event;
}

export async function sendEventCard(client, guild, event) {
  const room = event.room ?? (await prisma.activeRoom.findUnique({ where: { id: event.roomId } }));
  if (!room) return null;
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel?.isTextBased?.()) return null;
  const creator = await fetchMemberById(guild, event.creatorId);
  const components = eventCard(event, {
    roomName: room.name,
    creatorName: creator ? displayName(creator) : null,
    participantCount: event._count?.participants ?? 0,
  });
  if (event.messageId) {
    const message = await channel.messages.fetch(event.messageId).catch(() => null);
    if (message) {
      await editCv2(message, components).catch(() => null);
      return message;
    }
  }
  const message = await sendCv2(channel, components).catch((error) => {
    logger.debug({ err: error, eventId: event.id }, 'Failed to send event card');
    return null;
  });
  if (message) {
    await prisma.roomEvent.update({ where: { id: event.id }, data: { messageId: message.id } });
  }
  return message;
}

export async function refreshEventCard(client, eventId) {
  const event = await eventWithCount(eventId);
  if (!event) return null;
  const guild = client.guilds.cache.get(event.guildId);
  if (!guild) return null;
  return sendEventCard(client, guild, event);
}

export async function createRoomEvent({ client, guild, room, creator, input, actorId, actorName }) {
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new AppError('Invalid event start time.');
  if (startsAt.getTime() < Date.now() + 60000) throw new AppError('Events must start at least one minute in the future.');
  const durationMinutes = input.durationMinutes ?? 60;
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
  const event = await prisma.roomEvent.create({
    data: {
      roomId: room.id,
      guildId: room.guildId,
      creatorId: creator.id,
      title: input.title,
      type: input.type,
      description: input.description ?? null,
      startsAt,
      endsAt,
      participantLimit: input.participantLimit ?? 0,
      status: 'SCHEDULED',
    },
  });

  let discordEventId = null;
  let syncError = null;
  try {
    const scheduled = await guild.scheduledEvents.create({
      name: input.title,
      description: input.description || `Room event in ${room.name}`,
      scheduledStartTime: startsAt,
      scheduledEndTime: endsAt,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.Voice,
      channel: room.channelId,
      reason: 'Chamber: room event',
    });
    discordEventId = scheduled.id;
  } catch (error) {
    syncError = 'Discord scheduled event could not be created (missing ManageEvents permission or unsupported times).';
    logger.debug({ err: error, eventId: event.id }, 'Scheduled event sync failed');
  }

  await prisma.roomEvent.update({
    where: { id: event.id },
    data: { discordEventId, syncError },
  });
  const card = await sendEventCard(client, guild, await eventWithCount(event.id));
  const updated = await eventWithCount(event.id);
  if (card && !updated.messageId) updated.messageId = card.id;
  await writeAudit({
    guildId: room.guildId,
    actorId: actorId ?? creator.id,
    actorName: actorName ?? creator.username,
    action: 'event.created',
    category: 'ROOM',
    targetType: 'event',
    targetId: event.id,
    metadata: { title: input.title, startsAt, syncError },
  });
  publish('event.created', { guildId: room.guildId, eventId: event.id, roomId: room.id });
  return updated;
}

export async function joinRoomEvent({ client, eventId, user }) {
  const event = await eventWithCount(eventId);
  if (!event) throw new NotFoundError('Event not found.');
  if (!['SCHEDULED', 'ACTIVE'].includes(event.status)) throw new AppError('This event is no longer open.', { status: 409 });
  if (event.endsAt && new Date(event.endsAt).getTime() <= Date.now()) {
    throw new AppError('This event has already ended.', { status: 409 });
  }
  const existing = await prisma.eventParticipant.findUnique({
    where: { eventId_userId: { eventId, userId: user.id } },
  });
  if (existing) throw new AppError('You have already joined this event.', { status: 409 });
  if (event.participantLimit > 0 && event._count.participants >= event.participantLimit) {
    throw new AppError('This event is full.', { status: 409 });
  }
  await prisma.eventParticipant.create({ data: { eventId, userId: user.id } });
  await refreshEventCard(client, eventId);
  await sendUserPanel(
    client,
    user.id,
    noticePanel({
      title: '📅 Event joined',
      accentColor: '#34d399',
      body: `You joined **${event.title}**. It starts <t:${Math.floor(new Date(event.startsAt).getTime() / 1000)}:F>.`,
    }),
  ).catch(() => null);
  publish('event.updated', { guildId: event.guildId, eventId, roomId: event.roomId });
  return eventWithCount(eventId);
}

export async function leaveRoomEvent({ client, eventId, user }) {
  const event = await prisma.roomEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new NotFoundError('Event not found.');
  const deleted = await prisma.eventParticipant.deleteMany({ where: { eventId, userId: user.id } });
  if (deleted.count === 0) throw new AppError('You have not joined this event.', { status: 409 });
  await refreshEventCard(client, eventId);
  publish('event.updated', { guildId: event.guildId, eventId, roomId: event.roomId });
  return { ok: true };
}

export async function cancelRoomEvent({ client, event, actorId, actorName }) {
  if (!event) throw new NotFoundError('Event not found.');
  if (event.status === 'CANCELLED') return event;
  const guild = client.guilds.cache.get(event.guildId);
  if (guild && event.discordEventId) {
    await guild.scheduledEvents.delete(event.discordEventId, 'Chamber: event cancelled').catch(() => null);
  }
  const updated = await prisma.roomEvent.update({
    where: { id: event.id },
    data: { status: 'CANCELLED' },
    include: { _count: { select: { participants: true } }, room: true },
  });
  if (guild) {
    const channel = await fetchChannelById(guild, updated.room?.channelId ?? '');
    if (channel?.isTextBased?.() && updated.messageId) {
      const message = await channel.messages.fetch(updated.messageId).catch(() => null);
      if (message) {
        await editCv2(
          message,
          noticePanel({
            title: '📅 Event cancelled',
            accentColor: '#fb7185',
            body: `**${updated.title}** has been cancelled by the host.`,
          }),
        ).catch(() => null);
      }
    }
  }
  await writeAudit({
    guildId: event.guildId,
    actorId,
    actorName,
    action: 'event.cancelled',
    category: 'ROOM',
    targetType: 'event',
    targetId: event.id,
    metadata: { title: event.title },
  });
  publish('event.cancelled', { guildId: event.guildId, eventId: event.id, roomId: event.roomId });
  return updated;
}

export async function listRoomEvents(roomId) {
  return prisma.roomEvent.findMany({
    where: { roomId },
    orderBy: { startsAt: 'asc' },
    include: { _count: { select: { participants: true } } },
  });
}

export async function listGuildEvents(guildId, { take = 50 } = {}) {
  return prisma.roomEvent.findMany({
    where: { guildId },
    orderBy: { startsAt: 'asc' },
    take,
    include: {
      _count: { select: { participants: true } },
      room: { select: { name: true, channelId: true } },
    },
  });
}

export async function processRoomEvents(client) {
  const now = new Date();
  await prisma.roomEvent.updateMany({
    where: { status: 'SCHEDULED', startsAt: { lte: now }, endsAt: { gt: now } },
    data: { status: 'ACTIVE' },
  });
  await prisma.roomEvent.updateMany({
    where: { status: { in: ['SCHEDULED', 'ACTIVE'] }, endsAt: { lte: now } },
    data: { status: 'COMPLETED' },
  });
  await prisma.roomEvent.updateMany({
    where: { status: 'SCHEDULED', startsAt: { lt: new Date(now.getTime() - 6 * 3600000) }, endsAt: null },
    data: { status: 'COMPLETED' },
  });
}

export default {
  createRoomEvent,
  joinRoomEvent,
  leaveRoomEvent,
  cancelRoomEvent,
  listRoomEvents,
  listGuildEvents,
  processRoomEvents,
  refreshEventCard,
};
