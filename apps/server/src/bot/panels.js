import { ButtonStyle } from 'discord.js';
import { BUILTIN_ROOM_TYPES, PRIVACY_MODES, ROOM_LIMITS, privacyMeta } from '@chamber/shared';
import { ids } from '../lib/customIds.js';
import { button, panel, row, selectRow, stringSelect, userSelect, roleSelect, channelSelect, text } from '../lib/ui.js';

function roomAccent(room) {
  return room?.theme || room?.template?.accentColor || '#7c6cff';
}

export function roomTypeName(room, override) {
  if (override) return override;
  const builtin = BUILTIN_ROOM_TYPES.find((type) => type.key === room?.roomTypeKey);
  return builtin?.name ?? 'Room';
}

export function privacyLabel(room) {
  const meta = privacyMeta(room?.privacy);
  return `${meta.emoji} ${meta.label}`;
}

function expiryText(room) {
  if (!room.expiresAt) return 'until empty';
  return `<t:${Math.floor(new Date(room.expiresAt).getTime() / 1000)}:R>`;
}

function memberLine(member, ownerId) {
  const role = member.userId === ownerId ? '👑 owner' : member.role === 'ADMIN' ? '🛡️ admin' : 'member';
  const until = member.tempAdminUntil
    ? ` · until <t:${Math.floor(new Date(member.tempAdminUntil).getTime() / 1000)}:t>`
    : '';
  return `<@${member.userId}> — ${role}${until}`;
}

/**
 * The main persistent room control panel. Uses Discord Components V2
 * exclusively — no embeds anywhere in the bot.
 */
export function controlPanel(room, context = {}) {
  const {
    liveMembers = [],
    queueCount = 0,
    waitingCount = 0,
    typeName,
    templateName,
    ownerName,
  } = context;
  const members = liveMembers.length ? liveMembers : (room.members ?? []).map((m) => ({ ...m }));
  const memberIds = members.slice(0, 30).map((m) => `<@${m.userId}>`).join(', ');
  const type = roomTypeName(room, typeName);
  const badges = [];
  if (room.locked) badges.push('🔒 Locked');
  if (room.hidden) badges.push('🙈 Hidden');
  if (room.privacy === 'PASSWORD' && !room.passwordHash) badges.push('🔑 Waiting for you to set a password');
  if (queueCount > 0) badges.push(`⏳ ${queueCount} queued`);
  if (waitingCount > 0) badges.push(`🙋 ${waitingCount} waiting`);

  const blocks = [
    `### ${room.emoji || '🎧'} ${room.name}`,
    [
      `**Owner** <@${room.ownerId}>${ownerName ? ` (${ownerName})` : ''} · **Type** ${type}`,
      `**Members** ${members.length}/${room.userLimit || '∞'} · **Privacy** ${privacyLabel(room)}`,
      `**Created** <t:${Math.floor(new Date(room.createdAt).getTime() / 1000)}:R> · **Expires** ${expiryText(room)}`,
      badges.length ? badges.join(' · ') : null,
      templateName ? `-# Template: ${templateName}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    { separator: true },
    memberIds
      ? `**In the room**\n${memberIds}${members.length > 30 ? `\n-# and ${members.length - 30} more` : ''}`
      : '-# The room is waiting for its first guest.',
  ];

  const rows = [
    row(
      button({ id: ids.room('rename', room.id), label: 'Rename', emoji: '✏️' }),
      button({ id: ids.room('limit', room.id), label: 'User Limit', emoji: '👥' }),
      button({ id: ids.room('lock', room.id), label: 'Lock', emoji: '🔒' }),
      button({ id: ids.room('unlock', room.id), label: 'Unlock', emoji: '🔓' }),
    ),
    row(
      button({ id: ids.room('hide', room.id), label: 'Hide', emoji: '🙈' }),
      button({ id: ids.room('reveal', room.id), label: 'Reveal', emoji: '👁️' }),
      button({ id: ids.room('invite', room.id), label: 'Invite', emoji: '➕' }),
      button({ id: ids.room('kick', room.id), label: 'Kick', emoji: '👢' }),
    ),
    row(
      button({ id: ids.room('transfer', room.id), label: 'Transfer', emoji: '👑' }),
      button({ id: ids.room('clone', room.id), label: 'Clone', emoji: '⧉' }),
      button({ id: ids.room('queue', room.id), label: 'Queue', emoji: '⏳' }),
      button({ id: ids.room('privacy', room.id), label: 'Privacy', emoji: '🛡️' }),
    ),
    row(
      button({ id: ids.room('members', room.id), label: 'Members', emoji: '🧑' }),
      button({ id: ids.room('settings', room.id), label: 'Settings', emoji: '⚙️' }),
      button({ id: ids.room('stats', room.id), label: 'Statistics', emoji: '📊' }),
      button({ id: ids.room('refresh', room.id), label: 'Refresh', emoji: '🔄', style: ButtonStyle.Primary }),
    ),
    row(button({ id: ids.room('delete', room.id), label: 'Delete Room', emoji: '🗑️', style: ButtonStyle.Danger })),
  ];

  return panel({ accentColor: roomAccent(room), blocks, rows });
}

export function settingsPanel(room, { typeName, aiEnabled = false } = {}) {
  const options = [
    { label: 'Change topic', value: 'topic', emoji: '📝', description: 'Set the room topic (shown in Discord)' },
    { label: 'Change bitrate', value: 'bitrate', emoji: '🎚️', description: 'Audio quality in kbps' },
    { label: 'Set lifetime', value: 'expiry', emoji: '⏱️', description: 'Automatic expiration window' },
    { label: 'Apply template', value: 'template', emoji: '🧩', description: 'Reset defaults from a template' },
    { label: 'Reset room', value: 'reset', emoji: '↩️', description: 'Restore the template configuration' },
  ];
  if (aiEnabled) {
    options.push({ label: 'AI suggestions', value: 'ai', emoji: '✨', description: 'Get configuration ideas' });
  }

  return panel({
    accentColor: roomAccent(room),
    blocks: [
      `### ⚙️ Settings · ${room.name}`,
      `Fine-tune **${room.name}**. Every change is applied to Discord immediately and saved to the database.`,
      { separator: true },
      `**Privacy** ${privacyLabel(room)} · **Limit** ${room.userLimit || '∞'} · **Bitrate** ${Math.round(room.bitrate / 1000)} kbps`,
      `-# ${room.description || 'No room description set.'}`,
    ],
    rows: [
      selectRow(stringSelect({ id: ids.select('setting', room.id), placeholder: 'Choose a setting to change…', options })),
      selectRow(
        channelSelect({
          id: ids.select('category', room.id),
          placeholder: 'Move this room to another category…',
          channelTypes: [4],
        }),
      ),
      row(
        button({ id: ids.settings('allowed', room.id), label: 'Allowed', emoji: '✅' }),
        button({ id: ids.settings('blocked', room.id), label: 'Blocked', emoji: '⛔' }),
        button({ id: ids.settings('admins', room.id), label: 'Admins', emoji: '🛡️' }),
        button({ id: ids.settings('waiting', room.id), label: 'Waiting room', emoji: '🙋' }),
      ),
      row(
        button({ id: ids.settings('events', room.id), label: 'Events', emoji: '📅' }),
        button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary }),
        button({ id: ids.settings('refresh', room.id), label: 'Refresh', emoji: '🔄' }),
      ),
    ],
  });
}

export function membersPanel(room, { liveMembers = [] } = {}) {
  const members = liveMembers.length ? liveMembers : (room.members ?? []);
  const admins = members.filter((m) => m.role === 'ADMIN');
  const list = members.length
    ? members
        .slice(0, 25)
        .map((m) => memberLine(m, room.ownerId))
        .join('\n')
    : '-# No members are currently in the room.';
  return panel({
    accentColor: roomAccent(room),
    blocks: [`### 🧑 Members · ${room.name}`, list, { separator: true }, `Temporary admins: **${admins.length}** · Config limit: **${room.userLimit || '∞'}**`],
    rows: [
      selectRow(
        userSelect({
          id: ids.select('memberkick', room.id),
          placeholder: 'Kick a member from the room…',
          disabled: members.length === 0,
        }),
      ),
      selectRow(
        userSelect({
          id: ids.select('memberpromote', room.id),
          placeholder: 'Promote a member to temporary admin…',
          disabled: members.length === 0,
        }),
      ),
      selectRow(
        stringSelect({
          id: ids.select('demote', room.id),
          placeholder: admins.length ? 'Remove a temporary admin…' : 'No temporary admins to remove',
          disabled: admins.length === 0,
          options: admins.map((m) => ({ label: `Admin · ${m.userId}`, value: m.userId })),
        }),
      ),
      selectRow(
        stringSelect({
          id: ids.select('voicemod', room.id),
          placeholder: members.length ? 'Mute or deafen a member…' : 'No members to moderate',
          disabled: members.length === 0,
          options: members.slice(0, 6).flatMap((m) => {
            const name = (m.name || m.userId).slice(0, 40);
            return [
              { label: `Mute · ${name}`.slice(0, 100), value: `mute:${m.userId}`, emoji: '🔇' },
              { label: `Unmute · ${name}`.slice(0, 100), value: `unmute:${m.userId}`, emoji: '🔊' },
              { label: `Deafen · ${name}`.slice(0, 100), value: `deafen:${m.userId}`, emoji: '🎧' },
              { label: `Undeafen · ${name}`.slice(0, 100), value: `undeafen:${m.userId}`, emoji: '👂' },
            ];
          }),
        }),
      ),
      row(
        button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary }),
        button({ id: ids.room('refresh', room.id), label: 'Refresh', emoji: '🔄' }),
      ),
    ],
  });
}

export function privacyPanel(room) {
  return panel({
    accentColor: roomAccent(room),
    blocks: [
      `### 🛡️ Privacy · ${room.name}`,
      `Current mode: ${privacyLabel(room)}`,
      '-# Password protection is verified by the bot before access is granted. Discord does not expose native voice passwords.',
      { separator: true },
      'Choose a mode below. Selecting **Password** asks you for a password. Selecting a role adds it to the allow-list and activates **Role restricted**.',
    ],
    rows: [
      selectRow(
        stringSelect({
          id: ids.select('privacy', room.id),
          placeholder: 'Choose a privacy mode…',
          options: PRIVACY_MODES.map((mode) => ({
            label: mode.label,
            value: mode.value,
            emoji: mode.emoji,
            description: mode.description.slice(0, 100),
            default: mode.value === room.privacy,
          })),
        }),
      ),
      selectRow(roleSelect({ id: ids.select('privacyrole', room.id), placeholder: 'Allow a role (activates Role restricted)…' })),
      row(
        button({ id: ids.room('password', room.id), label: 'Set password', emoji: '🔑' }),
        button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary }),
      ),
    ],
  });
}

export function statsPanel(room, { history = [], queueCount = 0, waitingCount = 0, liveCount = 0 } = {}) {
  const totalHistoryMinutes = history.reduce((sum, entry) => sum + (entry.durationSeconds || 0), 0);
  const latest = history.slice(0, 5);
  return panel({
    accentColor: roomAccent(room),
    blocks: [
      `### 📊 Statistics · ${room.name}`,
      [
        `**Live members** ${liveCount} · **Peak** ${room.peakMembers} · **Total joins** ${room.totalJoins}`,
        `**Queue** ${queueCount} · **Waiting requests** ${waitingCount}`,
        `**Created** <t:${Math.floor(new Date(room.createdAt).getTime() / 1000)}:f>`,
        `**Room history entries** ${history.length} · **Historical voice time** ${Math.round(totalHistoryMinutes / 60)} min`,
      ].join('\n'),
      latest.length ? `**Recent history**\n${latest.map((entry) => `-# ${entry.name} · ${Math.round((entry.durationSeconds || 0) / 60)}m · ${entry.endReason || 'closed'}`).join('\n')}` : '',
    ].filter(Boolean),
    rows: [
      row(
        button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary }),
        button({ id: ids.room('refresh', room.id), label: 'Refresh', emoji: '🔄' }),
      ),
    ],
  });
}

export function queuePanel(room, { entries = [] } = {}) {
  const list = entries.length
    ? entries
        .slice(0, 20)
        .map((entry, index) => {
          const priority = entry.priority > 0 ? ' ⭐' : '';
          return `**${index + 1}.** <@${entry.userId}>${priority} · <t:${Math.floor(new Date(entry.joinedAt).getTime() / 1000)}:R>`;
        })
        .join('\n')
    : '-# The queue is empty.';
  return panel({
    accentColor: roomAccent(room),
    blocks: [
      `### ⏳ Queue · ${room.name}`,
      `**${entries.length}** waiting · limit configured in the dashboard. Admission is controlled by the room owner.`,
      { separator: true },
      list,
    ],
    rows: [
      row(
        button({
          id: ids.queue('admit', room.id),
          label: 'Admit next',
          emoji: '✅',
          style: ButtonStyle.Success,
          disabled: entries.length === 0,
        }),
        button({ id: ids.queue('join', room.id), label: 'Join queue', emoji: '➕' }),
        button({ id: ids.queue('leave', room.id), label: 'Leave queue', emoji: '🚪' }),
        button({ id: ids.queue('refresh', room.id), label: 'Refresh', emoji: '🔄' }),
        button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️', style: ButtonStyle.Primary }),
      ),
    ],
  });
}

export function waitingCard(request, { room, requesterName, requesterId, expiresAt } = {}) {
  return panel({
    accentColor: '#fbbf24',
    blocks: [
      `### 🙋 Access request · ${room?.name ?? 'Room'}`,
      `**Member** <@${requesterId ?? request.userId}>${requesterName ? ` (${requesterName})` : ''}\n**Message** ${request.message || '_No message provided._'}\n**Expires** <t:${Math.floor(new Date(expiresAt ?? request.expiresAt).getTime() / 1000)}:R>`,
      { separator: true },
      'Accepting grants private channel access and moves the member in if they are already in voice. Rejecting notifies the member.',
    ],
    rows: [
      row(
        button({ id: ids.waiting('accept', request.id), label: 'Accept', emoji: '✅', style: ButtonStyle.Success }),
        button({ id: ids.waiting('reject', request.id), label: 'Reject', emoji: '⛔', style: ButtonStyle.Danger }),
      ),
    ],
  });
}

export function eventCard(event, { roomName, creatorName, participantCount = 0 } = {}) {
  const limit = event.participantLimit > 0 ? event.participantLimit : '∞';
  return panel({
    accentColor: '#22d3ee',
    blocks: [
      `### 📅 ${event.title}`,
      [
        `**Room** ${roomName ?? 'Temporary room'} · **Host** <@${event.creatorId}>${creatorName ? ` (${creatorName})` : ''}`,
        `**Type** ${event.type} · **Starts** <t:${Math.floor(new Date(event.startsAt).getTime() / 1000)}:F>`,
        `**Participants** ${participantCount}/${limit}`,
        event.description ? `\n${event.description}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      { separator: true },
      'RSVP through the buttons below. Participant limits are enforced by the bot.',
    ],
    rows: [
      row(
        button({ id: ids.event('join', event.id), label: 'Join event', emoji: '✅', style: ButtonStyle.Success }),
        button({ id: ids.event('leave', event.id), label: 'Leave event', emoji: '🚪' }),
        button({ id: ids.event('cancel', event.id), label: 'Cancel event', emoji: '⛔', style: ButtonStyle.Danger }),
      ),
    ],
  });
}

export function lobbyPanel(rooms, { guildName } = {}) {
  const visible = rooms.slice(0, 10);
  const directory = visible.length
    ? visible
        .map((room) => {
          const meta = privacyMeta(room.privacy);
          return `**${room.emoji || '🎧'} ${room.name}** — <@${room.ownerId}> · ${room.memberCount}/${room.userLimit || '∞'} · ${meta.emoji} ${meta.label}`;
        })
        .join('\n')
    : '-# No temporary rooms are active right now. Join a trigger channel to create one.';
  const requestable = rooms.filter((room) => room.privacy === 'REQUEST');
  return panel({
    accentColor: '#7c6cff',
    blocks: [
      `### 🏛️ Room directory${guildName ? ` · ${guildName}` : ''}`,
      'Browse active temporary rooms. Rooms set to **Request to join** can be requested from the menu below.',
      { separator: true },
      directory,
    ],
    rows: [
      selectRow(
        stringSelect({
          id: ids.lobby('request'),
          placeholder: requestable.length ? 'Request access to a private room…' : 'No rooms are accepting requests',
          disabled: requestable.length === 0,
          options: requestable.slice(0, 25).map((room) => ({
            label: `${room.emoji || '🎧'} ${room.name}`, 
            value: room.id,
            description: `Owner: ${room.ownerName || room.ownerId}`.slice(0, 100),
          })),
        }),
      ),
      row(
        button({ id: ids.lobby('refresh'), label: 'Refresh', emoji: '🔄', style: ButtonStyle.Primary }),
        button({ id: ids.lobby('help'), label: 'How it works', emoji: '❔' }),
      ),
    ],
  });
}

export function confirmPanel({ title, body, confirmId, cancelId, confirmLabel = 'Confirm', danger = true }) {
  return panel({
    accentColor: danger ? '#fb7185' : '#7c6cff',
    blocks: [`### ${title}`, body],
    rows: [
      row(
        button({
          id: confirmId,
          label: confirmLabel,
          emoji: danger ? '⚠️' : '✅',
          style: danger ? ButtonStyle.Danger : ButtonStyle.Success,
        }),
        button({ id: cancelId, label: 'Cancel', emoji: '✖️' }),
      ),
    ],
  });
}

export function noticePanel({ title, body, accentColor = '#7c6cff', extra = null }) {
  return panel({
    accentColor,
    blocks: [`### ${title}`, body, ...(extra ? [extra] : [])],
  });
}

export function mergeRequestPanel(merge, { requesterRoom, targetRoom, requesterName } = {}) {
  return panel({
    accentColor: '#a78bfa',
    blocks: [
      `### 🔀 Merge request`,
      `**From** <@${merge.requesterId}>${requesterName ? ` (${requesterName})` : ''} — **${requesterRoom?.name ?? 'Room'}**`,
      `**Into your room** ${targetRoom?.name ?? ''}`,
      { separator: true },
      'If you accept, members and allow-lists are moved into your room and the other room is deleted once empty. Both owners are notified.',
    ],
    rows: [
      row(
        button({ id: ids.merge('accept', merge.id), label: 'Accept merge', emoji: '✅', style: ButtonStyle.Success }),
        button({ id: ids.merge('reject', merge.id), label: 'Reject', emoji: '⛔', style: ButtonStyle.Danger }),
      ),
    ],
  });
}

export function aiSuggestionPanel(suggestion, { room } = {}) {
  const lines = [
    `### ✨ AI suggestions${room ? ` · ${room.name}` : ''}`,
    `**Source** ${suggestion.source === 'ai' ? 'AI provider' : 'built-in heuristic engine'} · **Recommended template** ${suggestion.template?.name ?? 'Custom'}`,
    { separator: true },
    suggestion.suggestions
      ? [
          `**Privacy** ${suggestion.suggestions.privacy}`,
          `**User limit** ${suggestion.suggestions.userLimit || 'unlimited'}`,
          `**Bitrate** ${suggestion.suggestions.bitrate ? `${Math.round(suggestion.suggestions.bitrate / 1000)} kbps` : 'unchanged'}`,
        ].join('\n')
      : '',
    suggestion.rationale?.length ? `**Why**\n${suggestion.rationale.map((line) => `• ${line}`).join('\n')}` : '',
    '-# Suggestions never modify the room on their own. Applying them requires explicit confirmation.',
  ].filter(Boolean);

  const rows = [];
  if (room && suggestion.suggestions) {
    rows.push(
      row(
        button({ id: ids.room('ai-apply', room.id), label: 'Apply suggestions', emoji: '✅', style: ButtonStyle.Success }),
        button({ id: ids.settings('back', room.id), label: 'Back', emoji: '⬅️' }),
      ),
    );
  }
  return panel({ accentColor: '#c084fc', blocks: lines, rows });
}

export function logPanel({ action, actorName, actorId, target, metadata, guildName }) {
  const metaText =
    metadata && Object.keys(metadata).length
      ? Object.entries(metadata)
          .slice(0, 8)
          .map(([key, value]) => `**${key}** ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
          .join(' · ')
      : null;
  return panel({
    accentColor: '#64748b',
    blocks: [
      `### 📝 ${action}`,
      [
        guildName ? `**Server** ${guildName}` : null,
        `**Actor** ${actorId ? `<@${actorId}>` : 'System'}${actorName ? ` (${actorName})` : ''}`,
        target ? `**Target** ${target}` : null,
        metaText,
        `**When** <t:${Math.floor(Date.now() / 1000)}:T>`,
      ]
        .filter(Boolean)
        .join('\n'),
    ],
  });
}

export const PANEL_TEXT_LIMIT = ROOM_LIMITS.topicMax;
