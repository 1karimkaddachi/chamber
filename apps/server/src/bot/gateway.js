import prisma from '@chamber/db';
import { botLogger as logger } from '../logger.js';
import { sendUserPanel } from '../lib/notify.js';
import { noticePanel } from './panels.js';
import {
  closeMissingRoom,
  createRoom,
  getRoomByChannel,
  getRoomById,
  handleVoiceJoin,
  handleVoiceLeave,
  refreshPanel,
  scheduleEmptyCleanup,
  transferOnOwnerAbsent,
} from '../services/roomService.js';
import { ensureConfig as ensureGuildConfig, ensureGuildRecord, markGuildOffline } from '../services/guildService.js';
import { markJoinedFromQueue, onSlotAvailable } from '../services/queueService.js';

async function notifyUser(client, userId, title, body, accentColor = '#fb7185') {
  await sendUserPanel(client, userId, noticePanel({ title, body, accentColor })).catch(() => null);
}

async function handleTriggerJoin(client, guild, member, channelId) {
  const trigger = await prisma.triggerChannel.findFirst({
    where: { guildId: guild.id, channelId, enabled: true },
  });
  if (!trigger) return;
  const config = await ensureGuildConfig(guild.id);
  if (!config.enabled) return;
  if (member.voice?.channelId !== channelId) return;

  const owned = await prisma.activeRoom.findFirst({
    where: { guildId: guild.id, ownerId: member.id, status: 'ACTIVE' },
  });
  if (owned) {
    const ownedChannel = await guild.channels.fetch(owned.channelId).catch(() => null);
    if (ownedChannel) {
      await member.voice.setChannel(ownedChannel, 'Chamber: existing room').catch(() => null);
      await refreshPanel(client, owned.id).catch(() => null);
      return;
    }
    await closeMissingRoom(guild, await getRoomById(owned.id), 'channel_missing');
  }

  try {
    const room = await createRoom({
      guild,
      ownerMember: member,
      trigger,
      config,
      reason: 'Chamber: join to create',
    });
    logger.info({ guildId: guild.id, roomId: room.id, ownerId: member.id }, 'Join-to-create room opened');
  } catch (error) {
    logger.warn({ err: error, guildId: guild.id, userId: member.id }, 'Join-to-create failed');
    await notifyUser(
      client,
      member.id,
      'Could not create your room',
      error.message || 'The room could not be created right now.',
      '#fbbf24',
    );
  }
}

export function registerGatewayEvents(client) {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;
    const guild = newState.guild ?? oldState.guild;
    const member = newState.member ?? oldState.member;
    if (!guild || !member || member.user?.bot) return;

    try {
      if (oldState.channelId) {
        const leavingRoom = await getRoomByChannel(oldState.channelId);
        if (leavingRoom) {
          await handleVoiceLeave({ client, guild, room: leavingRoom, member });
          const config = await ensureGuildConfig(leavingRoom.guildId);
          const fresh = await getRoomById(leavingRoom.id);
          if (fresh && config.queueEnabled) {
            await onSlotAvailable({ client, guild, room: fresh, config }).catch(() => null);
          }
        }
      }

      if (newState.channelId) {
        const joiningRoom = await getRoomByChannel(newState.channelId);
        if (joiningRoom) {
          await handleVoiceJoin({ client, guild, room: joiningRoom, member });
          await markJoinedFromQueue(joiningRoom.id, member.id).catch(() => null);
        }
        await handleTriggerJoin(client, guild, member, newState.channelId);
      }
    } catch (error) {
      logger.error({ err: error, guildId: guild.id, userId: member.id }, 'Voice state handling failed');
    }
  });

  client.on('channelDelete', async (channel) => {
    try {
      const guild = channel.guild;
      if (!guild) return;
      const room = await getRoomByChannel(channel.id);
      if (room) {
        await closeMissingRoom(guild, room, 'channel_deleted');
        return;
      }
      const config = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
      if (!config) return;
      const patch = {};
      if (config.lobbyChannelId === channel.id) {
        patch.lobbyChannelId = null;
        patch.lobbyPanelMessageId = null;
      }
      if (config.waitingRoomChannelId === channel.id) patch.waitingRoomChannelId = null;
      if (config.logChannelId === channel.id) patch.logChannelId = null;
      if (Object.keys(patch).length > 0) {
        await prisma.guildConfig.update({ where: { guildId: guild.id }, data: patch });
      }
    } catch (error) {
      logger.error({ err: error, channelId: channel.id }, 'Channel delete handling failed');
    }
  });

  client.on('guildMemberRemove', async (member) => {
    try {
      const rooms = await prisma.activeRoom.findMany({
        where: { guildId: member.guild.id, ownerId: member.id, status: 'ACTIVE' },
      });
      for (const room of rooms) {
        const config = await ensureGuildConfig(room.guildId);
        const channel = await member.guild.channels.fetch(room.channelId).catch(() => null);
        const humans = channel
          ? [...channel.members.values()].filter((entry) => !entry.user.bot)
          : [];
        if (humans.length === 0) {
          if (config.autoCleanup) scheduleEmptyCleanup(client, room.id, config.emptyGraceSeconds);
          continue;
        }
        if (config.transferOnOwnerLeave) {
          await transferOnOwnerAbsent({ client, guild: member.guild, room, config }).catch((error) =>
            logger.warn({ err: error, roomId: room.id }, 'Owner leave transfer failed'),
          );
        } else {
          await notifyUser(
            client,
            room.ownerId,
            'Room owner left the server',
            `The owner of **${room.name}** left the server. Members can claim the room from the control panel.`,
            '#fbbf24',
          ).catch(() => null);
        }
      }
    } catch (error) {
      logger.error({ err: error, userId: member.id }, 'Guild member remove handling failed');
    }
  });

  client.on('guildCreate', async (guild) => {
    try {
      await ensureGuildRecord({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 128 }),
        ownerId: guild.ownerId,
        botPresent: true,
      });
      await ensureConfig(guild.id);
      logger.info({ guildId: guild.id, name: guild.name }, 'Joined guild');
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, 'Guild create handling failed');
    }
  });

  client.on('guildDelete', async (guild) => {
    await markGuildOffline(guild.id);
    logger.info({ guildId: guild.id }, 'Removed from guild');
  });

  client.on('error', (error) => {
    logger.error({ err: error }, 'Discord client error');
  });

  client.on('warn', (message) => {
    logger.warn({ message }, 'Discord client warning');
  });
}

export default registerGatewayEvents;
