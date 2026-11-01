import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarDays, Clock, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useReservations, useTemplates } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { ChannelPicker, NumberField, PrivacySelect, useConfigForm } from '../components/ConfigForm';
import { formatFullDate, privacyMeta, relativeTime, reservationStatusTone, toDateTimeLocalInput } from '../lib/format';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  Input,
  Modal,
  OfflineNotice,
  PageHeader,
  SaveBar,
  SectionCard,
  Select,
  Skeleton,
  Tabs,
} from '../components/ui';
import type { PrivacyMode } from '../types';

const DURATIONS = [30, 60, 90, 120, 180, 240, 480, 720];

function defaultStart() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return toDateTimeLocalInput(date);
}

export function ReservationsPage() {
  const { guildId, detail } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const { form, update, dirty, save, saving, reset } = useConfigForm(guildId, detail.config);
  const reservations = useReservations(guildId);
  const templates = useTemplates(guildId);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [open, setOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    name: '',
    scheduledFor: defaultStart(),
    durationMinutes: 60,
    templateId: '',
    privacy: 'PUBLIC' as PrivacyMode,
    userLimit: 0,
  });
  const canEdit = detail.access.admin;

  const upcoming = useMemo(
    () =>
      (reservations.data ?? []).filter(
        (reservation) => ['SCHEDULED', 'CREATED'].includes(reservation.status) && new Date(reservation.scheduledFor).getTime() > Date.now() - 3600000,
      ),
    [reservations.data],
  );
  const past = useMemo(
    () =>
      (reservations.data ?? []).filter(
        (reservation) => !upcoming.includes(reservation),
      ),
    [reservations.data, upcoming],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['reservations', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['overview', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
  };

  const create = useMutation({
    mutationFn: () => {
      if (!createForm.name.trim()) throw new Error('Give the reservation a name.');
      const scheduled = new Date(createForm.scheduledFor);
      if (Number.isNaN(scheduled.getTime())) throw new Error('Choose a valid date and time.');
      return api(`/guilds/${guildId}/reservations`, {
        method: 'POST',
        body: {
          name: createForm.name.trim(),
          scheduledFor: scheduled.toISOString(),
          durationMinutes: createForm.durationMinutes,
          templateId: createForm.templateId || null,
          privacy: createForm.privacy,
          userLimit: createForm.userLimit,
        },
      });
    },
    onSuccess: () => {
      success('Reservation scheduled');
      setOpen(false);
      setCreateForm({
        name: '',
        scheduledFor: defaultStart(),
        durationMinutes: 60,
        templateId: '',
        privacy: 'PUBLIC',
        userLimit: 0,
      });
      invalidate();
    },
    onError: (error) => toastError('Could not schedule reservation', errorMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/guilds/${guildId}/reservations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      success('Reservation cancelled');
      setCancelTarget(null);
      invalidate();
    },
    onError: (error) => toastError('Could not cancel reservation', errorMessage(error)),
  });

  const renderReservation = (reservation: (typeof upcoming)[number]) => {
    const privacy = privacyMeta(reservation.privacy);
    return (
      <div key={reservation.id} className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan/20 bg-cyan/10 text-cyan">
              <CalendarDays size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-medium text-ink">{reservation.name}</p>
                <Badge tone={reservationStatusTone(reservation.status)}>{reservation.status.toLowerCase()}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-faint">
                {formatFullDate(reservation.scheduledFor)} · {relativeTime(reservation.scheduledFor)} · {reservation.durationMinutes} min
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={privacy.tone}>{privacy.emoji} {privacy.label}</Badge>
                <Badge tone="muted">
                  <Users size={10} /> {reservation.userLimit || '∞'}
                </Badge>
                <Badge tone="muted">by {reservation.hostName ?? reservation.hostId}</Badge>
              </div>
              {reservation.error ? <p className="mt-2 text-[11px] text-rose">{reservation.error}</p> : null}
              {reservation.roomChannelId ? (
                <a
                  href={`https://discord.com/channels/${guildId}/${reservation.roomChannelId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[11px] text-accent-soft hover:text-ink"
                >
                  Open created room →
                </a>
              ) : null}
            </div>
          </div>
          {reservation.status === 'SCHEDULED' ? (
            <Button
              variant="danger"
              size="sm"
              leftIcon={Trash2}
              disabled={!detail.access.staff}
              onClick={() => setCancelTarget(reservation.id)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experience"
        title="Reservations"
        description="Schedule a temporary room for later. The scheduler creates it automatically, DMs the host and posts Discord timestamps."
        actions={
          <>
            <Button variant="secondary" leftIcon={RefreshCw} onClick={() => void reservations.refetch()}>
              Refresh
            </Button>
            <Button variant="primary" leftIcon={Plus} onClick={() => setOpen(true)} disabled={!detail.access.staff}>
              New reservation
            </Button>
          </>
        }
      />

      {!detail.bot.online ? <OfflineNotice message="Scheduled reservations will fail to start while the bot is offline. You can still manage the schedule." /> : null}

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <SectionCard icon={CalendarClock} title="Reservation policy" description="Limits enforced before a reservation is accepted.">
          <div className="space-y-4">
            {!canEdit ? <Callout tone="amber" title="Read-only">Only administrators can edit reservation policy.</Callout> : null}
            <NumberField
              label="Reservations per member"
              value={form.reservationsPerUser}
              min={0}
              max={50}
              onChange={(value) => update('reservationsPerUser', value)}
              disabled={!canEdit}
            />
            <NumberField
              label="Booking window"
              hint="How far ahead members can reserve."
              value={form.reservationWindowDays}
              min={1}
              max={365}
              suffix="days"
              onChange={(value) => update('reservationWindowDays', value)}
              disabled={!canEdit}
            />
            <NumberField
              label="Maximum duration"
              value={form.reservationMaxDurationMinutes}
              min={15}
              max={1440}
              suffix="min"
              onChange={(value) => update('reservationMaxDurationMinutes', value)}
              disabled={!canEdit}
            />
            <Callout tone="cyan" title="Timezone">
              The Discord command accepts UTC date and time. The dashboard converts your local time to an ISO timestamp.
            </Callout>
          </div>
        </SectionCard>

        <SectionCard
          icon={CalendarDays}
          title="Schedule"
          description="Upcoming and past reservations."
          actions={
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
                { value: 'past', label: 'History', count: past.length },
              ]}
            />
          }
        >
          {reservations.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-28 w-full" />
              ))}
            </div>
          ) : (tab === 'upcoming' ? upcoming : past).length > 0 ? (
            <div className="space-y-3">{(tab === 'upcoming' ? upcoming : past).map(renderReservation)}</div>
          ) : (
            <EmptyState
              icon={CalendarClock}
              title={tab === 'upcoming' ? 'No upcoming reservations' : 'No reservation history'}
              description="Schedule a room for a tournament, study session, meeting or movie night."
              action={
                tab === 'upcoming' ? (
                  <Button variant="primary" leftIcon={Plus} onClick={() => setOpen(true)} disabled={!detail.access.staff}>
                    Schedule a room
                  </Button>
                ) : null
              }
            />
          )}
        </SectionCard>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule a temporary room"
        description="The host receives a reminder 10 minutes before the room is created."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              Schedule reservation
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Room name">
            <Input
              value={createForm.name}
              onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Friday tournament"
              maxLength={100}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start time">
              <Input
                type="datetime-local"
                value={createForm.scheduledFor}
                onChange={(event) => setCreateForm((current) => ({ ...current, scheduledFor: event.target.value }))}
              />
            </Field>
            <Field label="Duration">
              <Select
                value={createForm.durationMinutes}
                onChange={(event) => setCreateForm((current) => ({ ...current, durationMinutes: Number(event.target.value) }))}
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes >= 60 ? `${minutes / 60} hour${minutes > 60 ? 's' : ''}` : `${minutes} minutes`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Template">
              <Select
                value={createForm.templateId}
                onChange={(event) => setCreateForm((current) => ({ ...current, templateId: event.target.value }))}
              >
                <option value="">Default template</option>
                {(templates.data ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.emoji || '🎧'} {template.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Privacy">
              <PrivacySelect
                value={createForm.privacy}
                onChange={(value) => setCreateForm((current) => ({ ...current, privacy: value }))}
              />
            </Field>
            <NumberField
              label="User limit"
              hint="0 means unlimited."
              value={createForm.userLimit}
              min={0}
              max={99}
              onChange={(value) => setCreateForm((current) => ({ ...current, userLimit: value }))}
            />
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
            <Clock size={14} className="mt-0.5 shrink-0 text-cyan" />
            Reservations use the guild's default category and trigger configuration. The host must still be in the server
            when the reservation starts.
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title="Cancel reservation?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              Keep it
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancelTarget && cancel.mutate(cancelTarget)}>
              Cancel reservation
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">The room will not be created. This action is recorded in the audit log.</p>
      </Modal>

      <SaveBar dirty={dirty && canEdit} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}

export default ReservationsPage;
