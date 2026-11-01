import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type LiveStatus = 'connecting' | 'open' | 'closed';

function invalidateForEvent(type: string, guildId: string, queryClient: ReturnType<typeof useQueryClient>) {
  const invalidate = (key: unknown[]) => void queryClient.invalidateQueries({ queryKey: key });
  const rooms = () => {
    invalidate(['rooms', guildId]);
    invalidate(['room', guildId]);
    invalidate(['queues', guildId]);
    invalidate(['waiting', guildId]);
    invalidate(['overview', guildId]);
    invalidate(['analytics', guildId]);
  };

  switch (type) {
    case 'room.created':
    case 'room.updated':
    case 'room.deleted':
    case 'room.member.joined':
    case 'room.member.left':
    case 'room.member.invited':
    case 'room.member.removed':
    case 'room.member.banned':
    case 'room.member.unbanned':
    case 'room.member.promoted':
    case 'room.access.granted':
      rooms();
      break;
    case 'queue.updated':
      rooms();
      break;
    case 'waiting.created':
    case 'waiting.resolved':
    case 'waiting.expired':
      invalidate(['waiting', guildId]);
      invalidate(['rooms', guildId]);
      invalidate(['overview', guildId]);
      break;
    case 'reservation.created':
    case 'reservation.cancelled':
    case 'reservation.created_room':
    case 'reservation.failed':
      invalidate(['reservations', guildId]);
      invalidate(['overview', guildId]);
      break;
    case 'event.created':
    case 'event.updated':
    case 'event.cancelled':
      invalidate(['guildEvents', guildId]);
      invalidate(['room', guildId]);
      break;
    case 'merge.requested':
    case 'merge.resolved':
      rooms();
      break;
    case 'config.updated':
      invalidate(['guild', guildId]);
      invalidate(['premium', guildId]);
      break;
    case 'audit.created':
      invalidate(['logs', guildId]);
      invalidate(['overview', guildId]);
      break;
    default:
      break;
  }
}

export function useLiveUpdates(guildId: string | undefined) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    if (!guildId) return;
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setStatus('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws?guildId=${guildId}`);
      socket.onopen = () => {
        retry = 0;
        setStatus('open');
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; data?: { guildId?: string; room?: { guildId?: string } } };
          if (!message.type || message.type === 'hello' || message.type === 'pong') return;
          invalidateForEvent(message.type, guildId, queryClient);
        } catch {
          // Ignore malformed frames.
        }
      };
      socket.onclose = () => {
        setStatus('closed');
        if (disposed) return;
        const delay = Math.min(15_000, 1200 * 2 ** retry);
        retry += 1;
        timer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      socket?.close();
    };
  }, [guildId, queryClient]);

  return status;
}
