import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Bot,
  FolderTree,
  Hash,
  Radio,
  Settings,
  ShieldCheck,
  Users,
  Volume2,
} from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useConfigForm, ChannelPicker, NumberField, PrivacySelect } from '../components/ConfigForm';
import {
  Badge,
  Callout,
  Field,
  Input,
  PageHeader,
  SaveBar,
  SectionCard,
  Toggle,
  OfflineNotice,
} from '../components/ui';

export function GeneralPage() {
  const { guildId, detail, channels } = useGuild();
  const { form, update, dirty, save, saving, reset } = useConfigForm(guildId, detail.config);
  const access = detail.access;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="General configuration"
        description="The defaults every new temporary room inherits. Changes save to PostgreSQL instantly and are broadcast to the bot."
        actions={
          <Badge tone={form.enabled ? 'mint' : 'amber'}>{form.enabled ? 'Engine enabled' : 'Engine paused'}</Badge>
        }
      />

      {!detail.bot.online ? (
        <OfflineNotice message="The bot is offline. Configuration saves are still persisted, but Discord destinations cannot be validated until it reconnects." />
      ) : null}

      {!access.admin ? (
        <Callout tone="amber" title="Read-only access">
          Your staff role can inspect this page but only administrators can save configuration.
        </Callout>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard icon={Bot} title="Room engine" description="Master switch and Discord presence.">
          <div className="space-y-4">
            <Toggle
              checked={form.enabled}
              onChange={(value) => update('enabled', value)}
              label="Temporary voice enabled"
              description="When disabled, trigger channels stop creating rooms. Existing rooms remain active."
            />
            <Toggle
              checked={form.setupCompleted}
              onChange={(value) => update('setupCompleted', value)}
              label="Mark setup as completed"
              description="Controls the setup checklist on the overview page."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bot status">
                <div className="flex h-[42px] items-center rounded-xl border border-white/8 bg-white/[0.025] px-3.5">
                  <Badge tone={detail.bot.online ? 'mint' : 'amber'}>
                    <Bot size={11} /> {detail.bot.online ? detail.bot.tag ?? 'Online' : 'Offline'}
                  </Badge>
                </div>
              </Field>
              <Field label="Realtime sync">
                <div className="flex h-[42px] items-center rounded-xl border border-white/8 bg-white/[0.025] px-3.5">
                  <Badge tone="accent">WebSocket · always on</Badge>
                </div>
              </Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard icon={Volume2} title="Default room settings" description="Applied when a template does not override a value.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default privacy" hint="Templates and room types can override this.">
              <PrivacySelect value={form.defaultPrivacy} onChange={(value) => update('defaultPrivacy', value)} />
            </Field>
            <NumberField
              label="Default user limit"
              hint="0 means unlimited."
              value={form.defaultUserLimit}
              min={0}
              max={99}
              onChange={(value) => update('defaultUserLimit', value)}
            />
            <NumberField
              label="Default bitrate"
              hint={`Discord caps bitrate by server boost tier. Current cap is enforced by Discord.`}
              value={Math.round(form.defaultBitrate / 1000)}
              min={8}
              max={384}
              suffix="kbps"
              onChange={(value) => update('defaultBitrate', value * 1000)}
            />
            <Toggle
              checked={form.allowUserRenames}
              onChange={(value) => update('allowUserRenames', value)}
              label="Allow member renames"
              description="Owners can rename their rooms from the control panel."
            />
            <Field
              label="Room name template"
              hint="Available placeholders: {user}, {type}, {emoji}."
              className="sm:col-span-2"
            >
              <Input
                value={form.roomNameTemplate}
                onChange={(event) => update('roomNameTemplate', event.target.value)}
                maxLength={80}
                placeholder="{user}'s room"
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard icon={Hash} title="Discord destinations" description="Where panels, lobby messages and logs are sent.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lobby / directory channel" hint="Public channel where Chamber posts the room directory.">
              <ChannelPicker
                value={form.lobbyChannelId}
                onChange={(value) => update('lobbyChannelId', value)}
                channels={channels}
                kind="text"
                placeholder="No lobby channel"
              />
            </Field>
            <Field label="Activity log channel" hint="Important audit events are mirrored here as Components V2 messages.">
              <ChannelPicker
                value={form.logChannelId}
                onChange={(value) => update('logChannelId', value)}
                channels={channels}
                kind="text"
                placeholder="No log channel"
              />
            </Field>
            <Field label="Default room category" hint="Triggers can override this with their own category.">
              <ChannelPicker
                value={form.defaultCategoryId}
                onChange={(value) => update('defaultCategoryId', value)}
                channels={channels}
                kind="category"
                placeholder="No category"
              />
            </Field>
            <Field label="Default trigger channel" hint="Used for fallback moves and room recovery.">
              <ChannelPicker
                value={form.defaultTriggerChannelId}
                onChange={(value) => update('defaultTriggerChannelId', value)}
                channels={channels}
                kind="voice"
                placeholder="No trigger"
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={`/g/${guildId}/triggers`} className="inline-flex items-center gap-1.5 text-xs text-accent-soft hover:text-ink">
              <Radio size={13} /> Manage triggers <ArrowUpRight size={12} />
            </Link>
            <Link to={`/g/${guildId}/categories`} className="inline-flex items-center gap-1.5 text-xs text-accent-soft hover:text-ink">
              <FolderTree size={13} /> Manage categories <ArrowUpRight size={12} />
            </Link>
          </div>
        </SectionCard>

        <SectionCard icon={Users} title="Capacity limits" description="Protect the server from room spam with hard caps.">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Rooms per member"
              hint="How many active rooms one member can own."
              value={form.maxRoomsPerUser}
              min={1}
              max={10}
              onChange={(value) => update('maxRoomsPerUser', value)}
            />
            <NumberField
              label="Rooms per server"
              hint="Global cap across all members."
              value={form.maxRoomsPerGuild}
              min={1}
              max={500}
              onChange={(value) => update('maxRoomsPerGuild', value)}
            />
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-mint" />
            Capacity is enforced in the engine, not just the dashboard. Rapid voice state updates are locked per member to
            prevent duplicate rooms.
          </div>
        </SectionCard>
      </div>

      {detail.counts.triggers === 0 ? (
        <Callout tone="amber" title="No trigger channels yet">
          Create at least one trigger channel before members can generate rooms. Configure it from the Triggers page.
          <div className="mt-2">
            <Link to={`/g/${guildId}/triggers`} className="font-medium text-accent-soft hover:text-ink">
              Open trigger setup →
            </Link>
          </div>
        </Callout>
      ) : null}

      <SaveBar dirty={dirty && access.admin} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}

export default GeneralPage;
