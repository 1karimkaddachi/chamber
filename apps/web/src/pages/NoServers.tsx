import { ExternalLink, LogOut, RefreshCw, Server } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, Card } from '../components/ui';

export function NoServersPage() {
  const { meta, logout, refresh } = useAuth();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[520px] -translate-x-1/2 rounded-full bg-accent/15 blur-[140px]" />
      <Card className="relative w-full max-w-lg p-7 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent-soft">
          <Server size={24} />
        </div>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">No manageable servers yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          You need <strong className="text-soft">Manage Server</strong> or <strong className="text-soft">Administrator</strong> on a
          server where Chamber is installed. Add the bot, then refresh.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {meta?.inviteUrl ? (
            <a href={meta.inviteUrl} target="_blank" rel="noreferrer">
              <Button variant="primary" leftIcon={ExternalLink} className="w-full sm:w-auto">
                Add Chamber to Discord
              </Button>
            </a>
          ) : null}
          <Button variant="secondary" leftIcon={RefreshCw} onClick={refresh}>
            Refresh access
          </Button>
        </div>
        <div className="mt-6 border-t border-white/6 pt-4">
          <Button variant="ghost" size="sm" leftIcon={LogOut} onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default NoServersPage;
