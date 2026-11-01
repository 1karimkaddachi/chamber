import { ChannelType } from 'discord.js';
import bcrypt from 'bcryptjs';
import prisma from '@chamber/db';
import { formatRoomName, clamp, ROOM_LIMITS } from '@chamber/shared';
import { getClient } from '../lib/botState.js';
import { publish } from '../lib/events.js';
import { logger } from '../logger.js';
import {
  displayName,
  fetchChannelById,
  fetchMemberById,
  isVoiceChannel,
  safeJson,
  sanitizeRoomName,
} from '../lib/discord.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { cv2Payload, editCv2, sendCv2 } from '../lib/ui.js';
import { noticePanel, lobbyPanel, controlPanel } from '../bot/panels.js';
import { ensureConfig } from './guildService.js';
import { buildOverwrites } from './permissions.js';
import { getTemplate } from './templateService.js';
import { getRoomType } from './roomTypeService.js';
import { writeAudit } from './auditService.js';
import {
  recordParticipants,
  recordRoomCreated,
  recordRoomDeleted,
  recordRoomSession,
} from './analyticsService.js';

const ROOM_INCLUDE = {
  members: { orderBy: { joinedAt: 'asc' } },
  permissions: true,
  bans: true,
  template: true,
  owner: { select: { id: true, username: true, globalName: true, avatar: true } },
};

const creationLocks = new Map();
const emptyTimers = new Map();
const panelTimers = new Map();
const lobbyTimers = new Map();

function guildBitrateCap(guild) {
  const tier = Number(guild?.premiumTier ?? 0);
  const fallback = tier >= 3 ? 384000 : tier === 2 ? 256000 : tier === 1 ? 128000 : 96000;
  return Math.min(Number(guild?.maximumBitrate) || fallback, ROOM_LIMITS.bitrateMax);
}

function clampBitrate(value, guild) {
  return clamp(value ?? 64000, ROOM_LIMITS.bitrateMin, guildBitrateCap(guild));
}

function activeBans(room, now = Date.now()) {
  return (room.bans ?? []).filter((ban) => !ban.expiresAt || new Date(ban.expiresAt).getTime() > now);
}

// Callers often hold a room object loaded before a ban was written, so the ban
// that gates re-entry is read from the database rather than from that snapshot.
async function isBannedFromRoom(roomId, userId) {
  const ban = await prisma.roomBan.findFirst({ where: { roomId, userId } });
  return Boolean(ban && (!ban.expiresAt || ban.expiresAt.getTime() > Date.now()));
}

export async function ensureUserRecord(user) {
  if (!user?.id) return null;
  try {
    return await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        username: user.username ?? null,
        globalName: user.globalName ?? null,
        avatar: user.avatar ?? null,
      },
      update: {
        username: user.username ?? null,
        globalName: user.globalName ?? null,
        avatar: user.avatar ?? null,
      },
    });
  } catch {
    return null;
  }
}

export async function getRoomById(roomId) {
  if (!roomId) return null;
  return prisma.activeRoom.findUnique({ where: { id: roomId }, include: ROOM_INCLUDE });
}

export async function getRoomByChannel(channelId) {
  if (!channelId) return null;
  return prisma.activeRoom.findUnique({ where: { channelId }, include: ROOM_INCLUDE });
}

export async function listActiveRooms(guildId, { search = '', type = '' } = {}) {
  const where = { guildId, status: 'ACTIVE' };
  if (search) where.name = { contains: search, mode: 'insensitive' };
  if (type) where.roomTypeKey = type;
  const rooms = await prisma.activeRoom.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      ...ROOM_INCLUDE,
      _count: {
        select: {
          members: true,
          queueEntries: { where: { status: 'WAITING' } },
          waitingRequests: { where: { status: 'PENDING' } },
        },
      },
    },
  });
  return rooms.map(toPublicRoom);
}

export function toPublicRoom(room) {
  if (!room) return null;
  const memberCount = room._count?.members ?? room.members?.length ?? 0;
  return {
    id: room.id,
    guildId: room.guildId,
    channelId: room.channelId,
    ownerId: room.ownerId,
    ownerName: room.owner?.globalName || room.owner?.username || room.ownerId,
    name: room.name,
    topic: room.topic,
    emoji: room.emoji,
    description: room.description,
    bannerUrl: room.bannerUrl,
    theme: room.theme,
    privacy: room.privacy,
    locked: room.locked,
    hidden: room.hidden,
    userLimit: room.userLimit,
    bitrate: room.bitrate,
    rtcRegion: room.rtcRegion,
    status: room.status,
    templateId: room.templateId,
    templateName: room.template?.name ?? null,
    templateEmoji: room.template?.emoji ?? null,
    roomTypeKey: room.roomTypeKey,
    parentCategoryId: room.parentCategoryId,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
    expiresAt: room.expiresAt,
    peakMembers: room.peakMembers,
    totalJoins: room.totalJoins,
    controlChannelId: room.controlChannelId,
    controlMessageId: room.controlMessageId,
    settings: room.settings ?? {},
    memberCount,
    queueCount: room._count?.queueEntries ?? 0,
    waitingCount: room._count?.waitingRequests ?? 0,
    members: (room.members ?? []).map((member) => ({
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      tempAdminUntil: member.tempAdminUntil,
    })),
  };
}

async function resolveCategory(guild, config, trigger, explicitCategoryId) {
  const candidates = [
    explicitCategoryId,
    trigger?.categoryId,
    config?.defaultCategoryId,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const channel = await fetchChannelById(guild, candidate);
    if (channel?.type === ChannelType.GuildCategory) return channel;
  }
  if (trigger?.channelId) {
    const triggerChannel = await fetchChannelById(guild, trigger.channelId);
    if (triggerChannel?.parentId) {
      const parent = await fetchChannelById(guild, triggerChannel.parentId);
      if (parent?.type === ChannelType.GuildCategory) return parent;
    }
  }
  return null;
}

async function resolveSetup(guildId, { config, trigger, template, roomType, privacy, userLimit, bitrate }) {
  let resolvedTemplate = template ?? null;
  if (!resolvedTemplate && trigger?.templateId) {
    resolvedTemplate = await getTemplate(guildId, trigger.templateId);
  }
  if (!resolvedTemplate && config.defaultTemplateId) {
    resolvedTemplate = await getTemplate(guildId, config.defaultTemplateId);
  }
  if (!resolvedTemplate) {
    resolvedTemplate = await prisma.roomTemplate.findFirst({
      where: { guildId: null, isBuiltin: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  let resolvedType = roomType ?? null;
  const typeKey = resolvedType?.key || trigger?.roomTypeKey || resolvedTemplate?.roomTypeKey || null;
  if (!resolvedType && typeKey) resolvedType = await getRoomType(guildId, typeKey);

  const resolvedPrivacy = privacy || resolvedTemplate?.defaultPrivacy || resolvedType?.defaultPrivacy || config.defaultPrivacy;
  const resolvedLimit = userLimit ?? resolvedTemplate?.defaultLimit ?? resolvedType?.defaultLimit ?? config.defaultUserLimit;
  const resolvedBitrate = bitrate ?? resolvedTemplate?.defaultBitrate ?? config.defaultBitrate;

  return {
    template: resolvedTemplate,
    roomType: resolvedType,
    privacy: resolvedPrivacy,
    userLimit: clamp(resolvedLimit, 0, ROOM_LIMITS.userLimitMax),
    bitrate: resolvedBitrate,
  };
}

async function assertCapacity(guildId, ownerId, config, categoryChannel) {
  const [owned, total] = await Promise.all([
    prisma.activeRoom.count({ where: { guildId, ownerId, status: 'ACTIVE' } }),
    prisma.activeRoom.count({ where: { guildId, status: 'ACTIVE' } }),
  ]);
  if (owned >= config.maxRoomsPerUser) {
    throw new AppError(
      `You already own ${owned} temporary ${owned === 1 ? 'room' : 'rooms'} (limit ${config.maxRoomsPerUser}).`,
      { status: 409, code: 'ROOM_LIMIT_REACHED' },
    );
  }
  if (total >= config.maxRoomsPerGuild) {
    throw new AppError('The server has reached its temporary room limit. Try again later.', {
      status: 409,
      code: 'GUILD_ROOM_LIMIT',
    });
  }
  if (categoryChannel) {
    const categorySettings = await prisma.voiceCategory.findFirst({
      where: { guildId, categoryId: categoryChannel.id },
    });
    if (categorySettings?.maxRooms > 0) {
      const inCategory = await prisma.activeRoom.count({
        where: { guildId, parentCategoryId: categoryChannel.id, status: 'ACTIVE' },
      });
      if (inCategory >= categorySettings.maxRooms) {
        throw new AppError('This voice category is full. Try another category.', {
          status: 409,
          code: 'CATEGORY_FULL',
        });
      }
    }
  }
}

export async function createRoom({
  guild,
  ownerMember,
  trigger = null,
  config = null,
  template = null,
  roomType = null,
  privacy = null,
  userLimit = null,
  bitrate = null,
  name = null,
  categoryId = null,
  settings = {},
  reason = 'Chamber temporary room created',
  createdBy = null,
  skipOwnershipLimit = false,
}) {
  const guildId = guild.id;
  const ownerUser = ownerMember.user ?? ownerMember;
  const lockKey = `${guildId}:${ownerUser.id}`;
  const existingLock = creationLocks.get(lockKey);
  if (existingLock && Date.now() < existingLock) {
    throw new ConflictError('A room for this member is already being created.');
  }
  creationLocks.set(lockKey, Date.now() + 15000);

  try {
    const resolvedConfig = config ?? (await ensureConfig(guildId));
    if (!resolvedConfig.enabled) {
      throw new AppError('Temporary voice is disabled on this server.', { status: 403, code: 'DISABLED' });
    }
    const setup = await resolveSetup(guildId, {
      config: resolvedConfig,
      trigger,
      template,
      roomType,
      privacy,
      userLimit,
      bitrate,
    });

    const categoryChannel = await resolveCategory(guild, resolvedConfig, trigger, categoryId);
    if (!skipOwnershipLimit) {
      await assertCapacity(guildId, ownerUser.id, resolvedConfig, categoryChannel);
    }

    const finalPrivacy = setup.privacy;
    const pendingPassword = finalPrivacy === 'PASSWORD';
    const effectivePrivacy = pendingPassword ? 'PRIVATE' : finalPrivacy;
    const typeLabel = setup.roomType?.name || 'Room';
    const roomName = sanitizeRoomName(
      name ||
        formatRoomName(setup.template?.roomNameRule || resolvedConfig.roomNameTemplate, {
          username: displayName(ownerMember),
          typeName: typeLabel,
          emoji: setup.template?.emoji,
        }),
    );
    if (!roomName) throw new AppError('The room name is empty.');

    await ensureUserRecord(ownerUser);
    const expiresAt =
      resolvedConfig.roomLifetimeMinutes > 0
        ? new Date(Date.now() + resolvedConfig.roomLifetimeMinutes * 60000)
        : null;

    const initialRoom = {
      ownerId: ownerUser.id,
      privacy: effectivePrivacy,
      locked: false,
      hidden: false,
      members: [],
      permissions: [],
      bans: [],
    };
    const botId = guild.client?.user?.id;
    const initialOverwrites = buildOverwrites(initialRoom, {
      everyoneRoleId: guild.roles.everyone.id,
      botId,
    });

    let channel;
    try {
      channel = await guild.channels.create({
        name: roomName,
        type: ChannelType.GuildVoice,
        parent: categoryChannel?.id ?? null,
        userLimit: setup.userLimit,
        bitrate: clampBitrate(setup.bitrate, guild),
        reason,
        permissionOverwrites: initialOverwrites,
      });
    } catch (error) {
      if (categoryChannel) {
        channel = await guild.channels.create({
          name: roomName,
          type: ChannelType.GuildVoice,
          userLimit: setup.userLimit,
          bitrate: clampBitrate(setup.bitrate, guild),
          reason,
          permissionOverwrites: initialOverwrites,
        });
      } else {
        throw error;
      }
    }

    let room;
    try {
      room = await prisma.$transaction(async (tx) => {
        const created = await tx.activeRoom.create({
          data: {
            guildId,
            channelId: channel.id,
            ownerId: ownerUser.id,
            templateId: setup.template?.id ?? null,
            roomTypeKey: setup.roomType?.key ?? setup.template?.roomTypeKey ?? null,
            parentCategoryId: channel.parentId ?? categoryChannel?.id ?? null,
            name: roomName,
            topic: null,
            emoji: setup.template?.emoji ?? setup.roomType?.emoji ?? null,
            theme: setup.template?.accentColor ?? null,
            privacy: effectivePrivacy,
            userLimit: setup.userLimit,
            bitrate: clampBitrate(setup.bitrate, guild),
            status: 'ACTIVE',
            settings: { ...settings, passwordPending: pendingPassword },
            totalJoins: 1,
            peakMembers: 1,
            expiresAt,
          },
        });
        await tx.roomMember.create({
          data: { roomId: created.id, userId: ownerUser.id, role: 'OWNER' },
        });
        return tx.activeRoom.findUnique({ where: { id: created.id }, include: ROOM_INCLUDE });
      });
    } catch (error) {
      await channel.delete('Chamber: database creation failed').catch(() => null);
      throw error;
    }

    if (ownerMember.voice?.channelId && ownerMember.voice.channelId !== channel.id) {
      await ownerMember.voice.setChannel(channel, 'Chamber: join to create').catch((error) => {
        logger.warn({ err: error, roomId: room.id }, 'Failed to move owner into new room');
      });
    }

    const configNow = resolvedConfig;
    await postControlPanel(guild, room, configNow);
    await applyPermissions(guild, room.id);
    await refreshLobby(guild.client, guildId);
    await writeAudit({
      guildId,
      actorId: createdBy ?? ownerUser.id,
      actorName: displayName(ownerMember),
      action: 'room.created',
      category: 'ROOM',
      targetType: 'room',
      targetId: room.id,
      metadata: { channelId: channel.id, name: room.name, privacy: room.privacy, template: setup.template?.name ?? null },
    });
    recordRoomCreated(guildId).catch(() => null);
    publish('room.created', { guildId, room: toPublicRoom(room) });
    logger.info({ guildId, roomId: room.id, channelId: channel.id }, 'Temporary room created');
    return getRoomById(room.id);
  } finally {
    creationLocks.delete(lockKey);
  }
}

export async function buildRoomContext(guild, room) {
  const channel = await fetchChannelById(guild, room.channelId);
  const liveIds = channel ? [...channel.members.keys()].filter((id) => !channel.members.get(id)?.user?.bot) : [];
  const roleByUser = new Map((room.members ?? []).map((member) => [member.userId, member]));
  const liveMembers = liveIds.map((userId) => {
    const row = roleByUser.get(userId);
    return {
      userId,
      name: channel?.members.get(userId)?.displayName ?? null,
      role: row?.role ?? 'MEMBER',
      tempAdminUntil: row?.tempAdminUntil ?? null,
    };
  });
  const [queueCount, waitingCount] = await Promise.all([
    prisma.queueEntry.count({ where: { roomId: room.id, status: 'WAITING' } }),
    prisma.waitingRequest.count({ where: { roomId: room.id, status: 'PENDING' } }),
  ]);
  let typeName = null;
  if (room.roomTypeKey) {
    const type = await getRoomType(room.guildId, room.roomTypeKey);
    typeName = type?.name ?? null;
  }
  return {
    channel,
    liveMembers,
    liveCount: liveMembers.length,
    queueCount,
    waitingCount,
    typeName,
    templateName: room.template?.name ?? null,
    ownerName: room.owner?.globalName || room.owner?.username || null,
  };
}

export async function postControlPanel(guild, room, config = null) {
  const resolvedConfig = config ?? (await ensureConfig(room.guildId));
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel) return null;
  const context = await buildRoomContext(guild, room);
  const components = controlPanel(room, {
    liveMembers: context.liveMembers,
    queueCount: context.queueCount,
    waitingCount: context.waitingCount,
    typeName: context.typeName,
    templateName: context.templateName,
    ownerName: context.ownerName,
  });

  let target = channel;
  let message = null;
  if (room.controlMessageId && room.controlChannelId) {
    const controlChannel = await fetchChannelById(guild, room.controlChannelId);
    if (controlChannel?.isTextBased?.()) {
      message = await controlChannel.messages.fetch(room.controlMessageId).catch(() => null);
      if (message) target = controlChannel;
    }
  }
  if (message) {
    await editCv2(message, components);
  } else {
    try {
      message = await sendCv2(target, components);
    } catch (error) {
      logger.debug({ err: error, roomId: room.id }, 'Sending panel to voice text chat failed, trying lobby');
      if (resolvedConfig.lobbyChannelId) {
        const lobby = await fetchChannelById(guild, resolvedConfig.lobbyChannelId);
        if (lobby?.isTextBased?.()) message = await sendCv2(lobby, components);
      }
    }
  }
  if (message) {
    await prisma.activeRoom.update({
      where: { id: room.id },
      data: { controlMessageId: message.id, controlChannelId: message.channelId },
    });
  }
  return message;
}

export async function refreshPanel(client, roomOrId) {
  const clientRef = client ?? getClient();
  if (!clientRef) return null;
  const room = typeof roomOrId === 'string' ? await getRoomById(roomOrId) : roomOrId;
  if (!room) return null;
  const guild = clientRef.guilds.cache.get(room.guildId);
  if (!guild) return null;
  const config = await ensureConfig(room.guildId);
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel) return null;
  const context = await buildRoomContext(guild, room);
  const components = controlPanel(room, {
    liveMembers: context.liveMembers,
    queueCount: context.queueCount,
    waitingCount: context.waitingCount,
    typeName: context.typeName,
    templateName: context.templateName,
    ownerName: context.ownerName,
  });
  if (room.controlMessageId) {
    const controlChannel = await fetchChannelById(guild, room.controlChannelId ?? room.channelId);
    if (controlChannel?.isTextBased?.()) {
      const message = await controlChannel.messages.fetch(room.controlMessageId).catch(() => null);
      if (message) {
        await editCv2(message, components).catch((error) => logger.debug({ err: error }, 'Panel edit failed'));
        return message;
      }
    }
  }
  return postControlPanel(guild, room, config);
}

export function schedulePanelRefresh(client, roomId) {
  const existing = panelTimers.get(roomId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    panelTimers.delete(roomId);
    refreshPanel(client, roomId).catch((error) => logger.debug({ err: error, roomId }, 'Debounced panel refresh failed'));
  }, 800);
  timer.unref?.();
  panelTimers.set(roomId, timer);
}

export async function refreshLobby(client, guildId) {
  const clientRef = client ?? getClient();
  if (!clientRef) return null;
  const config = await ensureConfig(guildId);
  const channelId = config.waitingRoomChannelId || config.lobbyChannelId;
  if (!channelId) return null;
  const guild = clientRef.guilds.cache.get(guildId);
  if (!guild) return null;
  const channel = await fetchChannelById(guild, channelId);
  if (!channel?.isTextBased?.()) return null;

  const rooms = await prisma.activeRoom.findMany({
    where: {
      guildId,
      status: 'ACTIVE',
      hidden: false,
      privacy: { in: ['PUBLIC', 'REQUEST', 'ROLE_RESTRICTED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      owner: { select: { username: true, globalName: true } },
      _count: { select: { members: true } },
    },
  });
  const publicRooms = rooms.map((room) => ({
    ...toPublicRoom(room),
    memberCount: room._count.members,
    ownerName: room.owner?.globalName || room.owner?.username || room.ownerId,
  }));
  const components = lobbyPanel(publicRooms, { guildName: guild.name });

  let message = null;
  if (config.lobbyPanelMessageId) {
    message = await channel.messages.fetch(config.lobbyPanelMessageId).catch(() => null);
  }
  if (message) {
    await editCv2(message, components).catch(() => null);
  } else {
    message = await sendCv2(channel, components).catch((error) => {
      logger.debug({ err: error, guildId }, 'Lobby panel send failed');
      return null;
    });
  }
  if (message) {
    await prisma.guildConfig.update({
      where: { guildId },
      data: { lobbyPanelMessageId: message.id },
    });
  }
  return message;
}

export function scheduleLobbyRefresh(client, guildId) {
  const existing = lobbyTimers.get(guildId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    lobbyTimers.delete(guildId);
    refreshLobby(client, guildId).catch(() => null);
  }, 1200);
  timer.unref?.();
  lobbyTimers.set(guildId, timer);
}

export async function applyPermissions(guild, roomOrId) {
  const room = typeof roomOrId === 'string' ? await getRoomById(roomOrId) : roomOrId;
  if (!room) return;
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel) return;
  const keepMemberIds = channel.members ? [...channel.members.keys()].filter((id) => !channel.members.get(id)?.user?.bot) : [];
  const overwrites = buildOverwrites(room, {
    everyoneRoleId: guild.roles.everyone.id,
    botId: guild.client?.user?.id,
    keepMemberIds,
  });
  await channel.permissionOverwrites.set(overwrites, 'Chamber: privacy and room permissions').catch((error) => {
    logger.warn({ err: error, roomId: room.id }, 'Failed to apply channel permissions');
    throw new AppError('Discord rejected the permission update. Check the bot role hierarchy.', {
      status: 500,
      code: 'PERMISSION_SYNC_FAILED',
    });
  });
}

export async function updateRoom({ guild, room: roomInput, patch, actorId = null, actorName = null }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel) throw new NotFoundError('The Discord channel for this room no longer exists.');

  const warnings = [];
  const data = {};
  if (patch.name !== undefined) {
    const name = sanitizeRoomName(patch.name);
    if (!name) throw new AppError('The room name cannot be empty.');
    data.name = name;
  }
  if (patch.topic !== undefined) data.topic = patch.topic ? String(patch.topic).slice(0, ROOM_LIMITS.topicMax) : null;
  if (patch.userLimit !== undefined) data.userLimit = clamp(patch.userLimit, 0, ROOM_LIMITS.userLimitMax);
  if (patch.bitrate !== undefined) data.bitrate = clampBitrate(patch.bitrate, guild);
  if (patch.privacy !== undefined) data.privacy = patch.privacy;
  if (patch.locked !== undefined) data.locked = Boolean(patch.locked);
  if (patch.hidden !== undefined) data.hidden = Boolean(patch.hidden);
  if (patch.rtcRegion !== undefined) data.rtcRegion = patch.rtcRegion || null;
  if (patch.theme !== undefined) data.theme = patch.theme || null;
  if (patch.emoji !== undefined) data.emoji = patch.emoji || null;
  if (patch.description !== undefined) data.description = patch.description || null;
  if (patch.bannerUrl !== undefined) data.bannerUrl = patch.bannerUrl || null;
  if (patch.parentCategoryId !== undefined) {
    if (patch.parentCategoryId) {
      const category = await fetchChannelById(guild, patch.parentCategoryId);
      if (category?.type !== ChannelType.GuildCategory) throw new AppError('Choose a valid category.');
      data.parentCategoryId = category.id;
    } else {
      data.parentCategoryId = null;
    }
  }
  if (patch.templateId !== undefined) data.templateId = patch.templateId || null;

  let passwordHash;
  if (patch.password !== undefined) {
    if (patch.password === null || patch.password === '') {
      passwordHash = null;
    } else {
      if (patch.password.length < ROOM_LIMITS.passwordMin) {
        throw new AppError(`Passwords must be at least ${ROOM_LIMITS.passwordMin} characters.`);
      }
      passwordHash = await bcrypt.hash(patch.password, 12);
    }
  }

  const finalPrivacy = data.privacy ?? room.privacy;
  if (finalPrivacy === 'PASSWORD' && !passwordHash && !room.passwordHash) {
    throw new AppError('Set a password before enabling password privacy.');
  }
  if (finalPrivacy !== 'PASSWORD') {
    passwordHash = null;
  }
  if (passwordHash !== undefined) data.passwordHash = passwordHash;
  const settings = safeJson(room.settings, {});
  if (finalPrivacy === 'PASSWORD') settings.passwordPending = false;
  data.settings = settings;

  const channelEdit = {};
  if (data.name !== undefined) channelEdit.name = data.name;
  if (data.topic !== undefined) channelEdit.topic = data.topic ?? '';
  if (data.userLimit !== undefined) channelEdit.userLimit = data.userLimit;
  if (data.bitrate !== undefined) channelEdit.bitrate = data.bitrate;
  if (data.parentCategoryId !== undefined) channelEdit.parent = data.parentCategoryId;
  if (Object.keys(channelEdit).length > 0) {
    await channel.edit(channelEdit, 'Chamber: room settings updated').catch((error) => {
      logger.warn({ err: error, roomId: room.id }, 'Channel edit failed');
      throw new AppError('Discord rejected the room update. Check channel permissions and bitrate limits.', {
        status: 500,
      });
    });
  }

  if (data.rtcRegion !== undefined) {
    try {
      await channel.setRTCRegion(data.rtcRegion, 'Chamber: voice region updated');
    } catch (error) {
      warnings.push('Voice regions are not available for this server; the region was left on automatic.');
      data.rtcRegion = null;
      logger.debug({ err: error, roomId: room.id }, 'Voice region update rejected');
    }
  }

  const updated = await prisma.activeRoom.update({
    where: { id: room.id },
    data: { ...data, lastActivityAt: new Date() },
    include: ROOM_INCLUDE,
  });
  await applyPermissions(guild, updated.id);
  await refreshPanel(guild.client, updated.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'room.updated',
    category: 'ROOM',
    targetType: 'room',
    targetId: room.id,
    metadata: Object.keys(data).filter((key) => key !== 'settings' && key !== 'passwordHash'),
  });
  publish('room.updated', { guildId: room.guildId, room: toPublicRoom(updated) });
  if (data.privacy !== undefined || data.hidden !== undefined || data.name !== undefined) {
    scheduleLobbyRefresh(guild.client, room.guildId);
  }
  return { room: toPublicRoom(updated), warnings };
}

export async function setPrivacy({ guild, room, privacy, password = null, actorId, actorName }) {
  if (privacy === 'PASSWORD' && !password) {
    return { requiresPassword: true };
  }
  return updateRoom({
    guild,
    room,
    actorId,
    actorName,
    patch: { privacy, password },
  });
}

export async function setPassword({ guild, room, password, actorId, actorName }) {
  return updateRoom({ guild, room, actorId, actorName, patch: { privacy: 'PASSWORD', password } });
}

export async function lockRoom({ guild, room, locked, actorId, actorName }) {
  return updateRoom({ guild, room, actorId, actorName, patch: { locked } });
}

export async function hideRoom({ guild, room, hidden, actorId, actorName }) {
  return updateRoom({ guild, room, actorId, actorName, patch: { hidden } });
}

export async function deleteRoom({
  guild,
  room: roomInput,
  actorId = null,
  actorName = null,
  reason = 'Room deleted',
  emptyOnly = false,
  moveMembers = false,
}) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) return { deleted: false };
  const channel = await fetchChannelById(guild, room.channelId);
  if (channel) {
    const humans = channel.members.filter((member) => !member.user.bot);
    if (emptyOnly && humans.size > 0) return { deleted: false, reason: 'occupied' };
    if (!emptyOnly && humans.size > 0) {
      for (const member of humans.values()) {
        await member.voice.setChannel(null, 'Chamber: room deleted').catch(() => null);
      }
    }
  }

  const claimed = await prisma.activeRoom.updateMany({
    where: { id: room.id, status: 'ACTIVE' },
    data: { status: 'CLOSING' },
  });
  if (claimed.count === 0) return { deleted: false };

  const endedAt = new Date();
  const durationSeconds = Math.max(1, Math.round((endedAt.getTime() - new Date(room.createdAt).getTime()) / 1000));
  let ownerName = room.owner?.globalName || room.owner?.username || null;
  if (!ownerName) {
    const owner = await prisma.user.findUnique({ where: { id: room.ownerId } }).catch(() => null);
    ownerName = owner?.globalName || owner?.username || null;
  }
  await recordRoomSession({
    guildId: room.guildId,
    roomId: room.id,
    channelId: room.channelId,
    ownerId: room.ownerId,
    ownerName,
    name: room.name,
    roomTypeKey: room.roomTypeKey,
    templateName: room.template?.name ?? null,
    privacy: room.privacy,
    peakMembers: room.peakMembers,
    totalJoins: room.totalJoins,
    durationSeconds,
    endReason: reason,
    createdAt: room.createdAt,
    endedAt,
  });

  if (channel) {
    await channel.delete(`Chamber: ${reason}`).catch((error) => {
      logger.warn({ err: error, roomId: room.id }, 'Failed to delete channel');
    });
  }
  await prisma.activeRoom.delete({ where: { id: room.id } }).catch(() => null);
  cancelEmptyCleanup(room.id);
  recordRoomDeleted(room.guildId).catch(() => null);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'room.deleted',
    category: 'ROOM',
    targetType: 'room',
    targetId: room.id,
    metadata: { name: room.name, channelId: room.channelId, reason, durationSeconds, peakMembers: room.peakMembers },
  });
  publish('room.deleted', { guildId: room.guildId, roomId: room.id, channelId: room.channelId });
  if (guild?.client) scheduleLobbyRefresh(guild.client, room.guildId);
  logger.info({ roomId: room.id, reason }, 'Temporary room deleted');
  return { deleted: true, durationSeconds };
}

export async function inviteMember({ guild, room: roomInput, targetMember, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  if (await isBannedFromRoom(room.id, targetMember.id)) {
    throw new AppError('That member is banned or blocked from this room. Unban them first.', { status: 409 });
  }
  await prisma.roomPermission.upsert({
    where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'USER', targetId: targetMember.id } },
    create: { roomId: room.id, targetType: 'USER', targetId: targetMember.id, allowConnect: true, createdBy: actorId },
    update: { allowConnect: true },
  });
  await prisma.roomInvitation.create({
    data: {
      roomId: room.id,
      inviterId: actorId,
      inviteeId: targetMember.id,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  await applyPermissions(guild, room.id);
  await targetMember
    .send(
      cv2Payload(
        noticePanel({
          title: '🎟️ Room invitation',
          accentColor: '#7c6cff',
          body: `**${actorName || 'The room owner'}** invited you to **${room.name}** in **${guild.name}**.\nOpen <#${room.channelId}> to join.`,
        }),
      ),
    )
    .catch(() => null);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'member.invited',
    category: 'MEMBER',
    targetType: 'user',
    targetId: targetMember.id,
    metadata: { roomId: room.id },
  });
  publish('room.member.invited', { guildId: room.guildId, roomId: room.id, userId: targetMember.id });
  return { ok: true };
}

// Same allow-list effect as an invitation, without messaging anybody: used by
// staff who want to un-block a regular rather than notify them.
export async function allowMember({ guild, room: roomInput, userId, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  // Read the ban from the database: callers often hold a room object loaded before
  // the ban was written, which would let a banned member back in.
  if (await isBannedFromRoom(room.id, userId)) {
    throw new AppError('Lift the ban or block before allowing this member.', { status: 409 });
  }
  await prisma.roomPermission.upsert({
    where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'USER', targetId: userId } },
    create: { roomId: room.id, targetType: 'USER', targetId: userId, allowConnect: true, createdBy: actorId },
    update: { allowConnect: true },
  });
  await applyPermissions(guild, room.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'member.allowed',
    category: 'PRIVACY',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id },
  });
  publish('room.member.allowed', { guildId: room.guildId, roomId: room.id, userId });
  return { ok: true };
}

export async function revokeAccess({ guild, room: roomInput, userId, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  if (userId === room.ownerId) throw new ForbiddenError('The room owner always keeps access to their room.');
  await prisma.roomPermission.deleteMany({ where: { roomId: room.id, targetType: 'USER', targetId: userId } });
  const channel = await fetchChannelById(guild, room.channelId);
  const target = channel?.members?.get(userId);
  if (target) await target.voice.setChannel(null, 'Chamber: room access revoked').catch(() => null);
  await applyPermissions(guild, room.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'member.access_revoked',
    category: 'PRIVACY',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id, disconnected: Boolean(target) },
  });
  publish('room.member.revoked', { guildId: room.guildId, roomId: room.id, userId });
  return { ok: true, disconnected: Boolean(target) };
}

export async function kickMember({ guild, room: roomInput, userId, actorId, actorName, reason = 'Removed from room' }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  if (userId === room.ownerId) throw new ForbiddenError('The room owner cannot be removed. Transfer ownership first.');
  const channel = await fetchChannelById(guild, room.channelId);
  const member = channel?.members?.get(userId);
  if (member) await member.voice.setChannel(null, `Chamber: ${reason}`).catch(() => null);
  await Promise.all([
    prisma.roomMember.deleteMany({ where: { roomId: room.id, userId } }),
    prisma.roomPermission.deleteMany({ where: { roomId: room.id, targetType: 'USER', targetId: userId } }),
    prisma.queueEntry.updateMany({ where: { roomId: room.id, userId, status: 'WAITING' }, data: { status: 'LEFT' } }),
    prisma.waitingRequest.updateMany({
      where: { roomId: room.id, userId, status: 'PENDING' },
      data: { status: 'CANCELLED', resolvedAt: new Date(), resolvedById: actorId },
    }),
  ]);
  await applyPermissions(guild, room.id);
  await guild.members
    .fetch(userId)
    .then((target) =>
      target.send(
        cv2Payload(
          noticePanel({
            title: 'Room removed',
            accentColor: '#fb7185',
            body: `You were removed from **${room.name}** in **${guild.name}**${reason ? `.\nReason: ${reason}` : '.'}`,
          }),
        ),
      ),
    )
    .catch(() => null);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'member.kicked',
    category: 'MEMBER',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id, reason },
  });
  publish('room.member.removed', { guildId: room.guildId, roomId: room.id, userId });
  schedulePanelRefresh(guild.client, room.id);
  return { ok: true };
}

export async function banMember({
  guild,
  room: roomInput,
  userId,
  kind = 'BAN',
  reason = null,
  durationMinutes = 0,
  actorId,
  actorName,
}) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  if (userId === room.ownerId) throw new ForbiddenError('The room owner cannot be banned from their own room.');
  const expiresAt = durationMinutes > 0 ? new Date(Date.now() + durationMinutes * 60000) : null;
  await prisma.roomBan.upsert({
    where: { roomId_userId: { roomId: room.id, userId } },
    create: {
      roomId: room.id,
      userId,
      moderatorId: actorId ?? 'system',
      kind,
      reason,
      expiresAt,
    },
    update: { kind, reason, expiresAt, moderatorId: actorId ?? 'system' },
  });
  await prisma.roomPermission.deleteMany({ where: { roomId: room.id, targetType: 'USER', targetId: userId } });
  const channel = await fetchChannelById(guild, room.channelId);
  const target = channel?.members?.get(userId);
  if (target) await target.voice.setChannel(null, 'Chamber: banned from room').catch(() => null);
  await prisma.roomMember.deleteMany({ where: { roomId: room.id, userId } });
  await applyPermissions(guild, room.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: kind === 'BLOCK' ? 'member.blocked' : 'member.banned',
    category: 'MEMBER',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id, reason, expiresAt },
  });
  publish('room.member.banned', { guildId: room.guildId, roomId: room.id, userId, kind });
  schedulePanelRefresh(guild.client, room.id);
  return { ok: true };
}

export async function unbanMember({ guild, room: roomInput, userId, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  await prisma.roomBan.deleteMany({ where: { roomId: room.id, userId } });
  await applyPermissions(guild, room.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'member.unbanned',
    category: 'MEMBER',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id },
  });
  publish('room.member.unbanned', { guildId: room.guildId, roomId: room.id, userId });
  return { ok: true };
}

export async function moveMember({ guild, room: roomInput, userId, destinationChannelId, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  const destination = await fetchChannelById(guild, destinationChannelId);
  if (!isVoiceChannel(destination)) throw new AppError('Choose a voice channel as the destination.');
  const member = await fetchMemberById(guild, userId);
  if (!member?.voice?.channelId) throw new AppError('That member is not connected to voice.');
  await member.voice.setChannel(destination, 'Chamber: moved by room moderator');
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'member.moved',
    category: 'MEMBER',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id, destinationChannelId },
  });
  return { ok: true };
}

export async function voiceModerate({ guild, room: roomInput, userId, action, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  const member = await fetchMemberById(guild, userId);
  if (!member?.voice?.channelId) throw new AppError('That member is not connected to voice.');
  if (action === 'mute') await member.voice.setMute(true, 'Chamber: room moderation');
  if (action === 'unmute') await member.voice.setMute(false, 'Chamber: room moderation');
  if (action === 'deafen') await member.voice.setDeaf(true, 'Chamber: room moderation');
  if (action === 'undeafen') await member.voice.setDeaf(false, 'Chamber: room moderation');
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: `member.${action}`,
    category: 'MEMBER',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id },
  });
  return { ok: true };
}

export async function promoteMember({ guild, room: roomInput, userId, durationMinutes = null, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  if (userId === room.ownerId) throw new AppError('The owner already has full control.');
  const config = await ensureConfig(room.guildId);
  const minutes = durationMinutes ?? config.tempAdminMinutes;
  const tempAdminUntil = minutes > 0 ? new Date(Date.now() + minutes * 60000) : null;
  await prisma.roomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId } },
    create: { roomId: room.id, userId, role: 'ADMIN', tempAdminUntil },
    update: { role: 'ADMIN', tempAdminUntil },
  });
  await applyPermissions(guild, room.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'member.promoted',
    category: 'MEMBER',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id, tempAdminUntil },
  });
  publish('room.member.promoted', { guildId: room.guildId, roomId: room.id, userId });
  schedulePanelRefresh(guild.client, room.id);
  return { ok: true, tempAdminUntil };
}

export async function demoteMember({ guild, room: roomInput, userId, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  await prisma.roomMember.updateMany({
    where: { roomId: room.id, userId, role: 'ADMIN' },
    data: { role: 'MEMBER', tempAdminUntil: null },
  });
  await applyPermissions(guild, room.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'member.demoted',
    category: 'MEMBER',
    targetType: 'user',
    targetId: userId,
    metadata: { roomId: room.id },
  });
  schedulePanelRefresh(guild.client, room.id);
  return { ok: true };
}

export async function transferOwnership({ guild, room: roomInput, targetUserId, actorId, actorName, claimed = false }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  if (targetUserId === room.ownerId) throw new AppError('That member already owns this room.');
  const targetMember = await fetchMemberById(guild, targetUserId);
  if (!targetMember) throw new AppError('That member is not in the server.');
  await ensureUserRecord(targetMember.user ?? targetMember);
  const oldOwnerId = room.ownerId;
  await prisma.$transaction(async (tx) => {
    await tx.activeRoom.update({ where: { id: room.id }, data: { ownerId: targetUserId } });
    await tx.roomMember.updateMany({
      where: { roomId: room.id, userId: oldOwnerId },
      data: { role: 'MEMBER', tempAdminUntil: null },
    });
    await tx.roomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId: targetUserId } },
      create: { roomId: room.id, userId: targetUserId, role: 'OWNER' },
      update: { role: 'OWNER', tempAdminUntil: null },
    });
  });
  const updated = await getRoomById(room.id);
  await applyPermissions(guild, updated.id);
  await refreshPanel(guild.client, updated.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: claimed ? 'room.claimed' : 'room.transferred',
    category: 'ROOM',
    targetType: 'room',
    targetId: room.id,
    metadata: { from: oldOwnerId, to: targetUserId },
  });
  await targetMember
    .send(
      cv2Payload(
        noticePanel({
          title: claimed ? '👑 You claimed a room' : '👑 Room ownership transferred',
          body: `You are now the owner of **${room.name}** in **${guild.name}**. Open <#${room.channelId}> to manage it.`,
        }),
      ),
    )
    .catch(() => null);
  publish('room.updated', { guildId: room.guildId, room: toPublicRoom(updated) });
  return { ok: true, room: toPublicRoom(updated) };
}

export async function claimRoom({ guild, room: roomInput, userId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  if (room.ownerId === userId) throw new AppError('You already own this room.');
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel?.members?.has(userId)) throw new ForbiddenError('You must be in the room to claim it.');
  if (channel.members.has(room.ownerId)) throw new ForbiddenError('The owner is currently in the room.');
  return transferOwnership({ guild, room, targetUserId: userId, actorId: userId, actorName, claimed: true });
}

export async function resetRoom({ guild, room: roomInput, actorId, actorName }) {
  const room = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!room) throw new NotFoundError('Room not found.');
  const config = await ensureConfig(room.guildId);
  const template = room.template ?? (await prisma.roomTemplate.findFirst({ where: { guildId: null, isBuiltin: true } }));
  const owner = await guild.members.fetch(room.ownerId).catch(() => null);
  const roomType = room.roomTypeKey ? await getRoomType(room.guildId, room.roomTypeKey) : null;
  const name = sanitizeRoomName(
    formatRoomName(template?.roomNameRule || config.roomNameTemplate, {
      username: owner ? displayName(owner) : 'Member',
      typeName: roomType?.name || 'Room',
      emoji: template?.emoji,
    }),
  );
  await prisma.$transaction([
    prisma.roomPermission.deleteMany({ where: { roomId: room.id } }),
    prisma.roomBan.deleteMany({ where: { roomId: room.id } }),
    prisma.roomMember.updateMany({ where: { roomId: room.id }, data: { role: 'MEMBER', tempAdminUntil: null } }),
    prisma.roomMember.updateMany({ where: { roomId: room.id, userId: room.ownerId }, data: { role: 'OWNER' } }),
    prisma.queueEntry.updateMany({ where: { roomId: room.id, status: 'WAITING' }, data: { status: 'LEFT' } }),
    prisma.waitingRequest.updateMany({
      where: { roomId: room.id, status: 'PENDING' },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    }),
    prisma.roomInvitation.updateMany({
      where: { roomId: room.id, status: 'PENDING' },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    }),
    prisma.activeRoom.update({
      where: { id: room.id },
      data: {
        name,
        privacy: template?.defaultPrivacy === 'PASSWORD' ? 'PRIVATE' : template?.defaultPrivacy ?? config.defaultPrivacy,
        passwordHash: null,
        userLimit: template?.defaultLimit ?? config.defaultUserLimit,
        bitrate: clampBitrate(template?.defaultBitrate ?? config.defaultBitrate, guild),
        locked: false,
        hidden: false,
        topic: null,
        emoji: template?.emoji ?? null,
        theme: template?.accentColor ?? null,
        settings: { passwordPending: template?.defaultPrivacy === 'PASSWORD' },
      },
    }),
  ]);
  await applyPermissions(guild, room.id);
  await refreshPanel(guild.client, room.id);
  await writeAudit({
    guildId: room.guildId,
    actorId,
    actorName,
    action: 'room.reset',
    category: 'ROOM',
    targetType: 'room',
    targetId: room.id,
    metadata: { template: template?.name ?? null },
  });
  publish('room.updated', { guildId: room.guildId, room: toPublicRoom((await getRoomById(room.id))) });
  return { ok: true };
}

export async function cloneRoom({ guild, room: roomInput, ownerMember, config, actorId, actorName }) {
  const source = typeof roomInput === 'string' ? await getRoomById(roomInput) : roomInput;
  if (!source) throw new NotFoundError('Room not found.');
  const resolvedConfig = config ?? (await ensureConfig(source.guildId));
  const created = await createRoom({
    guild,
    ownerMember,
    config: resolvedConfig,
    template: source.template,
    privacy: source.privacy,
    userLimit: source.userLimit,
    bitrate: source.bitrate,
    categoryId: source.parentCategoryId,
    name: sanitizeRoomName(`${source.name} copy`),
    settings: { ...safeJson(source.settings, {}), clonedFrom: source.id },
    createdBy: actorId,
    reason: `Chamber: cloned from ${source.name}`,
  });
  const copyPermissions = (source.permissions ?? []).map((rule) => ({
    roomId: created.id,
    targetType: rule.targetType,
    targetId: rule.targetId,
    allowConnect: rule.allowConnect,
    expiresAt: rule.expiresAt,
    createdBy: actorId,
  }));
  const copyBans = activeBans(source).map((ban) => ({
    roomId: created.id,
    userId: ban.userId,
    moderatorId: actorId ?? 'system',
    kind: ban.kind,
    reason: ban.reason,
    expiresAt: ban.expiresAt,
  }));
  if (copyPermissions.length) await prisma.roomPermission.createMany({ data: copyPermissions, skipDuplicates: true });
  if (copyBans.length) await prisma.roomBan.createMany({ data: copyBans, skipDuplicates: true });
  if (source.privacy === 'PASSWORD' && source.passwordHash) {
    await prisma.activeRoom.update({
      where: { id: created.id },
      data: { passwordHash: source.passwordHash, settings: { ...safeJson(created.settings, {}), passwordPending: false } },
    });
  }
  await applyPermissions(guild, created.id);
  await refreshPanel(guild.client, created.id);
  await writeAudit({
    guildId: source.guildId,
    actorId,
    actorName,
    action: 'room.cloned',
    category: 'ROOM',
    targetType: 'room',
    targetId: created.id,
    metadata: { sourceRoomId: source.id },
  });
  publish('room.created', { guildId: source.guildId, room: toPublicRoom(await getRoomById(created.id)) });
  return getRoomById(created.id);
}

export function cancelEmptyCleanup(roomId) {
  const timer = emptyTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    emptyTimers.delete(roomId);
  }
}

export function scheduleEmptyCleanup(client, roomId, delaySeconds = null) {
  if (emptyTimers.has(roomId)) return;
  const timer = setTimeout(
    async () => {
      emptyTimers.delete(roomId);
      try {
        const room = await getRoomById(roomId);
        if (!room || room.status !== 'ACTIVE') return;
        const config = await ensureConfig(room.guildId);
        if (!config.autoCleanup) return;
        const guild = client.guilds.cache.get(room.guildId) ?? (await client.guilds.fetch(room.guildId).catch(() => null));
        if (!guild) return;
        const channel = await fetchChannelById(guild, room.channelId);
        if (!channel) {
          await closeMissingRoom(guild, room, 'channel_missing');
          return;
        }
        const humans = channel.members.filter((member) => !member.user.bot);
        if (humans.size > 0) return;
        await deleteRoom({ guild, room, reason: 'Room empty', emptyOnly: true, actorName: 'Chamber' });
      } catch (error) {
        logger.warn({ err: error, roomId }, 'Empty room cleanup failed');
      }
    },
    Math.max(5, delaySeconds ?? 30) * 1000,
  );
  timer.unref?.();
  emptyTimers.set(roomId, timer);
}

export async function scheduleEmptyCleanupFor(client, room, config = null) {
  const resolvedConfig = config ?? (await ensureConfig(room.guildId));
  if (!resolvedConfig.autoCleanup) return;
  scheduleEmptyCleanup(client, room.id, resolvedConfig.emptyGraceSeconds);
}

export async function closeMissingRoom(guild, room, reason = 'closed') {
  const endedAt = new Date();
  await recordRoomSession({
    guildId: room.guildId,
    roomId: room.id,
    channelId: room.channelId,
    ownerId: room.ownerId,
    ownerName: room.owner?.globalName || room.owner?.username || null,
    name: room.name,
    roomTypeKey: room.roomTypeKey,
    templateName: room.template?.name ?? null,
    privacy: room.privacy,
    peakMembers: room.peakMembers,
    totalJoins: room.totalJoins,
    durationSeconds: Math.max(1, Math.round((endedAt.getTime() - new Date(room.createdAt).getTime()) / 1000)),
    endReason: reason,
    createdAt: room.createdAt,
    endedAt,
  });
  await prisma.activeRoom.delete({ where: { id: room.id } }).catch(() => null);
  cancelEmptyCleanup(room.id);
  recordRoomDeleted(room.guildId).catch(() => null);
  publish('room.deleted', { guildId: room.guildId, roomId: room.id, channelId: room.channelId });
  logger.warn({ roomId: room.id, reason }, 'Closed room record whose Discord channel was missing');
}

export async function handleVoiceJoin({ client, guild, room, member }) {
  if (member.user.bot) return;
  cancelEmptyCleanup(room.id);
  const existing = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: room.id, userId: member.id } },
  });
  const now = new Date();
  await prisma.roomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId: member.id } },
    create: { roomId: room.id, userId: member.id, role: 'MEMBER', joinedAt: now },
    update: { joinedAt: now },
  });
  await ensureUserRecord(member.user);
  const settings = safeJson(room.settings, {});
  if (member.id === room.ownerId) delete settings.ownerLeftAt;
  const channel = await fetchChannelById(guild, room.channelId);
  const humanCount = channel ? channel.members.filter((m) => !m.user.bot).size : 1;
  await prisma.activeRoom.update({
    where: { id: room.id },
    data: {
      lastActivityAt: now,
      ...(existing ? {} : { totalJoins: { increment: 1 } }),
      ...(humanCount > room.peakMembers ? { peakMembers: humanCount } : {}),
      settings,
    },
  });
  if (!existing) recordParticipants(room.guildId, 1).catch(() => null);
  await applyPermissions(guild, room.id).catch(() => null);
  schedulePanelRefresh(client, room.id);
  scheduleLobbyRefresh(client, room.guildId);
  publish('room.member.joined', { guildId: room.guildId, roomId: room.id, userId: member.id });
}

export async function handleVoiceLeave({ client, guild, room, member }) {
  if (member.user.bot) return;
  const row = await prisma.roomMember
    .findUnique({ where: { roomId_userId: { roomId: room.id, userId: member.id } } })
    .catch(() => null);
  await prisma.roomMember
    .deleteMany({ where: { roomId: room.id, userId: member.id } })
    .catch(() => null);
  const now = new Date();
  const minutes = row?.joinedAt ? (now.getTime() - new Date(row.joinedAt).getTime()) / 60000 : 0;
  if (minutes >= 1) recordParticipants(room.guildId, 0, minutes).catch(() => null);
  const settings = safeJson(room.settings, {});
  if (member.id === room.ownerId) settings.ownerLeftAt = now.toISOString();
  await prisma.activeRoom
    .update({ where: { id: room.id }, data: { lastActivityAt: now, settings } })
    .catch(() => null);
  const channel = await fetchChannelById(guild, room.channelId);
  const humanCount = channel ? channel.members.filter((m) => !m.user.bot).size : 0;
  if (humanCount === 0) {
    const config = await ensureConfig(room.guildId);
    if (config.autoCleanup) scheduleEmptyCleanup(client, room.id, config.emptyGraceSeconds);
  }
  schedulePanelRefresh(client, room.id);
  publish('room.member.left', { guildId: room.guildId, roomId: room.id, userId: member.id });
  return { humanCount };
}

export async function removeMemberRow(roomId, userId) {
  await prisma.roomMember.deleteMany({ where: { roomId, userId } }).catch(() => null);
}

export async function transferOnOwnerAbsent({ client, guild, room, config }) {
  if (!config.transferOnOwnerLeave) return { transferred: false };
  const channel = await fetchChannelById(guild, room.channelId);
  if (!channel) return { transferred: false };
  const humans = [...channel.members.values()].filter((member) => !member.user.bot && member.id !== room.ownerId);
  if (channel.members.has(room.ownerId) || humans.length === 0) return { transferred: false };
  const candidates = humans.sort((a, b) => (a.voice?.joinedTimestamp ?? 0) - (b.voice?.joinedTimestamp ?? 0));
  const target = candidates[0];
  if (!target) return { transferred: false };
  await transferOwnership({
    guild,
    room,
    targetUserId: target.id,
    actorId: client.user?.id ?? null,
    actorName: 'Chamber automation',
  });
  await writeAudit({
    guildId: room.guildId,
    actorId: client.user?.id ?? null,
    actorName: 'Chamber automation',
    action: 'room.ownership.recovered',
    category: 'SYSTEM',
    targetType: 'room',
    targetId: room.id,
    metadata: { newOwnerId: target.id, reason: 'owner_absent' },
  });
  return { transferred: true, newOwnerId: target.id };
}

export async function notifyRoomOwner(client, room, title, body, accentColor = '#7c6cff') {
  try {
    const owner = await client.users.fetch(room.ownerId);
    await owner.send(cv2Payload(noticePanel({ title, body, accentColor })));
    return true;
  } catch {
    const guild = client.guilds.cache.get(room.guildId);
    const channel = guild ? await fetchChannelById(guild, room.channelId) : null;
    if (channel?.isTextBased?.()) {
      await sendCv2(
        channel,
        noticePanel({ title, body: `${body}\n<@${room.ownerId}>`, accentColor }),
      ).catch(() => null);
    }
    return false;
  }
}

export async function cleanupGuildRooms(client, guild, config, { includeExpired = false } = {}) {
  const rooms = await prisma.activeRoom.findMany({
    where: { guildId: guild.id, status: 'ACTIVE' },
    include: ROOM_INCLUDE,
  });
  const result = { closedMissing: 0, deletedEmpty: 0, expiredWarned: 0, checked: rooms.length };
  for (const room of rooms) {
    const channel = await fetchChannelById(guild, room.channelId);
    if (!channel) {
      await closeMissingRoom(guild, room, 'channel_missing');
      result.closedMissing += 1;
      continue;
    }
    const humans = channel.members.filter((member) => !member.user.bot);
    if (humans.size === 0) {
      await deleteRoom({ guild, room, reason: 'Room empty', emptyOnly: true, actorName: 'Chamber cleanup' });
      result.deletedEmpty += 1;
      continue;
    }
    if (includeExpired && room.expiresAt && new Date(room.expiresAt).getTime() <= Date.now()) {
      result.expiredWarned += 1;
    }
  }
  return result;
}

export async function recoverActiveRooms(client) {
  const rooms = await prisma.activeRoom.findMany({ include: ROOM_INCLUDE });
  const summary = { total: rooms.length, restored: 0, closed: 0, emptied: 0 };
  for (const room of rooms) {
    try {
      if (room.status === 'CLOSING') {
        await closeMissingRoom(null, room, 'interrupted_deletion');
        summary.closed += 1;
        continue;
      }
      const guild = client.guilds.cache.get(room.guildId) ?? (await client.guilds.fetch(room.guildId).catch(() => null));
      if (!guild) {
        await closeMissingRoom(null, room, 'guild_unavailable');
        summary.closed += 1;
        continue;
      }
      const channel = await fetchChannelById(guild, room.channelId);
      if (!channel) {
        await closeMissingRoom(guild, room, 'channel_missing');
        summary.closed += 1;
        continue;
      }
      const liveIds = [...channel.members.keys()].filter((id) => !channel.members.get(id)?.user?.bot);
      const liveSet = new Set(liveIds);
      const staleRows = (room.members ?? []).filter((member) => !liveSet.has(member.userId));
      for (const member of liveIds) {
        await prisma.roomMember.upsert({
          where: { roomId_userId: { roomId: room.id, userId: member } },
          create: { roomId: room.id, userId: member, role: member === room.ownerId ? 'OWNER' : 'MEMBER' },
          update: {},
        });
        await ensureUserRecord(channel.members.get(member)?.user);
      }
      for (const stale of staleRows) {
        await prisma.roomMember.deleteMany({ where: { roomId: room.id, userId: stale.userId } });
      }
      const ownerPresent = liveSet.has(room.ownerId);
      if (!ownerPresent && liveIds.length > 0) {
        const config = await ensureConfig(room.guildId);
        await transferOnOwnerAbsent({ client, guild, room, config }).catch(() => null);
      }
      await prisma.activeRoom.update({
        where: { id: room.id },
        data: { peakMembers: Math.max(room.peakMembers, liveIds.length), lastActivityAt: new Date() },
      });
      const fresh = await getRoomById(room.id);
      await postControlPanel(guild, fresh);
      if (liveIds.length === 0) {
        const config = await ensureConfig(room.guildId);
        if (config.autoCleanup) scheduleEmptyCleanup(client, room.id, config.emptyGraceSeconds);
        summary.emptied += 1;
      } else {
        summary.restored += 1;
      }
    } catch (error) {
      logger.error({ err: error, roomId: room.id }, 'Failed to recover temporary room');
    }
  }
  for (const guild of client.guilds.cache.values()) {
    refreshLobby(client, guild.id).catch(() => null);
  }
  return summary;
}

export async function processRoomLifecycle(client) {
  const rooms = await prisma.activeRoom.findMany({ status: 'ACTIVE', include: ROOM_INCLUDE });
  const now = Date.now();
  for (const room of rooms) {
    try {
      const guild = client.guilds.cache.get(room.guildId);
      if (!guild) continue;
      const channel = await fetchChannelById(guild, room.channelId);
      if (!channel) {
        await closeMissingRoom(guild, room, 'channel_missing');
        continue;
      }
      const humans = [...channel.members.values()].filter((member) => !member.user.bot);
      const occupied = humans.length > 0;
      const config = await ensureConfig(room.guildId);
      const settings = safeJson(room.settings, {});

      // Temporary admins
      for (const member of room.members ?? []) {
        if (member.role === 'ADMIN' && member.tempAdminUntil && new Date(member.tempAdminUntil).getTime() <= now) {
          await prisma.roomMember.update({
            where: { roomId_userId: { roomId: room.id, userId: member.userId } },
            data: { role: 'MEMBER', tempAdminUntil: null },
          });
          await applyPermissions(guild, room.id).catch(() => null);
        }
      }
      // Temporary permissions
      const expiredRules = await prisma.roomPermission.findMany({
        where: { roomId: room.id, expiresAt: { lte: new Date(now) } },
      });
      if (expiredRules.length > 0) {
        await prisma.roomPermission.deleteMany({ where: { roomId: room.id, expiresAt: { lte: new Date(now) } } });
        await applyPermissions(guild, room.id).catch(() => null);
      }
      // Expired bans
      const expiredBans = await prisma.roomBan.count({ where: { roomId: room.id, expiresAt: { lte: new Date(now) } } });
      if (expiredBans > 0) {
        await prisma.roomBan.deleteMany({ where: { roomId: room.id, expiresAt: { lte: new Date(now) } } });
        await applyPermissions(guild, room.id).catch(() => null);
      }

      // Lifetime expiry — never destroy an occupied room.
      if (room.expiresAt && new Date(room.expiresAt).getTime() <= now) {
        if (!occupied) {
          await deleteRoom({ guild, room, reason: 'Room lifetime expired', emptyOnly: true, actorName: 'Chamber automation' });
          continue;
        }
        const lastNotice = settings.expiryNoticeAt ? new Date(settings.expiryNoticeAt).getTime() : 0;
        if (now - lastNotice > 30 * 60000) {
          settings.expiryNoticeAt = new Date(now).toISOString();
          await prisma.activeRoom.update({
            where: { id: room.id },
            data: {
              settings,
              expiresAt: new Date(now + 15 * 60000),
              lastActivityAt: new Date(now),
            },
          });
          await notifyRoomOwner(
            client,
            room,
            '⏳ Room lifetime extended',
            `**${room.name}** reached its configured lifetime while occupied, so it was extended by 15 minutes. It will be removed once empty.`,
            '#fbbf24',
          );
        }
      }

      // Inactivity notice (never destructive)
      if (config.inactivityMinutes > 0 && occupied) {
        const idleMs = now - new Date(room.lastActivityAt).getTime();
        const lastNotice = settings.inactivityNoticeAt ? new Date(settings.inactivityNoticeAt).getTime() : 0;
        if (idleMs > config.inactivityMinutes * 60000 && now - lastNotice > config.inactivityMinutes * 60000) {
          settings.inactivityNoticeAt = new Date(now).toISOString();
          await prisma.activeRoom.update({ where: { id: room.id }, data: { settings } });
          await notifyRoomOwner(
            client,
            room,
            '💤 Quiet room',
            `**${room.name}** has been quiet for a while. The room is occupied, so it will not be removed automatically.`,
            '#94a3b8',
          );
        }
      }

      // Ownership recovery when the owner stays absent from an occupied room.
      if (occupied && config.transferOnOwnerLeave && settings.ownerLeftAt) {
        const leftMs = now - new Date(settings.ownerLeftAt).getTime();
        if (leftMs > 5 * 60000 && !channel.members.has(room.ownerId)) {
          await transferOnOwnerAbsent({ client, guild, room, config });
        }
      }

      // Empty rooms
      if (!occupied && config.autoCleanup) {
        scheduleEmptyCleanup(client, room.id, config.emptyGraceSeconds);
      }
    } catch (error) {
      logger.error({ err: error, roomId: room.id }, 'Room lifecycle processing failed');
    }
  }
}

export default {
  createRoom,
  getRoomById,
  getRoomByChannel,
  listActiveRooms,
  toPublicRoom,
  updateRoom,
  deleteRoom,
  refreshPanel,
  refreshLobby,
  applyPermissions,
  recoverActiveRooms,
  processRoomLifecycle,
};
