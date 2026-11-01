import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Layers, Pencil, Plus, Radio, Shapes, Trash2 } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useChannels, useRoomTypes, useTemplates, useTriggers } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { ChannelPicker } from '../components/ConfigForm';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  OfflineNotice,
  PageHeader,
  SectionCard,
  Select,
  Skeleton,
  Toggle,
} from '../components/ui';
import type { RoomType, Template, Trigger } from '../types';

interface TriggerFormState {
  channelId: string;
  name: string;
  categoryId: string | null;
  templateId: string | null;
  roomTypeKey: string | null;
  enabled: boolean;
}

const EMPTY_FORM: TriggerFormState = {
  channelId: '',
  name: '',
  categoryId: null,
  templateId: null,
  roomTypeKey: null,
  enabled: true,
};

export function TriggersPage() {
  const { guildId, detail, channels } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const triggers = useTriggers(guildId);
  const templates = useTemplates(guildId);
  const roomTypes = useRoomTypes(guildId);
  const channelData = useChannels(guildId);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Trigger | null>(null);
  const [form, setForm] = useState<TriggerFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Trigger | null>(null);

  const canEdit = detail.access.admin;
  const channelNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const channel of [...(channelData.data?.voice ?? []), ...(channelData.data?.categories ?? []), ...(channelData.data?.text ?? [])]) {
      map.set(channel.id, channel.name);
    }
    for (const trigger of triggers.data ?? []) {
      if (trigger.name) map.set(trigger.channelId, trigger.name);
    }
    return map;
  }, [channelData.data, triggers.data]);

  const templateName = (id: string | null) =>
    (templates.data ?? []).find((template: Template) => template.id === id)?.name ?? null;
  const typeName = (key: string | null) =>
    (roomTypes.data ?? []).find((type: RoomType) => type.key === key)?.name ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['triggers', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.channelId) throw new Error('Choose a voice channel.');
      const body = {
        channelId: form.channelId,
        name: form.name.trim() || null,
        categoryId: form.categoryId || null,
        templateId: form.templateId || null,
        roomTypeKey: form.roomTypeKey || null,
        enabled: form.enabled,
      };
      if (editing) return api(`/guilds/${guildId}/triggers/${editing.id}`, { method: 'PATCH', body });
      return api(`/guilds/${guildId}/triggers`, { method: 'POST', body });
    },
    onSuccess: () => {
      success(editing ? 'Trigger updated' : 'Trigger added');
      setEditorOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError: (error) => toastError('Could not save trigger', errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (trigger: Trigger) =>
      api(`/guilds/${guildId}/triggers/${trigger.id}`, { method: 'PATCH', body: { enabled: !trigger.enabled } }),
    onSuccess: () => {
      success('Trigger updated');
      invalidate();
    },
    onError: (error) => toastError('Could not update trigger', errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (trigger: Trigger) => api(`/guilds/${guildId}/triggers/${trigger.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      success('Trigger removed');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toastError('Could not remove trigger', errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEdit = (trigger: Trigger) => {
    setEditing(trigger);
    setForm({
      channelId: trigger.channelId,
      name: trigger.name ?? '',
      categoryId: trigger.categoryId,
      templateId: trigger.templateId,
      roomTypeKey: trigger.roomTypeKey,
      enabled: trigger.enabled,
    });
    setEditorOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Trigger channels"
        description="Members who join these voice channels get their own temporary room. Multiple triggers, categories and templates are supported."
        actions={
          <Button variant="primary" leftIcon={Plus} onClick={openCreate} disabled={!canEdit}>
            Add trigger
          </Button>
        }
      />

      {!detail.bot.online ? (
        <OfflineNotice message="You can still add triggers by pasting channel IDs. Channel names and voice validation resume when the bot reconnects." />
      ) : null}
      {!canEdit ? (
        <Callout tone="amber" title="Administrator access required">
          Staff can view triggers, but only administrators can add or remove them.
        </Callout>
      ) : null}

      <SectionCard icon={Radio} title="Configured triggers" description={`${triggers.data?.length ?? 0} channels can create rooms.`}>
        {triggers.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} className="h-20 w-full" />
            ))}
          </div>
        ) : triggers.data && triggers.data.length > 0 ? (
          <div className="space-y-2">
            {triggers.data.map((trigger) => (
              <div
                key={trigger.id}
                className="flex flex-col gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3.5 transition hover:border-white/12 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent-soft">
                    <Radio size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {channelNames.get(trigger.channelId) ?? trigger.channelId}
                      </p>
                      <Badge tone={trigger.enabled ? 'mint' : 'muted'}>{trigger.enabled ? 'Enabled' : 'Paused'}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                      <span className="inline-flex items-center gap-1">
                        <FolderTree size={11} /> {trigger.categoryId ? channelNames.get(trigger.categoryId) ?? trigger.categoryId : 'Default category'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers size={11} /> {templateName(trigger.templateId) ?? 'Default template'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Shapes size={11} /> {trigger.roomTypeName ?? typeName(trigger.roomTypeKey) ?? 'Default type'}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-faint/70">Channel ID · {trigger.channelId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 self-end sm:self-center">
                  <Toggle checked={trigger.enabled} onChange={() => toggle.mutate(trigger)} disabled={!canEdit || toggle.isPending} label="Trigger enabled" />
                  <IconButton label="Edit trigger" icon={Pencil} onClick={() => openEdit(trigger)} disabled={!canEdit} />
                  <IconButton label="Delete trigger" icon={Trash2} variant="danger" onClick={() => setDeleteTarget(trigger)} disabled={!canEdit} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Radio}
            title="No trigger channels"
            description="Create a voice channel, then add it here. Members joining it will automatically receive a template-driven temporary room."
            action={
              <Button variant="primary" leftIcon={Plus} onClick={openCreate} disabled={!canEdit}>
                Add your first trigger
              </Button>
            }
          />
        )}
      </SectionCard>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit trigger channel' : 'Add trigger channel'}
        description="A trigger is a voice channel that creates a temporary room when someone joins it."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              {editing ? 'Save trigger' : 'Add trigger'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Voice channel" hint="The channel members join to create a room.">
            <ChannelPicker
              value={form.channelId || null}
              onChange={(value) => setForm((current) => ({ ...current, channelId: value ?? '' }))}
              channels={channelData.data}
              kind="voice"
              includeNone={false}
              placeholder="Choose a voice channel"
            />
          </Field>
          <Field label="Display name" hint="Optional label used in the dashboard.">
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Create a room"
              maxLength={100}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category override" hint="Where rooms from this trigger are created.">
              <ChannelPicker
                value={form.categoryId}
                onChange={(value) => setForm((current) => ({ ...current, categoryId: value }))}
                channels={channelData.data}
                kind="category"
                placeholder="Use server default"
              />
            </Field>
            <Field label="Room type">
              <Select
                value={form.roomTypeKey ?? ''}
                onChange={(event) => setForm((current) => ({ ...current, roomTypeKey: event.target.value || null }))}
              >
                <option value="">Use template / default</option>
                {(roomTypes.data ?? []).map((type) => (
                  <option key={type.id} value={type.key}>
                    {type.emoji} {type.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Room template">
            <Select
              value={form.templateId ?? ''}
              onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value || null }))}
            >
              <option value="">Use server default template</option>
              {(templates.data ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.emoji || '🎧'} {template.name}
                  {template.isBuiltin ? ' · built-in' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Toggle
            checked={form.enabled}
            onChange={(value) => setForm((current) => ({ ...current, enabled: value }))}
            label="Enabled"
            description="Paused triggers remain configured but do not create rooms."
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remove trigger channel?"
        description="Existing rooms are not affected. The channel will stop creating new rooms."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleteTarget && remove.mutate(deleteTarget)}
            >
              Remove trigger
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          <strong className="text-ink">{deleteTarget ? channelNames.get(deleteTarget.channelId) ?? deleteTarget.channelId : ''}</strong>{' '}
          will no longer create temporary rooms.
        </p>
      </Modal>
    </div>
  );
}

export default TriggersPage;
