import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '@chamber/db';
import { setClient } from '../src/lib/botState.js';
import {
  createReservation,
  cancelReservation,
  processReservations,
} from '../src/services/reservationService.js';
import {
  createFakeWorld,
  makeMember,
  resetDatabase,
  seedGuild,
  seedTemplate,
  seedTrigger,
  GUILD_ID,
  OWNER_ID,
} from './helpers.js';

const HOST_ID = '100000000000000006';

let world;
let guild;
let host;
let config;
let template;

beforeEach(async () => {
  await resetDatabase();
  config = await seedGuild();
  world = createFakeWorld();
  guild = world.guild;
  host = makeMember(guild, { id: HOST_ID, username: 'Host', channelId: world.lobby.id });
  await prisma.user.upsert({ where: { id: HOST_ID }, create: { id: HOST_ID, username: 'Host' }, update: {} });
  await seedTrigger(GUILD_ID, world.trigger, world.category);
  template = await seedTemplate(GUILD_ID, { defaultPrivacy: 'PUBLIC', defaultLimit: 6 });
  await prisma.guildConfig.update({
    where: { guildId: GUILD_ID },
    data: {
      lobbyChannelId: world.lobby.id,
      defaultTemplateId: template.id,
      defaultCategoryId: world.category.id,
      reservationsPerUser: 2,
      reservationWindowDays: 30,
      reservationMaxDurationMinutes: 480,
    },
  });
  setClient(world.client);
});

describe('reservations', () => {
  it('validates reservation rules', async () => {
    await expect(
      createReservation({
        guildId: GUILD_ID,
        host: { id: HOST_ID, username: 'Host', globalName: 'Host' },
        input: {
          name: 'Past room',
          scheduledFor: new Date(Date.now() - 60_000),
          durationMinutes: 60,
        },
      }),
    ).rejects.toThrow(/future/i);

    await expect(
      createReservation({
        guildId: GUILD_ID,
        host: { id: HOST_ID, username: 'Host', globalName: 'Host' },
        input: {
          name: 'Far future room',
          scheduledFor: new Date(Date.now() + 60 * 86400000),
          durationMinutes: 60,
        },
      }),
    ).rejects.toThrow(/days ahead/i);

    await expect(
      createReservation({
        guildId: GUILD_ID,
        host: { id: HOST_ID, username: 'Host', globalName: 'Host' },
        input: {
          name: 'Too long',
          scheduledFor: new Date(Date.now() + 3600_000),
          durationMinutes: 900,
        },
      }),
    ).rejects.toThrow(/maximum reservation duration/i);
  });

  it('creates a room when a reservation is due and notifies the host', async () => {
    const scheduledFor = new Date(Date.now() - 2 * 60_000);
    const reservation = await prisma.reservation.create({
      data: {
        guildId: GUILD_ID,
        hostId: HOST_ID,
        hostName: 'Host',
        templateId: template.id,
        roomTypeKey: 'gaming',
        name: 'Friday tournament',
        privacy: 'PUBLIC',
        userLimit: 5,
        durationMinutes: 60,
        scheduledFor,
        status: 'SCHEDULED',
      },
    });
    guild.dms.length = 0;
    await processReservations(world.client);
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(updated.status).toBe('CREATED');
    expect(updated.roomChannelId).toBeTruthy();
    const room = await prisma.activeRoom.findUnique({ where: { channelId: updated.roomChannelId } });
    expect(room).toBeTruthy();
    expect(room.name).toBe('Friday tournament');
    expect(room.ownerId).toBe(HOST_ID);
    expect(room.userLimit).toBe(5);
    expect(guild.dms.some((dm) => dm.userId === HOST_ID)).toBe(true);
    expect(guild.channels.cache.get(updated.roomChannelId)).toBeTruthy();
  });

  it('sends a reminder for upcoming reservations once', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guildId: GUILD_ID,
        hostId: HOST_ID,
        name: 'Soon',
        privacy: 'PUBLIC',
        durationMinutes: 60,
        scheduledFor: new Date(Date.now() + 5 * 60_000),
        status: 'SCHEDULED',
      },
    });
    guild.dms.length = 0;
    await processReservations(world.client);
    const afterFirst = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(afterFirst.remindedAt).toBeTruthy();
    expect(guild.dms.some((dm) => dm.userId === HOST_ID)).toBe(true);

    guild.dms.length = 0;
    await processReservations(world.client);
    expect(guild.dms.length).toBe(0);
  });

  it('cancels scheduled reservations', async () => {
    const reservation = await createReservation({
      guildId: GUILD_ID,
      host: { id: HOST_ID, username: 'Host', globalName: 'Host' },
      input: {
        name: 'Cancelled room',
        scheduledFor: new Date(Date.now() + 3600_000),
        durationMinutes: 60,
      },
    });
    const cancelled = await cancelReservation({
      guildId: GUILD_ID,
      id: reservation.id,
      userId: HOST_ID,
      canManage: false,
      actorName: 'Host',
    });
    expect(cancelled.status).toBe('CANCELLED');
    await expect(
      cancelReservation({ guildId: GUILD_ID, id: reservation.id, userId: HOST_ID, canManage: false }),
    ).rejects.toThrow(/scheduled/i);
  });

  it('honours per-user reservation limits', async () => {
    const host = { id: HOST_ID, username: 'Host', globalName: 'Host' };
    for (let index = 0; index < 2; index += 1) {
      await createReservation({
        guildId: GUILD_ID,
        host,
        input: {
          name: `Room ${index}`,
          scheduledFor: new Date(Date.now() + (index + 1) * 3600_000),
          durationMinutes: 60,
        },
      });
    }
    await expect(
      createReservation({
        guildId: GUILD_ID,
        host,
        input: {
          name: 'Room 3',
          scheduledFor: new Date(Date.now() + 3 * 3600_000),
          durationMinutes: 60,
        },
      }),
    ).rejects.toThrow(/limit/i);
  });
});
