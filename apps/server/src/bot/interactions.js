import {
  ActionRowBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import prisma from '@chamber/db';
import { ROOM_LIMITS, clamp } from '@chamber/shared';
import { getClient } from '../lib/botState.js';
import { ids, parseId } from '../lib/customIds.js';
import { AppError, ForbiddenError } from '../lib/errors.js';
import {
  button,
  cv2Payload,
  editReplyCv2,
  errorPanel,
  panel,
  replyCv2,
  respond,
  roleSelect,
  row,
  selectRow,
  stringSelect,
  successPanel,
  updateCv2,
  userSelect,
} from '../lib/ui.js';
import { displayName } from '../lib/discord.js';
import { getSuggestion } from './aiCache.js';
import {
  aiSuggestionPanel,
  controlPanel,
  membersPanel,
  noticePanel,
  privacyPanel,
  queuePanel,
  settingsPanel,
  statsPanel,
} from './panels.js';
import { ensureConfig } from '../services/guildService.js';
import { getRoomAccess, requireRoomAccess } from '../services/accessService.js';
import {
  applyPermissions,
  buildRoomContext,
  cloneRoom,
  deleteRoom,
  demoteMember,
  getRoomById,
  inviteMember,
  kickMember,
  moveMember,
  promoteMember,
  refreshLobby,
  refreshPanel,
  resetRoom,
  setPassword,
  transferOwnership,
  updateRoom,
  voiceModerate,
} from '../services/roomService.js';
import { banMember, unbanMember } from '../services/roomService.js';
import { resolveWaitingRequest } from '../services/privacyService.js';
import { admitNext, listQueue } from '../services/queueService.js';
import { cancelRoomEvent, createRoomEvent, joinRoomEvent, leaveRoomEvent } from '../services/eventService.js';
import { resolveMerge } from '../services/mergeService.js';
import { generateSuggestions } from '../services/aiService.js';
import { setSuggestion } from './aiCache.js';

async function roomFor(interaction, roomId) {
  const room = await getRoomById(roomId);
  if (!room) {
    await respond(interaction, errorPanel('This room no longer exists.'));
    return null;
  }
  return room;
}

async function guard(interaction, room, level) {
  const config = await ensureConfig(room.guildId);
  try {
    await requireRoomAccess(getClient(), room, interaction.user.id, config, level);
    return config;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      await respond(interaction, errorPanel(error.message));
      return null;
    }
    throw error;
  }
}

async function performAndRefresh(interaction, room, action) {
  await interaction.deferUpdate();
  try {
    await action();
    await refreshPanel(getClient(), room.id);
  } catch (error) {
    await interaction
      .followUp(cv2Payload(errorPanel(error.message || 'The action failed.'), { ephemeral: true }))
      .catch(() => null);
  }
}

async function runSelect(interaction, action) {
  await interaction.deferUpdate();
  try {
    const components = await action();
    await editReplyCv2(interaction, components);
  } catch (error) {
    await interaction
      .followUp(cv2Payload(errorPanel(error.message || 'The action failed.'), { ephemeral: true }))
      .catch(() => null);
  }
}

function modal(customId, title, inputs) {
  const builder = new ModalBuilder().setCustomId(customId).setTitle(title);
  builder.addComponents(
    inputs.map((input) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(input.id)
          .setLabel(input.label)
          .setStyle(input.style ?? TextInputStyle.Short)
          .setRequired(input.required ?? true)
          .setMaxLength(input.maxLength ?? 200)
          .setMinLength(input.minLength ?? 0)
          .setPlaceholder(input.placeholder ?? ''),
      ),
    ),
  );
  return builder;
}

async function settingsContext(interaction, room, components) {
  try {
    await interaction.update({ components: Array.isArray(components) ? components : [components], flags: 32768 });
  } catch {
    await respond(interaction, components);
  }
}

async function allowedPanel(room) {
  const rules = room.permissions ?? [];
  return panel({
    accentColor: '#7c6cff',
    blocks: [
      `### ✅ Allowed members & roles · ${room.name}`,
      rules.length
        ? rules
            .map(
              (rule) =>
                `${rule.targetType === 'USER' ? '👤' : '🎭'} <@${rule.targetId}>${rule.expiresAt ? ` · until <t:${Math.floor(new Date(rule.expiresAt).getTime() / 1000)}:R>` : ''}`,
            )
            .join('\n')
        : '-# Nobody is on the allow-list yet.',
      '-# Added members can connect even when the room is locked or private.',
    ],
    rows: [
      selectRow(userSelect({ id: ids.select('allowuser', room.id), placeholder: 'Allow a member…' })),
      selectRow(roleSelect({ id: ids.select('allowrole', room.id), placeholder: 'Allow a role…' })),
      row(button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary })),
    ],
  });
}

async function blockedPanel(room) {
  const bans = room.bans ?? [];
  const rows = [selectRow(userSelect({ id: ids.select('block', room.id), placeholder: 'Block a member…' }))];
  if (bans.length) {
    rows.push(
      selectRow(
        stringSelect({
          id: ids.select('unban', room.id),
          placeholder: 'Unblock a member…',
          options: bans.slice(0, 25).map((ban) => ({ label: `Unblock ${ban.userId}`, value: ban.userId })),
        }),
      ),
    );
  }
  rows.push(row(button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary })));
  return panel({
    accentColor: '#fb7185',
    blocks: [
      `### ⛔ Blocked members · ${room.name}`,
      bans.length
        ? bans
            .map(
              (ban) =>
                `<@${ban.userId}> · ${ban.kind.toLowerCase()}${ban.expiresAt ? ` · until <t:${Math.floor(new Date(ban.expiresAt).getTime() / 1000)}:R>` : ' · permanent'}${ban.reason ? ` · ${ban.reason}` : ''}`,
            )
            .join('\n')
        : '-# No blocked or banned members.',
      '-# Blocking prevents joining; banning also disconnects the member immediately.',
    ],
    rows,
  });
}

async function adminsPanel(room, context) {
  const admins = (context.liveMembers ?? []).filter((member) => member.role === 'ADMIN');
  const rows = [selectRow(userSelect({ id: ids.select('memberpromote', room.id), placeholder: 'Promote a member…' }))];
  if (admins.length) {
    rows.push(
      selectRow(
        stringSelect({
          id: ids.select('demote', room.id),
          placeholder: 'Remove a temporary admin…',
          options: admins.slice(0, 25).map((admin) => ({ label: `Demote ${admin.userId}`, value: admin.userId })),
        }),
      ),
    );
  }
  rows.push(row(button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary })));
  return panel({
    accentColor: '#a78bfa',
    blocks: [
      `### 🛡️ Temporary admins · ${room.name}`,
      admins.length
        ? admins.map((admin) => `<@${admin.userId}>${admin.tempAdminUntil ? ` · until <t:${Math.floor(new Date(admin.tempAdminUntil).getTime() / 1000)}:t>` : ' · until the room closes'}`).join('\n')
        : '-# No temporary admins.',
      '-# Room admins can moderate members but cannot delete the room or change privacy.',
    ],
    rows,
  });
}

async function waitingPanel(room) {
  const requests = await prisma.waitingRequest.findMany({
    where: { roomId: room.id, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  return panel({
    accentColor: '#fbbf24',
    blocks: [
      `### 🙋 Waiting room · ${room.name}`,
      requests.length
        ? requests
            .map(
              (request) =>
                `<@${request.userId}> · <t:${Math.floor(new Date(request.createdAt).getTime() / 1000)}:R>${request.message ? ` · ${request.message}` : ''}`,
            )
            .join('\n')
        : '-# No pending requests.',
      '-# Requests arrive in your DMs with Accept and Reject buttons. Expired requests are cleaned up automatically.',
    ],
    rows: [
      row(
        button({ id: ids.settings('refresh', room.id), label: 'Refresh', emoji: '🔄' }),
        button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary }),
      ),
    ],
  });
}

async function eventsPanel(room) {
  const events = await prisma.roomEvent.findMany({
    where: { roomId: room.id },
    orderBy: { startsAt: 'asc' },
    take: 10,
    include: { _count: { select: { participants: true } } },
  });
  return panel({
    accentColor: '#22d3ee',
    blocks: [
      `### 📅 Events · ${room.name}`,
      events.length
        ? events
            .map(
              (event) =>
                `**${event.title}** · ${event.status.toLowerCase()} · <t:${Math.floor(new Date(event.startsAt).getTime() / 1000)}:R> · ${event._count.participants}/${event.participantLimit || '∞'}`,
            )
            .join('\n')
        : '-# No events yet.',
    ],
    rows: [
      row(
        button({ id: ids.event('create', room.id), label: 'Create event', emoji: '➕', style: ButtonStyle.Success }),
        button({ id: ids.settings('refresh', room.id), label: 'Refresh', emoji: '🔄' }),
        button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary }),
      ),
    ],
  });
}

function templateSelectPanel(room, templates) {
  return panel({
    accentColor: '#7c6cff',
    blocks: [
      `### 🧩 Apply a template · ${room.name}`,
      'Applying a template updates the privacy, capacity, bitrate, emoji and theme. Members and ownership are preserved.',
    ],
    rows: [
      selectRow(
        stringSelect({
          id: ids.select('applytemplate', room.id),
          placeholder: 'Choose a template…',
          options: templates.slice(0, 25).map((template) => ({
            label: `${template.emoji || '🎧'} ${template.name}`.slice(0, 100),
            value: template.id,
            description: `${template.defaultPrivacy} · limit ${template.defaultLimit || '∞'}`.slice(0, 100),
          })),
        }),
      ),
      row(button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️' })),
    ],
  });
}

async function handleRoomButton(interaction, room, action) {
  const client = getClient();
  if (action === 'refresh') {
    await performAndRefresh(interaction, room, async () => {});
    return;
  }
  if (action === 'queue') {
    const [config, entries] = await Promise.all([ensureConfig(room.guildId), listQueue(room.id)]);
    await replyCv2(interaction, queuePanel(room, { entries }), { ephemeral: true });
    return;
  }
  if (action === 'privacy') {
    if (!(await guard(interaction, room, 'owner'))) return;
    await replyCv2(interaction, privacyPanel(room), { ephemeral: true });
    return;
  }
  if (action === 'settings') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const config = await ensureConfig(room.guildId);
    await replyCv2(interaction, settingsPanel(room, { aiEnabled: config.aiEnabled }), { ephemeral: true });
    return;
  }
  if (action === 'members') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const context = await buildRoomContext(interaction.guild, room);
    await replyCv2(interaction, membersPanel(room, { liveMembers: context.liveMembers }), { ephemeral: true });
    return;
  }
  if (action === 'stats') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const [context, history] = await Promise.all([
      buildRoomContext(interaction.guild, room),
      prisma.roomHistory.findMany({
        where: { guildId: room.guildId, ownerId: room.ownerId },
        orderBy: { endedAt: 'desc' },
        take: 10,
      }),
    ]);
    await replyCv2(
      interaction,
      statsPanel(room, {
        history,
        queueCount: context.queueCount,
        waitingCount: context.waitingCount,
        liveCount: context.liveCount,
      }),
      { ephemeral: true },
    );
    return;
  }
  if (action === 'rename') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    await interaction.showModal(
      modal(ids.modal('rename', room.id), 'Rename room', [
        {
          id: 'name',
          label: 'Room name',
          maxLength: ROOM_LIMITS.nameMax,
          placeholder: room.name,
        },
      ]),
    );
    return;
  }
  if (action === 'limit') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    await interaction.showModal(
      modal(ids.modal('limit', room.id), 'Set user limit', [
        {
          id: 'limit',
          label: 'Limit (0 = unlimited, max 99)',
          placeholder: String(room.userLimit),
          maxLength: 2,
        },
      ]),
    );
    return;
  }
  if (action === 'password') {
    if (!(await guard(interaction, room, 'owner'))) return;
    await interaction.showModal(
      modal(ids.modal('privacy-password', room.id), 'Set room password', [
        {
          id: 'password',
          label: 'Password',
          minLength: ROOM_LIMITS.passwordMin,
          maxLength: ROOM_LIMITS.passwordMax,
        },
      ]),
    );
    return;
  }
  if (action === 'invite' || action === 'kick' || action === 'transfer') {
    if (!(await guard(interaction, room, action === 'transfer' ? 'owner' : 'moderate'))) return;
    const titles = {
      invite: '➕ Invite a member',
      kick: '👢 Remove a member',
      transfer: '👑 Transfer ownership',
    };
    const placeholders = {
      invite: 'Choose a member to invite…',
      kick: 'Choose a member to remove…',
      transfer: 'Choose the new owner…',
    };
    await replyCv2(
      interaction,
      panel({
        accentColor: '#7c6cff',
        blocks: [`### ${titles[action]} · ${room.name}`, `Use the menu below to select a member.`],
        rows: [
          selectRow(userSelect({ id: ids.select(action, room.id), placeholder: placeholders[action] })),
          row(button({ id: ids.cancel(room.id), label: 'Cancel', emoji: '✖️' })),
        ],
      }),
      { ephemeral: true },
    );
    return;
  }
  if (action === 'delete') {
    if (!(await guard(interaction, room, 'owner'))) return;
    await replyCv2(
      interaction,
      panel({
        accentColor: '#fb7185',
        blocks: [
          `### 🗑️ Delete **${room.name}**?`,
          'Connected members will be disconnected and the room record will be closed. This cannot be undone.',
        ],
        rows: [
          row(
            button({ id: ids.confirm('delete', room.id), label: 'Delete room', emoji: '🗑️', style: ButtonStyle.Danger }),
            button({ id: ids.cancel(room.id), label: 'Cancel', emoji: '✖️' }),
          ),
        ],
      }),
      { ephemeral: true },
    );
    return;
  }
  if (action === 'clone') {
    if (!(await guard(interaction, room, 'owner'))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const newRoom = await cloneRoom({
        guild: interaction.guild,
        room,
        ownerMember: interaction.member,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      await editReplyCv2(interaction, successPanel('Room cloned', `Your new room is ready: <#${newRoom.channelId}>`));
      await refreshPanel(client, room.id).catch(() => null);
    } catch (error) {
      await editReplyCv2(interaction, errorPanel(error.message || 'Clone failed.'));
    }
    return;
  }
  if (action === 'lock' || action === 'unlock' || action === 'hide' || action === 'reveal') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const patch =
      action === 'lock'
        ? { locked: true }
        : action === 'unlock'
          ? { locked: false }
          : action === 'hide'
            ? { hidden: true }
            : { hidden: false };
    await performAndRefresh(interaction, room, () =>
      updateRoom({
        guild: interaction.guild,
        room,
        patch,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      }),
    );
    return;
  }
  if (action === 'ai-apply') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const suggestion = getSuggestion(room.id, interaction.user.id);
    if (!suggestion) {
      await respond(interaction, errorPanel('This suggestion expired. Generate a new one.'));
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const patch = {
        privacy: suggestion.suggestions.privacy === 'PASSWORD' ? 'PRIVATE' : suggestion.suggestions.privacy,
        userLimit: suggestion.suggestions.userLimit,
        bitrate: suggestion.suggestions.bitrate,
      };
      if (suggestion.template?.id) {
        patch.templateId = suggestion.template.id;
        const template = await prisma.roomTemplate.findUnique({ where: { id: suggestion.template.id } });
        if (template) patch.emoji = template.emoji;
      }
      const { warnings } = await updateRoom({
        guild: interaction.guild,
        room,
        patch,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      if (suggestion.template?.id) {
        const template = await prisma.roomTemplate.findUnique({ where: { id: suggestion.template.id } });
        await prisma.activeRoom.update({
          where: { id: room.id },
          data: { roomTypeKey: template?.roomTypeKey ?? room.roomTypeKey },
        });
      }
      await refreshPanel(client, room.id).catch(() => null);
      await editReplyCv2(
        interaction,
        successPanel('Suggestions applied', `${warnings?.length ? `${warnings.join('\n')}\n` : ''}The room was updated with the suggested privacy, capacity and bitrate.`),
      );
    } catch (error) {
      await editReplyCv2(interaction, errorPanel(error.message || 'Could not apply the suggestions.'));
    }
    return;
  }
}

async function handleSettingsButton(interaction, room, action) {
  if (action === 'back') {
    const guild = interaction.guild ?? getClient().guilds.cache.get(room.guildId);
    if (!guild) return;
    const context = await buildRoomContext(guild, room);
    await settingsContext(
      interaction,
      room,
      controlPanel(room, {
        liveMembers: context.liveMembers,
        queueCount: context.queueCount,
        waitingCount: context.waitingCount,
        typeName: context.typeName,
        templateName: context.templateName,
        ownerName: context.ownerName,
      }),
    );
    return;
  }
  if (
    !(await guard(
      interaction,
      room,
      action === 'allowed' || action === 'admins' || action === 'waiting' ? 'owner' : 'moderate',
    ))
  ) {
    return;
  }
  const client = getClient();
  if (action === 'refresh') {
    const config = await ensureConfig(room.guildId);
    await settingsContext(interaction, room, settingsPanel(room, { aiEnabled: config.aiEnabled }));
    return;
  }
  if (action === 'allowed') {
    await settingsContext(interaction, room, await allowedPanel(room));
    return;
  }
  if (action === 'blocked') {
    await settingsContext(interaction, room, await blockedPanel(room));
    return;
  }
  if (action === 'admins') {
    const context = await buildRoomContext(interaction.guild, room);
    await settingsContext(interaction, room, await adminsPanel(room, context));
    return;
  }
  if (action === 'waiting') {
    await settingsContext(interaction, room, await waitingPanel(room));
    return;
  }
  if (action === 'events') {
    await settingsContext(interaction, room, await eventsPanel(room));
    return;
  }
}

async function handleSelect(interaction, parts) {
  const [, action, roomId] = parts;
  const room = await roomFor(interaction, roomId);
  if (!room) return;
  const client = getClient();

  if (action === 'invite' || action === 'kick' || action === 'transfer') {
    if (!(await guard(interaction, room, action === 'transfer' ? 'owner' : 'moderate'))) return;
    const userId = interaction.values[0];
    if (action === 'transfer') {
      await updateCv2(
        interaction,
        panel({
          accentColor: '#7c6cff',
          blocks: [
            `### 👑 Transfer **${room.name}**?`,
            `<@${userId}> will become the owner. You will remain a member.`,
          ],
          rows: [
            row(
              button({
                id: ids.confirm('transfer', room.id, userId),
                label: 'Transfer ownership',
                emoji: '👑',
                style: ButtonStyle.Success,
              }),
              button({ id: ids.cancel(room.id), label: 'Cancel', emoji: '✖️' }),
            ),
          ],
        }),
      );
      return;
    }
    if (action === 'invite') {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await respond(interaction, errorPanel('That member is no longer in the server.'));
        return;
      }
      await runSelect(interaction, async () => {
        await inviteMember({
          guild: interaction.guild,
          room,
          targetMember: member,
          actorId: interaction.user.id,
          actorName: interaction.user.username,
        });
        return successPanel(`Invited <@${userId}>.`);
      });
      return;
    }
    await runSelect(interaction, async () => {
      await kickMember({
        guild: interaction.guild,
        room,
        userId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      return successPanel(`Removed <@${userId}>.`);
    });
    return;
  }

  if (action === 'memberkick' || action === 'memberpromote' || action === 'demote') {
    if (!(await guard(interaction, room, action === 'memberpromote' || action === 'demote' ? 'owner' : 'moderate'))) return;
    const userId = interaction.values[0];
    await runSelect(interaction, async () => {
      if (action === 'memberkick') {
        await kickMember({
          guild: interaction.guild,
          room,
          userId,
          actorId: interaction.user.id,
          actorName: interaction.user.username,
        });
        return successPanel(`Removed <@${userId}>.`);
      }
      if (action === 'memberpromote') {
        const result = await promoteMember({
          guild: interaction.guild,
          room,
          userId,
          actorId: interaction.user.id,
          actorName: interaction.user.username,
        });
        return successPanel(
          `Promoted <@${userId}> to room admin${result.tempAdminUntil ? ` until <t:${Math.floor(new Date(result.tempAdminUntil).getTime() / 1000)}:t>` : '.'}`,
        );
      }
      await demoteMember({
        guild: interaction.guild,
        room,
        userId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      return successPanel(`Removed temporary admin <@${userId}>.`);
    });
    return;
  }

  if (action === 'privacy') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const mode = interaction.values[0];
    if (mode === 'PASSWORD') {
      await interaction.showModal(
        modal(ids.modal('privacy-password', room.id), 'Set room password', [
          {
            id: 'password',
            label: 'Password',
            minLength: ROOM_LIMITS.passwordMin,
            maxLength: ROOM_LIMITS.passwordMax,
          },
        ]),
      );
      return;
    }
    if (mode === 'FRIENDS') {
      await updateCv2(
        interaction,
        noticePanel({
          title: '🤝 Friends only',
          accentColor: '#7c6cff',
          body: 'Discord does not expose friend lists to bots. **Friends only** is implemented as your trusted allow-list: invited members are the only ones who can connect.',
        }),
      );
      return;
    }
    await runSelect(interaction, async () => {
      await updateRoom({
        guild: interaction.guild,
        room,
        patch: { privacy: mode },
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      const fresh = await getRoomById(room.id);
      return privacyPanel(fresh);
    });
    return;
  }

  if (action === 'privacyrole') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const roleId = interaction.values[0];
    await runSelect(interaction, async () => {
      await prisma.roomPermission.upsert({
        where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'ROLE', targetId: roleId } },
        create: {
          roomId: room.id,
          targetType: 'ROLE',
          targetId: roleId,
          allowConnect: true,
          createdBy: interaction.user.id,
        },
        update: { allowConnect: true },
      });
      await updateRoom({
        guild: interaction.guild,
        room,
        patch: { privacy: 'ROLE_RESTRICTED' },
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      return privacyPanel(await getRoomById(room.id));
    });
    return;
  }

  if (action === 'setting') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const value = interaction.values[0];
    if (value === 'topic') {
      await interaction.showModal(
        modal(ids.modal('topic', room.id), 'Set room topic', [
          { id: 'topic', label: 'Topic', maxLength: ROOM_LIMITS.topicMax, required: false, placeholder: room.topic ?? '' },
        ]),
      );
      return;
    }
    if (value === 'bitrate') {
      await interaction.showModal(
        modal(ids.modal('bitrate', room.id), 'Set bitrate', [
          {
            id: 'bitrate',
            label: 'Bitrate in kbps (8-384)',
            maxLength: 3,
            placeholder: String(Math.round(room.bitrate / 1000)),
          },
        ]),
      );
      return;
    }
    if (value === 'expiry') {
      await interaction.showModal(
        modal(ids.modal('expiry', room.id), 'Set room lifetime', [
          {
            id: 'hours',
            label: 'Hours until expiry (0 = never)',
            maxLength: 3,
            placeholder: '4',
          },
        ]),
      );
      return;
    }
    if (value === 'template') {
      const { listTemplates } = await import('../services/templateService.js');
      const templates = await listTemplates(room.guildId);
      await updateCv2(interaction, templateSelectPanel(room, templates));
      return;
    }
    if (value === 'reset') {
      await updateCv2(
        interaction,
        panel({
          accentColor: '#fb7185',
          blocks: [
            `### ↩️ Reset **${room.name}**?`,
            'The room will return to its template defaults. The allow-list, bans, queue and waiting requests will be cleared. Members remain connected.',
          ],
          rows: [
            row(
              button({ id: ids.confirm('reset', room.id), label: 'Reset room', emoji: '↩️', style: ButtonStyle.Danger }),
              button({ id: ids.cancel(room.id), label: 'Cancel', emoji: '✖️' }),
            ),
          ],
        }),
      );
      return;
    }
    if (value === 'ai') {
      const config = await ensureConfig(room.guildId);
      if (!config.aiEnabled) {
        await respond(interaction, errorPanel('AI suggestions are disabled in the dashboard.'));
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const suggestion = await generateSuggestions({
        guildId: room.guildId,
        input: { purpose: room.description || room.name, expectedMembers: room.userLimit || undefined },
        currentRoom: { name: room.name, privacy: room.privacy, userLimit: room.userLimit },
      });
      setSuggestion(room.id, interaction.user.id, suggestion);
      await editReplyCv2(interaction, aiSuggestionPanel(suggestion, { room }));
      return;
    }
  }

  if (action === 'category') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const categoryId = interaction.values[0];
    await runSelect(interaction, async () => {
      await updateRoom({
        guild: interaction.guild,
        room,
        patch: { parentCategoryId: categoryId },
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      const config = await ensureConfig(room.guildId);
      return settingsPanel(await getRoomById(room.id), { aiEnabled: config.aiEnabled });
    });
    return;
  }

  if (action === 'applytemplate') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const templateId = interaction.values[0];
    const { getTemplate } = await import('../services/templateService.js');
    const template = await getTemplate(room.guildId, templateId);
    if (!template) {
      await respond(interaction, errorPanel('Template not found.'));
      return;
    }
    await runSelect(interaction, async () => {
      const privacy = template.defaultPrivacy === 'PASSWORD' ? 'PRIVATE' : template.defaultPrivacy;
      await updateRoom({
        guild: interaction.guild,
        room,
        patch: {
          templateId: template.id,
          privacy,
          userLimit: template.defaultLimit,
          bitrate: template.defaultBitrate,
          emoji: template.emoji,
          theme: template.accentColor,
        },
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      await prisma.activeRoom.update({
        where: { id: room.id },
        data: { roomTypeKey: template.roomTypeKey },
      });
      const config = await ensureConfig(room.guildId);
      return settingsPanel(await getRoomById(room.id), { aiEnabled: config.aiEnabled });
    });
    return;
  }

  if (action === 'allowuser' || action === 'allowrole') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const targetId = interaction.values[0];
    await runSelect(interaction, async () => {
      await prisma.roomPermission.upsert({
        where: {
          roomId_targetType_targetId: {
            roomId: room.id,
            targetType: action === 'allowuser' ? 'USER' : 'ROLE',
            targetId,
          },
        },
        create: {
          roomId: room.id,
          targetType: action === 'allowuser' ? 'USER' : 'ROLE',
          targetId,
          allowConnect: true,
          createdBy: interaction.user.id,
        },
        update: { allowConnect: true },
      });
      await applyPermissions(interaction.guild, room.id);
      return allowedPanel(await getRoomById(room.id));
    });
    return;
  }

  if (action === 'voicemod') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const [moderationAction, userId] = String(interaction.values[0] ?? '').split(':');
    if (!userId || !['mute', 'unmute', 'deafen', 'undeafen'].includes(moderationAction)) {
      await respond(interaction, errorPanel('Unsupported voice moderation action.'));
      return;
    }
    await runSelect(interaction, async () => {
      await voiceModerate({
        guild: interaction.guild,
        room,
        userId,
        action: moderationAction,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      return successPanel(`Voice moderation applied: **${moderationAction}** <@${userId}>.`);
    });
    return;
  }

  if (action === 'block' || action === 'unban') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const userId = interaction.values[0];
    await runSelect(interaction, async () => {
      if (action === 'block') {
        await banMember({
          guild: interaction.guild,
          room,
          userId,
          kind: 'BLOCK',
          durationMinutes: 0,
          actorId: interaction.user.id,
          actorName: interaction.user.username,
        });
      } else {
        await unbanMember({
          guild: interaction.guild,
          room,
          userId,
          actorId: interaction.user.id,
          actorName: interaction.user.username,
        });
      }
      return blockedPanel(await getRoomById(room.id));
    });
    return;
  }

}

async function handleLobbySelect(interaction) {
  const target = await getRoomById(interaction.values[0]);
  if (!target) {
    await respond(interaction, errorPanel('That room is no longer active.'));
    return;
  }
  const guild = interaction.guild ?? getClient().guilds.cache.get(target.guildId);
  if (!guild) {
    await respond(interaction, errorPanel('The server is unavailable.'));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { requestRoomAccess } = await import('../services/privacyService.js');
    await requestRoomAccess({
      client: getClient(),
      guild,
      room: target,
      user: interaction.user,
    });
    await editReplyCv2(interaction, successPanel('Request sent', `The owner of **${target.name}** has been notified.`));
  } catch (error) {
    await editReplyCv2(interaction, errorPanel(error.message || 'Request failed.'));
  }
}

async function handleConfirm(interaction, parts) {
  const [, action, roomId, extra] = parts;
  const room = await roomFor(interaction, roomId);
  if (!room) return;
  if (action === 'delete') {
    if (!(await guard(interaction, room, 'owner'))) return;
    await interaction.deferUpdate();
    try {
      await deleteRoom({
        guild: interaction.guild,
        room,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        reason: 'Deleted by room owner',
      });
      await editReplyCv2(interaction, successPanel('Room deleted.'));
    } catch (error) {
      await interaction.followUp(cv2Payload(errorPanel(error.message), { ephemeral: true })).catch(() => null);
    }
    return;
  }
  if (action === 'transfer') {
    if (!(await guard(interaction, room, 'owner'))) return;
    await interaction.deferUpdate();
    try {
      await transferOwnership({
        guild: interaction.guild,
        room,
        targetUserId: extra,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      await editReplyCv2(interaction, successPanel(`Ownership transferred to <@${extra}>.`));
      await refreshPanel(getClient(), room.id).catch(() => null);
    } catch (error) {
      await interaction.followUp(cv2Payload(errorPanel(error.message), { ephemeral: true })).catch(() => null);
    }
    return;
  }
  if (action === 'reset') {
    if (!(await guard(interaction, room, 'owner'))) return;
    await interaction.deferUpdate();
    try {
      await resetRoom({
        guild: interaction.guild,
        room,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      await editReplyCv2(interaction, successPanel('Room reset to its template defaults.'));
    } catch (error) {
      await interaction.followUp(cv2Payload(errorPanel(error.message), { ephemeral: true })).catch(() => null);
    }
    return;
  }
}

async function handleQueue(interaction, parts) {
  const [, action, roomId] = parts;
  const room = await roomFor(interaction, roomId);
  if (!room) return;
  if (action === 'refresh') {
    const entries = await listQueue(room.id);
    await updateCv2(interaction, queuePanel(room, { entries }));
    return;
  }
  if (action === 'join' || action === 'leave') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { joinQueue, leaveQueue } = await import('../services/queueService.js');
      if (action === 'join') {
        const result = await joinQueue({
          client: getClient(),
          guild: interaction.guild,
          room,
          user: interaction.user,
        });
        await editReplyCv2(interaction, successPanel(`You are in the queue at position **${result.position}**.`));
      } else {
        await leaveQueue({ room, userId: interaction.user.id });
        await editReplyCv2(interaction, successPanel('You left the queue.'));
      }
      await refreshPanel(getClient(), room.id).catch(() => null);
    } catch (error) {
      await editReplyCv2(interaction, errorPanel(error.message || 'Queue action failed.'));
    }
    return;
  }
  if (action === 'admit') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const entry = await admitNext({
        client: getClient(),
        guild: interaction.guild,
        room,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      await editReplyCv2(interaction, successPanel(`Admitted <@${entry.userId}>.`));
    } catch (error) {
      await editReplyCv2(interaction, errorPanel(error.message || 'Admission failed.'));
    }
    return;
  }
  if (action === 'back') {
    const context = await buildRoomContext(interaction.guild, room);
    await updateCv2(
      interaction,
      controlPanel(room, {
        liveMembers: context.liveMembers,
        queueCount: context.queueCount,
        waitingCount: context.waitingCount,
        typeName: context.typeName,
        templateName: context.templateName,
        ownerName: context.ownerName,
      }),
    );
  }
}

async function handleWaiting(interaction, parts) {
  const [, action, requestId] = parts;
  const request = await prisma.waitingRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    await respond(interaction, errorPanel('This request no longer exists.'));
    return;
  }
  const room = await getRoomById(request.roomId);
  if (!room) {
    await respond(interaction, errorPanel('The room no longer exists.'));
    return;
  }
  if (!(await guard(interaction, room, 'moderate'))) return;
  const guild = interaction.guild ?? getClient().guilds.cache.get(room.guildId);
  if (!guild) {
    await respond(interaction, errorPanel('The server is unavailable.'));
    return;
  }
  await interaction.deferUpdate();
  try {
    const result = await resolveWaitingRequest({
      client: getClient(),
      guild,
      room,
      requestId,
      accept: action === 'accept',
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    await editReplyCv2(
      interaction,
      successPanel(result.accepted ? `Accepted <@${request.userId}>.` : 'Request rejected.'),
    );
  } catch (error) {
    await editReplyCv2(interaction, errorPanel(error.message || 'Could not resolve the request.'));
  }
}

async function handleMerge(interaction, parts) {
  const [, action, mergeId] = parts;
  const merge = await prisma.mergeRequest.findUnique({ where: { id: mergeId } });
  if (!merge) {
    await respond(interaction, errorPanel('This merge request no longer exists.'));
    return;
  }
  const guild = interaction.guild ?? getClient().guilds.cache.get(merge.guildId);
  if (!guild) {
    await respond(interaction, errorPanel('The server is unavailable.'));
    return;
  }
  await interaction.deferUpdate();
  try {
    const result = await resolveMerge({
      client: getClient(),
      guild,
      mergeId,
      userId: interaction.user.id,
      accept: action === 'accept',
    });
    await editReplyCv2(
      interaction,
      successPanel(
        result.accepted
          ? `Merge complete — ${result.moved} ${result.moved === 1 ? 'member' : 'members'} moved.`
          : 'Merge request rejected.',
      ),
    );
  } catch (error) {
    await editReplyCv2(interaction, errorPanel(error.message || 'Merge action failed.'));
  }
}

async function handleEventButton(interaction, parts) {
  const [, action, targetId] = parts;
  if (action === 'create') {
    const room = await roomFor(interaction, targetId);
    if (!room) return;
    if (!(await guard(interaction, room, 'owner'))) return;
    await interaction.showModal(
      modal(ids.modal('event', room.id), 'Create room event', [
        { id: 'title', label: 'Event title', maxLength: 80 },
        { id: 'type', label: 'Type: gaming, movie, study, meeting…', maxLength: 20, placeholder: 'gaming' },
        { id: 'start', label: 'Start (YYYY-MM-DD HH:MM UTC)', maxLength: 16, placeholder: '2026-01-31 20:00' },
        { id: 'duration', label: 'Duration in minutes', maxLength: 4, placeholder: '60' },
        { id: 'limit', label: 'Participant limit (0 = unlimited)', maxLength: 2, required: false, placeholder: '0' },
      ]),
    );
    return;
  }
  const event = await prisma.roomEvent.findUnique({ where: { id: targetId } });
  if (!event) {
    await respond(interaction, errorPanel('This event no longer exists.'));
    return;
  }
  const room = await getRoomById(event.roomId);
  if (!room) {
    await respond(interaction, errorPanel('The room no longer exists.'));
    return;
  }
  if (action === 'cancel') {
    if (!(await guard(interaction, room, 'owner'))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await cancelRoomEvent({
        client: getClient(),
        event,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      await editReplyCv2(interaction, successPanel('Event cancelled.'));
    } catch (error) {
      await editReplyCv2(interaction, errorPanel(error.message || 'Could not cancel the event.'));
    }
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (action === 'join') {
      await joinRoomEvent({ client: getClient(), eventId: event.id, user: interaction.user });
      await editReplyCv2(interaction, successPanel('You joined the event.'));
    } else {
      await leaveRoomEvent({ client: getClient(), eventId: event.id, user: interaction.user });
      await editReplyCv2(interaction, successPanel('You left the event.'));
    }
  } catch (error) {
    await editReplyCv2(interaction, errorPanel(error.message || 'Event action failed.'));
  }
}

async function handleLobby(interaction, action) {
  if (action === 'refresh') {
    await interaction.deferUpdate();
    await refreshLobby(getClient(), interaction.guildId);
    return;
  }
  if (action === 'help') {
    await respond(
      interaction,
      noticePanel({
        title: '🏛️ How the room directory works',
        accentColor: '#7c6cff',
        body: [
          '• Temporary rooms appear here while they are active and public or requestable.',
          '• **Request to join** rooms can be requested from the menu below — the owner decides.',
          '• Password rooms are joined with `/chamber access`, or invite links from the owner.',
          '• Friends-only rooms use the owner’s trusted allow-list because Discord does not expose friend lists to bots.',
        ].join('\n'),
      }),
    );
    return;
  }
}

async function handlePwd(interaction, parts) {
  const [, action, roomId] = parts;
  if (action !== 'open') return;
  const room = await roomFor(interaction, roomId);
  if (!room) return;
  await interaction.showModal(
    modal(ids.modal('pwd', room.id), 'Room password', [
      {
        id: 'password',
        label: 'Password',
        minLength: ROOM_LIMITS.passwordMin,
        maxLength: ROOM_LIMITS.passwordMax,
      },
    ]),
  );
}

export async function handleButton(interaction) {
  const parts = parseId(interaction.customId);
  const [prefix] = parts;
  if (prefix === 'lobby') return handleLobby(interaction, parts[1]);
  if (prefix === 'queue') return handleQueue(interaction, parts);
  if (prefix === 'wait') return handleWaiting(interaction, parts);
  if (prefix === 'merge') return handleMerge(interaction, parts);
  if (prefix === 'event') return handleEventButton(interaction, parts);
  if (prefix === 'confirm') return handleConfirm(interaction, parts);
  if (prefix === 'pwd') return handlePwd(interaction, parts);
  if (prefix === 'cancel') {
    await updateCv2(interaction, noticePanel({ title: 'Cancelled', body: 'No changes were made.', accentColor: '#94a3b8' }));
    return;
  }
  if (prefix === 'room') {
    const room = await roomFor(interaction, parts[2]);
    if (!room) return;
    return handleRoomButton(interaction, room, parts[1]);
  }
  if (prefix === 'settings') {
    const room = await roomFor(interaction, parts[2]);
    if (!room) return;
    return handleSettingsButton(interaction, room, parts[1]);
  }
}

export async function handleSelectMenu(interaction) {
  const parts = parseId(interaction.customId);
  if (parts[0] === 'lobby') return handleLobbySelect(interaction);
  return handleSelect(interaction, parts);
}

export async function handleModal(interaction) {
  const parts = parseId(interaction.customId);
  const [, action, roomId, extra] = parts;
  if (action === 'pwd') {
    const room = await getRoomById(roomId);
    if (!room) {
      await respond(interaction, errorPanel('This room no longer exists.'));
      return;
    }
    const { verifyRoomPassword } = await import('../services/privacyService.js');
    try {
      const result = await verifyRoomPassword({
        client: getClient(),
        guild: interaction.guild,
        room,
        user: interaction.user,
        password: interaction.fields.getTextInputValue('password'),
      });
      await respond(
        interaction,
        result.ok
          ? successPanel('Access granted', `Open <#${room.channelId}> to join.`)
          : errorPanel('Incorrect password.', `${result.remaining} attempts remaining before a temporary lockout.`),
      );
    } catch (error) {
      await respond(interaction, errorPanel(error.message || 'Verification failed.'));
    }
    return;
  }

  const room = await getRoomById(roomId);
  if (!room) {
    await respond(interaction, errorPanel('This room no longer exists.'));
    return;
  }

  if (action === 'rename') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const name = interaction.fields.getTextInputValue('name').trim();
    await updateRoom({
      guild: interaction.guild,
      room,
      patch: { name },
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    await refreshPanel(getClient(), room.id).catch(() => null);
    await respond(interaction, successPanel(`Renamed to **${name}**.`));
    return;
  }
  if (action === 'limit') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const limit = Number.parseInt(interaction.fields.getTextInputValue('limit').trim(), 10);
    if (!Number.isFinite(limit) || limit < 0 || limit > ROOM_LIMITS.userLimitMax) {
      await respond(interaction, errorPanel(`Enter a number between 0 and ${ROOM_LIMITS.userLimitMax}.`));
      return;
    }
    await updateRoom({
      guild: interaction.guild,
      room,
      patch: { userLimit: limit },
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    await refreshPanel(getClient(), room.id).catch(() => null);
    await respond(interaction, successPanel(`User limit set to **${limit || 'unlimited'}**.`));
    return;
  }
  if (action === 'privacy-password') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const password = interaction.fields.getTextInputValue('password');
    await setPassword({
      guild: interaction.guild,
      room,
      password,
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    await refreshPanel(getClient(), room.id).catch(() => null);
    await respond(interaction, successPanel('Password set', 'The room is now password protected. Share the password privately.'));
    return;
  }
  if (action === 'topic') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const topic = interaction.fields.getTextInputValue('topic').trim();
    await updateRoom({
      guild: interaction.guild,
      room,
      patch: { topic: topic || null },
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    await refreshPanel(getClient(), room.id).catch(() => null);
    await respond(interaction, successPanel('Topic updated.'));
    return;
  }
  if (action === 'bitrate') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const kbps = Number.parseInt(interaction.fields.getTextInputValue('bitrate').trim(), 10);
    if (!Number.isFinite(kbps) || kbps < 8 || kbps > 384) {
      await respond(interaction, errorPanel('Enter a bitrate between 8 and 384 kbps.'));
      return;
    }
    const { warnings } = await updateRoom({
      guild: interaction.guild,
      room,
      patch: { bitrate: kbps * 1000 },
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    await refreshPanel(getClient(), room.id).catch(() => null);
    await respond(
      interaction,
      successPanel('Bitrate updated.', warnings?.length ? warnings.join('\n') : null),
    );
    return;
  }
  if (action === 'expiry') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const hours = Number.parseInt(interaction.fields.getTextInputValue('hours').trim(), 10);
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      await respond(interaction, errorPanel('Enter between 0 and 168 hours (0 disables expiry).'));
      return;
    }
    await prisma.activeRoom.update({
      where: { id: room.id },
      data: { expiresAt: hours > 0 ? new Date(Date.now() + hours * 3600000) : null },
    });
    await refreshPanel(getClient(), room.id).catch(() => null);
    await respond(interaction, successPanel(hours > 0 ? `Room expires in ${hours} hours.` : 'Room expiry disabled.'));
    return;
  }
  if (action === 'event') {
    if (!(await guard(interaction, room, 'owner'))) return;
    const title = interaction.fields.getTextInputValue('title').trim();
    const type = interaction.fields.getTextInputValue('type').trim().toLowerCase();
    const start = interaction.fields.getTextInputValue('start').trim();
    const duration = Number.parseInt(interaction.fields.getTextInputValue('duration').trim(), 10);
    const limitRaw = interaction.fields.getTextInputValue('limit').trim();
    const match = start.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
    if (!match) {
      await respond(interaction, errorPanel('Use the start format `YYYY-MM-DD HH:MM` in UTC.'));
      return;
    }
    const startsAt = new Date(`${match[1]}T${match[2]}:00.000Z`);
    if (Number.isNaN(startsAt.getTime()) || !Number.isFinite(duration) || duration < 15) {
      await respond(interaction, errorPanel('Check the start time and duration (minimum 15 minutes).'));
      return;
    }
    const typeValue = ['gaming', 'movie', 'study', 'meeting', 'discussion', 'other'].includes(type) ? type : 'other';
    try {
      const event = await createRoomEvent({
        client: getClient(),
        guild: interaction.guild,
        room,
        creator: interaction.user,
        input: {
          title,
          type: typeValue,
          startsAt,
          durationMinutes: duration,
          participantLimit: limitRaw ? clamp(Number.parseInt(limitRaw, 10) || 0, 0, 99) : 0,
        },
        actorId: interaction.user.id,
        actorName: interaction.user.username,
      });
      await respond(
        interaction,
        successPanel('Event created', `**${event.title}** starts <t:${Math.floor(startsAt.getTime() / 1000)}:F>.${event.syncError ? `\n⚠️ ${event.syncError}` : ''}`),
      );
    } catch (error) {
      await respond(interaction, errorPanel(error.message || 'Event creation failed.'));
    }
    return;
  }
  if (action === 'kick') {
    if (!(await guard(interaction, room, 'moderate'))) return;
    const reason = interaction.fields.getTextInputValue('reason').trim() || 'Removed from room';
    await kickMember({
      guild: interaction.guild,
      room,
      userId: extra,
      reason,
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    await refreshPanel(getClient(), room.id).catch(() => null);
    await respond(interaction, successPanel(`Removed <@${extra}>.`));
    return;
  }
}

export default { handleButton, handleSelectMenu, handleModal };
