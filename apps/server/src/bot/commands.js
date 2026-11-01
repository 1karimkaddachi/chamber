import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import prisma from '@chamber/db';
import { PRIVACY_MODES, ROOM_LIMITS } from '@chamber/shared';
import config from '../config.js';
import { getClient } from '../lib/botState.js';
import { ids } from '../lib/customIds.js';
import { AppError, ForbiddenError } from '../lib/errors.js';
import {
  button,
  errorPanel,
  infoPanel,
  linkButton,
  panel,
  respond,
  row,
  successPanel,
} from '../lib/ui.js';
import { computeAccess, ensureConfig, ensureGuildRecord } from '../services/guildService.js';
import {
  buildRoomContext,
  claimRoom,
  cloneRoom,
  createRoom,
  deleteRoom,
  getRoomById,
  getRoomByChannel,
  cleanupGuildRooms,
  applyPermissions,
  moveMember,
  transferOwnership,
  updateRoom,
} from '../services/roomService.js';
import { getRoomAccess, requireRoomAccess } from '../services/accessService.js';
import { listTemplates, getTemplate } from '../services/templateService.js';
import { listRoomTypes, getRoomType } from '../services/roomTypeService.js';
import { inviteMember, kickMember, banMember, unbanMember } from '../services/roomService.js';
import { requestRoomAccess, verifyRoomPassword } from '../services/privacyService.js';
import { joinQueue, leaveQueue, listQueue, admitNext } from '../services/queueService.js';
import { createReservation } from '../services/reservationService.js';
import { createRoomEvent } from '../services/eventService.js';
import { requestMerge } from '../services/mergeService.js';
import { generateSuggestions } from '../services/aiService.js';
import { getAnalytics } from '../services/analyticsService.js';
import { writeAudit } from '../services/auditService.js';
import {
  aiSuggestionPanel,
  confirmPanel,
  controlPanel,
  membersPanel,
  noticePanel,
  privacyPanel,
  queuePanel,
  settingsPanel,
  statsPanel,
} from './panels.js';
import { setSuggestion } from './aiCache.js';

const privacyChoices = PRIVACY_MODES.map((mode) => ({ name: `${mode.emoji} ${mode.label}`, value: mode.value }));
const durationChoices = [
  { name: '15 minutes', value: 15 },
  { name: '30 minutes', value: 30 },
  { name: '45 minutes', value: 45 },
  { name: '1 hour', value: 60 },
  { name: '90 minutes', value: 90 },
  { name: '2 hours', value: 120 },
  { name: '3 hours', value: 180 },
  { name: '4 hours', value: 240 },
  { name: '8 hours', value: 480 },
  { name: '12 hours', value: 720 },
];
const banDurationChoices = [
  { name: 'Permanent', value: 0 },
  { name: '10 minutes', value: 10 },
  { name: '30 minutes', value: 30 },
  { name: '1 hour', value: 60 },
  { name: '4 hours', value: 240 },
  { name: '1 day', value: 1440 },
  { name: '7 days', value: 10080 },
];

const eventTypeChoices = [
  { name: '🎮 Gaming session', value: 'gaming' },
  { name: '🍿 Movie night', value: 'movie' },
  { name: '📚 Study session', value: 'study' },
  { name: '🗂️ Meeting', value: 'meeting' },
  { name: '💬 Private discussion', value: 'discussion' },
  { name: '✨ Other', value: 'other' },
];

function roomBuilder() {
  const builder = new SlashCommandBuilder()
    .setName('room')
    .setDescription('Manage your temporary voice room')
    .setDMPermission(false);

  builder.addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create a temporary room for yourself')
      .addStringOption((option) =>
        option.setName('name').setDescription('Custom room name').setMaxLength(ROOM_LIMITS.nameMax),
      )
      .addStringOption((option) =>
        option.setName('template').setDescription('Room template').setAutocomplete(true),
      )
      .addStringOption((option) => option.setName('type').setDescription('Room type').setAutocomplete(true))
      .addStringOption((option) =>
        option.setName('privacy').setDescription('Starting privacy mode').addChoices(...privacyChoices),
      )
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription('User limit (0 = unlimited)')
          .setMinValue(0)
          .setMaxValue(ROOM_LIMITS.userLimitMax),
      ),
  );
  builder.addSubcommand((sub) => sub.setName('delete').setDescription('Delete your room'));
  builder.addSubcommand((sub) =>
    sub
      .setName('rename')
      .setDescription('Rename your room')
      .addStringOption((option) =>
        option.setName('name').setDescription('New room name').setRequired(true).setMaxLength(ROOM_LIMITS.nameMax),
      ),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('limit')
      .setDescription('Change the user limit')
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription('0 for unlimited, otherwise 1-99')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(ROOM_LIMITS.userLimitMax),
      ),
  );
  builder.addSubcommand((sub) => sub.setName('lock').setDescription('Prevent new members from joining'));
  builder.addSubcommand((sub) => sub.setName('unlock').setDescription('Allow new members to join'));
  builder.addSubcommand((sub) => sub.setName('hide').setDescription('Hide the room from the channel list'));
  builder.addSubcommand((sub) => sub.setName('reveal').setDescription('Make the room visible again'));
  builder.addSubcommand((sub) =>
    sub
      .setName('invite')
      .setDescription('Invite a member')
      .addUserOption((option) => option.setName('user').setDescription('Member to invite').setRequired(true)),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('kick')
      .setDescription('Remove a member from the room')
      .addUserOption((option) => option.setName('user').setDescription('Member to remove').setRequired(true)),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('ban')
      .setDescription('Ban or block a member from the room')
      .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption((option) =>
        option.setName('duration').setDescription('How long the ban lasts').addChoices(...banDurationChoices),
      )
      .addStringOption((option) => option.setName('reason').setDescription('Reason').setMaxLength(200)),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('unban')
      .setDescription('Unban a member')
      .addUserOption((option) => option.setName('user').setDescription('Member to unban').setRequired(true)),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('transfer')
      .setDescription('Transfer room ownership')
      .addUserOption((option) => option.setName('user').setDescription('New owner').setRequired(true)),
  );
  builder.addSubcommand((sub) => sub.setName('clone').setDescription('Clone your room with a new owner'));
  builder.addSubcommand((sub) => sub.setName('claim').setDescription('Claim your current room when the owner is gone'));
  builder.addSubcommand((sub) =>
    sub
      .setName('privacy')
      .setDescription('Change the privacy mode')
      .addStringOption((option) =>
        option.setName('mode').setDescription('Privacy mode').setRequired(true).addChoices(...privacyChoices),
      ),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('permissions')
      .setDescription('View or change the room allow-list')
      .addStringOption((option) =>
        option
          .setName('action')
          .setDescription('What to do')
          .addChoices(
            { name: 'View allow-list', value: 'view' },
            { name: 'Allow a member', value: 'allow' },
            { name: 'Remove a member', value: 'remove' },
          ),
      )
      .addUserOption((option) => option.setName('user').setDescription('Member'))
      .addRoleOption((option) => option.setName('role').setDescription('Role to allow')),
  );
  builder.addSubcommand((sub) => sub.setName('members').setDescription('Manage room members'));
  builder.addSubcommand((sub) => sub.setName('info').setDescription('Open the room control panel'));
  builder.addSubcommand((sub) => sub.setName('settings').setDescription('Open advanced room settings'));
  builder.addSubcommand((sub) =>
    sub
      .setName('queue')
      .setDescription('Use the room queue')
      .addStringOption((option) =>
        option
          .setName('action')
          .setDescription('Queue action')
          .setRequired(true)
          .addChoices(
            { name: 'Join queue', value: 'join' },
            { name: 'Leave queue', value: 'leave' },
            { name: 'View queue', value: 'list' },
            { name: 'Admit next', value: 'admit' },
          ),
      )
      .addStringOption((option) => option.setName('room').setDescription('Room').setAutocomplete(true)),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('reserve')
      .setDescription('Reserve a room for later')
      .addStringOption((option) =>
        option.setName('date').setDescription('Date (YYYY-MM-DD, UTC)').setRequired(true).setMaxLength(10),
      )
      .addStringOption((option) =>
        option.setName('time').setDescription('Time (HH:MM, UTC)').setRequired(true).setMaxLength(5),
      )
      .addIntegerOption((option) =>
        option.setName('duration').setDescription('Duration').setRequired(true).addChoices(...durationChoices),
      )
      .addStringOption((option) =>
        option.setName('name').setDescription('Room name').setRequired(true).setMaxLength(ROOM_LIMITS.nameMax),
      )
      .addStringOption((option) => option.setName('type').setDescription('Room type').setAutocomplete(true))
      .addStringOption((option) =>
        option.setName('privacy').setDescription('Privacy').addChoices(...privacyChoices),
      ),
  );
  builder.addSubcommand((sub) => sub.setName('statistics').setDescription('Show your room statistics'));

  return builder;
}

function chamberBuilder() {
  return new SlashCommandBuilder()
    .setName('chamber')
    .setDescription('Access, requests, merges, events and AI room suggestions')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('access')
        .setDescription('Enter a password-protected room')
        .addStringOption((option) =>
          option.setName('room').setDescription('Password-protected room').setRequired(true).setAutocomplete(true),
        )
        .addStringOption((option) => option.setName('password').setDescription('Room password')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('request')
        .setDescription('Request access to a private room')
        .addStringOption((option) =>
          option.setName('room').setDescription('Room').setRequired(true).setAutocomplete(true),
        )
        .addStringOption((option) => option.setName('message').setDescription('Message for the owner').setMaxLength(300)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('move')
        .setDescription('Move a member from your room to another voice channel')
        .addUserOption((option) => option.setName('user').setDescription('Member to move').setRequired(true))
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Destination voice channel')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildVoice),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('merge')
        .setDescription('Ask another owner to merge their room into yours')
        .addStringOption((option) =>
          option.setName('target').setDescription('Room to merge').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('event')
        .setDescription('Create an event in your room')
        .addStringOption((option) => option.setName('title').setDescription('Event title').setRequired(true).setMaxLength(80))
        .addStringOption((option) =>
          option.setName('type').setDescription('Event type').setRequired(true).addChoices(...eventTypeChoices),
        )
        .addStringOption((option) =>
          option
            .setName('start')
            .setDescription('Start time (YYYY-MM-DD HH:MM, UTC)')
            .setRequired(true)
            .setMaxLength(16),
        )
        .addIntegerOption((option) =>
          option.setName('duration').setDescription('Duration').setRequired(true).addChoices(...durationChoices),
        )
        .addIntegerOption((option) =>
          option.setName('limit').setDescription('Participant limit (0 = unlimited)').setMinValue(0).setMaxValue(99),
        )
        .addStringOption((option) =>
          option.setName('description').setDescription('Event description').setMaxLength(500),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('ai')
        .setDescription('Get AI-powered room configuration suggestions')
        .addStringOption((option) =>
          option.setName('purpose').setDescription('What is the room for?').setRequired(true).setMaxLength(120),
        )
        .addIntegerOption((option) =>
          option.setName('members').setDescription('Expected member count').setMinValue(1).setMaxValue(99),
        ),
    );
}

function tempvoiceBuilder() {
  return new SlashCommandBuilder()
    .setName('tempvoice')
    .setDescription('Configure temporary voice rooms for this server')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Create the trigger channel configuration')
        .addChannelOption((option) =>
          option
            .setName('trigger')
            .setDescription('Voice channel members join to create a room')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildVoice),
        )
        .addChannelOption((option) =>
          option
            .setName('category')
            .setDescription('Category where temporary rooms are created')
            .addChannelTypes(ChannelType.GuildCategory),
        )
        .addStringOption((option) => option.setName('template').setDescription('Default template').setAutocomplete(true))
        .addStringOption((option) => option.setName('type').setDescription('Default room type').setAutocomplete(true)),
    )
    .addSubcommand((sub) => sub.setName('enable').setDescription('Enable temporary voice'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Disable temporary voice'))
    .addSubcommand((sub) => sub.setName('configure').setDescription('Show the current configuration'))
    .addSubcommand((sub) =>
      sub
        .setName('triggers')
        .setDescription('Manage trigger channels')
        .addStringOption((option) =>
          option
            .setName('action')
            .setDescription('Action')
            .setRequired(true)
            .addChoices(
              { name: 'List', value: 'list' },
              { name: 'Add', value: 'add' },
              { name: 'Remove', value: 'remove' },
            ),
        )
        .addChannelOption((option) =>
          option.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('categories')
        .setDescription('Manage voice categories')
        .addStringOption((option) =>
          option
            .setName('action')
            .setDescription('Action')
            .setRequired(true)
            .addChoices(
              { name: 'List', value: 'list' },
              { name: 'Add', value: 'add' },
              { name: 'Remove', value: 'remove' },
            ),
        )
        .addChannelOption((option) =>
          option.setName('category').setDescription('Category').addChannelTypes(ChannelType.GuildCategory),
        )
        .addIntegerOption((option) =>
          option.setName('max_rooms').setDescription('Maximum rooms in this category (0 = unlimited)').setMinValue(0),
        ),
    )
    .addSubcommand((sub) => sub.setName('templates').setDescription('List room templates'))
    .addSubcommand((sub) => sub.setName('active').setDescription('List active rooms'))
    .addSubcommand((sub) => sub.setName('statistics').setDescription('Show server analytics'))
    .addSubcommand((sub) => sub.setName('cleanup').setDescription('Delete empty rooms and close orphaned records'))
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Reset all temporary voice configuration (rooms stay active)')
        .addBooleanOption((option) =>
          option.setName('confirm').setDescription('Confirm the reset').setRequired(true),
        ),
    );
}

export const commandData = [tempvoiceBuilder(), roomBuilder(), chamberBuilder()].map((builder) => builder.toJSON());

async function requireAdministrator(interaction) {
  const configForGuild = await ensureConfig(interaction.guildId);
  const access = computeAccess(interaction.member, configForGuild, interaction.guild);
  if (!access.admin) throw new ForbiddenError('You need Manage Server or a configured staff admin role.');
  return configForGuild;
}

async function ownedRoom(interaction) {
  const room = await prisma.activeRoom.findFirst({
    where: { guildId: interaction.guildId, ownerId: interaction.user.id, status: 'ACTIVE' },
  });
  if (!room) throw new AppError('You do not own an active temporary room.', { status: 404, code: 'NO_ROOM' });
  return getRoomById(room.id);
}

async function manageableRoom(interaction) {
  const voiceChannelId = interaction.member?.voice?.channelId;
  if (voiceChannelId) {
    const byChannel = await getRoomByChannel(voiceChannelId);
    if (byChannel) return byChannel;
  }
  return ownedRoom(interaction);
}

function passwordModal(customId, title) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('password')
          .setLabel('Password')
          .setStyle(TextInputStyle.Short)
          .setMinLength(ROOM_LIMITS.passwordMin)
          .setMaxLength(ROOM_LIMITS.passwordMax)
          .setRequired(true),
      ),
    );
}

async function handleTempvoice(interaction) {
  const subcommand = interaction.options.getSubcommand();
  await ensureGuildRecord({
    id: interaction.guild.id,
    name: interaction.guild.name,
    icon: interaction.guild.iconURL({ size: 128 }),
    ownerId: interaction.guild.ownerId,
    botPresent: true,
  });

  if (subcommand === 'configure') {
    const configForGuild = await ensureConfig(interaction.guildId);
    const [triggers, categories, templates, types] = await Promise.all([
      prisma.triggerChannel.count({ where: { guildId: interaction.guildId } }),
      prisma.voiceCategory.count({ where: { guildId: interaction.guildId } }),
      listTemplates(interaction.guildId),
      listRoomTypes(interaction.guildId),
    ]);
    const dashboard = config.webOrigin;
    const summary = panel({
      accentColor: '#7c6cff',
      blocks: [
        '### ⚙️ Chamber configuration',
        [
          `**Status** ${configForGuild.enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
          `**Triggers** ${triggers} · **Categories** ${categories} · **Templates** ${templates.length} · **Room types** ${types.length}`,
          `**Default privacy** ${configForGuild.defaultPrivacy} · **Default limit** ${configForGuild.defaultUserLimit || '∞'}`,
          `**Queue** ${configForGuild.queueEnabled ? 'on' : 'off'} · **Waiting room** ${configForGuild.waitingRoomEnabled ? 'on' : 'off'} · **Reservations** ${configForGuild.reservationsEnabled ? 'on' : 'off'}`,
          `**Cleanup** ${configForGuild.autoCleanup ? `after ${configForGuild.emptyGraceSeconds}s` : 'off'} · **Lifetime** ${configForGuild.roomLifetimeMinutes || '∞'} min`,
        ].join('\n'),
        '-# The web dashboard is the recommended place to configure every detail.',
      ],
      rows: [
        row(linkButton({ url: dashboard, label: 'Open dashboard', emoji: '🖥️' })),
      ],
    });
    return respond(interaction, summary);
  }

  await requireAdministrator(interaction);

  if (subcommand === 'setup') {
    const trigger = interaction.options.getChannel('trigger', true);
    const category = interaction.options.getChannel('category');
    if (trigger.type !== ChannelType.GuildVoice) throw new AppError('Choose a voice trigger channel.');
    if (category && category.type !== ChannelType.GuildCategory) throw new AppError('Choose a category.');
    const templateId = interaction.options.getString('template');
    const typeKey = interaction.options.getString('type');
    const template = templateId ? await getTemplate(interaction.guildId, templateId) : null;
    const roomType = typeKey ? await getRoomType(interaction.guildId, typeKey) : null;
    await prisma.triggerChannel.upsert({
      where: { guildId_channelId: { guildId: interaction.guildId, channelId: trigger.id } },
      create: {
        guildId: interaction.guildId,
        channelId: trigger.id,
        name: trigger.name,
        categoryId: category?.id ?? trigger.parentId ?? null,
        templateId: template?.id ?? null,
        roomTypeKey: roomType?.key ?? null,
      },
      update: {
        enabled: true,
        name: trigger.name,
        categoryId: category?.id ?? trigger.parentId ?? null,
        templateId: template?.id ?? null,
        roomTypeKey: roomType?.key ?? null,
      },
    });
    await ensureConfig(interaction.guildId);
    await prisma.guildConfig.update({
      where: { guildId: interaction.guildId },
      data: {
        setupCompleted: true,
        defaultTriggerChannelId: trigger.id,
        defaultCategoryId: category?.id ?? trigger.parentId ?? null,
        ...(template ? { defaultTemplateId: template.id } : {}),
      },
    });
    await writeAudit({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      actorName: interaction.user.username,
      action: 'trigger.created',
      category: 'CONFIG',
      targetType: 'channel',
      targetId: trigger.id,
      metadata: { categoryId: category?.id ?? trigger.parentId, template: template?.name ?? null },
    });
    return respond(
      interaction,
      successPanel(
        'Setup complete',
        `Members who join <#${trigger.id}> will now get their own temporary room.\nRooms are created in **${category?.name ?? trigger.parent?.name ?? 'the channel category'}**.`,
      ),
    );
  }

  if (subcommand === 'enable' || subcommand === 'disable') {
    await prisma.guildConfig.update({
      where: { guildId: interaction.guildId },
      data: { enabled: subcommand === 'enable' },
    });
    return respond(interaction, successPanel(`Temporary voice ${subcommand === 'enable' ? 'enabled' : 'disabled'}.`));
  }

  if (subcommand === 'triggers') {
    const action = interaction.options.getString('action', true);
    if (action === 'list') {
      const triggers = await prisma.triggerChannel.findMany({ where: { guildId: interaction.guildId } });
      return respond(
        interaction,
        panel({
          accentColor: '#7c6cff',
          blocks: [
            '### 🎚️ Trigger channels',
            triggers.length
              ? triggers
                  .map((trigger) => `<#${trigger.channelId}> · ${trigger.enabled ? 'enabled' : 'disabled'} · template ${trigger.templateId ? 'set' : 'default'}`)
                  .join('\n')
              : '-# No trigger channels configured.',
          ],
        }),
      );
    }
    const channel = interaction.options.getChannel('channel');
    if (!channel) throw new AppError('Choose a voice channel.');
    if (action === 'remove') {
      await prisma.triggerChannel.deleteMany({
        where: { guildId: interaction.guildId, channelId: channel.id },
      });
      const configForGuild = await ensureConfig(interaction.guildId);
      if (configForGuild.defaultTriggerChannelId === channel.id) {
        await prisma.guildConfig.update({
          where: { guildId: interaction.guildId },
          data: { defaultTriggerChannelId: null },
        });
      }
      await writeAudit({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: 'trigger.deleted',
        category: 'CONFIG',
        targetType: 'channel',
        targetId: channel.id,
      });
      return respond(interaction, successPanel(`Removed <#${channel.id}> from triggers.`));
    }
    await prisma.triggerChannel.upsert({
      where: { guildId_channelId: { guildId: interaction.guildId, channelId: channel.id } },
      create: {
        guildId: interaction.guildId,
        channelId: channel.id,
        name: channel.name,
        categoryId: channel.parentId ?? null,
      },
      update: { enabled: true, name: channel.name, categoryId: channel.parentId ?? null },
    });
    return respond(interaction, successPanel(`Added <#${channel.id}> as a trigger channel.`));
  }

  if (subcommand === 'categories') {
    const action = interaction.options.getString('action', true);
    if (action === 'list') {
      const categories = await prisma.voiceCategory.findMany({ where: { guildId: interaction.guildId } });
      return respond(
        interaction,
        panel({
          accentColor: '#7c6cff',
          blocks: [
            '### 🗂️ Voice categories',
            categories.length
              ? categories
                  .map((category) => `<#${category.categoryId}> · max ${category.maxRooms || '∞'} · ${category.enabled ? 'enabled' : 'disabled'}`)
                  .join('\n')
              : '-# No voice categories configured.',
          ],
        }),
      );
    }
    const category = interaction.options.getChannel('category');
    if (!category) throw new AppError('Choose a category.');
    if (action === 'remove') {
      await prisma.voiceCategory.deleteMany({
        where: { guildId: interaction.guildId, categoryId: category.id },
      });
      return respond(interaction, successPanel(`Removed <#${category.id}>.`));
    }
    await prisma.voiceCategory.upsert({
      where: { guildId_categoryId: { guildId: interaction.guildId, categoryId: category.id } },
      create: {
        guildId: interaction.guildId,
        categoryId: category.id,
        name: category.name,
        maxRooms: interaction.options.getInteger('max_rooms') ?? 0,
      },
      update: { maxRooms: interaction.options.getInteger('max_rooms') ?? 0, enabled: true },
    });
    return respond(interaction, successPanel(`Added <#${category.id}> as a voice category.`));
  }

  if (subcommand === 'templates') {
    const templates = await listTemplates(interaction.guildId);
    return respond(
      interaction,
      panel({
        accentColor: '#7c6cff',
        blocks: [
          '### 🧩 Room templates',
          templates
            .map(
              (template) =>
                `**${template.emoji || '🎧'} ${template.name}** · ${template.defaultPrivacy} · limit ${template.defaultLimit || '∞'}${template.isBuiltin ? ' · built-in' : ''}`,
            )
            .join('\n'),
        ],
      }),
    );
  }

  if (subcommand === 'active') {
    const rooms = await prisma.activeRoom.findMany({
      where: { guildId: interaction.guildId, status: 'ACTIVE' },
      include: { owner: true, _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return respond(
      interaction,
      panel({
        accentColor: '#7c6cff',
        blocks: [
          `### 🎧 Active rooms · ${rooms.length}`,
          rooms.length
            ? rooms
                .map(
                  (room) =>
                    `**${room.emoji || '🎧'} ${room.name}** · <#${room.channelId}> · <@${room.ownerId}> · ${room._count.members}/${room.userLimit || '∞'} · ${room.privacy}`,
                )
                .join('\n')
            : '-# No active temporary rooms.',
        ],
      }),
    );
  }

  if (subcommand === 'statistics') {
    const analytics = await getAnalytics(interaction.guildId, '30d');
    return respond(
      interaction,
      panel({
        accentColor: '#7c6cff',
        blocks: [
          '### 📈 Server analytics · last 30 days',
          [
            `**Rooms created** ${analytics.totals.roomsCreated}`,
            `**Rooms completed** ${analytics.totals.completedRooms}`,
            `**Average lifetime** ${Math.round(analytics.totals.avgLifetimeSeconds / 60)} min`,
            `**Peak concurrent** ${analytics.totals.peakConcurrent}`,
            `**Participants** ${analytics.totals.participants}`,
            `**Active now** ${analytics.totals.activeRooms} (${analytics.totals.membersInRooms} members)`,
          ].join('\n'),
        ],
      }),
    );
  }

  if (subcommand === 'cleanup') {
    const configForGuild = await ensureConfig(interaction.guildId);
    const result = await cleanupGuildRooms(getClient(), interaction.guild, configForGuild);
    await writeAudit({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      actorName: interaction.user.username,
      action: 'cleanup.run',
      category: 'SYSTEM',
      metadata: result,
    });
    return respond(
      interaction,
      successPanel(
        'Cleanup complete',
        `Checked **${result.checked}** rooms, deleted **${result.deletedEmpty}** empty rooms and closed **${result.closedMissing}** orphaned records.`,
      ),
    );
  }

  if (subcommand === 'reset') {
    const confirmed = interaction.options.getBoolean('confirm', true);
    if (!confirmed) return respond(interaction, errorPanel('Reset cancelled.', 'Run the command with confirm:true to reset.'));
    await prisma.$transaction([
      prisma.triggerChannel.deleteMany({ where: { guildId: interaction.guildId } }),
      prisma.voiceCategory.deleteMany({ where: { guildId: interaction.guildId } }),
      prisma.roomType.deleteMany({ where: { guildId: interaction.guildId } }),
      prisma.roomTemplate.deleteMany({ where: { guildId: interaction.guildId } }),
      prisma.reservation.deleteMany({ where: { guildId: interaction.guildId } }),
      prisma.guildConfig.deleteMany({ where: { guildId: interaction.guildId } }),
    ]);
    await ensureConfig(interaction.guildId);
    await writeAudit({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      actorName: interaction.user.username,
      action: 'guild.reset',
      category: 'CONFIG',
      metadata: { roomsPreserved: true },
    });
    return respond(
      interaction,
      successPanel('Configuration reset', 'Triggers, categories, custom templates, room types and reservations were removed. Active rooms were preserved.'),
    );
  }
}

async function handleRoom(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const user = interaction.user;

  if (subcommand === 'claim') {
    const channelId = interaction.member?.voice?.channelId;
    if (!channelId) throw new AppError('Join the room you want to claim first.');
    const room = await getRoomByChannel(channelId);
    if (!room) throw new AppError('You are not in a temporary room.');
    await claimRoom({ guild: interaction.guild, room, userId: user.id, actorName: user.username });
    return respond(interaction, successPanel('You are now the room owner.'));
  }

  if (subcommand === 'create') {
    const configForGuild = await ensureConfig(interaction.guildId);
    if (!configForGuild.enabled) throw new AppError('Temporary voice is disabled on this server.');
    const templateId = interaction.options.getString('template');
    const typeKey = interaction.options.getString('type');
    const privacy = interaction.options.getString('privacy');
    if (privacy === 'PASSWORD') throw new AppError('Create the room first, then set a password from the privacy panel.');
    const template = templateId ? await getTemplate(interaction.guildId, templateId) : null;
    const roomType = typeKey ? await getRoomType(interaction.guildId, typeKey) : null;
    const room = await createRoom({
      guild: interaction.guild,
      ownerMember: interaction.member,
      config: configForGuild,
      template,
      roomType,
      privacy,
      userLimit: interaction.options.getInteger('limit'),
      name: interaction.options.getString('name'),
      createdBy: user.id,
      reason: 'Chamber: /room create',
    });
    return respond(
      interaction,
      successPanel(
        'Room created',
        `**${room.name}** is ready: <#${room.channelId}>\nThe control panel has been posted there.`,
      ),
    );
  }

  const room = ['info', 'members', 'settings', 'statistics', 'privacy', 'permissions'].includes(subcommand)
    ? await manageableRoom(interaction)
    : await ownedRoom(interaction);

  if (subcommand === 'info') {
    const access = await getRoomAccess(getClient(), room, user.id, await ensureConfig(room.guildId));
    if (!access.isOwner && !access.roomAdmin && !access.staff && !access.memberInRoom) {
      throw new ForbiddenError('You need to be in this room to view its panel.');
    }
    const context = await buildRoomContext(interaction.guild, room);
    return respond(
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

  if (subcommand === 'members') {
    await requireRoomAccess(getClient(), room, user.id, await ensureConfig(room.guildId), 'moderate');
    const context = await buildRoomContext(interaction.guild, room);
    return respond(interaction, membersPanel(room, { liveMembers: context.liveMembers }));
  }

  if (subcommand === 'settings') {
    await requireRoomAccess(getClient(), room, user.id, await ensureConfig(room.guildId), 'owner');
    const configForGuild = await ensureConfig(room.guildId);
    return respond(interaction, settingsPanel(room, { aiEnabled: configForGuild.aiEnabled }));
  }

  if (subcommand === 'statistics') {
    await requireRoomAccess(getClient(), room, user.id, await ensureConfig(room.guildId), 'moderate');
    const context = await buildRoomContext(interaction.guild, room);
    const history = await prisma.roomHistory.findMany({
      where: { guildId: room.guildId, ownerId: room.ownerId },
      orderBy: { endedAt: 'desc' },
      take: 10,
    });
    return respond(
      interaction,
      statsPanel(room, {
        history,
        queueCount: context.queueCount,
        waitingCount: context.waitingCount,
        liveCount: context.liveCount,
      }),
    );
  }

  if (subcommand === 'delete') {
    await requireRoomAccess(getClient(), room, user.id, await ensureConfig(room.guildId), 'owner');
    return respond(
      interaction,
      confirmPanel({
        title: '🗑️ Delete this room?',
        body: `**${room.name}** will be deleted and connected members will be disconnected.\nThis cannot be undone.`,
        confirmId: ids.confirm('delete', room.id),
        cancelId: ids.cancel(room.id),
        confirmLabel: 'Delete room',
      }),
    );
  }

  if (subcommand === 'rename') {
    const name = interaction.options.getString('name', true);
    const { room: updated } = await updateRoom({
      guild: interaction.guild,
      room,
      patch: { name },
      actorId: user.id,
      actorName: user.username,
    });
    return respond(interaction, successPanel(`Renamed to **${updated.name}**.`));
  }

  if (subcommand === 'limit') {
    const limit = interaction.options.getInteger('limit', true);
    const { room: updated } = await updateRoom({
      guild: interaction.guild,
      room,
      patch: { userLimit: limit },
      actorId: user.id,
      actorName: user.username,
    });
    return respond(interaction, successPanel(`User limit set to **${updated.userLimit || 'unlimited'}**.`));
  }

  if (['lock', 'unlock', 'hide', 'reveal'].includes(subcommand)) {
    const patch =
      subcommand === 'lock' ? { locked: true } : subcommand === 'unlock' ? { locked: false } : subcommand === 'hide' ? { hidden: true } : { hidden: false };
    const labels = { lock: 'locked', unlock: 'unlocked', hide: 'hidden', reveal: 'visible again' };
    await updateRoom({ guild: interaction.guild, room, patch, actorId: user.id, actorName: user.username });
    return respond(interaction, successPanel(`Room ${labels[subcommand]}.`));
  }

  if (subcommand === 'invite') {
    const target = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) throw new AppError('That member is not in the server.');
    await inviteMember({
      guild: interaction.guild,
      room,
      targetMember: member,
      actorId: user.id,
      actorName: user.username,
    });
    return respond(interaction, successPanel(`Invited <@${target.id}>.`));
  }

  if (subcommand === 'kick') {
    const target = interaction.options.getUser('user', true);
    await kickMember({
      guild: interaction.guild,
      room,
      userId: target.id,
      actorId: user.id,
      actorName: user.username,
    });
    return respond(interaction, successPanel(`Removed <@${target.id}> from the room.`));
  }

  if (subcommand === 'ban') {
    const target = interaction.options.getUser('user', true);
    const duration = interaction.options.getInteger('duration') ?? 0;
    await banMember({
      guild: interaction.guild,
      room,
      userId: target.id,
      durationMinutes: duration,
      reason: interaction.options.getString('reason'),
      actorId: user.id,
      actorName: user.username,
    });
    return respond(interaction, successPanel(`<@${target.id}> is banned from this room.`));
  }

  if (subcommand === 'unban') {
    const target = interaction.options.getUser('user', true);
    await unbanMember({ guild: interaction.guild, room, userId: target.id, actorId: user.id, actorName: user.username });
    return respond(interaction, successPanel(`<@${target.id}> can join the room again.`));
  }

  if (subcommand === 'transfer') {
    const target = interaction.options.getUser('user', true);
    return respond(
      interaction,
      confirmPanel({
        title: '👑 Transfer ownership?',
        body: `<@${target.id}> will become the owner of **${room.name}**. You will remain a member.`,
        confirmId: ids.confirm('transfer', room.id, target.id),
        cancelId: ids.cancel(room.id),
        confirmLabel: 'Transfer ownership',
        danger: false,
      }),
    );
  }

  if (subcommand === 'clone') {
    const newRoom = await cloneRoom({
      guild: interaction.guild,
      room,
      ownerMember: interaction.member,
      actorId: user.id,
      actorName: user.username,
    });
    return respond(interaction, successPanel('Room cloned', `A new independent room was created: <#${newRoom.channelId}>`));
  }

  if (subcommand === 'privacy') {
    await requireRoomAccess(getClient(), room, user.id, await ensureConfig(room.guildId), 'owner');
    const mode = interaction.options.getString('mode', true);
    if (mode === 'PASSWORD') {
      return interaction.showModal(passwordModal(ids.modal('privacy-password', room.id), 'Set room password'));
    }
    const configForGuild = await ensureConfig(room.guildId);
    if (mode === 'FRIENDS') {
      return respond(
        interaction,
        noticePanel({
          title: '🤝 Friends only',
          body: 'Discord does not expose friend lists to bots. Chamber implements **Friends only** as your personal trusted list: invite the members you trust, and only they can connect. The dashboard explains this limitation honestly.',
          accentColor: '#7c6cff',
        }),
      );
    }
    await updateRoom({
      guild: interaction.guild,
      room,
      patch: { privacy: mode },
      actorId: user.id,
      actorName: user.username,
    });
    return respond(interaction, successPanel(`Privacy set to **${mode.replaceAll('_', ' ').toLowerCase()}**.`));
  }

  if (subcommand === 'permissions') {
    await requireRoomAccess(getClient(), room, user.id, await ensureConfig(room.guildId), 'owner');
    const action = interaction.options.getString('action') ?? 'view';
    const targetUser = interaction.options.getUser('user');
    const targetRole = interaction.options.getRole('role');
    if (action === 'view' || (!targetUser && !targetRole)) {
      const access = await getRoomAccess(getClient(), room, user.id, await ensureConfig(room.guildId));
      const rules = room.permissions ?? [];
      return respond(
        interaction,
        panel({
          accentColor: '#7c6cff',
          blocks: [
            `### ✅ Allow-list · ${room.name}`,
            rules.length
              ? rules
                  .map(
                    (rule) =>
                      `${rule.targetType === 'USER' ? '👤' : '🎭'} <@${rule.targetId}>${rule.expiresAt ? ` · until <t:${Math.floor(new Date(rule.expiresAt).getTime() / 1000)}:R>` : ''}`,
                  )
                  .join('\n')
              : '-# Nobody is on the allow-list yet.',
            '-# Use `/room permissions action:allow user:@member` or add roles here. Room admins and the owner always retain access.',
          ],
        }),
      );
    }
    if (action === 'allow') {
      if (targetUser) {
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) throw new AppError('That member is not in the server.');
        await inviteMember({
          guild: interaction.guild,
          room,
          targetMember: member,
          actorId: user.id,
          actorName: user.username,
        });
        return respond(interaction, successPanel(`Allowed <@${targetUser.id}>.`));
      }
      await prisma.roomPermission.upsert({
        where: { roomId_targetType_targetId: { roomId: room.id, targetType: 'ROLE', targetId: targetRole.id } },
        create: { roomId: room.id, targetType: 'ROLE', targetId: targetRole.id, allowConnect: true, createdBy: user.id },
        update: { allowConnect: true },
      });
      await applyPermissions(interaction.guild, room.id);
      return respond(interaction, successPanel(`Allowed role **${targetRole.name}**.`));
    }
    if (action === 'remove') {
      const targetType = targetUser ? 'USER' : 'ROLE';
      const targetId = targetUser?.id ?? targetRole?.id;
      if (!targetId) throw new AppError('Choose a member or role to remove.');
      await prisma.roomPermission.deleteMany({ where: { roomId: room.id, targetType, targetId } });
      await applyPermissions(interaction.guild, room.id);
      return respond(interaction, successPanel('Allow-list entry removed.'));
    }
    return respond(interaction, errorPanel('Unknown permission action.'));
  }

  if (subcommand === 'queue') {
    const action = interaction.options.getString('action', true);
    let targetRoom = room;
    const roomOption = interaction.options.getString('room');
    if (roomOption) {
      targetRoom = await getRoomById(roomOption);
      if (!targetRoom) throw new AppError('Room not found.');
    } else if (action === 'join' || action === 'leave') {
      const currentId = interaction.member?.voice?.channelId;
      targetRoom = currentId ? (await getRoomByChannel(currentId)) ?? room : room;
    }
    if (action === 'admit') {
      await requireRoomAccess(getClient(), targetRoom, user.id, await ensureConfig(targetRoom.guildId), 'moderate');
      const entry = await admitNext({
        client: getClient(),
        guild: interaction.guild,
        room: targetRoom,
        actorId: user.id,
        actorName: user.username,
      });
      return respond(interaction, successPanel(`Admitted <@${entry.userId}> from the queue.`));
    }
    if (action === 'list') {
      const entries = await listQueue(targetRoom.id);
      return respond(interaction, queuePanel(targetRoom, { entries }));
    }
    if (action === 'join') {
      const result = await joinQueue({
        client: getClient(),
        guild: interaction.guild,
        room: targetRoom,
        user: interaction.user,
      });
      return respond(interaction, successPanel(`You are in the queue at position **${result.position}**.`));
    }
    if (action === 'leave') {
      await leaveQueue({ room: targetRoom, userId: user.id });
      return respond(interaction, successPanel('You left the queue.'));
    }
  }

  if (subcommand === 'reserve') {
    const date = interaction.options.getString('date', true);
    const time = interaction.options.getString('time', true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      throw new AppError('Use date `YYYY-MM-DD` and time `HH:MM` in UTC.');
    }
    const scheduledFor = new Date(`${date}T${time}:00.000Z`);
    if (Number.isNaN(scheduledFor.getTime())) throw new AppError('That date or time is invalid.');
    const typeKey = interaction.options.getString('type');
    const reservation = await createReservation({
      guildId: interaction.guildId,
      host: interaction.user,
      input: {
        name: interaction.options.getString('name', true),
        scheduledFor,
        durationMinutes: interaction.options.getInteger('duration', true),
        privacy: interaction.options.getString('privacy') ?? undefined,
        roomTypeKey: typeKey ?? null,
      },
      actorId: user.id,
      actorName: user.username,
    });
    return respond(
      interaction,
      successPanel(
        'Reservation scheduled',
        `**${reservation.name}** is scheduled for <t:${Math.floor(scheduledFor.getTime() / 1000)}:F> (<t:${Math.floor(scheduledFor.getTime() / 1000)}:R>).\nYou will receive a reminder 10 minutes before.`,
      ),
    );
  }
}

async function handleChamber(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'access') {
    const roomId = interaction.options.getString('room', true);
    const room = await getRoomById(roomId);
    if (!room) throw new AppError('Room not found.');
    if (room.privacy !== 'PASSWORD') {
      throw new AppError('This room is not password protected. Use `/chamber request` for private rooms.');
    }
    const password = interaction.options.getString('password');
    if (!password) {
      return interaction.showModal(passwordModal(ids.modal('pwd', room.id), 'Room password'));
    }
    const result = await verifyRoomPassword({
      client: getClient(),
      guild: interaction.guild,
      room,
      user: interaction.user,
      password,
    });
    return respond(
      interaction,
      result.ok
        ? successPanel('Access granted', `Open <#${room.channelId}> to join.`)
        : errorPanel('Incorrect password.', `${result.remaining} attempts remaining before a temporary lockout.`),
    );
  }

  if (subcommand === 'request') {
    const roomId = interaction.options.getString('room', true);
    const room = await getRoomById(roomId);
    if (!room) throw new AppError('Room not found.');
    const result = await requestRoomAccess({
      client: getClient(),
      guild: interaction.guild,
      room,
      user: interaction.user,
      message: interaction.options.getString('message'),
    });
    return respond(
      interaction,
      successPanel(
        result.alreadyPending ? 'Request already pending' : 'Request sent',
        `The owner of **${room.name}** has been notified.`,
      ),
    );
  }

  if (subcommand === 'move') {
    const room = await ownedRoom(interaction);
    const target = interaction.options.getUser('user', true);
    const channel = interaction.options.getChannel('channel', true);
    await moveMember({
      guild: interaction.guild,
      room,
      userId: target.id,
      destinationChannelId: channel.id,
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    return respond(interaction, successPanel(`Moved <@${target.id}> to <#${channel.id}>.`));
  }

  if (subcommand === 'merge') {
    const requesterRoom = await ownedRoom(interaction);
    const targetRoomId = interaction.options.getString('target', true);
    const target = await getRoomById(targetRoomId);
    if (!target) throw new AppError('Target room not found.');
    await requestMerge({
      client: getClient(),
      guild: interaction.guild,
      requesterRoom,
      targetRoomId: target.id,
      requester: interaction.user,
    });
    return respond(interaction, successPanel('Merge request sent', `The owner of **${target.name}** must accept it.`));
  }

  if (subcommand === 'event') {
    const room = await ownedRoom(interaction);
    const start = interaction.options.getString('start', true);
    const match = start.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
    if (!match) throw new AppError('Use the start format `YYYY-MM-DD HH:MM` in UTC.');
    const startsAt = new Date(`${match[1]}T${match[2]}:00.000Z`);
    if (Number.isNaN(startsAt.getTime())) throw new AppError('That event start time is invalid.');
    const event = await createRoomEvent({
      client: getClient(),
      guild: interaction.guild,
      room,
      creator: interaction.user,
      input: {
        title: interaction.options.getString('title', true),
        type: interaction.options.getString('type', true),
        description: interaction.options.getString('description'),
        startsAt,
        durationMinutes: interaction.options.getInteger('duration', true),
        participantLimit: interaction.options.getInteger('limit') ?? 0,
      },
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });
    return respond(
      interaction,
      successPanel(
        'Event created',
        `**${event.title}** starts <t:${Math.floor(startsAt.getTime() / 1000)}:F>.${event.syncError ? `\n⚠️ ${event.syncError}` : ''}\nAn RSVP card was posted in the room.`,
      ),
    );
  }

  if (subcommand === 'ai') {
    const room = await ownedRoom(interaction);
    const suggestion = await generateSuggestions({
      guildId: interaction.guildId,
      input: {
        purpose: interaction.options.getString('purpose', true),
        expectedMembers: interaction.options.getInteger('members') ?? undefined,
      },
      currentRoom: { name: room.name, privacy: room.privacy, userLimit: room.userLimit },
    });
    setSuggestion(room.id, interaction.user.id, suggestion);
    return respond(interaction, aiSuggestionPanel(suggestion, { room }));
  }
}

export async function handleCommand(interaction) {
  if (interaction.commandName === 'tempvoice') return handleTempvoice(interaction);
  if (interaction.commandName === 'room') return handleRoom(interaction);
  if (interaction.commandName === 'chamber') return handleChamber(interaction);
  throw new AppError('Unknown command.');
}

export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const guildId = interaction.guildId;
  let choices = [];

  if (focused.name === 'template') {
    const templates = await listTemplates(guildId);
    const query = String(focused.value || '').toLowerCase();
    choices = templates
      .filter((template) => template.name.toLowerCase().includes(query) || template.slug.includes(query))
      .slice(0, 25)
      .map((template) => ({
        name: `${template.emoji || '🎧'} ${template.name}${template.isBuiltin ? ' · built-in' : ''}`.slice(0, 100),
        value: template.id,
      }));
  } else if (focused.name === 'type') {
    const types = await listRoomTypes(guildId);
    const query = String(focused.value || '').toLowerCase();
    choices = types
      .filter((type) => type.name.toLowerCase().includes(query) || type.key.includes(query))
      .slice(0, 25)
      .map((type) => ({ name: `${type.emoji} ${type.name}`.slice(0, 100), value: type.key }));
  } else if (focused.name === 'room' || focused.name === 'target') {
    if (!guildId) return interaction.respond([]);
    const query = String(focused.value || '').toLowerCase();
    let subcommand = null;
    try {
      subcommand = interaction.options.getSubcommand();
    } catch {
      subcommand = null;
    }
    const rooms = await prisma.activeRoom.findMany({
      where: { guildId, status: 'ACTIVE' },
      include: { owner: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    choices = rooms
      .filter((room) => {
        if (room.hidden && room.ownerId !== interaction.user.id) return false;
        if (focused.name === 'target') {
          return (
            room.ownerId !== interaction.user.id &&
            ['PUBLIC', 'REQUEST', 'ROLE_RESTRICTED', 'PASSWORD'].includes(room.privacy)
          );
        }
        if (subcommand === 'access') return room.privacy === 'PASSWORD';
        if (subcommand === 'request') return room.privacy === 'REQUEST';
        return ['PUBLIC', 'REQUEST', 'ROLE_RESTRICTED', 'PASSWORD'].includes(room.privacy);
      })
      .filter((room) => room.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((room) => ({
        name: `${room.emoji || '🎧'} ${room.name} · ${room.owner?.username ?? room.ownerId}`.slice(0, 100),
        value: room.id,
      }));
  }

  await interaction.respond(choices);
}
