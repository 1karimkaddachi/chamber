import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuth } from './auth';
import { useChannels, useGuildDetail } from './hooks';
import { useLiveUpdates, type LiveStatus } from './live';
import { api, errorMessage } from './api';
import type { ChannelsData, GuildDetail } from '../types';
import { Button, PageLoader } from '../components/ui';

interface GuildContextValue {
  guildId: string;
  detail: GuildDetail;
  channels: ChannelsData | undefined;
  live: LiveStatus;
  refetch: () => void;
}

const GuildContext = createContext<GuildContextValue | null>(null);

export function GuildProvider({ guildId, children }: { guildId: string; children: ReactNode }) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const detail = useGuildDetail(guildId);
  const channels = useChannels(guildId);
  const live = useLiveUpdates(guildId);

  const value = useMemo<GuildContextValue | null>(() => {
    if (!detail.data) return null;
    return {
      guildId,
      detail: detail.data,
      channels: channels.data,
      live,
      refetch: () => {
        void detail.refetch();
        void channels.refetch();
      },
    };
  }, [guildId, detail.data, channels.data, live, detail, channels]);

  const summary = me?.guilds.find((guild) => guild.id === guildId);

  if (detail.isLoading) return <PageLoader />;

  if (detail.error) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose/25 bg-rose/10 text-rose">
          <AlertTriangle size={24} />
        </div>
        <h1 className="mt-5 font-display text-xl font-semibold text-ink">This server is unavailable</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{errorMessage(detail.error)}</p>
        <div className="mt-6 flex gap-2">
          <Button variant="primary" leftIcon={RefreshCw} onClick={() => void detail.refetch()}>
            Try again
          </Button>
          <Button variant="secondary" leftIcon={ArrowLeft} onClick={() => navigate('/')}>
            Back to servers
          </Button>
        </div>
      </div>
    );
  }

  if (!detail.data) return <PageLoader />;

  if (summary && !summary.admin && !summary.staff) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
        <h1 className="font-display text-xl font-semibold text-ink">No access to this server</h1>
        <p className="mt-2 text-sm text-muted">Ask a server administrator to add one of your roles to Chamber staff.</p>
        <Link to="/" className="mt-6 text-sm text-accent-soft hover:text-ink">
          Choose another server
        </Link>
      </div>
    );
  }

  return <GuildContext.Provider value={value ?? { guildId, detail: detail.data, channels: channels.data, live, refetch: () => void detail.refetch() }}>{children}</GuildContext.Provider>;
}

export function useGuild() {
  const context = useContext(GuildContext);
  if (!context) throw new Error('useGuild must be used inside GuildProvider');
  return context;
}
