import type { PrivacyMode } from '../types';

export const PRIVACY_OPTIONS: Array<{
  value: PrivacyMode;
  label: string;
  emoji: string;
  description: string;
  tone: 'mint' | 'cyan' | 'amber' | 'rose' | 'accent' | 'muted';
}> = [
  { value: 'PUBLIC', label: 'Public', emoji: '🌐', description: 'Anyone in the server can see and join.', tone: 'mint' },
  { value: 'PRIVATE', label: 'Private', emoji: '🔒', description: 'Hidden until you invite someone.', tone: 'rose' },
  { value: 'INVITE_ONLY', label: 'Invite only', emoji: '✉️', description: 'Visible, but only invited members connect.', tone: 'amber' },
  { value: 'REQUEST', label: 'Request to join', emoji: '🙋', description: 'Members ask; you approve each request.', tone: 'cyan' },
  { value: 'PASSWORD', label: 'Password', emoji: '🔑', description: 'The bot verifies a password before access.', tone: 'accent' },
  { value: 'FRIENDS', label: 'Friends only', emoji: '🤝', description: 'Trusted allow-list members only.', tone: 'muted' },
  { value: 'ROLE_RESTRICTED', label: 'Role restricted', emoji: '🎭', description: 'Only selected roles may connect.', tone: 'accent' },
];

export function privacyMeta(privacy: PrivacyMode | string | undefined) {
  return PRIVACY_OPTIONS.find((option) => option.value === privacy) ?? PRIVACY_OPTIONS[0];
}

export const ROOM_TYPE_FALLBACK: Record<string, { name: string; emoji: string }> = {
  gaming: { name: 'Gaming', emoji: '🎮' },
  competitive: { name: 'Competitive', emoji: '🏆' },
  duo: { name: 'Duo', emoji: '👥' },
  trio: { name: 'Trio', emoji: '🧑‍🤝‍🧑' },
  study: { name: 'Study', emoji: '📚' },
  music: { name: 'Music', emoji: '🎧' },
  movie: { name: 'Movie night', emoji: '🍿' },
  meeting: { name: 'Meeting', emoji: '🗂️' },
  lounge: { name: 'Lounge', emoji: '🛋️' },
  community: { name: 'Community', emoji: '🌍' },
};

export function roomTypeMeta(key: string | null | undefined) {
  if (!key) return { name: 'Custom', emoji: '🎧' };
  return ROOM_TYPE_FALLBACK[key] ?? { name: key.replace(/-/g, ' '), emoji: '🎧' };
}

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

export function formatDuration(seconds: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

export function formatMinutes(minutes: number | null | undefined) {
  return formatDuration((Number(minutes) || 0) * 60);
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDay(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function formatFullDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function relativeTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return rtf.format(Math.round(diff / 2_592_000_000), 'month');
}

export function toDateTimeLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function discordChannelUrl(guildId: string, channelId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function shortId(id: string | null | undefined) {
  if (!id) return '—';
  return `…${id.slice(-6)}`;
}

export function titleCase(value: string) {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function eventTypeMeta(type: string | undefined) {
  switch (type) {
    case 'gaming':
      return { emoji: '🎮', label: 'Gaming' };
    case 'movie':
      return { emoji: '🍿', label: 'Movie night' };
    case 'study':
      return { emoji: '📚', label: 'Study' };
    case 'meeting':
      return { emoji: '🗂️', label: 'Meeting' };
    case 'discussion':
      return { emoji: '💬', label: 'Discussion' };
    default:
      return { emoji: '✨', label: titleCase(type || 'event') };
  }
}

export function reservationStatusTone(status: string): 'mint' | 'cyan' | 'amber' | 'rose' | 'muted' {
  if (status === 'SCHEDULED') return 'cyan';
  if (status === 'CREATED') return 'mint';
  if (status === 'FAILED') return 'rose';
  if (status === 'EXPIRED') return 'amber';
  return 'muted';
}
