import { z } from 'zod';

export const APP_NAME = 'Chamber';
export const APP_TAGLINE = 'Temporary voice, perfectly orchestrated.';

export const ROOM_PRIVACY = Object.freeze({
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
  INVITE_ONLY: 'INVITE_ONLY',
  REQUEST: 'REQUEST',
  PASSWORD: 'PASSWORD',
  FRIENDS: 'FRIENDS',
  ROLE_RESTRICTED: 'ROLE_RESTRICTED',
});

export const PRIVACY_MODES = Object.freeze([
  {
    value: 'PUBLIC',
    label: 'Public',
    emoji: '🌐',
    description: 'Anyone in the server can see and join.',
  },
  {
    value: 'PRIVATE',
    label: 'Private',
    emoji: '🔒',
    description: 'Hidden from everyone until you invite them.',
  },
  {
    value: 'INVITE_ONLY',
    label: 'Invite only',
    emoji: '✉️',
    description: 'Visible, but only invited members may connect.',
  },
  {
    value: 'REQUEST',
    label: 'Request to join',
    emoji: '🙋',
    description: 'Members can ask for access; you approve each request.',
  },
  {
    value: 'PASSWORD',
    label: 'Password',
    emoji: '🔑',
    description: 'Members verify a password with the bot before gaining access.',
  },
  {
    value: 'FRIENDS',
    label: 'Friends only',
    emoji: '🤝',
    description: 'Only members on your trusted list may connect.',
  },
  {
    value: 'ROLE_RESTRICTED',
    label: 'Role restricted',
    emoji: '🎭',
    description: 'Only members with one of the selected roles may connect.',
  },
]);

export const PRIVACY_VALUES = PRIVACY_MODES.map((mode) => mode.value);

export const BUILTIN_ROOM_TYPES = Object.freeze([
  { key: 'gaming', name: 'Gaming', emoji: '🎮', description: 'Casual or ranked gaming sessions.', defaultPrivacy: 'PUBLIC', defaultLimit: 0, sortOrder: 10 },
  { key: 'competitive', name: 'Competitive', emoji: '🏆', description: 'Focused team play with room admins.', defaultPrivacy: 'PRIVATE', defaultLimit: 5, sortOrder: 20 },
  { key: 'duo', name: 'Duo', emoji: '👥', description: 'A private room for two.', defaultPrivacy: 'PRIVATE', defaultLimit: 2, sortOrder: 30 },
  { key: 'trio', name: 'Trio', emoji: '🧑‍🤝‍🧑', description: 'A private room for three.', defaultPrivacy: 'PRIVATE', defaultLimit: 3, sortOrder: 40 },
  { key: 'study', name: 'Study', emoji: '📚', description: 'Quiet focus and study sessions.', defaultPrivacy: 'PUBLIC', defaultLimit: 20, sortOrder: 50 },
  { key: 'music', name: 'Music', emoji: '🎧', description: 'Listening parties and music sharing.', defaultPrivacy: 'PUBLIC', defaultLimit: 0, sortOrder: 60 },
  { key: 'movie', name: 'Movie night', emoji: '🍿', description: 'Watch parties with a capped audience.', defaultPrivacy: 'INVITE_ONLY', defaultLimit: 15, sortOrder: 70 },
  { key: 'meeting', name: 'Meeting', emoji: '🗂️', description: 'Structured discussions and standups.', defaultPrivacy: 'INVITE_ONLY', defaultLimit: 25, sortOrder: 80 },
  { key: 'lounge', name: 'Private lounge', emoji: '🛋️', description: 'A relaxed invite-only hangout.', defaultPrivacy: 'PRIVATE', defaultLimit: 0, sortOrder: 90 },
  { key: 'community', name: 'Community', emoji: '🌍', description: 'An open room for everyone in the server.', defaultPrivacy: 'PUBLIC', defaultLimit: 0, sortOrder: 100 },
]);

export const BUILTIN_TEMPLATES = Object.freeze([
  {
    slug: 'gaming-squad',
    name: 'Gaming Squad',
    description: 'A balanced public squad room with room for everyone.',
    emoji: '🎮',
    accentColor: '#7c6cff',
    roomTypeKey: 'gaming',
    defaultPrivacy: 'PUBLIC',
    defaultLimit: 0,
    defaultBitrate: 96000,
    roomNameRule: "{user}'s squad",
  },
  {
    slug: 'competitive-team',
    name: 'Competitive Gaming',
    description: 'A locked five-stack room. Invite your team after creating it.',
    emoji: '🏆',
    accentColor: '#f59e0b',
    roomTypeKey: 'competitive',
    defaultPrivacy: 'INVITE_ONLY',
    defaultLimit: 5,
    defaultBitrate: 128000,
    roomNameRule: "{user}'s team",
  },
  {
    slug: 'duo-room',
    name: 'Duo Room',
    description: 'Just the two of you, nothing else.',
    emoji: '👥',
    accentColor: '#22d3ee',
    roomTypeKey: 'duo',
    defaultPrivacy: 'PRIVATE',
    defaultLimit: 2,
    defaultBitrate: 96000,
    roomNameRule: "{user}'s duo",
  },
  {
    slug: 'trio-room',
    name: 'Trio Room',
    description: 'A private room sized for three.',
    emoji: '🧑‍🤝‍🧑',
    accentColor: '#38bdf8',
    roomTypeKey: 'trio',
    defaultPrivacy: 'PRIVATE',
    defaultLimit: 3,
    defaultBitrate: 96000,
    roomNameRule: "{user}'s trio",
  },
  {
    slug: 'study-room',
    name: 'Study Room',
    description: 'A calm, public space for deep work.',
    emoji: '📚',
    accentColor: '#34d399',
    roomTypeKey: 'study',
    defaultPrivacy: 'PUBLIC',
    defaultLimit: 20,
    defaultBitrate: 64000,
    roomNameRule: "{user}'s study room",
  },
  {
    slug: 'music-lounge',
    name: 'Music Room',
    description: 'High-bitrate audio for listening sessions.',
    emoji: '🎧',
    accentColor: '#f472b6',
    roomTypeKey: 'music',
    defaultPrivacy: 'PUBLIC',
    defaultLimit: 0,
    defaultBitrate: 128000,
    roomNameRule: "{user}'s listening room",
  },
  {
    slug: 'movie-night',
    name: 'Movie Room',
    description: 'A capped, invite-only room for watch parties.',
    emoji: '🍿',
    accentColor: '#fb7185',
    roomTypeKey: 'movie',
    defaultPrivacy: 'INVITE_ONLY',
    defaultLimit: 15,
    defaultBitrate: 96000,
    roomNameRule: "{user}'s movie night",
  },
  {
    slug: 'meeting-room',
    name: 'Meeting Room',
    description: 'A structured room for standups and planning.',
    emoji: '🗂️',
    accentColor: '#a3e635',
    roomTypeKey: 'meeting',
    defaultPrivacy: 'INVITE_ONLY',
    defaultLimit: 25,
    defaultBitrate: 64000,
    roomNameRule: "{user}'s meeting",
  },
  {
    slug: 'private-lounge',
    name: 'Private Lounge',
    description: 'A quiet, password-protected retreat.',
    emoji: '🛋️',
    accentColor: '#c084fc',
    roomTypeKey: 'lounge',
    defaultPrivacy: 'PASSWORD',
    defaultLimit: 0,
    defaultBitrate: 96000,
    roomNameRule: "{user}'s lounge",
  },
  {
    slug: 'community-room',
    name: 'Community Room',
    description: 'An open stage for the whole server.',
    emoji: '🌍',
    accentColor: '#60a5fa',
    roomTypeKey: 'community',
    defaultPrivacy: 'PUBLIC',
    defaultLimit: 0,
    defaultBitrate: 64000,
    roomNameRule: '{user} invites you in',
  },
]);

export const ROOM_LIMITS = Object.freeze({
  nameMax: 100,
  topicMax: 1024,
  userLimitMax: 99,
  bitrateMin: 8000,
  bitrateMax: 384000,
  passwordMin: 4,
  passwordMax: 64,
  queueMessageMax: 300,
});

export const SNOWFLAKE = /^\d{5,25}$/;
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const UPLOAD_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  // A 4 MB image base64-encodes to just over 5.3 million characters.
  maxEncodedChars: 5_600_000,
});

export const IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const UPLOADED_IMAGE_PATH = /^\/api\/uploads\/[a-z0-9_-]{16,48}\.(?:png|jpe?g|webp|gif)$/;

// Room banners are either an operator-supplied absolute URL or a file this
// server already stores under /api/uploads. z.string().url() alone would accept
// javascript: and data: URLs, so the scheme is pinned.
const absoluteImageUrl = z
  .string()
  .url()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), 'Banner URLs must use http or https');

const bannerImageSchema = z
  .union([absoluteImageUrl, z.string().regex(UPLOADED_IMAGE_PATH, 'Expected an uploaded image path')])
  .nullable();

export const imageUploadSchema = z.object({
  data: z
    .string()
    .min(32, 'Expected a base64 encoded image')
    .max(UPLOAD_LIMITS.maxEncodedChars)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected base64 image data without a data-URL prefix'),
  mimeType: z.enum(IMAGE_MIME_TYPES),
});

const snowflake = z.string().regex(SNOWFLAKE, 'Expected a Discord snowflake ID');
const nullableSnowflake = z
  .union([snowflake, z.literal(''), z.null()])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

const stringList = z.array(z.string().regex(SNOWFLAKE, 'Expected Discord IDs')).max(50);

const normalizedStringList = stringList.default([]);

export const privacyEnum = z.enum(PRIVACY_VALUES);

export const guildConfigUpdateSchema = z
  .object({
    enabled: z.boolean(),
    lobbyChannelId: nullableSnowflake,
    logChannelId: nullableSnowflake,
    defaultCategoryId: nullableSnowflake,
    defaultTriggerChannelId: nullableSnowflake,
    defaultTemplateId: nullableSnowflake,
    defaultPrivacy: privacyEnum,
    defaultUserLimit: z.number().int().min(0).max(ROOM_LIMITS.userLimitMax),
    defaultBitrate: z.number().int().min(ROOM_LIMITS.bitrateMin).max(ROOM_LIMITS.bitrateMax),
    roomNameTemplate: z.string().min(1).max(80),
    allowUserRenames: z.boolean(),
    staffRoleIds: stringList,
    adminRoleIds: stringList,
    autoCleanup: z.boolean(),
    emptyGraceSeconds: z.number().int().min(10).max(600),
    maxRoomsPerUser: z.number().int().min(1).max(10),
    maxRoomsPerGuild: z.number().int().min(1).max(500),
    roomLifetimeMinutes: z.number().int().min(0).max(10080),
    inactivityMinutes: z.number().int().min(0).max(10080),
    transferOnOwnerLeave: z.boolean(),
    tempAdminMinutes: z.number().int().min(0).max(1440),
    permissionsExpireMinutes: z.number().int().min(0).max(10080),
    retentionDays: z.number().int().min(1).max(3650),
    waitingRoomEnabled: z.boolean(),
    waitingRoomChannelId: nullableSnowflake,
    waitingRequestExpiryMinutes: z.number().int().min(5).max(1440),
    queueEnabled: z.boolean(),
    queueMaxSize: z.number().int().min(0).max(100),
    queuePriorityRoleIds: stringList,
    queueAutoAdmit: z.boolean(),
    reservationsEnabled: z.boolean(),
    reservationsPerUser: z.number().int().min(0).max(50),
    reservationWindowDays: z.number().int().min(1).max(365),
    reservationMaxDurationMinutes: z.number().int().min(15).max(1440),
    eventsEnabled: z.boolean(),
    mergingEnabled: z.boolean(),
    cloningEnabled: z.boolean(),
    passwordEnabled: z.boolean(),
    passwordMaxAttempts: z.number().int().min(1).max(20),
    passwordLockoutMinutes: z.number().int().min(1).max(1440),
    aiEnabled: z.boolean(),
    featureOverrides: z.record(z.string(), z.boolean()),
  })
  .partial();

export const triggerInputSchema = z.object({
  channelId: snowflake,
  name: z.string().trim().max(100).optional().nullable(),
  categoryId: nullableSnowflake,
  templateId: z.string().min(1).max(40).nullable().optional(),
  roomTypeKey: z.string().trim().max(40).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const voiceCategoryInputSchema = z.object({
  categoryId: snowflake,
  name: z.string().trim().max(100).optional().nullable(),
  templateId: z.string().min(1).max(40).nullable().optional(),
  maxRooms: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(200).nullable().optional(),
  emoji: z.string().trim().max(16).nullable().optional(),
  accentColor: z.string().regex(HEX_COLOR).default('#7c6cff'),
  roomTypeKey: z.string().trim().max(40).nullable().optional(),
  defaultPrivacy: privacyEnum.default('PUBLIC'),
  defaultLimit: z.number().int().min(0).max(ROOM_LIMITS.userLimitMax).default(0),
  defaultBitrate: z.number().int().min(ROOM_LIMITS.bitrateMin).max(ROOM_LIMITS.bitrateMax).default(64000),
  roomNameRule: z.string().trim().max(80).default("{user}'s {type}"),
  allowedRoleIds: normalizedStringList,
});

export const templateImportSchema = z.object({
  version: z.number().int().optional(),
  templates: z.array(templateInputSchema.extend({ slug: z.string().max(60).optional() })).min(1).max(50),
});

export const roomTypeInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes'),
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().max(16).default('🎧'),
  description: z.string().trim().max(200).nullable().optional(),
  defaultPrivacy: privacyEnum.default('PUBLIC'),
  defaultLimit: z.number().int().min(0).max(ROOM_LIMITS.userLimitMax).default(0),
  templateId: z.string().min(1).max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(500),
});

export const roomUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(ROOM_LIMITS.nameMax),
    topic: z.string().max(ROOM_LIMITS.topicMax).nullable(),
    userLimit: z.number().int().min(0).max(ROOM_LIMITS.userLimitMax),
    bitrate: z.number().int().min(ROOM_LIMITS.bitrateMin).max(ROOM_LIMITS.bitrateMax),
    privacy: privacyEnum,
    locked: z.boolean(),
    hidden: z.boolean(),
    password: z
      .union([z.string().min(ROOM_LIMITS.passwordMin).max(ROOM_LIMITS.passwordMax), z.literal(''), z.null()])
      .optional(),
    rtcRegion: z.string().trim().max(40).nullable(),
    parentCategoryId: nullableSnowflake,
    templateId: z.string().min(1).max(40).nullable(),
    theme: z.string().regex(HEX_COLOR).nullable(),
    emoji: z.string().trim().max(16).nullable(),
    description: z.string().trim().max(300).nullable(),
    bannerUrl: bannerImageSchema,
  })
  .partial();

export const roomActionSchema = z.object({
  action: z.enum([
    'lock',
    'unlock',
    'hide',
    'reveal',
    'delete',
    'claim',
    'refresh',
    'clone',
    'reset',
    'admit-next',
    'close-queue',
  ]),
});

export const memberActionSchema = z.object({
  action: z.enum(['invite', 'remove', 'move', 'mute', 'unmute', 'deafen', 'undeafen', 'promote', 'demote']),
  userId: snowflake,
  destinationChannelId: snowflake.optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
});

export const moderationSchema = z.object({
  action: z.enum(['ban', 'unban', 'block', 'unblock', 'allow', 'revoke']),
  userId: snowflake,
  reason: z.string().trim().max(200).optional(),
  durationMinutes: z.number().int().min(0).max(10080).optional(),
});

export const transferSchema = z.object({ userId: snowflake });
export const passwordSetSchema = z.object({
  password: z.string().min(ROOM_LIMITS.passwordMin).max(ROOM_LIMITS.passwordMax),
});

export const reservationInputSchema = z.object({
  name: z.string().trim().min(1).max(ROOM_LIMITS.nameMax),
  scheduledFor: z.coerce.date(),
  durationMinutes: z.number().int().min(15).max(1440),
  privacy: privacyEnum.optional(),
  userLimit: z.number().int().min(0).max(ROOM_LIMITS.userLimitMax).optional(),
  templateId: z.string().max(40).nullable().optional(),
  roomTypeKey: z.string().max(40).nullable().optional(),
});

export const roomEventInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  type: z.enum(['gaming', 'movie', 'study', 'meeting', 'discussion', 'other']),
  description: z.string().trim().max(500).optional().nullable(),
  startsAt: z.coerce.date(),
  durationMinutes: z.number().int().min(15).max(1440).default(60),
  participantLimit: z.number().int().min(0).max(99).default(0),
});

export const mergeRequestSchema = z.object({
  targetRoomId: z.string().min(1).max(40),
});

export const accessRequestSchema = z.object({
  password: z.string().min(1).max(ROOM_LIMITS.passwordMax).optional(),
  message: z.string().trim().max(ROOM_LIMITS.queueMessageMax).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  category: z.string().max(30).optional(),
});

export const analyticsQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d', '365d']).default('30d'),
});

export const aiSuggestionSchema = z.object({
  purpose: z.string().trim().min(2).max(120),
  expectedMembers: z.number().int().min(1).max(99).optional(),
  tone: z.enum(['casual', 'competitive', 'focused', 'social']).optional(),
  roomId: z.string().max(40).optional(),
});

export function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function formatRoomName(rule, { username, typeName = 'room', emoji = '' }) {
  const raw = String(rule || "{user}'s room")
    .replaceAll('{user}', username || 'Member')
    .replaceAll('{type}', typeName.toLowerCase())
    .replaceAll('{emoji}', emoji || '');
  return raw.replace(/\s+/g, ' ').trim().slice(0, ROOM_LIMITS.nameMax) || 'Temporary room';
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

export function discordTimestamp(date, style = 'R') {
  const unix = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${unix}:${style}>`;
}

export function privacyMeta(value) {
  return PRIVACY_MODES.find((mode) => mode.value === value) ?? PRIVACY_MODES[0];
}

export function isValidSnowflake(value) {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

export const AUDIT_ACTIONS = Object.freeze({
  ROOM_CREATED: 'room.created',
  ROOM_DELETED: 'room.deleted',
  ROOM_UPDATED: 'room.updated',
  ROOM_TRANSFERRED: 'room.transferred',
  ROOM_CLAIMED: 'room.claimed',
  ROOM_CLONED: 'room.cloned',
  ROOM_MERGED: 'room.merged',
  ROOM_RESET: 'room.reset',
  MEMBER_INVITED: 'member.invited',
  MEMBER_KICKED: 'member.kicked',
  MEMBER_BANNED: 'member.banned',
  MEMBER_UNBANNED: 'member.unbanned',
  MEMBER_BLOCKED: 'member.blocked',
  MEMBER_PROMOTED: 'member.promoted',
  MEMBER_ALLOWED: 'member.allowed',
  MEMBER_ACCESS_REVOKED: 'member.access_revoked',
  QUEUE_JOINED: 'queue.joined',
  WAITING_REQUESTED: 'waiting.requested',
  WAITING_RESOLVED: 'waiting.resolved',
  RESERVATION_CREATED: 'reservation.created',
  RESERVATION_CANCELLED: 'reservation.cancelled',
  CONFIG_UPDATED: 'config.updated',
  UPLOAD_CREATED: 'upload.created',
  TRIGGER_CREATED: 'trigger.created',
  TRIGGER_DELETED: 'trigger.deleted',
  TEMPLATE_CREATED: 'template.created',
  TEMPLATE_UPDATED: 'template.updated',
  TEMPLATE_DELETED: 'template.deleted',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  CLEANUP_RUN: 'cleanup.run',
  RESET_GUILD: 'guild.reset',
});
