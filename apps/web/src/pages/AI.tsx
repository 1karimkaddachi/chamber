import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Save, Sparkles, Wand2, Zap } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useAIStatus, useRooms, useTemplates } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { privacyMeta } from '../lib/format';
import {
  Badge,
  Button,
  Callout,
  Card,
  Field,
  Input,
  OfflineNotice,
  PageHeader,
  SectionCard,
  Select,
  Spinner,
  Toggle,
} from '../components/ui';
import type { AISuggestion } from '../types';

const TONES = [
  { value: '', label: 'No particular tone' },
  { value: 'casual', label: 'Casual' },
  { value: 'competitive', label: 'Competitive' },
  { value: 'focused', label: 'Focused' },
  { value: 'social', label: 'Social' },
];

export function AIPage() {
  const { guildId, detail } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const status = useAIStatus(guildId);
  const templates = useTemplates(guildId);
  const rooms = useRooms(guildId);
  const [purpose, setPurpose] = useState('');
  const [members, setMembers] = useState<number | ''>('');
  const [tone, setTone] = useState('');
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);
  const [generating, setGenerating] = useState(false);
  const [roomId, setRoomId] = useState('');

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api(`/guilds/${guildId}/config`, { method: 'PATCH', body: { aiEnabled: enabled } }),
    onSuccess: (_data, enabled) => {
      success(enabled ? 'AI assistant enabled' : 'AI assistant disabled');
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['aiStatus', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['premium', guildId] });
    },
    onError: (error) => toastError('Could not update AI settings', errorMessage(error)),
  });

  const generate = useMutation({
    mutationFn: () =>
      api<AISuggestion>(`/guilds/${guildId}/ai/suggest`, {
        method: 'POST',
        body: {
          purpose: purpose.trim(),
          expectedMembers: members === '' ? undefined : Number(members),
          tone: tone || undefined,
          roomId: roomId || undefined,
        },
      }),
    onMutate: () => setGenerating(true),
    onSuccess: (data) => setSuggestion(data),
    onError: (error) => toastError('Suggestion failed', errorMessage(error)),
    onSettled: () => setGenerating(false),
  });

  const saveTemplate = useMutation({
    mutationFn: () => {
      if (!suggestion) throw new Error('Generate a suggestion first.');
      const sourceTemplate = templates.data?.find((template) => template.id === suggestion.template?.id);
      return api(`/guilds/${guildId}/templates`, {
        method: 'POST',
        body: {
          name: `AI · ${purpose}`.slice(0, 50),
          description: suggestion.rationale.join(' ').slice(0, 200) || 'AI-assisted room template.',
          emoji: suggestion.template?.emoji ?? '✨',
          accentColor: '#c084fc',
          roomTypeKey: sourceTemplate?.roomTypeKey ?? null,
          defaultPrivacy: suggestion.suggestions.privacy,
          defaultLimit: suggestion.suggestions.userLimit,
          defaultBitrate: suggestion.suggestions.bitrate,
          roomNameRule: "{user}'s {type}",
          allowedRoleIds: [],
        },
      });
    },
    onSuccess: () => {
      success('Template created from suggestion');
      void queryClient.invalidateQueries({ queryKey: ['templates', guildId] });
    },
    onError: (error) => toastError('Could not save template', errorMessage(error)),
  });

  const applyToRoom = useMutation({
    mutationFn: () => {
      if (!suggestion || !roomId) throw new Error('Choose a room.');
      return api(`/guilds/${guildId}/rooms/${roomId}`, {
        method: 'PATCH',
        body: {
          privacy: suggestion.suggestions.privacy === 'PASSWORD' ? 'PRIVATE' : suggestion.suggestions.privacy,
          userLimit: suggestion.suggestions.userLimit,
          bitrate: suggestion.suggestions.bitrate,
        },
      });
    },
    onSuccess: () => {
      success('Room updated with the suggestion');
      void queryClient.invalidateQueries({ queryKey: ['rooms', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['overview', guildId] });
    },
    onError: (error) => toastError('Could not apply to room', errorMessage(error)),
  });

  const privacy = suggestion ? privacyMeta(suggestion.suggestions.privacy) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="AI room assistant"
        description="Configuration suggestions from an optional AI provider — or the built-in heuristic engine when no provider is configured. Suggestions never change a room without an explicit click."
        actions={<Badge tone="accent"><Sparkles size={11} /> Optional</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-5">
          <SectionCard icon={Bot} title="Assistant status" description="Core Chamber never requires a paid AI API.">
            <div className="space-y-4">
              <Toggle
                checked={detail.config.aiEnabled}
                onChange={(value) => toggle.mutate(value)}
                label="Enable AI assistant for this server"
                description="Controls the AI options inside the Discord room settings panel."
                disabled={!detail.access.admin || toggle.isPending}
              />
              <div className="space-y-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
                <p className="flex items-center justify-between gap-2">
                  <span>Provider</span>
                  <span className="text-soft">{status.data?.provider ?? 'Built-in heuristics'}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span>Model</span>
                  <span className="text-soft">{status.data?.model ?? 'Local rules'}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span>Paid dependency</span>
                  <span className="text-mint">None required</span>
                </p>
              </div>
              {!status.data?.configured ? (
                <Callout tone="cyan" title="No external provider">
                  Add AI_BASE_URL, AI_MODEL and optionally AI_API_KEY to <code>.env</code> to use an OpenAI-compatible endpoint
                  (including local Ollama). Otherwise the deterministic engine answers locally.
                </Callout>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard icon={Wand2} title="Describe the room" description="The assistant reads only aggregated, non-sensitive stats.">
            <div className="space-y-4">
              <Field label="What is the room for?">
                <Input
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="Ranked five-stack for the weekend tournament"
                  maxLength={120}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Expected members">
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={members}
                    onChange={(event) => setMembers(event.target.value === '' ? '' : Number(event.target.value))}
                    placeholder="5"
                  />
                </Field>
                <Field label="Tone">
                  <Select value={tone} onChange={(event) => setTone(event.target.value)}>
                    {TONES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Existing room (optional)" hint="Include current settings for context.">
                <Select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                  <option value="">No room context</option>
                  {(rooms.data ?? []).map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="primary"
                leftIcon={Sparkles}
                loading={generating || generate.isPending}
                disabled={purpose.trim().length < 2}
                onClick={() => generate.mutate()}
              >
                Generate suggestion
              </Button>
            </div>
          </SectionCard>
        </div>

        <SectionCard icon={Sparkles} title="Suggestion" description="A concrete configuration you can review, save as a template, or apply explicitly.">
          {!suggestion ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-16 text-center">
              {generating ? (
                <>
                  <Spinner className="h-6 w-6" />
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-faint">Thinking</p>
                </>
              ) : (
                <>
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-muted">
                    <Sparkles size={22} />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-ink">No suggestion yet</h3>
                  <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">
                    Describe the room and Chamber will propose privacy, capacity, bitrate and a template using local
                    statistics and heuristics.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={suggestion.source === 'ai' ? 'accent' : 'cyan'}>
                  {suggestion.source === 'ai' ? <Bot size={11} /> : <Zap size={11} />}
                  {suggestion.source === 'ai' ? 'AI provider' : 'Local heuristics'}
                </Badge>
                {suggestion.template ? <Badge tone="muted">{suggestion.template.emoji} {suggestion.template.name}</Badge> : null}
              </div>
              {suggestion.fallbackReason ? (
                <Callout tone="amber" title="Fallback used">
                  {suggestion.fallbackReason}
                </Callout>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                <Card className="p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-faint">Privacy</p>
                  <p className="mt-1 text-[12px] font-medium text-soft">{privacy?.emoji} {privacy?.label}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-faint">Capacity</p>
                  <p className="mt-1 text-[12px] font-medium text-soft">{suggestion.suggestions.userLimit || '∞'}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-faint">Bitrate</p>
                  <p className="mt-1 text-[12px] font-medium text-soft">{Math.round(suggestion.suggestions.bitrate / 1000)}k</p>
                </Card>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">Why this configuration</p>
                <ul className="space-y-2">
                  {suggestion.rationale.map((line, index) => (
                    <li key={index} className="flex gap-2 text-xs leading-relaxed text-muted">
                      <Check size={13} className="mt-0.5 shrink-0 text-mint" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-white/6 pt-4">
                <Button
                  variant="secondary"
                  leftIcon={Save}
                  loading={saveTemplate.isPending}
                  onClick={() => saveTemplate.mutate()}
                  disabled={!detail.access.admin}
                >
                  Save as template
                </Button>
                <div className="flex min-w-[220px] flex-1 items-center gap-2">
                  <Select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="min-w-0">
                    <option value="">Choose a room…</option>
                    {(rooms.data ?? []).map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="primary"
                    leftIcon={Check}
                    loading={applyToRoom.isPending}
                    disabled={!roomId || !detail.bot.online || !detail.access.admin}
                    onClick={() => applyToRoom.mutate()}
                  >
                    Apply
                  </Button>
                </div>
              </div>
              {!detail.bot.online ? <OfflineNotice message="Applying a suggestion to a live room requires the bot." /> : null}
              <p className="text-[10px] leading-relaxed text-faint">
                Suggestions are advisory. Chamber never edits permissions, kicks members or changes privacy without the action
                you take here.
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}


export default AIPage;
