import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '@chamber/db';
import {
  cloneRoom,
  createRoom,
  deleteRoom,
  getRoomById,
  handleVoiceJoin,
  handleVoiceLeave,
  recoverActiveRooms,
  transferOwnership,
  updateRoom,
} from '../src/services/roomService.js';
import { verifyRoomPassword } from '../src/services/privacyService.js';
import { getAnalytics } from '../src/services/analyticsService.js';
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
import { ChannelType, MessageFlags, OverwriteType, PermissionFlagsBits } from 'discord.js';

const MEMBER_ID = '100000000000000003';

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
  owner = makeMember(guild, {
    id: OWNER_ID,
    username: 'Room Owner',
    globalName: 'Room Owner',
    channelId: world.trigger.id,
  });
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

function overwrite(channel, id, type = OverwriteType.Member) {
  return channel.lastOverwrites?.find((entry) => entry.id === id && entry.type === type);
}

describe('temporary room lifecycle', () => {
  it('creates a room, applies V2 panel, permissions and moves the owner', async () => {
    const room = await makeRoom();
    expect(room).toBeTruthy();
    const channel = guild.channels.cache.get(room.channelId);
    expect(channel).toBeTruthy();
    expect(channel.type).toBe(ChannelType.GuildVoice);
    expect(owner.voice.channelId).toBe(room.channelId);
    expect(room.controlMessageId).toBeTruthy();
    expect(channel.lastPayload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(channel.sent.length).toBeGreaterThan(0);

    const ownerOverwrite = overwrite(channel, OWNER_ID);
    expect(ownerOverwrite.allow).toContain(PermissionFlagsBits.Connect);
    const everyoneOverwrite = overwrite(channel, guild.roles.everyone.id, OverwriteType.Role);
    expect(everyoneOverwrite.allow).toContain(PermissionFlagsBits.Connect);
    const botOverwrite = overwrite(channel, world.client.user.id);
    expect(botOverwrite.allow).toContain(PermissionFlagsBits.ManageChannels);

    const dbRoom = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(dbRoom.ownerId).toBe(OWNER_ID);
    expect(dbRoom.privacy).toBe('PUBLIC');
    expect(dbRoom.name).toBe("Room Owner's test room");
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: OWNER_ID } },
    });
    expect(member.role).toBe('OWNER');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'room.created', guildId: GUILD_ID } });
    expect(audit).toBeTruthy();
    const analytics = await prisma.roomAnalytics.findFirst({ where: { guildId: GUILD_ID } });
    expect(analytics.roomsCreated).toBe(1);

    const updatedConfig = await prisma.guildConfig.findUnique({ where: { guildId: GUILD_ID } });
    expect(updatedConfig.lobbyPanelMessageId).toBeTruthy();
    expect(world.lobby.sent.length).toBeGreaterThan(0);
  });

  it('enforces per-user capacity limits', async () => {
    await prisma.guildConfig.update({ where: { guildId: GUILD_ID }, data: { maxRoomsPerUser: 1 } });
    await makeRoom();
    await expect(makeRoom()).rejects.toMatchObject({ code: 'ROOM_LIMIT_REACHED' });
    expect(await prisma.activeRoom.count({ where: { guildId: GUILD_ID } })).toBe(1);
  });

  it('prevents duplicate rooms during rapid creation attempts', async () => {
    await prisma.guildConfig.update({ where: { guildId: GUILD_ID }, data: { maxRoomsPerUser: 2 } });
    const results = await Promise.allSettled([makeRoom(), makeRoom()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.activeRoom.count({ where: { guildId: GUILD_ID } })).toBe(1);
  });

  it('locks, hides and applies privacy overwrites live', async () => {
    const room = await makeRoom();
    const { room: updated } = await updateRoom({
      guild,
      room,
      patch: { privacy: 'PRIVATE', locked: true },
      actorId: OWNER_ID,
      actorName: 'Room Owner',
    });
    expect(updated.privacy).toBe('PRIVATE');
    expect(updated.locked).toBe(true);
    const channel = guild.channels.cache.get(room.channelId);
    const everyone = overwrite(channel, guild.roles.everyone.id, OverwriteType.Role);
    expect(everyone.deny).toContain(PermissionFlagsBits.ViewChannel);
    expect(everyone.deny).toContain(PermissionFlagsBits.Connect);
    expect(overwrite(channel, OWNER_ID).allow).toContain(PermissionFlagsBits.Connect);

    const publicResult = await updateRoom({
      guild,
      room: await getRoomById(room.id),
      patch: { privacy: 'PUBLIC', locked: false },
      actorId: OWNER_ID,
      actorName: 'Room Owner',
    });
    expect(publicResult.room.privacy).toBe('PUBLIC');
    const openOverwrite = overwrite(channel, guild.roles.everyone.id, OverwriteType.Role);
    expect(openOverwrite.allow).toContain(PermissionFlagsBits.Connect);
    expect(openOverwrite.deny).not.toContain(PermissionFlagsBits.Connect);
  });

  it('tracks voice joins, transfers ownership and refreshes the panel', async () => {
    const room = await makeRoom();
    const member = makeMember(guild, {
      id: MEMBER_ID,
      username: 'Second Member',
      globalName: 'Second Member',
      channelId: room.channelId,
    });
    await handleVoiceJoin({ client: world.client, guild, room: await getRoomById(room.id), member });

    const joined = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: MEMBER_ID } },
    });
    expect(joined.role).toBe('MEMBER');
    const afterJoin = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(afterJoin.totalJoins).toBe(2);
    expect(afterJoin.peakMembers).toBe(2);

    await transferOwnership({
      guild,
      room: await getRoomById(room.id),
      targetUserId: MEMBER_ID,
      actorId: OWNER_ID,
      actorName: 'Room Owner',
    });
    const afterTransfer = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(afterTransfer.ownerId).toBe(MEMBER_ID);
    const oldOwnerRow = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: OWNER_ID } },
    });
    expect(oldOwnerRow.role).toBe('MEMBER');
    const newOwnerRow = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: MEMBER_ID } },
    });
    expect(newOwnerRow.role).toBe('OWNER');
    expect(guild.dms.some((dm) => dm.userId === MEMBER_ID)).toBe(true);
    const channel = guild.channels.cache.get(room.channelId);
    expect(overwrite(channel, MEMBER_ID).allow).toContain(PermissionFlagsBits.Connect);
  });

  it('removes members and records the empty session on leave', async () => {
    const room = await makeRoom();
    const member = makeMember(guild, {
      id: MEMBER_ID,
      username: 'Leaver',
      channelId: room.channelId,
    });
    await handleVoiceJoin({ client: world.client, guild, room: await getRoomById(room.id), member });
    member.voice.channelId = null;
    guild.channels.cache.get(room.channelId)?.members.delete(MEMBER_ID);
    await handleVoiceLeave({ client: world.client, guild, room: await getRoomById(room.id), member });
    const row = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: MEMBER_ID } },
    });
    expect(row).toBeNull();
  });

  it('clones rooms with allow-list and bans', async () => {
    const room = await makeRoom();
    await prisma.roomPermission.create({
      data: { roomId: room.id, targetType: 'USER', targetId: MEMBER_ID, allowConnect: true, createdBy: OWNER_ID },
    });
    await prisma.roomBan.create({
      data: { roomId: room.id, userId: '100000000000000009', moderatorId: OWNER_ID, kind: 'BAN' },
    });
    const clone = await cloneRoom({
      guild,
      room: await getRoomById(room.id),
      ownerMember: owner,
      config: await prisma.guildConfig.findUnique({ where: { guildId: GUILD_ID } }),
      actorId: OWNER_ID,
      actorName: 'Room Owner',
    });
    expect(clone.id).not.toBe(room.id);
    expect(clone.channelId).not.toBe(room.channelId);
    expect(await prisma.roomPermission.count({ where: { roomId: clone.id } })).toBe(1);
    expect(await prisma.roomBan.count({ where: { roomId: clone.id } })).toBe(1);
    expect(await prisma.activeRoom.count({ where: { guildId: GUILD_ID } })).toBe(2);
  });

  it('deletes the Discord channel and closes the room history', async () => {
    const room = await makeRoom();
    const channel = guild.channels.cache.get(room.channelId);
    await deleteRoom({ guild, room: await getRoomById(room.id), actorId: OWNER_ID, actorName: 'Room Owner' });
    expect(await prisma.activeRoom.findUnique({ where: { id: room.id } })).toBeNull();
    expect(channel.delete).toHaveBeenCalled();
    expect(guild.channels.cache.has(room.channelId)).toBe(false);
    const history = await prisma.roomHistory.findFirst({ where: { guildId: GUILD_ID } });
    expect(history).toBeTruthy();
    expect(history.endReason).toBe('Room deleted');
    expect(owner.voice.channelId).toBeNull();

    const analytics = await getAnalytics(GUILD_ID, '30d');
    expect(analytics.totals.completedRooms).toBe(1);
    expect(analytics.totals.roomsDeleted).toBe(1);
    expect(analytics.topOwners).toHaveLength(1);
    expect(analytics.topOwners[0].id).toBe(OWNER_ID);
    expect(analytics.recentHistory).toHaveLength(1);
  });

  it('verifies passwords and enforces lockouts', async () => {
    const room = await makeRoom();
    await updateRoom({
      guild,
      room,
      patch: { privacy: 'PASSWORD', password: 'super-secret' },
      actorId: OWNER_ID,
      actorName: 'Room Owner',
    });
    let fresh = await getRoomById(room.id);
    expect(fresh.privacy).toBe('PASSWORD');
    expect(fresh.passwordHash).toMatch(/^\$2[aby]\$/);

    const wrong = await verifyRoomPassword({
      client: world.client,
      guild,
      room: fresh,
      user: { id: MEMBER_ID, username: 'Second Member' },
      password: 'nope',
    });
    expect(wrong.ok).toBe(false);
    const right = await verifyRoomPassword({
      client: world.client,
      guild,
      room: fresh,
      user: { id: MEMBER_ID, username: 'Second Member' },
      password: 'super-secret',
    });
    expect(right.ok).toBe(true);
    const permission = await prisma.roomPermission.findUnique({
      where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'USER', targetId: MEMBER_ID } },
    });
    expect(permission.allowConnect).toBe(true);

    await prisma.guildConfig.update({
      where: { guildId: GUILD_ID },
      data: { passwordMaxAttempts: 2, passwordLockoutMinutes: 5 },
    });
    fresh = await getRoomById(room.id);
    const other = { id: '100000000000000004', username: 'Locked User' };
    await verifyRoomPassword({ client: world.client, guild, room: fresh, user: other, password: 'bad' });
    const locked = await verifyRoomPassword({ client: world.client, guild, room: fresh, user: other, password: 'bad' });
    expect(locked.locked).toBe(true);
    await expect(
      verifyRoomPassword({ client: world.client, guild, room: fresh, user: other, password: 'bad' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('recovers rooms after a restart and closes orphaned records', async () => {
    const room = await makeRoom();
    const summary = await recoverActiveRooms(world.client);
    expect(summary.restored).toBe(1);
    expect(summary.closed).toBe(0);
    expect(await prisma.activeRoom.count({ where: { guildId: GUILD_ID } })).toBe(1);

    guild.channels.cache.delete(room.channelId);
    await recoverActiveRooms(world.client);
    expect(await prisma.activeRoom.findUnique({ where: { id: room.id } })).toBeNull();
    const history = await prisma.roomHistory.findFirst({ where: { roomId: room.id } });
    expect(history.endReason).toBe('channel_missing');
  });
});
