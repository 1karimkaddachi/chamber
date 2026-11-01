import { vi } from 'vitest';
import { ChannelType, Collection, PermissionsBitField } from 'discord.js';
import prisma from '@chamber/db';

export const GUILD_ID = '900000000000000001';
export const OWNER_ID = '100000000000000001';
export const BOT_ID = '200000000000000001';
export const GUILD_ADMIN_ID = '100000000000000002';

let sequence = 1000;
function nextId() {
  return String(300000000000000000n + BigInt((sequence += 1)));
}

const TABLES = [
  'event_participants',
  'room_events',
  'merge_requests',
  'waiting_requests',
  'queue_entries',
  'password_attempts',
  'room_invitations',
  'room_bans',
  'room_permissions',
  'room_members',
  'room_history',
  'active_rooms',
  'reservations',
  'room_analytics',
  'audit_logs',
  'dashboard_preferences',
  'trigger_channels',
  'voice_categories',
  'room_templates',
  'room_types',
  'guild_configs',
  'guilds',
  'users',
];

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export function makeChannel(guild, { id = nextId(), name = 'channel', type = ChannelType.GuildVoice, parentId = null } = {}) {
  const messages = new Map();
  const sent = [];
  const channel = {
    id,
    name,
    type,
    parentId,
    guild,
    userLimit: 0,
    bitrate: 64000,
    members: new Collection(),
    sent,
    lastOverwrites: null,
    isTextBased: () => true,
    permissionOverwrites: {
      set: vi.fn(async (overwrites) => {
        channel.lastOverwrites = overwrites;
        return overwrites;
      }),
    },
    edit: vi.fn(async (options) => {
      if (options.name) channel.name = options.name;
      if (options.topic !== undefined) channel.topic = options.topic;
      if (options.userLimit !== undefined) channel.userLimit = options.userLimit;
      if (options.bitrate !== undefined) channel.bitrate = options.bitrate;
      if (options.parent !== undefined) channel.parentId = options.parent;
      return channel;
    }),
    setRTCRegion: vi.fn(async () => channel),
    delete: vi.fn(async () => {
      guild.channels.cache.delete(channel.id);
    }),
    send: vi.fn(async (payload) => {
      const message = {
        id: `msg-${nextId()}`,
        channelId: channel.id,
        channel,
        payload,
        edit: vi.fn(async (next) => {
          message.payload = next;
          return message;
        }),
        delete: vi.fn(async () => {
          messages.delete(message.id);
        }),
      };
      messages.set(message.id, message);
      channel.lastPayload = payload;
      sent.push(payload);
      return message;
    }),
    messages: {
      fetch: vi.fn(async (messageId) => messages.get(messageId) ?? null),
    },
    sentMessages: messages,
  };
  guild.channels.cache.set(channel.id, channel);
  return channel;
}

export function makeMember(guild, { id, username = 'Member', channelId = null, globalName = null, admin = false } = {}) {
  const user = {
    id,
    username,
    globalName: globalName ?? username,
    avatar: null,
    bot: false,
    send: vi.fn(async (payload) => {
      guild.dms.push({ userId: id, payload });
      return { id: `dm-${nextId()}` };
    }),
  };
  const permissions = new PermissionsBitField();
  if (admin) permissions.add(PermissionsBitField.Flags.Administrator);
  const member = {
    id,
    user,
    displayName: globalName ?? username,
    guild,
    roles: { cache: new Collection() },
    permissions,
    voice: {
      channelId: null,
      joinedTimestamp: Date.now(),
      setChannel: vi.fn(async (target) => {
        const resolved = typeof target === 'string' ? guild.channels.cache.get(target) : target;
        const previous = guild.channels.cache.get(member.voice.channelId);
        previous?.members.delete(member.id);
        if (resolved) {
          member.voice.channelId = resolved.id;
          member.voice.joinedTimestamp = Date.now();
          resolved.members.set(member.id, member);
        } else {
          member.voice.channelId = null;
        }
        return member;
      }),
      setMute: vi.fn(async () => member),
      setDeaf: vi.fn(async () => member),
    },
  };
  member.send = vi.fn(async (payload) => {
    guild.dms.push({ userId: id, payload });
    return { id: `dm-${nextId()}` };
  });
  guild.members.cache.set(id, member);
  if (channelId) {
    const channel = guild.channels.cache.get(channelId);
    member.voice.channelId = channelId;
    channel?.members.set(id, member);
  }
  return member;
}

export function createFakeWorld({ guildId = GUILD_ID, ownerId = OWNER_ID } = {}) {
  const channels = new Collection();
  const members = new Collection();
  const guild = {
    id: guildId,
    name: 'Test Chamber',
    ownerId,
    premiumTier: 0,
    maximumBitrate: 96000,
    memberCount: 0,
    dms: [],
    iconURL: () => null,
    roles: {
      everyone: { id: guildId, name: '@everyone', position: 0 },
      cache: new Collection([[guildId, { id: guildId, name: '@everyone', position: 0 }]]),
    },
    channels: {
      cache: channels,
      fetch: vi.fn(async (channelId) => channels.get(channelId) ?? null),
      create: vi.fn(async (options) => {
        const channel = makeChannel(guild, {
          id: nextId(),
          name: options.name,
          type: options.type ?? ChannelType.GuildVoice,
          parentId: options.parent ?? null,
        });
        channel.userLimit = options.userLimit ?? 0;
        channel.bitrate = options.bitrate ?? 64000;
        return channel;
      }),
    },
    members: {
      cache: members,
      fetch: vi.fn(async (userId) => members.get(userId) ?? null),
    },
    scheduledEvents: {
      create: vi.fn(async () => ({ id: `scheduled-${nextId()}` })),
      delete: vi.fn(async () => true),
    },
  };

  const client = {
    user: { id: BOT_ID, tag: 'Chamber#0001', username: 'Chamber', bot: true },
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: vi.fn(async () => guild),
    },
    users: {
      fetch: vi.fn(async (userId) => {
        const member = guild.members.cache.get(userId);
        if (member) return member.user;
        return {
          id: userId,
          username: userId,
          globalName: userId,
          bot: false,
          send: vi.fn(async (payload) => {
            guild.dms.push({ userId, payload });
            return { id: `dm-${nextId()}` };
          }),
        };
      }),
    },
  };
  guild.client = client;

  const category = makeChannel(guild, { name: 'Voice', type: ChannelType.GuildCategory });
  const trigger = makeChannel(guild, { name: 'Join to create', parentId: category.id });
  const lobby = makeChannel(guild, { name: 'lobby', type: ChannelType.GuildText });

  return { guild, client, category, trigger, lobby };
}

export async function seedGuild({ guildId = GUILD_ID, ownerId = OWNER_ID } = {}) {
  await prisma.user.upsert({
    where: { id: ownerId },
    create: { id: ownerId, username: 'Test Operator' },
    update: {},
  });
  await prisma.guild.create({
    data: {
      id: guildId,
      name: 'Test Chamber',
      ownerId,
      botPresent: false,
    },
  });
  return prisma.guildConfig.create({
    data: {
      guildId,
      setupCompleted: true,
      autoCleanup: true,
      emptyGraceSeconds: 10,
      maxRoomsPerUser: 2,
      maxRoomsPerGuild: 20,
      queueEnabled: true,
      waitingRoomEnabled: true,
      reservationsEnabled: true,
      eventsEnabled: true,
      mergingEnabled: true,
      cloningEnabled: true,
      passwordEnabled: true,
    },
  });
}

export async function seedTrigger(guildId, trigger, category, options = {}) {
  return prisma.triggerChannel.create({
    data: {
      guildId,
      channelId: trigger.id,
      name: trigger.name,
      categoryId: category.id,
      ...options,
    },
  });
}

export async function seedTemplate(guildId, overrides = {}) {
  return prisma.roomTemplate.create({
    data: {
      guildId,
      name: 'Test Template',
      slug: `test-${nextId()}`,
      emoji: '🧪',
      accentColor: '#7c6cff',
      roomTypeKey: 'gaming',
      defaultPrivacy: 'PUBLIC',
      defaultLimit: 0,
      defaultBitrate: 96000,
      roomNameRule: "{user}'s test room",
      allowedRoleIds: [],
      ...overrides,
    },
  });
}

export { prisma, nextId };
