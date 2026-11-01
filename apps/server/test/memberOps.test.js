import { beforeEach, describe, expect, it } from 'vitest';
import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import prisma from '@chamber/db';
import {
  allowMember,
  banMember,
  createRoom,
  demoteMember,
  inviteMember,
  promoteMember,
  revokeAccess,
  unbanMember,
} from '../src/services/roomService.js';
import { setClient } from '../src/lib/botState.js';
import {
  createFakeWorld,
  makeMember,
  resetDatabase,
  seedGuild,
  seedTrigger,
  GUILD_ID,
  OWNER_ID,
} from './helpers.js';

const MEMBER_ID = '100000000000000003';
const OUTSIDER_ID = '100000000000000004';

let world;
let guild;
let owner;
let triggerRow;
let config;

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
  setClient(world.client);
});

const makeRoom = () => createRoom({ guild, ownerMember: owner, trigger: triggerRow, config });

function memberOverwrite(channel, id) {
  return (channel.lastOverwrites ?? []).find((entry) => entry.id === id && entry.type === OverwriteType.Member);
}

async function permission(roomId, userId) {
  return prisma.roomPermission.findUnique({
    where: { roomId_targetType_targetId: { roomId, targetType: 'USER', targetId: userId } },
  });
}

describe('room member operations', () => {
  it('invites a member onto the allow-list, syncs overwrites and sends a DM', async () => {
    const room = await makeRoom();
    const channel = guild.channels.cache.get(room.channelId);
    const target = makeMember(guild, { id: MEMBER_ID, username: 'Invitee' });

    await inviteMember({ guild, room, targetMember: target, actorId: OWNER_ID, actorName: 'Room Owner' });

    const rule = await permission(room.id, MEMBER_ID);
    expect(rule.allowConnect).toBe(true);
    expect(memberOverwrite(channel, MEMBER_ID).allow).toContain(PermissionFlagsBits.Connect);
    expect(guild.dms).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'member.invited' } });
    expect(audit.targetId).toBe(MEMBER_ID);
  });

  it('allows and revokes access without messaging the member', async () => {
    const room = await makeRoom();
    const channel = guild.channels.cache.get(room.channelId);

    await allowMember({ guild, room, userId: OUTSIDER_ID, actorId: OWNER_ID, actorName: 'Room Owner' });
    expect((await permission(room.id, OUTSIDER_ID)).allowConnect).toBe(true);
    expect(guild.dms).toHaveLength(0);

    const revoked = await revokeAccess({ guild, room, userId: OUTSIDER_ID, actorId: OWNER_ID, actorName: 'Room Owner' });
    expect(revoked.disconnected).toBe(false);
    expect(await permission(room.id, OUTSIDER_ID)).toBeNull();
    expect(memberOverwrite(channel, OUTSIDER_ID)).toBeUndefined();
    expect(await prisma.auditLog.findFirst({ where: { action: 'member.access_revoked' } })).toBeTruthy();
  });

  it('refuses to revoke the owner', async () => {
    const room = await makeRoom();
    await expect(revokeAccess({ guild, room, userId: OWNER_ID, actorId: OWNER_ID })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('bans a connected member, blocks re-allowing them and clears the ban on unban', async () => {
    const room = await makeRoom();
    const target = makeMember(guild, { id: MEMBER_ID, username: 'Spammer', channelId: room.channelId });

    await banMember({
      guild,
      room,
      userId: MEMBER_ID,
      kind: 'BAN',
      reason: 'Spam',
      durationMinutes: 30,
      actorId: OWNER_ID,
      actorName: 'Room Owner',
    });

    expect(target.voice.channelId).toBeNull();
    const ban = await prisma.roomBan.findUnique({ where: { roomId_userId: { roomId: room.id, userId: MEMBER_ID } } });
    expect(ban.kind).toBe('BAN');
    expect(ban.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(memberOverwrite(guild.channels.cache.get(room.channelId), MEMBER_ID).deny).toContain(
      PermissionFlagsBits.Connect,
    );

    await expect(allowMember({ guild, room, userId: MEMBER_ID, actorId: OWNER_ID })).rejects.toMatchObject({
      status: 409,
    });

    await unbanMember({ guild, room, userId: MEMBER_ID, actorId: OWNER_ID, actorName: 'Room Owner' });
    expect(await prisma.roomBan.findUnique({ where: { roomId_userId: { roomId: room.id, userId: MEMBER_ID } } })).toBeNull();
    await allowMember({ guild, room, userId: MEMBER_ID, actorId: OWNER_ID });
    expect(await permission(room.id, MEMBER_ID)).toBeTruthy();
  });

  it('promotes a member to temporary admin and demotes them again', async () => {
    const room = await makeRoom();
    const channel = guild.channels.cache.get(room.channelId);
    makeMember(guild, { id: MEMBER_ID, username: 'Trusted', channelId: room.channelId });

    await promoteMember({ guild, room, userId: MEMBER_ID, durationMinutes: 30, actorId: OWNER_ID, actorName: 'Room Owner' });
    const admin = await prisma.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: MEMBER_ID } } });
    expect(admin.role).toBe('ADMIN');
    expect(admin.tempAdminUntil.getTime()).toBeGreaterThan(Date.now());
    expect(memberOverwrite(channel, MEMBER_ID).allow).toContain(PermissionFlagsBits.MoveMembers);

    await demoteMember({ guild, room, userId: MEMBER_ID, actorId: OWNER_ID, actorName: 'Room Owner' });
    const demoted = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: MEMBER_ID } },
    });
    expect(demoted.role).toBe('MEMBER');
    expect(demoted.tempAdminUntil).toBeNull();
    expect(memberOverwrite(channel, MEMBER_ID).allow).not.toContain(PermissionFlagsBits.MoveMembers);
  });

  it('refuses to promote the room owner', async () => {
    const room = await makeRoom();
    await expect(promoteMember({ guild, room, userId: OWNER_ID, actorId: OWNER_ID })).rejects.toMatchObject({
      status: 400,
    });
  });
});
