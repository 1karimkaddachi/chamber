export type PrivacyMode =
  | 'PUBLIC'
  | 'PRIVATE'
  | 'INVITE_ONLY'
  | 'REQUEST'
  | 'PASSWORD'
  | 'FRIENDS'
  | 'ROLE_RESTRICTED';

export type RoomRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface UserSummary {
  id: string;
  username: string;
  globalName?: string | null;
  avatar?: string | null;
  avatarUrl?: string | null;
}

export interface GuildAccess {
  owner: boolean;
  admin: boolean;
  staff: boolean;
}

export interface GuildSummary {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  admin: boolean;
  staff: boolean;
  botPresent: boolean;
  enabled: boolean;
  setupCompleted: boolean;
}

export interface Preference {
  id: string;
  userId: string;
  theme: string;
  sidebarCollapsed: boolean;
  notifications: Record<string, boolean>;
  lastGuildId: string | null;
  updatedAt: string;
}

export interface MeData {
  user: UserSummary;
  guilds: GuildSummary[];
  csrfToken: string;
  preferences: Preference;
}

export interface MetaData {
  appName: string;
  tagline: string;
  version: string;
  environment: string;
  devAuth: boolean;
  botConfigured: boolean;
  oauthConfigured: boolean;
  aiConfigured: boolean;
  ai: { configured: boolean; enabled: boolean; provider: string | null; model: string | null };
  inviteUrl: string | null;
  webOrigin: string;
}

export interface GuildConfig {
  id: string;
  guildId: string;
  enabled: boolean;
  setupCompleted: boolean;
  lobbyChannelId: string | null;
  lobbyPanelMessageId: string | null;
  logChannelId: string | null;
  defaultCategoryId: string | null;
  defaultTriggerChannelId: string | null;
  defaultTemplateId: string | null;
  defaultPrivacy: PrivacyMode;
  defaultUserLimit: number;
  defaultBitrate: number;
  roomNameTemplate: string;
  allowUserRenames: boolean;
  staffRoleIds: string[];
  adminRoleIds: string[];
  autoCleanup: boolean;
  emptyGraceSeconds: number;
  maxRoomsPerUser: number;
  maxRoomsPerGuild: number;
  roomLifetimeMinutes: number;
  inactivityMinutes: number;
  transferOnOwnerLeave: boolean;
  tempAdminMinutes: number;
  permissionsExpireMinutes: number;
  retentionDays: number;
  waitingRoomEnabled: boolean;
  waitingRoomChannelId: string | null;
  waitingRequestExpiryMinutes: number;
  queueEnabled: boolean;
  queueMaxSize: number;
  queuePriorityRoleIds: string[];
  queueAutoAdmit: boolean;
  reservationsEnabled: boolean;
  reservationsPerUser: number;
  reservationWindowDays: number;
  reservationMaxDurationMinutes: number;
  eventsEnabled: boolean;
  mergingEnabled: boolean;
  cloningEnabled: boolean;
  passwordEnabled: boolean;
  passwordMaxAttempts: number;
  passwordLockoutMinutes: number;
  aiEnabled: boolean;
  featureOverrides: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface GuildDetail {
  guild: {
    id: string;
    name: string;
    icon: string | null;
    memberCount: number | null;
    ownerId: string | null;
    botPresent: boolean;
  };
  config: GuildConfig;
  access: GuildAccess;
  bot: { online: boolean; tag: string | null };
  counts: {
    activeRooms: number;
    members: number;
    triggers: number;
    categories: number;
    templates: number;
    roomTypes: number;
    scheduledReservations: number;
  };
  setup: { completed: boolean; hasTriggers: boolean; hasCategory: boolean };
}

export interface ChannelOption {
  id: string;
  name: string;
  parentId?: string | null;
  position: number;
}

export interface RoleOption {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface ChannelsData {
  offline: boolean;
  categories: ChannelOption[];
  text: ChannelOption[];
  voice: ChannelOption[];
  roles: RoleOption[];
}

export interface Trigger {
  id: string;
  guildId: string;
  channelId: string;
  name: string | null;
  categoryId: string | null;
  templateId: string | null;
  roomTypeKey: string | null;
  enabled: boolean;
  roomTypeName: string | null;
  roomTypeEmoji: string | null;
  createdAt: string;
}

export interface VoiceCategory {
  id: string;
  guildId: string;
  categoryId: string;
  name: string | null;
  templateId: string | null;
  maxRooms: number;
  enabled: boolean;
  createdAt: string;
}

export interface Template {
  id: string;
  guildId: string | null;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  accentColor: string | null;
  roomTypeKey: string | null;
  defaultPrivacy: PrivacyMode;
  defaultLimit: number;
  defaultBitrate: number;
  roomNameRule: string | null;
  autoSettings: Record<string, unknown>;
  allowedRoleIds: string[];
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomType {
  id: string;
  guildId: string | null;
  key: string;
  name: string;
  emoji: string;
  description: string | null;
  defaultPrivacy: PrivacyMode;
  defaultLimit: number;
  templateId: string | null;
  sortOrder: number;
  isBuiltin: boolean;
}

export interface RoomMember {
  userId: string;
  role: RoomRole;
  joinedAt: string;
  tempAdminUntil: string | null;
  name?: string;
}

export interface ActiveRoom {
  id: string;
  guildId: string;
  channelId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  topic: string | null;
  emoji: string | null;
  description: string | null;
  bannerUrl: string | null;
  theme: string | null;
  privacy: PrivacyMode;
  locked: boolean;
  hidden: boolean;
  userLimit: number;
  bitrate: number;
  rtcRegion: string | null;
  status: string;
  templateId: string | null;
  templateName: string | null;
  templateEmoji: string | null;
  roomTypeKey: string | null;
  parentCategoryId: string | null;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string | null;
  peakMembers: number;
  totalJoins: number;
  controlChannelId: string | null;
  controlMessageId: string | null;
  settings: Record<string, unknown>;
  memberCount: number;
  queueCount: number;
  waitingCount: number;
  members: RoomMember[];
}

export interface RoomHistoryEntry {
  id: string;
  roomId: string | null;
  channelId: string;
  ownerId: string;
  ownerName: string | null;
  name: string;
  roomTypeKey: string | null;
  templateName: string | null;
  privacy: PrivacyMode;
  peakMembers: number;
  totalJoins: number;
  durationSeconds: number;
  endReason: string | null;
  createdAt: string;
  endedAt: string;
}

export interface RoomEvent {
  id: string;
  roomId: string;
  guildId: string;
  creatorId: string;
  title: string;
  type: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  participantLimit: number;
  discordEventId: string | null;
  messageId: string | null;
  syncError: string | null;
  status: string;
  _count?: { participants: number };
  room?: { name: string; channelId: string } | null;
}

export interface QueueEntry {
  id: string;
  roomId: string;
  userId: string;
  name?: string;
  priority: number;
  status: string;
  joinedAt: string;
  admittedAt: string | null;
  position?: number;
}

export interface WaitingRequest {
  id: string;
  roomId: string;
  roomName?: string;
  channelId?: string;
  userId: string;
  name?: string;
  message: string | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  resolvedById: string | null;
  resolvedAt: string | null;
}

export interface RoomDetail extends ActiveRoom {
  live: {
    members: RoomMember[];
    count: number;
    queueCount: number;
    waitingCount: number;
    typeName: string | null;
  } | null;
  allowList: Array<{
    id: string;
    targetType: 'USER' | 'ROLE';
    targetId: string;
    name: string | null;
    expiresAt: string | null;
    createdAt: string;
  }>;
  bans: Array<{
    id: string;
    userId: string;
    name: string | null;
    kind: 'BAN' | 'BLOCK';
    reason: string | null;
    expiresAt: string | null;
    createdAt: string;
  }>;
  queue: QueueEntry[];
  waiting: WaitingRequest[];
  events: RoomEvent[];
  history: RoomHistoryEntry[];
}

export interface QueueGroup {
  roomId: string;
  roomName: string;
  channelId: string;
  userLimit: number;
  privacy: PrivacyMode;
  entries: Array<{
    id: string;
    userId: string;
    name: string;
    priority: number;
    joinedAt: string;
    position: number;
  }>;
}

export interface Reservation {
  id: string;
  guildId: string;
  hostId: string;
  hostName: string | null;
  templateId: string | null;
  roomTypeKey: string | null;
  name: string;
  privacy: PrivacyMode;
  userLimit: number;
  durationMinutes: number;
  scheduledFor: string;
  status: 'SCHEDULED' | 'CREATED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  roomChannelId: string | null;
  error: string | null;
  remindedAt: string | null;
  createdAt: string;
}

export interface AnalyticsSeriesPoint {
  day: string;
  roomsCreated: number;
  roomsDeleted: number;
  peakConcurrent: number;
  totalParticipants: number;
  totalVoiceMinutes: number;
}

export interface Analytics {
  range: string;
  days: number;
  series: AnalyticsSeriesPoint[];
  totals: {
    roomsCreated: number;
    roomsDeleted: number;
    participants: number;
    voiceMinutes: number;
    peakConcurrent: number;
    activeRooms: number;
    membersInRooms: number;
    completedRooms: number;
    avgLifetimeSeconds: number;
    allTimeRoomsCreated: number;
    allTimeRoomsDeleted: number;
  };
  popularTypes: Array<{ key: string; name: string; emoji: string; count: number }>;
  topOwners: Array<{ id: string; name: string; rooms: number }>;
  recentHistory: RoomHistoryEntry[];
}

export interface OverviewData extends Analytics {
  counts: {
    activeRooms: number;
    members: number;
    scheduledReservations: number;
    pendingWaiting: number;
  };
  activeRooms: ActiveRoom[];
  recentLogs: AuditLog[];
  bot: { online: boolean; tag: string | null };
}

export interface AuditLog {
  id: string;
  guildId: string | null;
  actorId: string | null;
  actorName: string | null;
  action: string;
  category: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipHash?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface LogsResponse {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface PremiumData {
  selfHosted: boolean;
  note: string;
  features: Array<{ key: string; label: string; enabled: boolean }>;
  limits: {
    maxRoomsPerUser: number;
    maxRoomsPerGuild: number;
    queueMaxSize: number;
    reservationsPerUser: number;
    reservationWindowDays: number;
    retentionDays: number;
  };
  usage: {
    triggers: number;
    templates: number;
    activeRooms: number;
    queued: number;
    roomsThisMonth: number;
    averageLifetimeSeconds: number;
  };
}

export interface AISuggestion {
  source: 'ai' | 'local';
  suggestions: {
    privacy: PrivacyMode;
    userLimit: number;
    bitrate: number;
    templateSlug: string | null;
    templateName: string | null;
  };
  template: { id: string; name: string; slug: string; emoji: string | null } | null;
  rationale: string[];
  fallbackReason?: string;
}

export interface HealthData {
  status: string;
  database: string;
  bot: { online: boolean; tag: string | null; guilds: number; startedAt: string | null };
  version: string;
  uptimeSeconds: number;
}
