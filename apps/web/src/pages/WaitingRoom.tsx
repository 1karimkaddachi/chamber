import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, DoorOpen, RefreshCw, X } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useWaitingRequests } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { ChannelPicker, NumberField } from '../components/ConfigForm';
import { useConfigForm } from '../components/ConfigForm';
import { formatDate } from '../lib/format';
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

export function WaitingRoomPage() {
  const { guildId, detail, channels } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const { form, update, dirty, save, saving, reset } = useConfigForm(guildId, detail.config);
  const waiting = useWaitingRequests(guildId);
  const canEdit = detail.access.admin;
  const canModerate = detail.access.staff;

  const resolve = useMutation({
    mutationFn: ({ requestId, roomId, accept }: { requestId: string; roomId: string; accept: boolean }) =>
      api(`/guilds/${guildId}/rooms/${roomId}/waiting/${requestId}`, { method: 'POST', body: { accept } }),
    onSuccess: (_data, variables) => {
      success(variables.accept ? 'Request accepted' : 'Request rejected');
      void queryClient.invalidateQueries({ queryKey: ['waiting', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['rooms', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['overview', guildId] });
    },
    onError: (error) => toastError('Could not resolve request', errorMessage(error)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experience"
        title="Waiting room"
        description="Members request access to private rooms. You receive the cards in Discord and can resolve them here or from the DM."
        actions={
          <Button variant="secondary" leftIcon={RefreshCw} onClick={() => void waiting.refetch()}>
            Refresh
          </Button>
        }
      />

      {!detail.bot.online ? <OfflineNotice message="Accepting a request requires the bot to update channel permissions. You can still review pending requests." /> : null}

      <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <SectionCard icon={DoorOpen} title="Waiting room configuration" description="A public lobby panel lists requestable rooms and posts the room directory.">
          <div className="space-y-4">
            {!canEdit ? <Callout tone="amber" title="Read-only">Only administrators can edit this configuration.</Callout> : null}
            <Toggle
              checked={form.waitingRoomEnabled}
              onChange={(value) => update('waitingRoomEnabled', value)}
              label="Enable waiting room requests"
              description="Allows request-to-join rooms to receive access requests and owner DMs."
              disabled={!canEdit}
            />
            <Field label="Directory channel" hint="Chamber posts and keeps a live room directory panel here.">
              <ChannelPicker
                value={form.waitingRoomChannelId}
                onChange={(value) => update('waitingRoomChannelId', value)}
                channels={channels}
                kind="text"
                placeholder="Use lobby channel"
              />
            </Field>
            <NumberField
              label="Request expiry"
              hint="Pending requests expire automatically after this window."
              value={form.waitingRequestExpiryMinutes}
              min={5}
              max={1440}
              suffix="min"
              onChange={(value) => update('waitingRequestExpiryMinutes', value)}
              disabled={!canEdit}
            />
            <Callout tone="accent" title="What members see">
              A Components V2 lobby panel lists public and requestable rooms. Members choose a room from a select menu and
              the owner receives Accept / Reject buttons in DMs.
            </Callout>
          </div>
        </SectionCard>

        <SectionCard
          icon={Clock}
          title="Pending requests"
          description={`${waiting.data?.length ?? 0} request${(waiting.data?.length ?? 0) === 1 ? '' : 's'} waiting for a decision.`}
        >
          {waiting.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-24 w-full" />
              ))}
            </div>
          ) : waiting.data && waiting.data.length > 0 ? (
            <div className="space-y-3">
              {waiting.data.map((request) => (
                <div key={request.id} className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-medium text-ink">{request.name ?? request.userId}</p>
                        <Badge tone="amber">Pending</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-faint">
                        wants to join <strong className="text-soft">{request.roomName}</strong> · requested {formatDate(request.createdAt)}
                      </p>
                      {request.message ? (
                        <p className="mt-2 rounded-lg border border-white/6 bg-black/20 px-3 py-2 text-[11px] italic leading-relaxed text-muted">
                          “{request.message}”
                        </p>
                      ) : null}
                      <p className="mt-2 text-[10px] text-faint/70">Expires {formatDate(request.expiresAt)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="success"
                        size="sm"
                        leftIcon={Check}
                        disabled={!canModerate || !detail.bot.online || resolve.isPending}
                        onClick={() => resolve.mutate({ requestId: request.id, roomId: request.roomId, accept: true })}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        leftIcon={X}
                        disabled={!canModerate || !detail.bot.online || resolve.isPending}
                        onClick={() => resolve.mutate({ requestId: request.id, roomId: request.roomId, accept: false })}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={DoorOpen}
              title="No pending requests"
              description="When a member requests access to a request-to-join room, it appears here and in the owner's DMs."
            />
          )}
        </SectionCard>
      </div>

      <SaveBar dirty={dirty && canEdit} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}

export default WaitingRoomPage;
