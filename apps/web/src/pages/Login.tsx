import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  ListOrdered,
  Lock,
  Radio,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button, Spinner } from '../components/ui';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: 'Discord OAuth is not configured on this server yet. Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.',
  state_mismatch: 'The sign-in session expired. Please try again.',
  missing_code: 'Discord did not return an authorization code. Try again.',
  token_exchange_failed: 'Discord rejected the sign-in. Check the OAuth redirect URI and client secret.',
  access_denied: 'You cancelled the Discord authorization.',
  login_failed: 'Discord sign-in failed. Please try again.',
};

const FEATURES = [
  { icon: Radio, title: 'Join-to-create engine', copy: 'Multi-trigger, multi-category rooms with template intelligence.' },
  { icon: ShieldCheck, title: 'Seven privacy modes', copy: 'Password verification, request-to-join, trusted lists and more.' },
  { icon: ListOrdered, title: 'Queues & waiting rooms', copy: 'Owner-controlled admission with live positions and notifications.' },
  { icon: CalendarClock, title: 'Reservations & events', copy: 'Schedules, reminders, RSVP limits and Discord timestamps.' },
  { icon: Sparkles, title: 'Components V2 only', copy: 'A real control panel. No embeds, no dead buttons.' },
  { icon: Zap, title: 'Live dashboard', copy: 'WebSocket updates, analytics and audit trails in real time.' },
];

export function LoginPage() {
  const { me, meta, loading } = useAuth();
  const { error: toastError } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [devLoading, setDevLoading] = useState(false);
  const errorCode = searchParams.get('error');
  const loginErrorText =
    searchParams.get('message') ?? (errorCode ? ERROR_MESSAGES[errorCode] ?? 'Sign-in failed.' : null);

  useEffect(() => {
    if (!me) return;
    if (me.guilds.length > 0) {
      const last = localStorage.getItem('chamber:last-guild');
      const target = me.guilds.find((guild) => guild.id === last) ?? me.guilds[0];
      navigate(`/g/${target.id}`, { replace: true });
    }
  }, [me, navigate]);

  const devLogin = useMutation({
    mutationFn: () => api('/auth/dev-login', { method: 'POST' }),
    onMutate: () => setDevLoading(true),
    onSuccess: () => {
      window.location.href = '/';
    },
    onError: (error) => {
      setDevLoading(false);
      toastError('Development login failed', errorMessage(error));
    },
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (me && me.guilds.length > 0) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div className="pointer-events-none absolute -left-40 top-[-10%] h-[520px] w-[520px] rounded-full bg-accent/20 blur-[140px]" />
      <div className="pointer-events-none absolute -right-40 top-1/3 h-[420px] w-[420px] rounded-full bg-cyan/10 blur-[140px]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1400px] flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="accent-gradient flex h-10 w-10 items-center justify-center rounded-2xl shadow-[0_10px_30px_-12px_rgba(124,108,255,0.9)]">
              <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden>
                <rect x="6" y="8" width="20" height="16" rx="5" stroke="white" strokeWidth="2" />
                <path d="M13 13v6M16 11v10M19 14v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="font-display text-lg font-semibold tracking-tight">Chamber</p>
              <p className="text-[10px] uppercase tracking-[0.24em] text-faint">Temporary voice, orchestrated</p>
            </div>
          </div>
          <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-muted sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" /> Open source · self-hosted
          </span>
        </header>

        <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20 lg:py-20">
          <div className="max-w-2xl animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.08] px-3 py-1 text-[11px] font-medium text-accent-soft">
              <Sparkles size={12} /> The control room for Discord voice
            </div>
            <h1 className="mt-6 font-display text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] text-ink sm:text-[56px]">
              Temporary voice,
              <br />
              <span className="gradient-text">perfectly orchestrated.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
              Chamber turns a single join-to-create channel into a complete temporary voice platform — private rooms,
              queues, reservations, events and a real-time dashboard. No embeds. No mock controls.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="flex items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent-soft">
                    <feature.icon size={15} />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-ink">{feature.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-faint">{feature.copy}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-faint">
              {['10 built-in templates', '7 privacy modes', '0 embeds', 'PostgreSQL + Prisma'].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <Check size={12} className="text-mint" /> {item}
                </span>
              ))}
            </div>
          </div>

          <div className="w-full max-w-md justify-self-center lg:justify-self-end">
            <div className="glass relative overflow-hidden rounded-3xl p-1.5">
              <div className="rounded-[20px] bg-[#0a0a13]/90 px-6 py-7 sm:px-8">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                  <Lock size={19} className="text-accent-soft" />
                </div>
                <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight">Sign in to your control room</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  Authenticate with Discord. Chamber only requests your identity and the list of servers you manage.
                </p>

                {loginErrorText ? (
                  <div className="mt-4 rounded-xl border border-rose/25 bg-rose/[0.08] px-3.5 py-3 text-xs leading-relaxed text-rose">
                    {loginErrorText}
                  </div>
                ) : null}

                <div className="mt-6 space-y-3">
                  {meta?.oauthConfigured ? (
                    <a
                      href="/api/auth/login"
                      className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#5865F2] text-sm font-semibold text-white shadow-[0_12px_30px_-12px_rgba(88,101,242,0.9)] transition hover:brightness-110"
                    >
                      <DiscordGlyph className="h-5 w-5" />
                      Continue with Discord
                      <ArrowRight size={15} />
                    </a>
                  ) : (
                    <div className="rounded-xl border border-amber/25 bg-amber/[0.06] px-3.5 py-3 text-xs leading-relaxed text-amber">
                      Discord OAuth is not configured. Add your Discord client credentials to <code>.env</code> to enable
                      sign-in.
                    </div>
                  )}

                  {meta?.devAuth ? (
                    <Button
                      variant="secondary"
                      size="lg"
                      className="w-full"
                      loading={devLoading || devLogin.isPending}
                      leftIcon={Bot}
                      onClick={() => devLogin.mutate()}
                    >
                      Development sign-in
                    </Button>
                  ) : null}
                </div>

                <div className="mt-6 space-y-2 border-t border-white/6 pt-4 text-[11px] leading-relaxed text-faint">
                  <p className="flex items-center gap-2">
                    <ShieldCheck size={13} className="text-mint" /> Sessions are server-side and CSRF protected.
                  </p>
                  <p className="flex items-center gap-2">
                    <Bot size={13} className="text-accent-soft" /> No message content is ever read or stored.
                  </p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center text-[11px] text-faint">
              By continuing you agree to the open-source license and the privacy notes in the README.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.947 2.419-2.157 2.419z" />
    </svg>
  );
}

export default LoginPage;
