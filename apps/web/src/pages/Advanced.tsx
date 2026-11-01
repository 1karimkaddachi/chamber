import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  Download,
  FileJson,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useAuth } from '../lib/auth';
import { api, download, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import {
  Badge,
  Button,
  Callout,
  CodeBlock,
  Field,
  Input,
  Modal,
  OfflineNotice,
  PageHeader,
  SectionCard,
  Spinner,
} from '../components/ui';

export function AdvancedPage() {
  const { guildId, detail, refetch } = useGuild();
  const { meta } = useAuth();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const canEdit = detail.access.admin;
  const botOnline = detail.bot.online;

  const exportQuery = useQuery({
    queryKey: ['export', guildId],
    queryFn: () => api<Record<string, unknown>>(`/guilds/${guildId}/export`),
    staleTime: 60_000,
  });

  const importJson = useMutation({
    mutationFn: (payload: unknown) => api(`/guilds/${guildId}/import`, { method: 'POST', body: payload }),
    onSuccess: (data: unknown) => {
      const summary = (data as { summary?: Record<string, unknown> })?.summary;
      success('Configuration imported', summary ? JSON.stringify(summary) : undefined);
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['templates', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['triggers', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['categories', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['roomTypes', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['premium', guildId] });
      refetch();
    },
    onError: (error) => toastError('Import failed', errorMessage(error)),
  });

  const cleanup = useMutation({
    mutationFn: () => api<{ result: Record<string, number> }>(`/guilds/${guildId}/cleanup`, { method: 'POST' }),
    onSuccess: (data) => {
      success('Cleanup complete', Object.entries(data.result ?? {}).map(([key, value]) => `${key}: ${value}`).join(', '));
      refetch();
    },
    onError: (error) => toastError('Cleanup failed', errorMessage(error)),
  });

  const refreshLobby = useMutation({
    mutationFn: () => api(`/guilds/${guildId}/lobby/refresh`, { method: 'POST' }),
    onSuccess: () => success('Lobby panel refreshed'),
    onError: (error) => toastError('Could not refresh lobby', errorMessage(error)),
  });

  const recover = useMutation({
    mutationFn: () => api<{ summary: Record<string, number> }>(`/guilds/${guildId}/recover`, { method: 'POST' }),
    onSuccess: (data) => {
      success('Recovery complete', Object.entries(data.summary ?? {}).map(([key, value]) => `${key}: ${value}`).join(', '));
      refetch();
    },
    onError: (error) => toastError('Recovery failed', errorMessage(error)),
  });

  const reset = useMutation({
    mutationFn: () => api(`/guilds/${guildId}/reset`, { method: 'POST', body: { confirmName } }),
    onSuccess: () => {
      success('Server configuration reset');
      setResetOpen(false);
      setConfirmName('');
      queryClient.clear();
      refetch();
    },
    onError: (error) => toastError('Reset failed', errorMessage(error)),
  });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      importJson.mutate(payload);
    } catch {
      toastError('Import failed', 'The selected file is not valid JSON.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const exportJson = JSON.stringify(exportQuery.data ?? {}, null, 2);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Advanced settings"
        description="Backups, maintenance, recovery and the danger zone. These controls are intentionally explicit."
        actions={<Badge tone="rose"><AlertTriangle size={11} /> High impact</Badge>}
      />

      {!botOnline ? <OfflineNotice message="Maintenance operations that touch Discord are disabled while the bot is offline." /> : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard icon={FileJson} title="Configuration backup" description="Export everything configurable in one JSON file. Secrets are never included.">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                leftIcon={Download}
                onClick={() => download(`/guilds/${guildId}/export`, `chamber-${guildId}.json`)}
              >
                Download export
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
              <Button variant="secondary" leftIcon={Upload} onClick={() => fileInput.current?.click()} disabled={!canEdit}>
                Import JSON
              </Button>
            </div>
            <Callout tone="amber" title="Import overwrites configuration">
              Triggers, categories and configuration values in the file replace the current ones. Custom templates are added,
              not removed.
            </Callout>
            {exportQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Spinner /> Preparing export preview…
              </div>
            ) : (
              <CodeBlock code={exportJson} maxHeight="280px" />
            )}
          </div>
        </SectionCard>

        <SectionCard icon={RefreshCw} title="Maintenance" description="Safe operations for keeping rooms and Discord in sync.">
          <div className="space-y-3">
            <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-ink">Cleanup empty rooms</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">Deletes empty rooms and closes records whose Discord channel is missing.</p>
                </div>
                <Button variant="secondary" size="sm" loading={cleanup.isPending} disabled={!canEdit || !botOnline} onClick={() => cleanup.mutate()}>
                  Run cleanup
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-ink">Refresh lobby directory</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">Reposts and repairs the Components V2 room directory panel.</p>
                </div>
                <Button variant="secondary" size="sm" loading={refreshLobby.isPending} disabled={!canEdit || !botOnline} onClick={() => refreshLobby.mutate()}>
                  Refresh
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-ink">Recover active rooms</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">Reconciles database rooms with Discord channels and restores panels.</p>
                </div>
                <Button variant="secondary" size="sm" loading={recover.isPending} disabled={!canEdit || !botOnline} onClick={() => recover.mutate()}>
                  Recover
                </Button>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard icon={Server} title="Runtime information" description="Version and environment details." accent="cyan">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoRow label="Chamber version" value={meta?.version ?? '1.0.0'} />
            <InfoRow label="Environment" value={meta?.environment ?? 'development'} />
            <InfoRow label="Discord OAuth" value={meta?.oauthConfigured ? 'Configured' : 'Not configured'} />
            <InfoRow label="Bot token" value={meta?.botConfigured ? 'Configured' : 'Missing'} />
            <InfoRow label="AI provider" value={meta?.aiConfigured ? meta.ai.provider ?? 'Configured' : 'Local heuristics'} />
            <InfoRow label="Server ID" value={guildId} />
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
            <Bot size={14} className="mt-0.5 shrink-0 text-accent-soft" />
            The bot and API share a supervised process. If the bot token is missing the dashboard runs in bot-offline mode and
            clearly labels unavailable actions.
          </div>
        </SectionCard>

        <SectionCard icon={AlertTriangle} title="Danger zone" description="Irreversible configuration reset." accent="rose">
          <div className="space-y-4">
            <div className="rounded-xl border border-rose/25 bg-rose/[0.05] p-4">
              <p className="text-[13px] font-medium text-ink">Reset all server configuration</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Removes triggers, categories, custom templates, custom room types, reservations and the guild configuration.
                Active rooms and audit history are preserved.
              </p>
              <Button
                variant="danger"
                className="mt-3"
                leftIcon={RotateCcw}
                disabled={!canEdit}
                onClick={() => setResetOpen(true)}
              >
                Open danger zone
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3 text-[11px]">
              <span className="text-muted">Retention policy</span>
              <span className="text-soft">{detail.config.retentionDays} days</span>
            </div>
          </div>
        </SectionCard>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => {
          setResetOpen(false);
          setConfirmName('');
        }}
        title="Reset server configuration"
        description="This cannot be undone. Type the server name exactly to continue."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setResetOpen(false);
                setConfirmName('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              leftIcon={Trash2}
              loading={reset.isPending}
              disabled={confirmName.trim() !== detail.guild.name.trim()}
              onClick={() => reset.mutate()}
            >
              Reset configuration
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Callout tone="rose" title="Active rooms are preserved">
            The engine continues running existing rooms. Only configuration and scheduled reservations are removed.
          </Callout>
          <Field label={`Type “${detail.guild.name}” to confirm`}>
            <Input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={detail.guild.name} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-faint">{label}</p>
      <p className="mt-0.5 truncate text-[12px] text-soft">{value}</p>
    </div>
  );
}

export default AdvancedPage;
