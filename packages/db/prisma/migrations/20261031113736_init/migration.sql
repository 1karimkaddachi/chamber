-- CreateEnum
CREATE TYPE "RoomPrivacy" AS ENUM ('PUBLIC', 'PRIVATE', 'INVITE_ONLY', 'REQUEST', 'PASSWORD', 'FRIENDS', 'ROLE_RESTRICTED');

-- CreateEnum
CREATE TYPE "RoomMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'ADMITTED', 'LEFT', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('SCHEDULED', 'CREATED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "RoomEventStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MergeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PermissionTarget" AS ENUM ('USER', 'ROLE');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('ROOM', 'CONFIG', 'PRIVACY', 'MEMBER', 'RESERVATION', 'QUEUE', 'TEMPLATE', 'AUTH', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActiveRoomStatus" AS ENUM ('ACTIVE', 'CLOSING');

-- CreateEnum
CREATE TYPE "BanKind" AS ENUM ('BAN', 'BLOCK');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "globalName" TEXT,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guilds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "ownerId" TEXT,
    "botPresent" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_configs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "lobbyChannelId" TEXT,
    "lobbyPanelMessageId" TEXT,
    "logChannelId" TEXT,
    "defaultCategoryId" TEXT,
    "defaultTriggerChannelId" TEXT,
    "defaultTemplateId" TEXT,
    "defaultPrivacy" "RoomPrivacy" NOT NULL DEFAULT 'PUBLIC',
    "defaultUserLimit" INTEGER NOT NULL DEFAULT 0,
    "defaultBitrate" INTEGER NOT NULL DEFAULT 64000,
    "roomNameTemplate" TEXT NOT NULL DEFAULT '{user}''s room',
    "allowUserRenames" BOOLEAN NOT NULL DEFAULT true,
    "staffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adminRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoCleanup" BOOLEAN NOT NULL DEFAULT true,
    "emptyGraceSeconds" INTEGER NOT NULL DEFAULT 30,
    "maxRoomsPerUser" INTEGER NOT NULL DEFAULT 1,
    "maxRoomsPerGuild" INTEGER NOT NULL DEFAULT 50,
    "roomLifetimeMinutes" INTEGER NOT NULL DEFAULT 240,
    "inactivityMinutes" INTEGER NOT NULL DEFAULT 120,
    "transferOnOwnerLeave" BOOLEAN NOT NULL DEFAULT true,
    "tempAdminMinutes" INTEGER NOT NULL DEFAULT 60,
    "permissionsExpireMinutes" INTEGER NOT NULL DEFAULT 0,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "waitingRoomEnabled" BOOLEAN NOT NULL DEFAULT false,
    "waitingRoomChannelId" TEXT,
    "waitingRequestExpiryMinutes" INTEGER NOT NULL DEFAULT 30,
    "queueEnabled" BOOLEAN NOT NULL DEFAULT true,
    "queueMaxSize" INTEGER NOT NULL DEFAULT 10,
    "queuePriorityRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "queueAutoAdmit" BOOLEAN NOT NULL DEFAULT false,
    "reservationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reservationsPerUser" INTEGER NOT NULL DEFAULT 3,
    "reservationWindowDays" INTEGER NOT NULL DEFAULT 30,
    "reservationMaxDurationMinutes" INTEGER NOT NULL DEFAULT 480,
    "eventsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mergingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cloningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "passwordEnabled" BOOLEAN NOT NULL DEFAULT true,
    "passwordMaxAttempts" INTEGER NOT NULL DEFAULT 5,
    "passwordLockoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "featureOverrides" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trigger_channels" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT,
    "categoryId" TEXT,
    "templateId" TEXT,
    "roomTypeKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trigger_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_categories" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT,
    "templateId" TEXT,
    "maxRooms" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_templates" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "accentColor" TEXT DEFAULT '#7c6cff',
    "roomTypeKey" TEXT,
    "defaultPrivacy" "RoomPrivacy" NOT NULL DEFAULT 'PUBLIC',
    "defaultLimit" INTEGER NOT NULL DEFAULT 0,
    "defaultBitrate" INTEGER NOT NULL DEFAULT 64000,
    "roomNameRule" TEXT DEFAULT '{user}''s {type}',
    "autoSettings" JSONB NOT NULL DEFAULT '{}',
    "allowedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🎧',
    "description" TEXT,
    "defaultPrivacy" "RoomPrivacy" NOT NULL DEFAULT 'PUBLIC',
    "defaultLimit" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_rooms" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "templateId" TEXT,
    "roomTypeKey" TEXT,
    "parentCategoryId" TEXT,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "emoji" TEXT,
    "description" TEXT,
    "bannerUrl" TEXT,
    "theme" TEXT,
    "privacy" "RoomPrivacy" NOT NULL DEFAULT 'PUBLIC',
    "passwordHash" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "bitrate" INTEGER NOT NULL DEFAULT 64000,
    "rtcRegion" TEXT,
    "status" "ActiveRoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "controlMessageId" TEXT,
    "controlChannelId" TEXT,
    "totalJoins" INTEGER NOT NULL DEFAULT 0,
    "peakMembers" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "mergedIntoChannelId" TEXT,

    CONSTRAINT "active_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_members" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "RoomMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tempAdminUntil" TIMESTAMP(3),

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_permissions" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "targetType" "PermissionTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "allowConnect" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_bans" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "kind" "BanKind" NOT NULL DEFAULT 'BAN',
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_bans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_invitations" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "room_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiting_requests" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "waiting_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_attempts" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "hostName" TEXT,
    "templateId" TEXT,
    "roomTypeKey" TEXT,
    "name" TEXT NOT NULL,
    "privacy" "RoomPrivacy" NOT NULL DEFAULT 'PUBLIC',
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "roomChannelId" TEXT,
    "error" TEXT,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_events" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'gaming',
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "participantLimit" INTEGER NOT NULL DEFAULT 0,
    "discordEventId" TEXT,
    "status" "RoomEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participants" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_requests" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "requesterRoomId" TEXT NOT NULL,
    "targetRoomId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetOwnerId" TEXT NOT NULL,
    "status" "MergeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "merge_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_history" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roomId" TEXT,
    "channelId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" TEXT,
    "name" TEXT NOT NULL,
    "roomTypeKey" TEXT,
    "templateName" TEXT,
    "privacy" "RoomPrivacy" NOT NULL,
    "peakMembers" INTEGER NOT NULL DEFAULT 0,
    "totalJoins" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "endReason" TEXT,
    "mergedIntoChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_analytics" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "roomsCreated" INTEGER NOT NULL DEFAULT 0,
    "roomsDeleted" INTEGER NOT NULL DEFAULT 0,
    "peakConcurrent" INTEGER NOT NULL DEFAULT 0,
    "totalParticipants" INTEGER NOT NULL DEFAULT 0,
    "totalVoiceMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "sidebarCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "notifications" JSONB NOT NULL DEFAULT '{}',
    "lastGuildId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL DEFAULT 'SYSTEM',
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_configs_guildId_key" ON "guild_configs"("guildId");

-- CreateIndex
CREATE INDEX "trigger_channels_guildId_enabled_idx" ON "trigger_channels"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "trigger_channels_guildId_channelId_key" ON "trigger_channels"("guildId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "voice_categories_guildId_categoryId_key" ON "voice_categories"("guildId", "categoryId");

-- CreateIndex
CREATE INDEX "room_templates_guildId_idx" ON "room_templates"("guildId");

-- CreateIndex
CREATE INDEX "room_templates_slug_idx" ON "room_templates"("slug");

-- CreateIndex
CREATE INDEX "room_types_guildId_idx" ON "room_types"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "active_rooms_channelId_key" ON "active_rooms"("channelId");

-- CreateIndex
CREATE INDEX "active_rooms_guildId_status_idx" ON "active_rooms"("guildId", "status");

-- CreateIndex
CREATE INDEX "active_rooms_ownerId_idx" ON "active_rooms"("ownerId");

-- CreateIndex
CREATE INDEX "active_rooms_expiresAt_idx" ON "active_rooms"("expiresAt");

-- CreateIndex
CREATE INDEX "room_members_userId_idx" ON "room_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "room_members_roomId_userId_key" ON "room_members"("roomId", "userId");

-- CreateIndex
CREATE INDEX "room_permissions_expiresAt_idx" ON "room_permissions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "room_permissions_roomId_targetType_targetId_key" ON "room_permissions"("roomId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "room_bans_roomId_kind_idx" ON "room_bans"("roomId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "room_bans_roomId_userId_key" ON "room_bans"("roomId", "userId");

-- CreateIndex
CREATE INDEX "room_invitations_roomId_status_idx" ON "room_invitations"("roomId", "status");

-- CreateIndex
CREATE INDEX "room_invitations_inviteeId_status_idx" ON "room_invitations"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "waiting_requests_roomId_status_idx" ON "waiting_requests"("roomId", "status");

-- CreateIndex
CREATE INDEX "waiting_requests_userId_status_idx" ON "waiting_requests"("userId", "status");

-- CreateIndex
CREATE INDEX "queue_entries_roomId_status_priority_joinedAt_idx" ON "queue_entries"("roomId", "status", "priority", "joinedAt");

-- CreateIndex
CREATE INDEX "queue_entries_userId_status_idx" ON "queue_entries"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "password_attempts_roomId_userId_key" ON "password_attempts"("roomId", "userId");

-- CreateIndex
CREATE INDEX "reservations_status_scheduledFor_idx" ON "reservations"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "reservations_guildId_scheduledFor_idx" ON "reservations"("guildId", "scheduledFor");

-- CreateIndex
CREATE INDEX "room_events_roomId_status_idx" ON "room_events"("roomId", "status");

-- CreateIndex
CREATE INDEX "room_events_guildId_startsAt_idx" ON "room_events"("guildId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "event_participants_eventId_userId_key" ON "event_participants"("eventId", "userId");

-- CreateIndex
CREATE INDEX "merge_requests_status_expiresAt_idx" ON "merge_requests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "merge_requests_targetOwnerId_status_idx" ON "merge_requests"("targetOwnerId", "status");

-- CreateIndex
CREATE INDEX "room_history_guildId_createdAt_idx" ON "room_history"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "room_history_ownerId_idx" ON "room_history"("ownerId");

-- CreateIndex
CREATE INDEX "room_history_guildId_endedAt_idx" ON "room_history"("guildId", "endedAt");

-- CreateIndex
CREATE INDEX "room_analytics_guildId_day_idx" ON "room_analytics"("guildId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "room_analytics_guildId_day_key" ON "room_analytics"("guildId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_preferences_userId_key" ON "dashboard_preferences"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_guildId_createdAt_idx" ON "audit_logs"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_category_createdAt_idx" ON "audit_logs"("category", "createdAt");

-- AddForeignKey
ALTER TABLE "guild_configs" ADD CONSTRAINT "guild_configs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trigger_channels" ADD CONSTRAINT "trigger_channels_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_categories" ADD CONSTRAINT "voice_categories_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_templates" ADD CONSTRAINT "room_templates_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_rooms" ADD CONSTRAINT "active_rooms_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_rooms" ADD CONSTRAINT "active_rooms_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_rooms" ADD CONSTRAINT "active_rooms_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "room_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_permissions" ADD CONSTRAINT "room_permissions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiting_requests" ADD CONSTRAINT "waiting_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_attempts" ADD CONSTRAINT "password_attempts_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_events" ADD CONSTRAINT "room_events_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_events" ADD CONSTRAINT "room_events_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "room_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_requesterRoomId_fkey" FOREIGN KEY ("requesterRoomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_targetRoomId_fkey" FOREIGN KEY ("targetRoomId") REFERENCES "active_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_history" ADD CONSTRAINT "room_history_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_analytics" ADD CONSTRAINT "room_analytics_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_preferences" ADD CONSTRAINT "dashboard_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
