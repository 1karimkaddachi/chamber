import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type {
  ActiveRoom,
  AISuggestion,
  Analytics,
  ChannelsData,
  GuildDetail,
  LogsResponse,
  OverviewData,
  PremiumData,
  QueueGroup,
  Reservation,
  RoomDetail,
  RoomEvent,
  RoomType,
  Template,
  Trigger,
  VoiceCategory,
  WaitingRequest,
} from '../types';

export const useGuildDetail = (guildId: string) =>
  useQuery({
    queryKey: ['guild', guildId],
    queryFn: () => api<GuildDetail>(`/guilds/${guildId}`),
    staleTime: 15_000,
  });

export const useChannels = (guildId: string) =>
  useQuery({
    queryKey: ['channels', guildId],
    queryFn: () => api<ChannelsData>(`/guilds/${guildId}/channels`),
    staleTime: 60_000,
  });

export const useTriggers = (guildId: string) =>
  useQuery({
    queryKey: ['triggers', guildId],
    queryFn: () => api<Trigger[]>(`/guilds/${guildId}/triggers`),
  });

export const useCategories = (guildId: string) =>
  useQuery({
    queryKey: ['categories', guildId],
    queryFn: () => api<VoiceCategory[]>(`/guilds/${guildId}/categories`),
  });

export const useTemplates = (guildId: string) =>
  useQuery({
    queryKey: ['templates', guildId],
    queryFn: () => api<Template[]>(`/guilds/${guildId}/templates`),
  });

export const useRoomTypes = (guildId: string) =>
  useQuery({
    queryKey: ['roomTypes', guildId],
    queryFn: () => api<RoomType[]>(`/guilds/${guildId}/room-types`),
  });

export const useRooms = (guildId: string, params: { search?: string; type?: string } = {}) => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.type) query.set('type', params.type);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return useQuery({
    queryKey: ['rooms', guildId, params.search ?? '', params.type ?? ''],
    queryFn: () => api<ActiveRoom[]>(`/guilds/${guildId}/rooms${suffix}`),
    refetchInterval: 20_000,
  });
};

export const useRoomDetail = (guildId: string, roomId: string | null) =>
  useQuery({
    queryKey: ['room', guildId, roomId],
    queryFn: () => api<RoomDetail>(`/guilds/${guildId}/rooms/${roomId}`),
    enabled: Boolean(roomId),
  });

export const useQueues = (guildId: string) =>
  useQuery({
    queryKey: ['queues', guildId],
    queryFn: () => api<QueueGroup[]>(`/guilds/${guildId}/queues`),
    refetchInterval: 20_000,
  });

export const useWaitingRequests = (guildId: string) =>
  useQuery({
    queryKey: ['waiting', guildId],
    queryFn: () => api<WaitingRequest[]>(`/guilds/${guildId}/waiting`),
    refetchInterval: 20_000,
  });

export const useReservations = (guildId: string, status?: string) =>
  useQuery({
    queryKey: ['reservations', guildId, status ?? 'all'],
    queryFn: () =>
      api<Reservation[]>(`/guilds/${guildId}/reservations${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  });

export const useGuildEvents = (guildId: string) =>
  useQuery({
    queryKey: ['guildEvents', guildId],
    queryFn: () => api<RoomEvent[]>(`/guilds/${guildId}/events`),
  });

export const useOverview = (guildId: string, range = '30d') =>
  useQuery({
    queryKey: ['overview', guildId, range],
    queryFn: () => api<OverviewData>(`/guilds/${guildId}/overview?range=${range}`),
    refetchInterval: 30_000,
  });

export const useAnalytics = (guildId: string, range = '30d') =>
  useQuery({
    queryKey: ['analytics', guildId, range],
    queryFn: () => api<Analytics>(`/guilds/${guildId}/analytics?range=${range}`),
  });

export const useLogs = (guildId: string, params: { page: number; search?: string; category?: string }) => {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '25' });
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  return useQuery({
    queryKey: ['logs', guildId, params.page, params.search ?? '', params.category ?? ''],
    queryFn: () => api<LogsResponse>(`/guilds/${guildId}/logs?${query.toString()}`),
  });
};

export const usePremium = (guildId: string) =>
  useQuery({
    queryKey: ['premium', guildId],
    queryFn: () => api<PremiumData>(`/guilds/${guildId}/premium`),
  });

export const useAIStatus = (guildId: string) =>
  useQuery({
    queryKey: ['aiStatus', guildId],
    queryFn: () =>
      api<{ configured: boolean; enabled: boolean; provider: string | null; model: string | null }>(
        `/guilds/${guildId}/ai/status`,
      ),
  });

export const useAISuggestion = () => ({
  generate: async (guildId: string, body: Record<string, unknown>) =>
    api<AISuggestion>(`/guilds/${guildId}/ai/suggest`, { method: 'POST', body }),
});
