import { OverwriteType, PermissionFlagsBits } from 'discord.js';

const F = PermissionFlagsBits;

const USER_ALLOW = [F.ViewChannel, F.Connect, F.Speak, F.Stream, F.UseVAD, F.SendMessages, F.ReadMessageHistory];
const ADMIN_ALLOW = [F.MuteMembers, F.DeafenMembers, F.MoveMembers, F.PrioritySpeaker];
const BAN_DENY = [F.ViewChannel, F.Connect, F.Speak, F.Stream];
const BOT_ALLOW = [
  F.ViewChannel,
  F.SendMessages,
  F.ReadMessageHistory,
  F.ManageChannels,
  F.MoveMembers,
  F.MuteMembers,
  F.DeafenMembers,
  F.ManageMessages,
];

export function isActive(entry, now = Date.now()) {
  return !entry.expiresAt || new Date(entry.expiresAt).getTime() > now;
}

export function shouldDenyConnect(room) {
  return room.locked || room.privacy !== 'PUBLIC';
}

export function isAllowedTarget(room, targetType, targetId, now = Date.now()) {
  return (room.permissions ?? []).some(
    (rule) =>
      rule.targetType === targetType && rule.targetId === targetId && isActive(rule, now),
  );
}

/**
 * Build the complete overwrite set for a room. Allows are additive over the
 * privacy policy; bans always win; the owner and the bot always keep access.
 */
export function buildOverwrites(room, { everyoneRoleId, botId = null, keepMemberIds = [], now = Date.now() } = {}) {
  if (!everyoneRoleId) throw new Error('everyoneRoleId is required');

  const entries = new Map();
  const add = (id, type, allow = [], deny = []) => {
    const key = `${type}:${id}`;
    const existing = entries.get(key) ?? { id, type, allow: new Set(), deny: new Set() };
    for (const permission of allow) {
      existing.deny.delete(permission);
      existing.allow.add(permission);
    }
    for (const permission of deny) {
      existing.allow.delete(permission);
      existing.deny.add(permission);
    }
    entries.set(key, existing);
  };

  const everyoneAllow = [];
  const everyoneDeny = [];
  const hidden = Boolean(room.hidden);
  const denyConnect = shouldDenyConnect(room);

  if (hidden) everyoneDeny.push(F.ViewChannel, F.Connect);
  if (room.privacy === 'PRIVATE') {
    everyoneDeny.push(F.ViewChannel, F.Connect);
  } else if (denyConnect) {
    everyoneDeny.push(F.Connect);
    everyoneAllow.push(F.ViewChannel);
  } else {
    everyoneAllow.push(F.ViewChannel, F.Connect);
  }
  if (room.privacy === 'PUBLIC' && !hidden) {
    everyoneAllow.push(F.Speak, F.Stream, F.UseVAD, F.SendMessages, F.ReadMessageHistory);
  }
  add(everyoneRoleId, OverwriteType.Role, everyoneAllow, everyoneDeny);

  for (const rule of room.permissions ?? []) {
    if (!isActive(rule, now)) continue;
    if (rule.targetType === 'USER') {
      add(
        rule.targetId,
        OverwriteType.Member,
        rule.allowConnect ? USER_ALLOW : [F.ViewChannel, F.SendMessages, F.ReadMessageHistory],
      );
    } else {
      add(
        rule.targetId,
        OverwriteType.Role,
        rule.allowConnect ? [F.ViewChannel, F.Connect, F.Speak, F.Stream, F.UseVAD] : [F.ViewChannel],
      );
    }
  }

  const bannedIds = new Set(
    (room.bans ?? []).filter((ban) => isActive(ban, now)).map((ban) => ban.userId),
  );
  for (const userId of keepMemberIds) {
    if (!bannedIds.has(userId) && userId !== room.ownerId) {
      add(userId, OverwriteType.Member, USER_ALLOW);
    }
  }

  for (const ban of room.bans ?? []) {
    if (!isActive(ban, now)) continue;
    add(ban.userId, OverwriteType.Member, [], BAN_DENY);
  }

  add(room.ownerId, OverwriteType.Member, [...USER_ALLOW, ...ADMIN_ALLOW, F.ManageMessages]);

  for (const member of room.members ?? []) {
    if (member.role !== 'ADMIN' || member.userId === room.ownerId) continue;
    if (member.tempAdminUntil && new Date(member.tempAdminUntil).getTime() <= now) continue;
    add(member.userId, OverwriteType.Member, [...USER_ALLOW, ...ADMIN_ALLOW]);
  }

  if (botId) add(botId, OverwriteType.Member, BOT_ALLOW);

  return [...entries.values()].map((entry) => ({
    id: entry.id,
    type: entry.type,
    allow: [...entry.allow],
    deny: [...entry.deny],
  }));
}

export function permissionSummary(room) {
  const bits = [];
  if (room.locked) bits.push('locked');
  if (room.hidden) bits.push('hidden');
  if (room.privacy !== 'PUBLIC') bits.push(room.privacy.toLowerCase());
  return bits;
}
