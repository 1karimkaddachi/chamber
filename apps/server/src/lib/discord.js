import { ChannelType, PermissionsBitField } from 'discord.js';

export function displayName(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || 'Member';
}

export function sanitizeRoomName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export function isGuildAdmin(member) {
  if (!member) return false;
  const permissions = member.permissions;
  if (!permissions) return false;
  return permissions.has(PermissionsBitField.Flags.Administrator) || permissions.has(PermissionsBitField.Flags.ManageGuild);
}

export function isGuildOwner(guild, userId) {
  return Boolean(guild && guild.ownerId === userId);
}

export function hasAnyRole(member, roleIds = []) {
  if (!member || !roleIds?.length) return false;
  return roleIds.some((roleId) => member.roles?.cache?.has(roleId));
}

export function memberInVoice(member, channelId) {
  return Boolean(member?.voice?.channelId && member.voice.channelId === channelId);
}

export function isVoiceChannel(channel) {
  return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

export function isTextChannel(channel) {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

export function truncate(value, max) {
  const string = String(value ?? '');
  return string.length > max ? `${string.slice(0, Math.max(0, max - 1))}…` : string;
}

export function formatUsername(user) {
  if (!user) return 'Unknown member';
  return user.globalName || user.username || user.id;
}

export async function fetchChannelById(guild, channelId) {
  if (!guild || !channelId) return null;
  return guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
}

export async function fetchMemberById(guild, userId) {
  if (!guild || !userId) return null;
  return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
}

export function parseDurationToMs(minutes) {
  return Math.max(0, Number(minutes) || 0) * 60 * 1000;
}

export function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function isSnowflake(value) {
  return typeof value === 'string' && /^\d{5,25}$/.test(value);
}
