import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarClock,
  BarChart3,
  Check,
  Circle,
  DoorOpen,
  RefreshCw,
  Settings,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useGuild } from '../lib/guild';
import { useOverview } from '../lib/hooks';
import { formatDate, formatDay, formatDuration, formatNumber, privacyMeta, roomTypeMeta, titleCase } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Progress,
  SectionCard,
  Skeleton,
  StatCard,
  Tabs,
  cn,
} from '../components/ui';
import { useAuth } from '../lib/auth';

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: '1 year' },
] as const;

export function OverviewPage() {
  const { guildId, detail, live } = useGuild();
  const { user } = useAuth();
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('30d');
  const overview = useOverview(guildId, range);
  const data = overview.data;

  const checklist = [
    { label: 'Bot connected to Discord', done: detail.bot.online, hint: 'Add DISCORD_TOKEN and enable the required intents.' },
    { label: 'Join-to-create trigger configured', done: detail.counts.triggers > 0, hint: 'Create a trigger channel in Setup.' },
    { label: 'Room category selected', done: Boolean(detail.config.defaultCategoryId), hint: 'Temporary rooms need a category.' },
    { label: 'Lobby / control panel channel', done: Boolean(detail.config.lobbyChannelId), hint: 'Shows the room directory and fallback panels.' },
    { label: 'Engine enabled', done: detail.config.enabled, hint: 'Enable temporary voice in General.' },
  ];
  const completed = checklist.filter((item) => item.done).length;
  const setupProgress = Math.round((completed / checklist.length) * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command center"
        title={`Welcome back, ${user?.globalName || user?.username || 'operator'}`}
        description={`A live view of temporary voice in ${detail.guild.name}. Every number comes from the database and updates over WebSocket.`}
        actions={
          <>
            <Tabs value={range} onChange={setRange} items={RANGES.map((item) => ({ ...item }))} />
            <Button
              variant="secondary"
              leftIcon={RefreshCw}
              onClick={() => {
                void overview.refetch();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="relative overflow-hidden p-6 sm:p-7">
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/20 blur-[90px]" />
          <div className="pointer-events-none absolute -bottom-32 left-20 h-56 w-56 rounded-full bg-cyan/10 blur-[90px]" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={detail.bot.online ? 'mint' : 'amber'}>
                  <Bot size={11} /> {detail.bot.online ? `Bot online${detail.bot.tag ? ` · ${detail.bot.tag}` : ''}` : 'Bot offline'}
                </Badge>
                <Badge tone={live === 'open' ? 'accent' : 'muted'}>
                  <Activity size={11} /> {live === 'open' ? 'Realtime connected' : 'Realtime reconnecting'}
                </Badge>
                {detail.config.enabled ? <Badge tone="cyan">Engine on</Badge> : <Badge tone="rose">Engine paused</Badge>}
              </div>
              <h2 className="mt-4 font-display text-[26px] font-semibold leading-tight tracking-tight sm:text-[32px]">
                {detail.guild.name}’s voice floor, in one place.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {formatNumber(data?.totals.activeRooms ?? detail.counts.activeRooms)} rooms are active right now with{' '}
                {formatNumber(data?.totals.membersInRooms ?? detail.counts.members)} connected members. Configure, moderate
                and learn from every room without leaving the dashboard.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to={`/g/${guildId}/triggers`}>
                  <Button variant="primary" size="sm" leftIcon={Settings}>
                    Configure triggers
                  </Button>
                </Link>
                <Link to={`/g/${guildId}/active-rooms`}>
                  <Button variant="secondary" size="sm" leftIcon={DoorOpen}>
                    Manage rooms
                  </Button>
                </Link>
                <Link to={`/g/${guildId}/analytics`}>
                  <Button variant="ghost" size="sm" leftIcon={BarChart3}>
                    Open analytics
                  </Button>
                </Link>
              </div>
            </div>

            <div className="w-full max-w-sm rounded-2xl border border-white/8 bg-black/25 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">Setup health</p>
                <span className="text-xs font-medium text-soft">{setupProgress}%</span>
              </div>
              <div className="mt-2">
                <Progress value={completed} max={checklist.length} />
              </div>
              <div className="mt-4 space-y-2">
                {checklist.map((item) => (
                  <div key={item.label} className="flex items-start gap-2">
                    {item.done ? (
                      <Check size={13} className="mt-0.5 shrink-0 text-mint" />
                    ) : (
                      <Circle size={11} className="mt-0.5 shrink-0 text-faint" />
                    )}
                    <div>
                      <p className={cn('text-[12px] leading-tight', item.done ? 'text-soft' : 'text-muted')}>{item.label}</p>
                      {!item.done ? <p className="mt-0.5 text-[10px] leading-relaxed text-faint">{item.hint}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
          <StatCard
            icon={DoorOpen}
            label="Active rooms"
            value={formatNumber(data?.totals.activeRooms ?? detail.counts.activeRooms)}
            hint={`${formatNumber(detail.counts.triggers)} trigger channels · ${formatNumber(detail.counts.categories)} categories`}
            accent="accent"
          />
          <StatCard
            icon={Users}
            label="Members in voice"
            value={formatNumber(data?.totals.membersInRooms ?? detail.counts.members)}
            hint={`${formatNumber(data?.counts.pendingWaiting ?? 0)} pending access requests`}
            accent="cyan"
          />
          <StatCard
            icon={Sparkles}
            label={`Rooms created · ${range}`}
            value={formatNumber(data?.totals.roomsCreated ?? 0)}
            hint={`${formatNumber(data?.totals.completedRooms ?? 0)} completed rooms in range`}
            accent="mint"
          />
          <StatCard
            icon={Timer}
            label="Average lifetime"
            value={formatDuration(data?.totals.avgLifetimeSeconds ?? 0)}
            hint={`Peak concurrent ${formatNumber(data?.totals.peakConcurrent ?? 0)}`}
            accent="amber"
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <SectionCard
          icon={Activity}
          title="Room activity"
          description="Creations, deletions and peak concurrency over the selected window."
          actions={<Badge tone="muted">{range}</Badge>}
        >
          {overview.isLoading ? (
            <Skeleton className="h-[290px] w-full" />
          ) : (
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data?.series ?? []} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="creations" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b7cff" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#8b7cff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(value) => formatDay(value)}
                    tick={{ fill: '#5a5a70', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={26}
                  />
                  <YAxis tick={{ fill: '#5a5a70', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: '#0d0d17',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 12,
                      fontSize: 12,
                      color: '#f5f5fa',
                    }}
                    labelFormatter={(value) => formatDay(String(value))}
                  />
                  <Area type="monotone" dataKey="roomsCreated" name="Rooms created" stroke="#8b7cff" strokeWidth={2} fill="url(#creations)" />
                  <Line type="monotone" dataKey="peakConcurrent" name="Peak concurrent" stroke="#22d3ee" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard icon={Sparkles} title="Popular room types" description="What your community actually uses.">
          {overview.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-10 w-full" />
              ))}
            </div>
          ) : data && data.popularTypes.length > 0 ? (
            <div className="space-y-4">
              {data.popularTypes.slice(0, 5).map((type) => {
                const max = data.popularTypes[0]?.count || 1;
                return (
                  <div key={type.key}>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-soft">
                        <span>{type.emoji}</span> {type.name}
                      </span>
                      <span className="text-faint">{formatNumber(type.count)}</span>
                    </div>
                    <Progress value={type.count} max={max} tone="accent" />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted">No completed rooms yet. Popular types appear once rooms start closing.</p>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <SectionCard
          icon={DoorOpen}
          title="Live rooms"
          description="Jump into the room manager or open a room in Discord."
          actions={
            <Link to={`/g/${guildId}/active-rooms`} className="text-xs font-medium text-accent-soft hover:text-ink">
              View all
            </Link>
          }
        >
          {overview.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-16 w-full" />
              ))}
            </div>
          ) : data && data.activeRooms.length > 0 ? (
            <div className="space-y-3">
              {data.activeRooms.map((room) => {
                const privacy = privacyMeta(room.privacy);
                const type = roomTypeMeta(room.roomTypeKey);
                return (
                  <div
                    key={room.id}
                    className="flex flex-col gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3 transition hover:border-white/12 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-base">
                        {room.emoji || type.emoji}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">{room.name}</p>
                        <p className="text-[11px] text-faint">
                          @{room.ownerName} · {type.name} · {room.memberCount}/{room.userLimit || '∞'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={privacy.tone}>{privacy.emoji} {privacy.label}</Badge>
                      {room.locked ? <Badge tone="amber">Locked</Badge> : null}
                      <a
                        href={`https://discord.com/channels/${guildId}/${room.channelId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[11px] text-soft transition hover:border-accent/30 hover:text-ink"
                      >
                        Open <ArrowUpRight size={12} />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={DoorOpen}
              title="No active rooms"
              description="When members join a trigger channel, their rooms appear here instantly."
              action={
                <Link to={`/g/${guildId}/triggers`}>
                  <Button variant="secondary" size="sm">
                    Set up triggers
                  </Button>
                </Link>
              }
            />
          )}
        </SectionCard>

        <SectionCard icon={CalendarClock} title="Recent activity" description="Audit events from the last actions.">
          {overview.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-12 w-full" />
              ))}
            </div>
          ) : data && data.recentLogs.length > 0 ? (
            <div className="space-y-1">
              {data.recentLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.03]">
                  <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-soft">{titleCase(log.action)}</p>
                    <p className="text-[10px] text-faint">
                      {log.actorName || 'System'} · {formatDate(log.createdAt)}
                    </p>
                  </div>
                  <Badge tone="muted">{log.category.toLowerCase()}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">No activity recorded yet.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export default OverviewPage;
