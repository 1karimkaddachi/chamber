import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useCategories, useChannels, useTemplates } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { ChannelPicker, NumberField } from '../components/ConfigForm';
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
import type { VoiceCategory } from '../types';

interface CategoryFormState {
  categoryId: string;
  name: string;
  templateId: string | null;
  maxRooms: number;
  enabled: boolean;
}

const EMPTY: CategoryFormState = { categoryId: '', name: '', templateId: null, maxRooms: 0, enabled: true };

export function CategoriesPage() {
  const { guildId, detail, channels } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const categories = useCategories(guildId);
  const templates = useTemplates(guildId);
  const channelData = useChannels(guildId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VoiceCategory | null>(null);
  const [form, setForm] = useState<CategoryFormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<VoiceCategory | null>(null);
  const canEdit = detail.access.admin;

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of channelData.data?.categories ?? []) map.set(category.id, category.name);
    for (const category of categories.data ?? []) if (category.name) map.set(category.categoryId, category.name);
    return map;
  }, [channelData.data, categories.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['categories', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.categoryId) throw new Error('Choose a category.');
      const body = {
        categoryId: form.categoryId,
        name: form.name.trim() || null,
        templateId: form.templateId || null,
        maxRooms: form.maxRooms,
        enabled: form.enabled,
      };
      if (editing) return api(`/guilds/${guildId}/categories/${editing.id}`, { method: 'PATCH', body });
      return api(`/guilds/${guildId}/categories`, { method: 'POST', body });
    },
    onSuccess: () => {
      success(editing ? 'Category updated' : 'Category added');
      setOpen(false);
      setEditing(null);
      setForm(EMPTY);
      invalidate();
    },
    onError: (error) => toastError('Could not save category', errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (category: VoiceCategory) =>
      api(`/guilds/${guildId}/categories/${category.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      success('Category removed');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toastError('Could not remove category', errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (category: VoiceCategory) => {
    setEditing(category);
    setForm({
      categoryId: category.categoryId,
      name: category.name ?? '',
      templateId: category.templateId,
      maxRooms: category.maxRooms,
      enabled: category.enabled,
    });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Voice categories"
        description="Category-level rules: room caps and template overrides. Triggers can target a category directly."
        actions={
          <Button variant="primary" leftIcon={Plus} onClick={openCreate} disabled={!canEdit}>
            Add category
          </Button>
        }
      />

      {!detail.bot.online ? <OfflineNotice message="Add categories by pasting IDs while the bot is offline." /> : null}
      {!canEdit ? (
        <Callout tone="amber" title="Administrator access required">
          Only administrators can change voice categories.
        </Callout>
      ) : null}

      <SectionCard icon={FolderTree} title="Category rules" description={`${categories.data?.length ?? 0} categories configured.`}>
        {categories.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((item) => (
              <Skeleton key={item} className="h-24 w-full" />
            ))}
          </div>
        ) : categories.data && categories.data.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {categories.data.map((category) => (
              <div
                key={category.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.02] p-4 transition hover:border-white/12"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan/20 bg-cyan/10 text-cyan">
                    <FolderTree size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {names.get(category.categoryId) ?? category.categoryId}
                      </p>
                      <Badge tone={category.enabled ? 'mint' : 'muted'}>{category.enabled ? 'Enabled' : 'Paused'}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-faint">
                      Max {category.maxRooms || '∞'} rooms ·{' '}
                      {(templates.data ?? []).find((template) => template.id === category.templateId)?.name ?? 'Default template'}
                    </p>
                    <p className="mt-1 text-[10px] text-faint/70">ID · {category.categoryId}</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <IconButton label="Edit category" icon={Pencil} onClick={() => openEdit(category)} disabled={!canEdit} />
                  <IconButton
                    label="Delete category"
                    icon={Trash2}
                    variant="danger"
                    onClick={() => setDeleteTarget(category)}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FolderTree}
            title="No category rules"
            description="Categories are optional. Add one to cap how many rooms can live in a Discord category or to apply a template."
            action={
              <Button variant="primary" leftIcon={Plus} onClick={openCreate} disabled={!canEdit}>
                Add category
              </Button>
            }
          />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit voice category' : 'Add voice category'}
        description="Category rules apply to rooms created inside this category."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              {editing ? 'Save category' : 'Add category'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Discord category">
            <ChannelPicker
              value={form.categoryId || null}
              onChange={(value) => setForm((current) => ({ ...current, categoryId: value ?? '' }))}
              channels={channelData.data}
              kind="category"
              includeNone={false}
              placeholder="Choose a category"
            />
          </Field>
          <Field label="Display name" hint="Optional dashboard label.">
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Gaming floor"
              maxLength={100}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Maximum rooms"
              hint="0 means unlimited."
              value={form.maxRooms}
              min={0}
              max={100}
              onChange={(value) => setForm((current) => ({ ...current, maxRooms: value }))}
            />
            <Field label="Template override">
              <Select
                value={form.templateId ?? ''}
                onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value || null }))}
              >
                <option value="">Use trigger / default</option>
                {(templates.data ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.emoji || '🎧'} {template.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Toggle
            checked={form.enabled}
            onChange={(value) => setForm((current) => ({ ...current, enabled: value }))}
            label="Category enabled"
            description="Disabled category rules are kept but ignored by the engine."
          />
          <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
            <Layers size={14} className="mt-0.5 shrink-0 text-accent-soft" />
            Category caps are enforced when rooms are created. A full category returns a helpful error to the member.
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remove category rule?"
        description="Rooms in this category are not affected."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget)}>
              Remove category
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          Remove the rule for{' '}
          <strong className="text-ink">
            {deleteTarget ? names.get(deleteTarget.categoryId) ?? deleteTarget.categoryId : ''}
          </strong>
          ?
        </p>
      </Modal>
    </div>
  );
}

export default CategoriesPage;
