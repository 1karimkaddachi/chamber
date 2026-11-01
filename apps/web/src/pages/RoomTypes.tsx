import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Shapes, Trash2 } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useRoomTypes, useTemplates } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { NumberField, PrivacySelect } from '../components/ConfigForm';
import { privacyMeta } from '../lib/format';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SectionCard,
  Select,
  Skeleton,
  Textarea,
} from '../components/ui';
import type { PrivacyMode, RoomType } from '../types';

interface TypeFormState {
  key: string;
  name: string;
  emoji: string;
  description: string;
  defaultPrivacy: PrivacyMode;
  defaultLimit: number;
  templateId: string | null;
  sortOrder: number;
}

const BLANK: TypeFormState = {
  key: '',
  name: '',
  emoji: '🎧',
  description: '',
  defaultPrivacy: 'PUBLIC',
  defaultLimit: 0,
  templateId: null,
  sortOrder: 500,
};

export function RoomTypesPage() {
  const { guildId, detail } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const types = useRoomTypes(guildId);
  const templates = useTemplates(guildId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoomType | null>(null);
  const [form, setForm] = useState<TypeFormState>(BLANK);
  const [deleteTarget, setDeleteTarget] = useState<RoomType | null>(null);
  const canEdit = detail.access.admin;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['roomTypes', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Give the room type a name.');
      if (!editing && !/^[a-z0-9-]{2,40}$/.test(form.key)) {
        throw new Error('Keys use lowercase letters, numbers and dashes.');
      }
      const body = {
        key: form.key,
        name: form.name.trim(),
        emoji: form.emoji || '🎧',
        description: form.description.trim() || null,
        defaultPrivacy: form.defaultPrivacy,
        defaultLimit: form.defaultLimit,
        templateId: form.templateId || null,
        sortOrder: form.sortOrder,
      };
      if (editing) return api(`/guilds/${guildId}/room-types/${editing.id}`, { method: 'PATCH', body });
      return api(`/guilds/${guildId}/room-types`, { method: 'POST', body });
    },
    onSuccess: () => {
      success(editing ? 'Room type updated' : 'Room type created');
      setOpen(false);
      setEditing(null);
      setForm(BLANK);
      invalidate();
    },
    onError: (error) => toastError('Could not save room type', errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (type: RoomType) => api(`/guilds/${guildId}/room-types/${type.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      success('Room type deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toastError('Could not delete room type', errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  };

  const openEdit = (type: RoomType) => {
    setEditing(type);
    setForm({
      key: type.key,
      name: type.name,
      emoji: type.emoji,
      description: type.description ?? '',
      defaultPrivacy: type.defaultPrivacy,
      defaultLimit: type.defaultLimit,
      templateId: type.templateId,
      sortOrder: type.sortOrder,
    });
    setOpen(true);
  };

  const sorted = [...(types.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Room types"
        description="Room types describe what a room is for. Templates decide the concrete defaults; types give them a name, emoji and purpose."
        actions={
          <Button variant="primary" leftIcon={Plus} onClick={openCreate} disabled={!canEdit}>
            New room type
          </Button>
        }
      />

      {!canEdit ? (
        <Callout tone="amber" title="Administrator access required">
          Built-in room types are available to everyone. Administrators can add custom types.
        </Callout>
      ) : null}

      <SectionCard icon={Shapes} title="Catalogue" description={`${sorted.length} room types available to triggers and templates.`}>
        {types.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-24 w-full" />
            ))}
          </div>
        ) : sorted.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {sorted.map((type) => {
              const privacy = privacyMeta(type.defaultPrivacy);
              return (
                <div
                  key={type.id}
                  className="flex flex-col gap-3 rounded-xl border border-white/6 bg-white/[0.02] p-4 transition hover:border-white/12"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-lg">
                        {type.emoji}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-medium text-ink">{type.name}</p>
                          {type.isBuiltin ? <Badge tone="muted">Built-in</Badge> : <Badge tone="accent">Custom</Badge>}
                        </div>
                        <p className="mt-1 text-[11px] text-faint">
                          {privacy.emoji} {privacy.label} · limit {type.defaultLimit || '∞'} · key {type.key}
                        </p>
                        {type.description ? (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">{type.description}</p>
                        ) : null}
                      </div>
                    </div>
                    {!type.isBuiltin && canEdit ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton label="Edit room type" icon={Pencil} onClick={() => openEdit(type)} />
                        <IconButton
                          label="Delete room type"
                          icon={Trash2}
                          variant="danger"
                          onClick={() => setDeleteTarget(type)}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone="muted">Sort {type.sortOrder}</Badge>
                    <Badge tone="muted">
                      {(templates.data ?? []).find((template) => template.id === type.templateId)?.name ?? 'No template'}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Shapes}
            title="No room types"
            description="Built-in types should have been seeded. Run the seed script or add a custom type."
            action={
              <Button variant="primary" leftIcon={Plus} onClick={openCreate} disabled={!canEdit}>
                Add room type
              </Button>
            }
          />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit room type' : 'New room type'}
        description="Types are surfaced in triggers, templates and reservation choice lists."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              {editing ? 'Save type' : 'Create type'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key" hint="Lowercase identifier. Cannot be changed later.">
              <Input
                value={form.key}
                onChange={(event) => setForm((current) => ({ ...current, key: event.target.value.toLowerCase() }))}
                placeholder="retro-gaming"
                maxLength={40}
                disabled={Boolean(editing)}
              />
            </Field>
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Retro gaming"
                maxLength={40}
              />
            </Field>
            <Field label="Emoji">
              <Input
                value={form.emoji}
                onChange={(event) => setForm((current) => ({ ...current, emoji: event.target.value }))}
                maxLength={16}
              />
            </Field>
            <NumberField
              label="Sort order"
              value={form.sortOrder}
              min={0}
              max={9999}
              onChange={(value) => setForm((current) => ({ ...current, sortOrder: value }))}
            />
            <Field label="Default privacy">
              <PrivacySelect
                value={form.defaultPrivacy}
                onChange={(value) => setForm((current) => ({ ...current, defaultPrivacy: value }))}
              />
            </Field>
            <NumberField
              label="Default limit"
              hint="0 means unlimited."
              value={form.defaultLimit}
              min={0}
              max={99}
              onChange={(value) => setForm((current) => ({ ...current, defaultLimit: value }))}
            />
          </div>
          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="What kind of room is this?"
              maxLength={200}
              className="min-h-20"
            />
          </Field>
          <Field label="Default template" hint="Applied when a trigger selects this type without its own template.">
            <Select
              value={form.templateId ?? ''}
              onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value || null }))}
            >
              <option value="">No linked template</option>
              {(templates.data ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.emoji || '🎧'} {template.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete room type?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget)}>
              Delete type
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          Delete <strong className="text-ink">{deleteTarget?.name}</strong>? Active rooms using this type must be changed first.
        </p>
      </Modal>
    </div>
  );
}

export default RoomTypesPage;
