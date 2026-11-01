import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListOrdered, RefreshCw, Star, Timer, UserCheck } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useQueues } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { NumberField, RoleMultiPicker, useConfigForm } from '../components/ConfigForm';
import { formatDate, privacyMeta } from '../lib/format';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  OfflineNotice,
  PageHeader,
  SaveBar,
  SectionCard,
  Skeleton,
  Toggle,
} from '../components/ui';

export function QueuePage() {
  const { guildId, detail, channels } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const { form, update, dirty, save, saving, reset } = useConfigForm(guildId, detail.config);
  const queues = useQueues(guildId);
  const canEdit = detail.access.admin;
  const canModerate = detail.access.staff;

  const admit = useMutation({
    mutationFn: (roomId: string) =>
      api(`/guilds/${guildId}/rooms/${roomId}/queue/admit`, { method: 'POST', body: {} }),
    onSuccess: () => {
      success('Queue entry admitted');
      void queryClient.invalidateQueries({ queryKey: ['queues', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['rooms', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['overview', guildId] });
    },
    onError: (error) => toastError('Could not admit the next member', errorMessage(error)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experience"
        title="Queue management"
        description="A real waiting queue for full rooms. Owners control admission; Chamber enforces positions, priority roles and limits."
        actions={
          <Button variant="secondary" leftIcon={RefreshCw} onClick={() => void queues.refetch()}>
            Refresh
          </Button>
        }
      />

      {!detail.bot.online ? <OfflineNotice message="Admission requires the bot to update channel permissions and move members." /> : null}

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <SectionCard icon={ListOrdered} title="Queue policy" description="How queues behave on this server.">
          <div className="space-y-4">
            {!canEdit ? <Callout tone="amber" title="Read-only">Only administrators can change queue policy.</Callout> : null}
            <Toggle
              checked={form.queueEnabled}
              onChange={(value) => update('queueEnabled', value)}
              label="Enable room queues"
              description="Members can queue when a limited room is full."
              disabled={!canEdit}
            />
            <NumberField
              label="Maximum queue size"
              hint="0 disables the cap. Per-room queues use this limit."
              value={form.queueMaxSize}
              min={0}
              max={100}
              onChange={(value) => update('queueMaxSize', value)}
              disabled={!canEdit}
            />
            <Toggle
              checked={form.queueAutoAdmit}
              onChange={(value) => update('queueAutoAdmit', value)}
              label="Auto-admit the next member"
              description="When a spot opens, Chamber admits the first queued member automatically and notifies them."
              disabled={!canEdit}
            />
            <Field label="Priority roles" hint="Higher priority sorts ahead of earlier joiners. Privacy and bans still apply.">
              <RoleMultiPicker
                values={form.queuePriorityRoleIds}
                onChange={(values) => update('queuePriorityRoleIds', values)}
                roles={channels?.roles}
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          icon={Timer}
          title="Active queues"
          description={`${queues.data?.reduce((sum, group) => sum + group.entries.length, 0) ?? 0} members waiting across ${queues.data?.length ?? 0} rooms.`}
        >
          {queues.isLoading ? (
            <div className="space-y-3">
              {[0, 1].map((item) => (
                <Skeleton key={item} className="h-32 w-full" />
              ))}
            </div>
          ) : queues.data && queues.data.length > 0 ? (
            <div className="space-y-4">
              {queues.data.map((group) => {
                const privacy = privacyMeta(group.privacy);
                return (
                  <div key={group.roomId} className="overflow-hidden rounded-xl border border-white/6 bg-white/[0.02]">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 px-4 py-3">
                      <div>
                        <p className="text-[13px] font-medium text-ink">{group.roomName}</p>
                        <p className="mt-0.5 text-[11px] text-faint">
                          {privacy.emoji} {privacy.label} · capacity {group.userLimit || '∞'} · {group.entries.length} waiting
                        </p>
                      </div>
                      <Button
                        variant="success"
                        size="sm"
                        leftIcon={UserCheck}
                        loading={admit.isPending && admit.variables === group.roomId}
                        disabled={!canModerate || !detail.bot.online}
                        onClick={() => admit.mutate(group.roomId)}
                      >
                        Admit next
                      </Button>
                    </div>
                    <div className="divide-y divide-white/5">
                      {group.entries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/6 text-[11px] text-soft">
                              {entry.position}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[12px] text-soft">
                                {entry.name}
                                {entry.priority > 0 ? <Star size={11} className="ml-1 inline text-amber" /> : null}
                              </p>
                              <p className="text-[10px] text-faint">Joined {formatDate(entry.joinedAt)}</p>
                            </div>
                          </div>
                          {entry.priority > 0 ? <Badge tone="amber">Priority</Badge> : <Badge tone="muted">Standard</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={ListOrdered}
              title="No active queues"
              description="Queues appear when members wait for a full room. Only rooms with a user limit can be queued."
            />
          )}
        </SectionCard>
      </div>

      <SaveBar dirty={dirty && canEdit} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}

export default QueuePage;
