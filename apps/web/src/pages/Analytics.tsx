import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BarChart3, Clock, DoorOpen, RefreshCw, TrendingUp, Users } from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useGuild } from '../lib/guild';
import { useAnalytics } from '../lib/hooks';
import { formatDate, formatDay, formatDuration, formatNumber, privacyMeta, roomTypeMeta } from '../lib/format';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionCard,
  Skeleton,
  StatCard,
  Tabs,
} from '../components/ui';

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: '1 year' },
] as const;

const COLORS = ['#8b7cff', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#60a5fa', '#f472b6'];

const tooltipStyle = {
  background: '#0d0d17',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  fontSize: 12,
  color: '#f5f5fa',
};

export function AnalyticsPage() {
  const { guildId } = useGuild();
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('30d');
  const analytics = useAnalytics(guildId, range);
  const data = analytics.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Room analytics"
        description="Creation and deletion volume, peak concurrency, lifetime, popular templates and owner activity — all computed from real records."
        actions={
          <>
            <Tabs value={range} onChange={setRange} items={RANGES.map((item) => ({ ...item }))} />
            <button
              type="button"
              onClick={() => void analytics.refetch()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-muted transition hover:text-ink"
              aria-label="Refresh analytics"
            >
              <RefreshCw size={15} />
            </button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={TrendingUp}
          label={`Rooms created · ${range}`}
          value={formatNumber(data?.totals.roomsCreated ?? 0)}
          hint={`${formatNumber(data?.totals.completedRooms ?? 0)} completed rooms`}
          accent="accent"
        />
        <StatCard
          icon={Clock}
          label="Average lifetime"
          value={formatDuration(data?.totals.avgLifetimeSeconds ?? 0)}
          hint={`${formatNumber(data?.totals.voiceMinutes ?? 0)} voice minutes`}
          accent="cyan"
        />
        <StatCard
          icon={Activity}
          label="Peak concurrent"
          value={formatNumber(data?.totals.peakConcurrent ?? 0)}
          hint={`Active now: ${formatNumber(data?.totals.activeRooms ?? 0)}`}
          accent="amber"
        />
        <StatCard
          icon={Users}
          label="Participants"
          value={formatNumber(data?.totals.participants ?? 0)}
          hint={`${formatNumber(data?.totals.membersInRooms ?? 0)} members in voice now`}
          accent="mint"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <SectionCard icon={BarChart3} title="Creation & concurrency" description="Daily rooms created and peak concurrent rooms.">
          {analytics.isLoading ? (
            <Skeleton className="h-[320px] w-full" />
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data?.series ?? []} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="analyticsArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b7cff" stopOpacity={0.35} />
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
                    minTickGap={28}
                  />
                  <YAxis tick={{ fill: '#5a5a70', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => formatDay(String(value))} />
                  <Area type="monotone" dataKey="roomsCreated" name="Created" stroke="#8b7cff" fill="url(#analyticsArea)" strokeWidth={2} />
                  <Line type="monotone" dataKey="peakConcurrent" name="Peak concurrent" stroke="#22d3ee" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard icon={Activity} title="Popular room types" description="Completed and active rooms in range.">
          {analytics.isLoading ? (
            <Skeleton className="h-[320px] w-full" />
          ) : data && data.popularTypes.length > 0 ? (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.popularTypes}
                    dataKey="count"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="82%"
                    paddingAngle={3}
                    stroke="rgba(0,0,0,0.3)"
                  >
                    {data.popularTypes.map((entry, index) => (
                      <Cell key={entry.key} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="-mt-3 flex flex-wrap justify-center gap-2">
                {data.popularTypes.slice(0, 5).map((type, index) => (
                  <span key={type.key} className="inline-flex items-center gap-1.5 text-[10px] text-muted">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
                    {type.emoji} {type.name}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title="No room data yet" description="Analytics appear after rooms are created." />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard icon={Users} title="Participants per day" description="Voice joins counted by the engine.">
          {analytics.isLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.series ?? []} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(value) => formatDay(value)}
                    tick={{ fill: '#5a5a70', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis tick={{ fill: '#5a5a70', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => formatDay(String(value))} />
                  <Bar dataKey="totalParticipants" name="Participants" fill="#22d3ee" radius={[6, 6, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard icon={TrendingUp} title="Most active owners" description="Completed rooms in the selected window.">
          {analytics.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-10 w-full" />
              ))}
            </div>
          ) : data && data.topOwners.length > 0 ? (
            <div className="space-y-2">
              {data.topOwners.map((owner, index) => (
                <div key={owner.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/6 text-[11px] text-soft">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-soft">{owner.name}</p>
                      <p className="text-[10px] text-faint">{owner.id}</p>
                    </div>
                  </div>
                  <Badge tone="accent">{owner.rooms} rooms</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">No completed rooms in this window yet.</p>
          )}
        </SectionCard>
      </div>

      <SectionCard icon={Clock} title="Recent room history" description="The latest closed temporary rooms.">
        {analytics.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} className="h-12 w-full" />
            ))}
          </div>
        ) : data && data.recentHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-faint">
                  <th className="pb-2 font-medium">Room</th>
                  <th className="pb-2 font-medium">Owner</th>
                  <th className="pb-2 font-medium">Privacy</th>
                  <th className="pb-2 font-medium">Peak</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Ended</th>
                </tr>
              </thead>
              <tbody>
                {data.recentHistory.map((entry) => {
                  const privacy = privacyMeta(entry.privacy);
                  return (
                    <tr key={entry.id} className="border-b border-white/4 last:border-0">
                      <td className="py-2.5 pr-3 text-soft">{entry.name}</td>
                      <td className="py-2.5 pr-3 text-muted">{entry.ownerName ?? entry.ownerId}</td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={privacy.tone}>{privacy.emoji} {privacy.label}</Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{entry.peakMembers}</td>
                      <td className="py-2.5 pr-3 text-muted">{formatDuration(entry.durationSeconds)}</td>
                      <td className="py-2.5 text-faint">{formatDate(entry.endedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted">No closed rooms recorded yet.</p>
        )}
      </SectionCard>

      <div className="flex justify-end">
        <Link to={`/g/${guildId}/active-rooms`} className="text-xs text-accent-soft hover:text-ink">
          Inspect active rooms →
        </Link>
      </div>
    </div>
  );
}

export default AnalyticsPage;
