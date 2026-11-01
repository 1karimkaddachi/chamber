import prisma from '@chamber/db';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { logger } from '../logger.js';
import { fetchMemberById, sanitizeRoomName } from '../lib/discord.js';
import { sendUserPanel } from '../lib/notify.js';
import { noticePanel } from '../bot/panels.js';
import { ensureConfig } from './guildService.js';
import { createRoom, ensureUserRecord } from './roomService.js';
import { getTemplate } from './templateService.js';
import { writeAudit } from './auditService.js';

function timestamp(date, style = 'F') {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
}

export async function createReservation({ guildId, host, input, actorId = null, actorName = null }) {
  const config = await ensureConfig(guildId);
  if (!config.reservationsEnabled) throw new AppError('Reservations are disabled on this server.', { status: 409 });
  const scheduledFor = new Date(input.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) throw new AppError('Invalid reservation date.');
  if (scheduledFor.getTime() < Date.now() + 60000) throw new AppError('Choose a time at least one minute in the future.');
  const windowEnd = Date.now() + config.reservationWindowDays * 86400000;
  if (scheduledFor.getTime() > windowEnd) {
    throw new AppError(`Reservations can be made up to ${config.reservationWindowDays} days ahead.`);
  }
  if (input.durationMinutes > config.reservationMaxDurationMinutes) {
    throw new AppError(`The maximum reservation duration is ${config.reservationMaxDurationMinutes} minutes.`);
  }
  const existingCount = await prisma.reservation.count({
    where: { guildId, hostId: host.id, status: 'SCHEDULED' },
  });
  if (existingCount >= config.reservationsPerUser) {
    throw new AppError(`You already have ${existingCount} scheduled reservations (limit ${config.reservationsPerUser}).`, {
      status: 409,
    });
  }
  let template = null;
  if (input.templateId) {
    template = await getTemplate(guildId, input.templateId);
    if (!template) throw new NotFoundError('Template not found.');
  }
  await ensureUserRecord(host);
  const privacy = input.privacy ?? template?.defaultPrivacy ?? 'PUBLIC';
  const reservation = await prisma.reservation.create({
    data: {
      guildId,
      hostId: host.id,
      hostName: host.globalName || host.username || null,
      templateId: template?.id ?? null,
      roomTypeKey: template?.roomTypeKey ?? input.roomTypeKey ?? null,
      name: sanitizeRoomName(input.name),
      privacy,
      userLimit: input.userLimit ?? template?.defaultLimit ?? 0,
      durationMinutes: input.durationMinutes,
      scheduledFor,
      status: 'SCHEDULED',
    },
  });
  await writeAudit({
    guildId,
    actorId: actorId ?? host.id,
    actorName: actorName ?? host.username,
    action: 'reservation.created',
    category: 'RESERVATION',
    targetType: 'reservation',
    targetId: reservation.id,
    metadata: { scheduledFor, durationMinutes: input.durationMinutes, name: input.name },
  });
  publish('reservation.created', { guildId, reservation });
  return reservation;
}

export async function cancelReservation({ guildId, id, userId, canManage = false, actorName = null }) {
  const reservation = await prisma.reservation.findUnique({ where: { id } });
  if (!reservation || reservation.guildId !== guildId) throw new NotFoundError('Reservation not found.');
  if (reservation.hostId !== userId && !canManage) throw new ForbiddenError();
  if (reservation.status !== 'SCHEDULED') throw new AppError('Only scheduled reservations can be cancelled.', { status: 409 });
  const updated = await prisma.reservation.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });
  await writeAudit({
    guildId,
    actorId: userId,
    actorName,
    action: 'reservation.cancelled',
    category: 'RESERVATION',
    targetType: 'reservation',
    targetId: id,
    metadata: { scheduledFor: reservation.scheduledFor },
  });
  publish('reservation.cancelled', { guildId, reservationId: id });
  return updated;
}

export async function listReservations(guildId, { status = null, from = null, take = 50 } = {}) {
  const where = { guildId };
  if (status) where.status = status;
  if (from) where.scheduledFor = { gte: from };
  return prisma.reservation.findMany({
    where,
    orderBy: { scheduledFor: 'asc' },
    take,
  });
}

async function notifyHost(client, reservation, panel) {
  const guild = client.guilds.cache.get(reservation.guildId);
  const member = guild ? await fetchMemberById(guild, reservation.hostId) : null;
  if (member) await sendUserPanel(client, member.id, panel);
  else await sendUserPanel(client, reservation.hostId, panel);
}

export async function processReservations(client) {
  const now = new Date();
  let created = 0;
  await prisma.reservation.updateMany({
    where: { status: 'SCHEDULED', scheduledFor: { lt: new Date(now.getTime() - 15 * 60000) } },
    data: { status: 'EXPIRED', error: 'The bot was offline when the reservation was due.' },
  });

  const reminders = await prisma.reservation.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledFor: { gte: now, lte: new Date(now.getTime() + 11 * 60000) },
      remindedAt: null,
    },
    take: 10,
  });
  for (const reservation of reminders) {
    const claimed = await prisma.reservation.updateMany({
      where: { id: reservation.id, remindedAt: null, status: 'SCHEDULED' },
      data: { remindedAt: now },
    });
    if (claimed.count === 0) continue;
    await notifyHost(
      client,
      reservation,
      noticePanel({
        title: '⏰ Reservation starting soon',
        accentColor: '#22d3ee',
        body: `**${reservation.name}** starts ${timestamp(reservation.scheduledFor, 'R')} (${timestamp(reservation.scheduledFor, 'F')}).\nThe bot will create the room automatically.`,
      }),
    ).catch(() => null);
  }

  const due = await prisma.reservation.findMany({
    where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
    take: 5,
  });
  for (const reservation of due) {
    try {
      const guild = client.guilds.cache.get(reservation.guildId);
      if (!guild) throw new Error('The bot is not connected to this server.');
      const hostMember = await fetchMemberById(guild, reservation.hostId);
      if (!hostMember) throw new Error('The host is no longer in the server.');
      const config = await ensureConfig(reservation.guildId);
      const template = reservation.templateId ? await getTemplate(reservation.guildId, reservation.templateId) : null;
      const privacy = reservation.privacy === 'PASSWORD' ? 'PRIVATE' : reservation.privacy;
      const room = await createRoom({
        guild,
        ownerMember: hostMember,
        config,
        template,
        privacy,
        userLimit: reservation.userLimit,
        name: reservation.name,
        settings: { reservationId: reservation.id },
        createdBy: reservation.hostId,
        reason: 'Chamber: scheduled reservation',
      });
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: 'CREATED', roomChannelId: room.channelId },
      });
      await notifyHost(
        client,
        reservation,
        noticePanel({
          title: '📅 Reservation room is ready',
          accentColor: '#34d399',
          body: `**${reservation.name}** has been created for ${reservation.durationMinutes} minutes.\nOpen <#${room.channelId}> to join.`,
        }),
      ).catch(() => null);
      await writeAudit({
        guildId: reservation.guildId,
        actorId: reservation.hostId,
        actorName: 'Reservation scheduler',
        action: 'reservation.created_room',
        category: 'RESERVATION',
        targetType: 'room',
        targetId: room.id,
        metadata: { reservationId: reservation.id },
      });
      publish('reservation.created_room', {
        guildId: reservation.guildId,
        reservationId: reservation.id,
        roomId: room.id,
      });
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ err: error, reservationId: reservation.id }, 'Reservation failed');
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: 'FAILED', error: message.slice(0, 300) },
      });
      await notifyHost(
        client,
        reservation,
        noticePanel({
          title: '⚠️ Reservation could not start',
          accentColor: '#fb7185',
          body: `**${reservation.name}** could not be created.\nReason: ${message}`,
        }),
      ).catch(() => null);
      publish('reservation.failed', { guildId: reservation.guildId, reservationId: reservation.id });
    }
  }
  return created;
}

export default {
  createReservation,
  cancelReservation,
  listReservations,
  processReservations,
};
