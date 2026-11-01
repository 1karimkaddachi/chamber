import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '@chamber/db';
import {
  createRoom,
  getRoomById,
  handleVoiceJoin,
} from '../src/services/roomService.js';
import { requestMerge, resolveMerge } from '../src/services/mergeService.js';
import { cancelRoomEvent, createRoomEvent, joinRoomEvent } from '../src/services/eventService.js';
import { generateSuggestions } from '../src/services/aiService.js';
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

const OWNER2_ID = '100000000000000007';
const MEMBER_ID = '100000000000000008';

let world;
let guild;
let owner;
let owner2;
let config;
let triggerRow;
let template;

beforeEach(async () => {
  await resetDatabase();
  config = await seedGuild();
  world = createFakeWorld();
  guild = world.guild;
  owner = makeMember(guild, { id: OWNER_ID, username: 'Alpha', channelId: world.trigger.id });
  owner2 = makeMember(guild, { id: OWNER2_ID, username: 'Bravo', channelId: world.trigger.id });
  triggerRow = await seedTrigger(GUILD_ID, world.trigger, world.category);
  template = await seedTemplate(GUILD_ID);
  await prisma.guildConfig.update({
    where: { guildId: GUILD_ID },
    data: { lobbyChannelId: world.lobby.id, defaultTemplateId: template.id },
  });
  setClient(world.client);
});

async function makeRoomFor(member, overrides = {}) {
  return createRoom({
    guild,
    ownerMember: member,
    trigger: triggerRow,
    config: await prisma.guildConfig.findUnique({ where: { guildId: GUILD_ID } }),
    ...overrides,
  });
}

describe('merging, events and AI', () => {
  it('merges two rooms after both owners approve and deletes the empty source', async () => {
    const source = await makeRoomFor(owner);
    const target = await makeRoomFor(owner2);
    const guest = makeMember(guild, {
      id: MEMBER_ID,
      username: 'Guest',
      channelId: source.channelId,
    });
    await handleVoiceJoin({ client: world.client, guild, room: await getRoomById(source.id), member: guest });

    const merge = await requestMerge({
      client: world.client,
      guild,
      requesterRoom: await getRoomById(source.id),
      targetRoomId: target.id,
      requester: owner.user,
    });
    expect(merge.status).toBe('PENDING');
    expect(guild.dms.some((dm) => dm.userId === OWNER2_ID)).toBe(true);

    const result = await resolveMerge({
      client: world.client,
      guild,
      mergeId: merge.id,
      userId: OWNER2_ID,
      accept: true,
    });
    expect(result.accepted).toBe(true);
    expect(result.moved).toBe(2);
    expect(guest.voice.channelId).toBe(target.channelId);
    expect(owner.voice.channelId).toBe(target.channelId);
    expect(await prisma.activeRoom.findUnique({ where: { id: source.id } })).toBeNull();
    expect(await prisma.activeRoom.findUnique({ where: { id: target.id } })).toBeTruthy();
    const mergedOwnerRow = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: target.id, userId: OWNER_ID } },
    });
    expect(mergedOwnerRow.role).toBe('ADMIN');
  });

  it('creates an event, enforces RSVP limits and cancels it', async () => {
    const room = await makeRoomFor(owner);
    const event = await createRoomEvent({
      client: world.client,
      guild,
      room: await getRoomById(room.id),
      creator: owner.user,
      input: {
        title: 'Tournament night',
        type: 'gaming',
        description: 'Bring your A-game',
        startsAt: new Date(Date.now() + 10 * 60_000),
        durationMinutes: 60,
        participantLimit: 1,
      },
      actorId: OWNER_ID,
      actorName: 'Alpha',
    });
    expect(event.discordEventId).toBeTruthy();
    expect(event.messageId).toBeTruthy();
    expect(guild.scheduledEvents.create).toHaveBeenCalled();

    const guest = makeMember(guild, { id: MEMBER_ID, username: 'Guest', channelId: world.lobby.id });
    await joinRoomEvent({ client: world.client, eventId: event.id, user: guest.user });
    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(1);

    const other = makeMember(guild, { id: '100000000000000009', username: 'Other', channelId: world.lobby.id });
    await expect(joinRoomEvent({ client: world.client, eventId: event.id, user: other.user })).rejects.toMatchObject({
      status: 409,
    });

    const cancelled = await cancelRoomEvent({
      client: world.client,
      event: await prisma.roomEvent.findUnique({ where: { id: event.id } }),
      actorId: OWNER_ID,
      actorName: 'Alpha',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(guild.scheduledEvents.delete).toHaveBeenCalled();
  });

  it('returns deterministic local AI suggestions without an external provider', async () => {
    const suggestion = await generateSuggestions({
      guildId: GUILD_ID,
      input: { purpose: 'ranked tournament for the weekend', expectedMembers: 6 },
    });
    expect(suggestion.source).toBe('local');
    expect(suggestion.suggestions.privacy).toBe('INVITE_ONLY');
    expect(suggestion.suggestions.userLimit).toBe(6);
    expect(suggestion.rationale.length).toBeGreaterThan(0);
    expect(await prisma.roomTemplate.count()).toBe(1);
  });
});
