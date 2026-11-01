import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useConfigForm, NumberField, PrivacySelect } from '../components/ConfigForm';
import { PRIVACY_OPTIONS } from '../lib/format';
import {
  Badge,
  Callout,
  Field,
  OfflineNotice,
  PageHeader,
  SaveBar,
  SectionCard,
  Toggle,
  cn,
} from '../components/ui';

export function PrivacyPage() {
  const { guildId, detail } = useGuild();
  const { form, update, dirty, save, saving, reset } = useConfigForm(guildId, detail.config);
  const canEdit = detail.access.admin;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experience"
        title="Privacy settings"
        description="The default privacy policy for new rooms, plus the security rules behind Chamber's bot-verified password flow."
        actions={<Badge tone="accent"><Lock size={11} /> {PRIVACY_OPTIONS.length} modes</Badge>}
      />

      {!detail.bot.online ? <OfflineNotice /> : null}

      <SectionCard icon={Lock} title="Privacy modes" description="Every mode maps to real Discord overwrites. Click a mode in a room panel to apply it.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PRIVACY_OPTIONS.map((option) => {
            const isDefault = form.defaultPrivacy === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => update('defaultPrivacy', option.value)}
                disabled={!canEdit}
                className={cn(
                  'rounded-xl border p-4 text-left transition',
                  isDefault
                    ? 'border-accent/35 bg-accent/[0.07] shadow-[0_0_0_1px_rgba(124,108,255,0.15)]'
                    : 'border-white/6 bg-white/[0.02] hover:border-white/12',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg">{option.emoji}</span>
                  {isDefault ? <Badge tone="accent">Default</Badge> : null}
                </div>
                <p className="mt-2 text-[13px] font-medium text-ink">{option.label}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{option.description}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Fallback default" hint="Used when neither a template nor a room type provides privacy.">
            <PrivacySelect value={form.defaultPrivacy} onChange={(value) => update('defaultPrivacy', value)} disabled={!canEdit} />
          </Field>
          <Field label="Member renames" hint="Allows room owners to rename rooms from the control panel.">
            <Toggle
              checked={form.allowUserRenames}
              onChange={(value) => update('allowUserRenames', value)}
              label="Allow member renames"
              disabled={!canEdit}
            />
          </Field>
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard icon={KeyRound} title="Password protection" description="Discord has no native voice password. Chamber verifies passwords privately with the bot." accent="cyan">
          <div className="space-y-4">
            <Toggle
              checked={form.passwordEnabled}
              onChange={(value) => update('passwordEnabled', value)}
              label="Allow password-protected rooms"
              description="When disabled, owners cannot select password privacy."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="Maximum attempts"
                value={form.passwordMaxAttempts}
                min={1}
                max={20}
                onChange={(value) => update('passwordMaxAttempts', value)}
                disabled={!form.passwordEnabled}
              />
              <NumberField
                label="Lockout window"
                value={form.passwordLockoutMinutes}
                min={1}
                max={1440}
                suffix="min"
                onChange={(value) => update('passwordLockoutMinutes', value)}
                disabled={!form.passwordEnabled}
              />
            </div>
            <NumberField
              label="Temporary access expiry"
              hint="0 keeps verified access until the room closes. Otherwise access is removed automatically after this many minutes."
              value={form.permissionsExpireMinutes}
              min={0}
              max={10080}
              suffix="min"
              onChange={(value) => update('permissionsExpireMinutes', value)}
            />
            <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-mint" />
              Passwords are hashed with bcrypt (cost 12). Plaintext is never logged, returned by the API, or stored.
            </div>
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard icon={ShieldCheck} title="Honest limitations" description="What Discord actually allows." accent="amber">
            <div className="space-y-3 text-xs leading-relaxed text-muted">
              <p>
                <strong className="text-soft">Friends only</strong> cannot inspect Discord friend lists. Chamber implements it as
                the owner's trusted allow-list: invite the members you trust and only they can connect.
              </p>
              <p>
                <strong className="text-soft">Voice regions</strong> are deprecated for most servers. The dashboard honours the
                request but reports a warning if Discord rejects it.
              </p>
              <p>
                <strong className="text-soft">Banners</strong> are a Chamber dashboard identity feature. Discord voice channels do
                not expose custom banners, and the UI never claims otherwise.
              </p>
            </div>
          </SectionCard>

          <Callout tone="rose" title="Occupied rooms are never destroyed">
            Expiry and inactivity run on a never-destructive policy: a room must be empty before automatic deletion or it is
            extended with a warning.
          </Callout>
        </div>
      </div>

      <SaveBar dirty={dirty && canEdit} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}

export default PrivacyPage;
