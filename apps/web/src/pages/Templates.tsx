import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Download,
  Layers,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Volume2,
} from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useChannels, useRoomTypes, useTemplates } from '../lib/hooks';
import { api, download, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { useAuth } from '../lib/auth';
import { ChannelPicker, NumberField, PrivacySelect, RoleMultiPicker } from '../components/ConfigForm';
import { PRIVACY_OPTIONS, privacyMeta, roomTypeMeta } from '../lib/format';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SectionCard,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  Toggle,
} from '../components/ui';
import type { PrivacyMode, Template } from '../types';

interface TemplateFormState {
  name: string;
  description: string;
  emoji: string;
  accentColor: string;
  roomTypeKey: string;
  defaultPrivacy: PrivacyMode;
  defaultLimit: number;
  defaultBitrateKbps: number;
  roomNameRule: string;
  allowedRoleIds: string[];
}

const BLANK: TemplateFormState = {
  name: '',
  description: '',
  emoji: '🎧',
  accentColor: '#7c6cff',
  roomTypeKey: '',
  defaultPrivacy: 'PUBLIC',
  defaultLimit: 0,
  defaultBitrateKbps: 64,
  roomNameRule: "{user}'s room",
  allowedRoleIds: [],
};

function renderName(rule: string, user: string, type: string, emoji: string) {
  return (rule || "{user}'s room")
    .replaceAll('{user}', user)
    .replaceAll('{type}', type.toLowerCase())
    .replaceAll('{emoji}', emoji || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function fromTemplate(template: Template): TemplateFormState {
  return {
    name: template.name,
    description: template.description ?? '',
    emoji: template.emoji ?? '🎧',
    accentColor: template.accentColor ?? '#7c6cff',
    roomTypeKey: template.roomTypeKey ?? '',
    defaultPrivacy: template.defaultPrivacy,
    defaultLimit: template.defaultLimit,
    defaultBitrateKbps: Math.round(template.defaultBitrate / 1000),
    roomNameRule: template.roomNameRule ?? "{user}'s {type}",
    allowedRoleIds: template.allowedRoleIds ?? [],
  };
}

export function TemplatesPage() {
  const { guildId, detail, channels } = useGuild();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const templates = useTemplates(guildId);
  const roomTypes = useRoomTypes(guildId);
  const channelData = useChannels(guildId);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState<TemplateFormState>(BLANK);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'builtin' | 'custom'>('all');
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const canEdit = detail.access.admin;

  const filtered = useMemo(() => {
    return (templates.data ?? []).filter((template) => {
      if (filter === 'builtin' && !template.isBuiltin) return false;
      if (filter === 'custom' && template.isBuiltin) return false;
      if (search && !`${template.name} ${template.slug} ${template.roomTypeKey ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [templates.data, filter, search]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['templates', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Give the template a name.');
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        emoji: form.emoji.trim() || null,
        accentColor: form.accentColor,
        roomTypeKey: form.roomTypeKey || null,
        defaultPrivacy: form.defaultPrivacy,
        defaultLimit: form.defaultLimit,
        defaultBitrate: form.defaultBitrateKbps * 1000,
        roomNameRule: form.roomNameRule || "{user}'s room",
        allowedRoleIds: form.allowedRoleIds,
      };
      if (editing) return api(`/guilds/${guildId}/templates/${editing.id}`, { method: 'PATCH', body });
      return api(`/guilds/${guildId}/templates`, { method: 'POST', body });
    },
    onSuccess: () => {
      success(editing ? 'Template updated' : 'Template created');
      setOpen(false);
      setEditing(null);
      setForm(BLANK);
      invalidate();
    },
    onError: (error) => toastError('Could not save template', errorMessage(error)),
  });

  const duplicate = useMutation({
    mutationFn: (template: Template) =>
      api(`/guilds/${guildId}/templates/${template.id}/duplicate`, { method: 'POST' }),
    onSuccess: () => {
      success('Template duplicated');
      invalidate();
    },
    onError: (error) => toastError('Could not duplicate template', errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (template: Template) => api(`/guilds/${guildId}/templates/${template.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      success('Template deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toastError('Could not delete template', errorMessage(error)),
  });

  const importTemplates = useMutation({
    mutationFn: (payload: unknown) =>
      api(`/guilds/${guildId}/templates/import`, { method: 'POST', body: payload }),
    onSuccess: (data: unknown) => {
      const count = Array.isArray(data) ? data.length : 0;
      success(`Imported ${count} template${count === 1 ? '' : 's'}`);
      invalidate();
    },
    onError: (error) => toastError('Import failed', errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  };

  const openEdit = (template: Template) => {
    setEditing(template);
    setForm(fromTemplate(template));
    setOpen(true);
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = Array.isArray(parsed) ? { templates: parsed } : parsed;
      importTemplates.mutate(payload);
    } catch {
      toastError('Import failed', 'The file is not valid JSON.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const typeMeta = roomTypeMeta(form.roomTypeKey);
  const previewUser = user?.globalName || user?.username || 'Member';
  const previewName = renderName(form.roomNameRule, previewUser, typeMeta.name, form.emoji);
  const previewPrivacy = privacyMeta(form.defaultPrivacy);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Room templates"
        description="Templates define the identity and defaults of every room. Built-ins are immutable; duplicate one to customize it."
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
            <Button variant="ghost" leftIcon={Upload} onClick={() => fileInput.current?.click()} disabled={!canEdit}>
              Import
            </Button>
            <Button
              variant="ghost"
              leftIcon={Download}
              onClick={() => download(`/guilds/${guildId}/templates/export`, 'chamber-templates.json')}
            >
              Export
            </Button>
            <Button variant="primary" leftIcon={Plus} onClick={openCreate} disabled={!canEdit}>
              New template
            </Button>
          </>
        }
      />

      {!canEdit ? (
        <Callout tone="amber" title="Administrator access required">
          You can use templates but only administrators can edit them.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'All', count: templates.data?.length ?? 0 },
            { value: 'builtin', label: 'Built-in', count: (templates.data ?? []).filter((template) => template.isBuiltin).length },
            { value: 'custom', label: 'Custom', count: (templates.data ?? []).filter((template) => !template.isBuiltin).length },
          ]}
        />
        <div className="relative w-full sm:w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search templates…"
            className="pl-9"
          />
        </div>
      </div>

      {templates.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <Skeleton key={item} className="h-52 w-full" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => {
            const privacy = privacyMeta(template.defaultPrivacy);
            const type = roomTypeMeta(template.roomTypeKey);
            const accent = template.accentColor ?? '#7c6cff';
            return (
              <Card key={template.id} className="group flex flex-col overflow-hidden card-hover">
                <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}33)` }} />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-xl">
                      {template.emoji || '🎧'}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {template.isBuiltin ? <Badge tone="muted">Built-in</Badge> : <Badge tone="accent">Custom</Badge>}
                    </div>
                  </div>
                  <h3 className="mt-4 text-[15px] font-semibold text-ink">{template.name}</h3>
                  <p className="mt-1 line-clamp-2 min-h-[32px] text-xs leading-relaxed text-muted">
                    {template.description || 'No description.'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <Badge tone={privacy.tone}>{privacy.emoji} {privacy.label}</Badge>
                    <Badge tone="muted">
                      <Users size={10} /> {template.defaultLimit || '∞'}
                    </Badge>
                    <Badge tone="muted">
                      <Volume2 size={10} /> {Math.round(template.defaultBitrate / 1000)}k
                    </Badge>
                  </div>
                  <div className="mt-auto flex items-center justify-between border-t border-white/6 pt-4">
                    <span className="text-[11px] text-faint">{type.emoji} {type.name}</span>
                    <div className="flex items-center gap-1">
                      <IconButton
                        label="Duplicate template"
                        icon={Copy}
                        onClick={() => duplicate.mutate(template)}
                        disabled={!canEdit || duplicate.isPending}
                      />
                      {!template.isBuiltin && canEdit ? (
                        <>
                          <IconButton label="Edit template" icon={Pencil} onClick={() => openEdit(template)} />
                          <IconButton
                            label="Delete template"
                            icon={Trash2}
                            variant="danger"
                            onClick={() => setDeleteTarget(template)}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Layers}
          title={search ? 'No matching templates' : 'No templates yet'}
          description={search ? 'Try a different search or filter.' : 'Create a template that fits how your community uses voice.'}
          action={
            !search ? (
              <Button variant="primary" leftIcon={Plus} onClick={openCreate} disabled={!canEdit}>
                Create template
              </Button>
            ) : null
          }
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit · ${editing.name}` : 'Visual template builder'}
        description="Configure the room identity and defaults. The preview updates live — what you see is what the room becomes."
        size="xl"
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="hidden text-[11px] text-faint sm:block">Built-in templates cannot be edited. Duplicate one to fork it.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                {editing ? 'Save template' : 'Create template'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_100px]">
              <Field label="Template name">
                <Input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Gaming Squad"
                  maxLength={50}
                />
              </Field>
              <Field label="Emoji">
                <Input
                  value={form.emoji}
                  onChange={(event) => setForm((current) => ({ ...current, emoji: event.target.value }))}
                  placeholder="🎧"
                  maxLength={16}
                />
              </Field>
            </div>
            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="What is this room for?"
                maxLength={200}
                className="min-h-20"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Accent color">
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={form.accentColor}
                    onChange={(event) => setForm((current) => ({ ...current, accentColor: event.target.value }))}
                    className="h-[42px] w-12 cursor-pointer rounded-xl border border-white/10 bg-transparent p-1"
                    aria-label="Accent color"
                  />
                  <Input
                    value={form.accentColor}
                    onChange={(event) => setForm((current) => ({ ...current, accentColor: event.target.value }))}
                    maxLength={7}
                  />
                </div>
              </Field>
              <Field label="Room type">
                <Select
                  value={form.roomTypeKey}
                  onChange={(event) => setForm((current) => ({ ...current, roomTypeKey: event.target.value }))}
                >
                  <option value="">No room type</option>
                  {(roomTypes.data ?? []).map((type) => (
                    <option key={type.id} value={type.key}>
                      {type.emoji} {type.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Privacy">
                <PrivacySelect
                  value={form.defaultPrivacy}
                  onChange={(value) => setForm((current) => ({ ...current, defaultPrivacy: value }))}
                />
              </Field>
              <NumberField
                label="User limit"
                hint="0 means unlimited."
                value={form.defaultLimit}
                min={0}
                max={99}
                onChange={(value) => setForm((current) => ({ ...current, defaultLimit: value }))}
              />
              <NumberField
                label="Bitrate"
                value={form.defaultBitrateKbps}
                min={8}
                max={384}
                suffix="kbps"
                onChange={(value) => setForm((current) => ({ ...current, defaultBitrateKbps: value }))}
              />
              <Field label="Room name rule" hint="Use {user}, {type} and {emoji}.">
                <Input
                  value={form.roomNameRule}
                  onChange={(event) => setForm((current) => ({ ...current, roomNameRule: event.target.value }))}
                  maxLength={80}
                />
              </Field>
            </div>
            <Field label="Allowed roles (optional)" hint="Roles that can connect even when privacy restricts the room.">
              <RoleMultiPicker
                values={form.allowedRoleIds}
                onChange={(values) => setForm((current) => ({ ...current, allowedRoleIds: values }))}
                roles={channelData.data?.roles}
              />
            </Field>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
              <Sparkles size={12} /> Live preview
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b14]">
              <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${form.accentColor}, transparent)` }} />
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
                      style={{ background: `${form.accentColor}22`, border: `1px solid ${form.accentColor}55` }}
                    >
                      {form.emoji || '🎧'}
                    </div>
                    <div>
                      <p className="max-w-[180px] truncate text-[13px] font-semibold text-ink">{previewName || 'Unnamed room'}</p>
                      <p className="text-[10px] text-faint">Temporary voice room</p>
                    </div>
                  </div>
                  <Badge tone={previewPrivacy.tone}>{previewPrivacy.emoji} {previewPrivacy.label}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-faint">Limit</p>
                    <p className="mt-0.5 text-[12px] font-medium text-soft">{form.defaultLimit || '∞'}</p>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-faint">Bitrate</p>
                    <p className="mt-0.5 text-[12px] font-medium text-soft">{form.defaultBitrateKbps}k</p>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-faint">Type</p>
                    <p className="mt-0.5 truncate text-[12px] font-medium text-soft">{typeMeta.name}</p>
                  </div>
                </div>
                <p className="mt-4 text-[11px] leading-relaxed text-muted">
                  {form.description || 'Add a description to explain what this room is for.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {PRIVACY_OPTIONS.filter((option) => option.value === form.defaultPrivacy).map((option) => (
                    <Badge key={option.value} tone={option.tone}>
                      {option.description}
                    </Badge>
                  ))}
                  {form.allowedRoleIds.length > 0 ? <Badge tone="muted">{form.allowedRoleIds.length} allowed roles</Badge> : null}
                </div>
              </div>
              <div className="border-t border-white/6 bg-black/20 px-4 py-2 text-[10px] text-faint">
                Control panel, privacy and permissions are applied automatically when the room is created.
              </div>
            </div>
            <Callout tone="accent" title="Password templates">
              A template with password privacy creates the room locked until the owner sets a password. The bot never stores
              plaintext passwords.
            </Callout>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete template?"
        description="Rooms currently using this template must be changed first."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget)}>
              Delete template
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          Delete <strong className="text-ink">{deleteTarget?.name}</strong>? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

export default TemplatesPage;
