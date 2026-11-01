import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import type { ChannelOption, ChannelsData, GuildConfig, PrivacyMode, RoleOption } from '../types';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { PRIVACY_OPTIONS } from '../lib/format';
import { Badge, Input, Select } from './ui';

export function useConfigForm(guildId: string, config: GuildConfig) {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  const [form, setForm] = useState<GuildConfig>(config);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(config);
    setDirty(false);
  }, [config.updatedAt]);

  const update = <K extends keyof GuildConfig>(key: K, value: GuildConfig[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const mutation = useMutation({
    mutationFn: () => api<GuildConfig>(`/guilds/${guildId}/config`, { method: 'PATCH', body: form }),
    onSuccess: (data) => {
      setDirty(false);
      queryClient.setQueryData(['guild', guildId], (current: unknown) => {
        if (!current || typeof current !== 'object') return current;
        return { ...(current as Record<string, unknown>), config: data };
      });
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['premium', guildId] });
      success('Configuration saved');
    },
    onError: (errorValue) => error('Could not save', errorMessage(errorValue)),
  });

  return {
    form,
    update,
    setForm,
    dirty,
    save: () => mutation.mutate(),
    saving: mutation.isPending,
    reset: () => {
      setForm(config);
      setDirty(false);
    },
  };
}

export function ChannelPicker({
  value,
  onChange,
  channels,
  kind,
  placeholder = 'Select a channel',
  includeNone = true,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  channels: ChannelsData | undefined;
  kind: 'text' | 'voice' | 'category';
  placeholder?: string;
  includeNone?: boolean;
}) {
  const list: ChannelOption[] = channels
    ? kind === 'category'
      ? channels.categories
      : channels[kind]
    : [];
  if (!channels || channels.offline || list.length === 0) {
    return (
      <div className="space-y-1.5">
        <Input
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value.trim() || null)}
          placeholder={channels?.offline ? 'Channel ID (bot offline)' : 'Channel ID'}
        />
        {channels?.offline ? (
          <p className="text-[11px] text-faint">The bot is offline, so channel names cannot be listed. Paste a channel ID.</p>
        ) : null}
      </div>
    );
  }
  return (
    <Select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      {includeNone ? <option value="">{placeholder}</option> : null}
      {list.map((channel) => (
        <option key={channel.id} value={channel.id}>
          {channel.name}
        </option>
      ))}
    </Select>
  );
}

export function RoleMultiPicker({
  values,
  onChange,
  roles,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  roles: RoleOption[] | undefined;
}) {
  const available = (roles ?? []).filter((role) => !values.includes(role.id));
  if (!roles || roles.length === 0) {
    return (
      <Input
        value={values.join(',')}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          )
        }
        placeholder="Comma-separated role IDs (bot offline)"
      />
    );
  }
  return (
    <div className="space-y-2">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((roleId) => {
            const role = roles.find((entry) => entry.id === roleId);
            return (
              <span
                key={roleId}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-soft"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: role?.color && role.color !== '#000000' ? role.color : '#7c6cff' }} />
                {role?.name ?? roleId}
                <button
                  type="button"
                  aria-label={`Remove ${role?.name ?? roleId}`}
                  className="text-faint transition hover:text-rose"
                  onClick={() => onChange(values.filter((value) => value !== roleId))}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="muted">No roles selected</Badge>
        </div>
      )}
      <Select
        value=""
        onChange={(event) => {
          const roleId = event.target.value;
          if (roleId && !values.includes(roleId)) onChange([...values, roleId]);
        }}
        disabled={available.length === 0}
      >
        <option value="">{available.length ? 'Add a role…' : 'All roles selected'}</option>
        {available.map((role) => (
          <option key={role.id} value={role.id}>
            {role.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function PrivacySelect({
  value,
  onChange,
  disabled = false,
}: {
  value: PrivacyMode;
  onChange: (value: PrivacyMode) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value as PrivacyMode)} disabled={disabled}>
      {PRIVACY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.emoji} {option.label}
        </option>
      ))}
    </Select>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max,
  suffix,
  disabled,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-[13px] font-medium text-soft">{label}</label>
      <div className="relative">
        <Input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange(Number.isFinite(next) ? Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, next)) : min);
          }}
          className={suffix ? 'pr-16' : ''}
        />
        {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-faint">{suffix}</span> : null}
      </div>
      {hint ? <p className="text-[11px] leading-relaxed text-faint">{hint}</p> : null}
    </div>
  );
}

export function AddButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-soft transition hover:text-ink disabled:opacity-40"
    >
      <Plus size={14} /> {label}
    </button>
  );
}
