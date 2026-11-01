import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken, type ApiError } from './api';
import type { MeData, MetaData } from '../types';

interface AuthContextValue {
  me: MeData | undefined;
  user: MeData['user'] | undefined;
  meta: MetaData | undefined;
  loading: boolean;
  unauthorized: boolean;
  error: ApiError | null;
  refresh: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeData>('/me'),
    retry: false,
    staleTime: 30_000,
  });
  const metaQuery = useQuery({
    queryKey: ['meta'],
    queryFn: () => api<MetaData>('/meta'),
    retry: 1,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (meQuery.data?.csrfToken) setCsrfToken(meQuery.data.csrfToken);
  }, [meQuery.data?.csrfToken]);

  useEffect(() => {
    if (meQuery.data?.user?.id) {
      const previous = localStorage.getItem('chamber:last-guild');
      if (meQuery.data.preferences?.lastGuildId) {
        localStorage.setItem('chamber:last-guild', meQuery.data.preferences.lastGuildId);
      } else if (!previous && meQuery.data.guilds[0]) {
        localStorage.setItem('chamber:last-guild', meQuery.data.guilds[0].id);
      }
    }
  }, [meQuery.data]);

  useEffect(() => {
    const handler = () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    };
    window.addEventListener('chamber:unauthorized', handler);
    return () => window.removeEventListener('chamber:unauthorized', handler);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const unauthorized = meQuery.error instanceof Error && 'status' in meQuery.error && (meQuery.error as { status: number }).status === 401;
    return {
      me: meQuery.data,
      user: meQuery.data?.user,
      meta: metaQuery.data,
      loading: meQuery.isLoading || metaQuery.isLoading,
      unauthorized: Boolean(unauthorized) || (!meQuery.isLoading && !meQuery.data),
      error: (meQuery.error as ApiError | null) ?? null,
      refresh: () => {
        void meQuery.refetch();
        void metaQuery.refetch();
      },
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST' });
        } catch {
          // Session may already be gone.
        } finally {
          setCsrfToken('');
          localStorage.removeItem('chamber:last-guild');
          queryClient.clear();
          window.location.href = '/login';
        }
      },
    };
  }, [meQuery.data, meQuery.error, meQuery.isLoading, metaQuery.data, metaQuery.isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
