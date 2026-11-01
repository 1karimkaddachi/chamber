import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '@chamber/db';
import { createRoom, getRoomById, updateRoom } from '../src/services/roomService.js';
import { admitNext, joinQueue, leaveQueue, onSlotAvailable } from '../src/services/queueService.js';
import { requestRoomAccess, resolveWaitingRequest } from '../src/services/privacyService.js';
import { setClient } from '../src/lib/botState.js';
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

const MEMBER_ID = '100000000000000003';
const MEMBER2_ID = '100000000000000005';

let world;
let guild;
let owner;
let config;
let triggerRow;
let template;

beforeEach(async () => {
  await resetDatabase();
  config = await seedGuild();
  world = createFakeWorld();
  guild = world.guild;
  owner = makeMember(guild, { id: OWNER_ID, username: 'Owner', channelId: world.trigger.id });
  triggerRow = await seedTrigger(GUILD_ID, world.trigger, world.category);
  template = await seedTemplate(GUILD_ID);
  await prisma.guildConfig.update({
    where: { guildId: GUILD_ID },
    data: { lobbyChannelId: world.lobby.id, defaultTemplateId: template.id },
  });
  setClient(world.client);
});

async function makeRoom(overrides = {}) {
  return createRoom({
    guild,
    ownerMember: owner,
    trigger: triggerRow,
    config: await prisma.guildConfig.findUnique({ where: { guildId: GUILD_ID } }),
    ...overrides,
  });
}

describe('queue and waiting room', () => {
  it('queues members for a full room and admits them', async () => {
    const room = await makeRoom({ userLimit: 1 });
    const member = makeMember(guild, {
      id: MEMBER_ID,
      username: 'Queued Member',
      channelId: world.lobby.id,
    });

    const join = await joinQueue({ client: world.client, guild, room: await getRoomById(room.id), user: member.user });
    expect(join.position).toBe(1);
    const entry = await prisma.queueEntry.findFirst({ where: { roomId: room.id } });
    expect(entry.status).toBe('WAITING');
    expect(guild.dms.some((dm) => dm.userId === OWNER_ID)).toBe(true);

    guild.channels.cache.get(room.channelId).members.delete(OWNER_ID);
    owner.voice.channelId = null;

    const admitted = await admitNext({
      client: world.client,
      guild,
      room: await getRoomById(room.id),
      actorId: OWNER_ID,
      actorName: 'Owner',
    });
    expect(admitted.userId).toBe(MEMBER_ID);
    expect(member.voice.channelId).toBe(room.channelId);
    const permission = await prisma.roomPermission.findUnique({
      where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'USER', targetId: MEMBER_ID } },
    });
    expect(permission.allowConnect).toBe(true);
    const updatedEntry = await prisma.queueEntry.findUnique({ where: { id: entry.id } });
    expect(updatedEntry.status).toBe('ADMITTED');
  });

  it('rejects queueing for rooms that are not full', async () => {
    const room = await makeRoom({ userLimit: 5 });
    const member = makeMember(guild, { id: MEMBER_ID, username: 'Member', channelId: world.lobby.id });
    await expect(
      joinQueue({ client: world.client, guild, room: await getRoomById(room.id), user: member.user }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('notifies the next queued member when a slot opens', async () => {
    const room = await makeRoom({ userLimit: 1 });
    const member = makeMember(guild, { id: MEMBER_ID, username: 'Waiting', channelId: world.lobby.id });
    await joinQueue({ client: world.client, guild, room: await getRoomById(room.id), user: member.user });
    guild.dms.length = 0;
    await onSlotAvailable({
      client: world.client,
      guild,
      room: await getRoomById(room.id),
      config: await prisma.guildConfig.findUnique({ where: { guildId: GUILD_ID } }),
    });
    expect(guild.dms.some((dm) => dm.userId === MEMBER_ID)).toBe(true);
  });

  it('lets members leave the queue', async () => {
    const room = await makeRoom({ userLimit: 1 });
    const member = makeMember(guild, { id: MEMBER_ID, username: 'Leaver', channelId: world.lobby.id });
    await joinQueue({ client: world.client, guild, room: await getRoomById(room.id), user: member.user });
    await leaveQueue({ room: await getRoomById(room.id), userId: MEMBER_ID });
    const entry = await prisma.queueEntry.findFirst({ where: { roomId: room.id } });
    expect(entry.status).toBe('LEFT');
  });

  it('handles waiting room requests end to end', async () => {
    const room = await makeRoom();
    await updateRoom({
      guild,
      room,
      patch: { privacy: 'REQUEST' },
      actorId: OWNER_ID,
      actorName: 'Owner',
    });
    const member = makeMember(guild, {
      id: MEMBER2_ID,
      username: 'Requester',
      channelId: world.lobby.id,
    });
    const requested = await requestRoomAccess({
      client: world.client,
      guild,
      room: await getRoomById(room.id),
      user: member.user,
      message: 'Can I join?',
    });
    const request = await prisma.waitingRequest.findUnique({ where: { id: requested.request.id } });
    expect(request.status).toBe('PENDING');
    expect(guild.dms.some((dm) => dm.userId === OWNER_ID)).toBe(true);

    const result = await resolveWaitingRequest({
      client: world.client,
      guild,
      room: await getRoomById(room.id),
      requestId: request.id,
      accept: true,
      actorId: OWNER_ID,
      actorName: 'Owner',
    });
    expect(result.accepted).toBe(true);
    expect(member.voice.channelId).toBe(room.channelId);
    const after = await prisma.waitingRequest.findUnique({ where: { id: request.id } });
    expect(after.status).toBe('ACCEPTED');
    const permission = await prisma.roomPermission.findUnique({
      where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'USER', targetId: MEMBER2_ID } },
    });
    expect(permission.allowConnect).toBe(true);
  });

  it('rejects waiting room requests', async () => {
    const room = await makeRoom();
    await updateRoom({ guild, room, patch: { privacy: 'REQUEST' }, actorId: OWNER_ID, actorName: 'Owner' });
    const member = makeMember(guild, { id: MEMBER2_ID, username: 'Rejected', channelId: world.lobby.id });
    const requested = await requestRoomAccess({
      client: world.client,
      guild,
      room: await getRoomById(room.id),
      user: member.user,
    });
    const result = await resolveWaitingRequest({
      client: world.client,
      guild,
      room: await getRoomById(room.id),
      requestId: requested.request.id,
      accept: false,
      actorId: OWNER_ID,
      actorName: 'Owner',
    });
    expect(result.accepted).toBe(false);
    const after = await prisma.waitingRequest.findUnique({ where: { id: requested.request.id } });
    expect(after.status).toBe('REJECTED');
    expect(await prisma.roomPermission.count({ where: { roomId: room.id, targetId: MEMBER2_ID } })).toBe(0);
  });
});
