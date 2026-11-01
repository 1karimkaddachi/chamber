import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Crown,
  DoorOpen,
  Layers,
  ListOrdered,
  Lock,
  Sparkles,
  Split,
  Workflow,
} from 'lucide-react';
import { useGuild } from '../lib/guild';
import { usePremium } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { formatDuration, formatNumber } from '../lib/format';
import {
  Badge,
  Callout,
  Card,
  PageHeader,
  Progress,
  SectionCard,
  Skeleton,
  Toggle,
} from '../components/ui';

const META: Record<string, { icon: typeof Crown; description: string }> = {
  waitingRoom: { icon: DoorOpen, description: 'Request-to-join workflow with owner approvals and a public directory.' },
  queue: { icon: ListOrdered, description: 'Real voice waiting queues with priority roles and owner admission.' },
  reservations: { icon: CalendarClock, description: 'Scheduled rooms, reminders and automatic creation.' },
  events: { icon: Crown, description: 'Gaming, movie, study and meeting events with RSVP limits.' },
  merging: { icon: Split, description: 'Two-owner approval, member transfer and safe room cleanup.' },
  cloning: { icon: Layers, description: 'Clone identity, privacy, allow-list and bans into a new room.' },
  password: { icon: Lock, description: 'Bot-verified passwords with hashes, attempt limits and lockouts.' },
  ai: { icon: Sparkles, description: 'Optional AI suggestions with a local heuristic fallback.' },
};

export function PremiumPage() {
  const { guildId, detail } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const premium = usePremium(guildId);
  const canEdit = detail.access.admin;

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api(`/guilds/${guildId}/premium`, { method: 'PATCH', body: { [key]: enabled } }),
    onSuccess: (_data, variables) => {
      success(`${variables.enabled ? 'Enabled' : 'Disabled'} ${variables.key}`);
      void queryClient.invalidateQueries({ queryKey: ['premium', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
    },
    onError: (error) => toastError('Could not update feature', errorMessage(error)),
  });

  const data = premium.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Premium features"
        description="Chamber is fully self-hosted. Every advanced feature is included — no billing, no license gate, no telemetry."
        actions={<Badge tone="mint"><Crown size={11} /> Self-hosted</Badge>}
      />

      {premium.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-36 w-full" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-faint">Active rooms</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(data.usage.activeRooms)}</p>
              <p className="mt-1 text-[11px] text-muted">limit {formatNumber(data.limits.maxRoomsPerGuild)} per server</p>
              <div className="mt-3">
                <Progress value={data.usage.activeRooms} max={data.limits.maxRoomsPerGuild} />
              </div>
            </Card>
            <Card className="p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-faint">Templates</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(data.usage.templates)}</p>
              <p className="mt-1 text-[11px] text-muted">custom templates beyond 10 built-ins</p>
            </Card>
            <Card className="p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-faint">Queued members</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(data.usage.queued)}</p>
              <p className="mt-1 text-[11px] text-muted">cap {data.limits.queueMaxSize || 'unlimited'} per room</p>
            </Card>
            <Card className="p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-faint">Average lifetime</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatDuration(data.usage.averageLifetimeSeconds)}</p>
              <p className="mt-1 text-[11px] text-muted">{formatNumber(data.usage.roomsThisMonth)} rooms in 30 days</p>
            </Card>
          </div>

          <SectionCard icon={Crown} title="Feature switches" description="Toggle advanced features per server. Disabled features also hide their UI and Discord controls.">
            <div className="grid gap-4 sm:grid-cols-2">
              {data.features.map((feature) => {
                const meta = META[feature.key];
                const Icon = meta?.icon ?? Workflow;
                return (
                  <div key={feature.key} className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent-soft">
                          <Icon size={16} />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-ink">{feature.label}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted">{meta?.description}</p>
                        </div>
                      </div>
                      <Toggle
                        checked={feature.enabled}
                        onChange={(value) => toggle.mutate({ key: feature.key, enabled: value })}
                        disabled={!canEdit || toggle.isPending}
                        label={feature.label}
                        hideLabel
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard icon={Workflow} title="Configured limits" description="Hard caps enforced by the engine.">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Limit label="Rooms per member" value={data.limits.maxRoomsPerUser} />
              <Limit label="Rooms per server" value={data.limits.maxRoomsPerGuild} />
              <Limit label="Queue size per room" value={data.limits.queueMaxSize || 'Unlimited'} />
              <Limit label="Reservations per member" value={data.limits.reservationsPerUser} />
              <Limit label="Reservation window" value={`${data.limits.reservationWindowDays} days`} />
              <Limit label="Retention" value={`${data.limits.retentionDays} days`} />
            </div>
          </SectionCard>

          <Callout tone="mint" title="No fake monetisation">
            {data.note} The Premium page exists because open-source self-hosters deserve a clear inventory of advanced
            capabilities — not because anything is locked.
          </Callout>
        </>
      ) : null}

      {!canEdit ? (
        <Callout tone="amber" title="Read-only">
          Staff can inspect usage. Only administrators can toggle features.
        </Callout>
      ) : null}
    </div>
  );
}

function Limit({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-faint">{label}</p>
      <p className="mt-1 text-sm font-medium text-soft">{typeof value === 'number' ? formatNumber(value) : value}</p>
    </div>
  );
}

export default PremiumPage;
