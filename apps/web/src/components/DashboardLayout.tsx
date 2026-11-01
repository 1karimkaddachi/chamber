import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  Crown,
  DoorOpen,
  ExternalLink,
  FolderTree,
  Layers,
  LayoutDashboard,
  ListOrdered,
  Lock,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  ScrollText,
  Settings,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useGuild } from '../lib/guild';
import { cn, Avatar, Badge, IconButton } from './ui';
import { initials } from '../lib/format';
import { api } from '../lib/api';

type NavItem = { label: string; path: string; icon: LucideIcon; end?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Overview', path: '', icon: LayoutDashboard, end: true },
      { label: 'Active Rooms', path: 'active-rooms', icon: Users },
    ],
  },
  {
    label: 'Setup',
    items: [
      { label: 'General', path: 'general', icon: Settings },
      { label: 'Trigger Channels', path: 'triggers', icon: Radio },
      { label: 'Voice Categories', path: 'categories', icon: FolderTree },
      { label: 'Room Templates', path: 'templates', icon: Layers },
      { label: 'Room Types', path: 'room-types', icon: Shapes },
    ],
  },
  {
    label: 'Experience',
    items: [
      { label: 'Permissions', path: 'permissions', icon: ShieldCheck },
      { label: 'Privacy', path: 'privacy', icon: Lock },
      { label: 'Waiting Room', path: 'waiting-room', icon: DoorOpen },
      { label: 'Queue', path: 'queue', icon: ListOrdered },
      { label: 'Reservations', path: 'reservations', icon: CalendarClock },
      { label: 'Automation', path: 'automation', icon: Workflow },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { label: 'AI Assistant', path: 'ai', icon: Sparkles },
      { label: 'Analytics', path: 'analytics', icon: BarChart3 },
      { label: 'Activity Logs', path: 'logs', icon: ScrollText },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Premium Features', path: 'premium', icon: Crown },
      { label: 'Advanced', path: 'advanced', icon: SlidersHorizontal },
    ],
  },
];

function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="accent-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-[0_10px_30px_-12px_rgba(124,108,255,0.9)]">
        <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden>
          <rect x="6" y="8" width="20" height="16" rx="5" stroke="white" strokeWidth="2" />
          <path d="M13 13v6M16 11v10M19 14v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      {collapsed ? null : (
        <div className="leading-none">
          <p className="font-display text-[17px] font-semibold tracking-tight text-ink">Chamber</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-faint">Voice control</p>
        </div>
      )}
    </div>
  );
}

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose, active]);
}

export function DashboardLayout() {
  const { me, meta, logout } = useAuth();
  const { detail, guildId, live } = useGuild();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('chamber:sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [guildMenu, setGuildMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const guildMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useOutsideClick(guildMenuRef, () => setGuildMenu(false), guildMenu);
  useOutsideClick(userMenuRef, () => setUserMenu(false), userMenu);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem('chamber:sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  const guild = me?.guilds.find((entry) => entry.id === guildId);

  const switchGuild = (id: string) => {
    setGuildMenu(false);
    navigate(`/g/${id}`);
    void api('/me/preferences', { method: 'PATCH', body: { lastGuildId: id } }).catch(() => null);
  };

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between px-4 py-5">
        <Logo collapsed={collapsed} />
        <div className="hidden lg:block">
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            onClick={() => setCollapsed((value) => !value)}
          />
        </div>
        <div className="lg:hidden">
          <IconButton label="Close navigation" icon={X} onClick={() => setMobileOpen(false)} />
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((group) => (
          <div key={group.label} className="mb-5">
            {!collapsed ? (
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-faint/80">{group.label}</p>
            ) : (
              <div className="mx-auto mb-3 h-px w-6 bg-white/8" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const to = `/g/${guildId}${item.path ? `/${item.path}` : ''}`;
                return (
                  <NavLink
                    key={item.path}
                    to={to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
                        isActive
                          ? 'bg-white/[0.07] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                          : 'text-muted hover:bg-white/[0.045] hover:text-soft',
                        collapsed && 'justify-center px-0',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-accent to-cyan" />
                        ) : null}
                        <Icon size={17} className={isActive ? 'text-accent-soft' : 'text-faint group-hover:text-soft'} />
                        {collapsed ? null : <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-white/6 p-3">
        <div className={cn('rounded-xl border border-white/7 bg-white/[0.025] p-3', collapsed && 'px-2 py-3')}>
          <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                detail.bot.online ? 'bg-mint animate-pulse-soft' : 'bg-amber',
              )}
            />
            {collapsed ? null : (
              <p className="truncate text-[11px] font-medium text-soft">
                {detail.bot.online ? `Bot online${detail.bot.tag ? ` · ${detail.bot.tag.split('#')[0]}` : ''}` : 'Bot offline'}
              </p>
            )}
          </div>
          {collapsed ? null : (
            <p className="mt-1 pl-4 text-[10px] text-faint">
              {live === 'open' ? 'Realtime connected' : live === 'connecting' ? 'Connecting realtime…' : 'Realtime reconnecting'}
            </p>
          )}
        </div>
        {collapsed ? null : (
          <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.18em] text-faint/70">
            Chamber v{meta?.version ?? '1.0.0'}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="relative flex min-h-screen">
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/6 bg-[#08080f]/70 backdrop-blur-2xl transition-[width] duration-300 lg:flex',
          collapsed ? 'w-[84px]' : 'w-[264px]',
        )}
      >
        {sidebarContent}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="glass absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-white/10">
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-white/6 bg-canvas/70 backdrop-blur-2xl">
          <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <div className="lg:hidden">
                <IconButton label="Open navigation" icon={Menu} onClick={() => setMobileOpen(true)} />
              </div>
              <div className="relative" ref={guildMenuRef}>
                <button
                  type="button"
                  onClick={() => setGuildMenu((value) => !value)}
                  className="flex max-w-[52vw] items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-left transition hover:bg-white/[0.06] sm:max-w-none"
                  aria-haspopup="menu"
                  aria-expanded={guildMenu}
                >
                  {guild?.icon ? (
                    <img src={guild.icon} alt="" className="h-7 w-7 rounded-lg object-cover ring-1 ring-white/10" />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent/40 to-cyan/20 text-[10px] font-semibold text-white ring-1 ring-white/10">
                      {initials(guild?.name)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{guild?.name ?? detail.guild.name}</p>
                    <p className="text-[10px] text-faint">
                      {summaryRole(guild?.admin, guild?.staff)} · {detail.bot.online ? 'bot online' : 'bot offline'}
                    </p>
                  </div>
                  <ChevronDown size={14} className="ml-1 shrink-0 text-faint" />
                </button>
                {guildMenu ? (
                  <div className="glass absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl p-2 animate-fade-up" role="menu">
                    <p className="px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] text-faint">Your servers</p>
                    {(me?.guilds ?? []).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        role="menuitem"
                        onClick={() => switchGuild(entry.id)}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/6"
                      >
                        {entry.icon ? (
                          <img src={entry.icon} alt="" className="h-8 w-8 rounded-lg object-cover ring-1 ring-white/10" />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/6 text-[11px] font-semibold text-soft">
                            {initials(entry.name)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] text-ink">{entry.name}</p>
                          <p className="text-[10px] text-faint">
                            {summaryRole(entry.admin, entry.staff)} {entry.botPresent ? '· bot present' : '· bot not added'}
                          </p>
                        </div>
                        {entry.id === guildId ? <Check size={14} className="text-accent-soft" /> : null}
                      </button>
                    ))}
                    {meta?.inviteUrl ? (
                      <a
                        href={meta.inviteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-2 text-[11px] text-muted transition hover:text-soft"
                      >
                        <ExternalLink size={13} /> Add Chamber to another server
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 sm:flex">
                <Badge tone={live === 'open' ? 'mint' : live === 'connecting' ? 'amber' : 'muted'}>
                  {live === 'open' ? <Wifi size={11} /> : <WifiOff size={11} />}
                  {live === 'open' ? 'Live' : live === 'connecting' ? 'Linking' : 'Reconnecting'}
                </Badge>
                <Badge tone={detail.bot.online ? 'accent' : 'amber'}>
                  <Bot size={11} /> {detail.bot.online ? 'Bot online' : 'Bot offline'}
                </Badge>
              </div>
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenu((value) => !value)}
                  className="flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] p-1 pr-2 transition hover:bg-white/[0.06]"
                  aria-haspopup="menu"
                  aria-expanded={userMenu}
                >
                  <Avatar src={me?.user.avatarUrl} name={me?.user.globalName || me?.user.username} size={28} />
                  <ChevronDown size={13} className="text-faint" />
                </button>
                {userMenu ? (
                  <div className="glass absolute right-0 top-full z-50 mt-2 w-60 rounded-2xl p-2 animate-fade-up" role="menu">
                    <div className="flex items-center gap-3 px-2 py-2">
                      <Avatar src={me?.user.avatarUrl} name={me?.user.globalName || me?.user.username} size={36} />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">
                          {me?.user.globalName || me?.user.username}
                        </p>
                        <p className="truncate text-[10px] text-faint">Discord · {me?.user.id}</p>
                      </div>
                    </div>
                    <div className="my-1 h-px bg-white/6" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void logout()}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[13px] text-rose transition hover:bg-rose/10"
                    >
                      <LogOut size={15} /> Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pt-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function summaryRole(admin?: boolean, staff?: boolean) {
  if (admin) return 'Administrator';
  if (staff) return 'Staff';
  return 'Member';
}

export default DashboardLayout;
