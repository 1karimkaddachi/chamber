import { Clock, Database, RefreshCw, ShieldCheck, Timer, Trash2, Users, Workflow } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { NumberField, useConfigForm } from '../components/ConfigForm';
import {
  Badge,
  Callout,
  OfflineNotice,
  PageHeader,
  SaveBar,
  SectionCard,
  Toggle,
} from '../components/ui';

export function AutomationPage() {
  const { guildId, detail } = useGuild();
  const { form, update, dirty, save, saving, reset } = useConfigForm(guildId, detail.config);
  const canEdit = detail.access.admin;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experience"
        title="Room automation"
        description="Cleanup, lifetimes, ownership recovery and retention. Automation never destroys an occupied room."
        actions={<Badge tone="mint"><ShieldCheck size={11} /> Non-destructive</Badge>}
      />

      {!detail.bot.online ? <OfflineNotice message="Timers continue in the database; Discord actions resume when the bot is online." /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard icon={Trash2} title="Empty room cleanup" description="Rooms are removed after they have been empty for the grace period." accent="rose">
          <div className="space-y-4">
            <Toggle
              checked={form.autoCleanup}
              onChange={(value) => update('autoCleanup', value)}
              label="Delete empty rooms automatically"
              description="Occupied rooms are never touched. A member rejoining cancels the timer."
              disabled={!canEdit}
            />
            <NumberField
              label="Empty grace period"
              hint="How long a room stays reserved after the last member leaves."
              value={form.emptyGraceSeconds}
              min={10}
              max={600}
              suffix="sec"
              onChange={(value) => update('emptyGraceSeconds', value)}
              disabled={!canEdit || !form.autoCleanup}
            />
          </div>
        </SectionCard>

        <SectionCard icon={Timer} title="Lifetime & inactivity" description="Warnings first, extensions for occupied rooms, deletion only when empty." accent="amber">
          <div className="space-y-4">
            <NumberField
              label="Maximum room lifetime"
              hint="0 disables the lifetime cap. Occupied rooms receive a 15-minute extension with a warning."
              value={form.roomLifetimeMinutes}
              min={0}
              max={10080}
              suffix="min"
              onChange={(value) => update('roomLifetimeMinutes', value)}
              disabled={!canEdit}
            />
            <NumberField
              label="Inactivity notice"
              hint="0 disables inactivity notices. The room is never deleted because it is quiet."
              value={form.inactivityMinutes}
              min={0}
              max={10080}
              suffix="min"
              onChange={(value) => update('inactivityMinutes', value)}
              disabled={!canEdit}
            />
          </div>
        </SectionCard>

        <SectionCard icon={Users} title="Ownership recovery" description="Keeps rooms manageable when the owner leaves or goes quiet." accent="cyan">
          <div className="space-y-4">
            <Toggle
              checked={form.transferOnOwnerLeave}
              onChange={(value) => update('transferOnOwnerLeave', value)}
              label="Transfer ownership when the owner leaves"
              description="The longest-present connected member becomes owner after the owner is absent for 5 minutes."
              disabled={!canEdit}
            />
            <NumberField
              label="Temporary admin duration"
              hint="0 keeps temporary admins until the room closes."
              value={form.tempAdminMinutes}
              min={0}
              max={1440}
              suffix="min"
              onChange={(value) => update('tempAdminMinutes', value)}
              disabled={!canEdit}
            />
            <NumberField
              label="Temporary permission expiry"
              hint="Applies to access grants and invite allow-list entries. 0 keeps them for the room lifetime."
              value={form.permissionsExpireMinutes}
              min={0}
              max={10080}
              suffix="min"
              onChange={(value) => update('permissionsExpireMinutes', value)}
              disabled={!canEdit}
            />
          </div>
        </SectionCard>

        <SectionCard icon={Database} title="Retention" description="Bound how much history and audit data is stored." accent="mint">
          <div className="space-y-4">
            <NumberField
              label="History & audit retention"
              hint="Room history, daily analytics and audit logs older than this are pruned daily at 04:00 UTC."
              value={form.retentionDays}
              min={1}
              max={3650}
              suffix="days"
              onChange={(value) => update('retentionDays', value)}
              disabled={!canEdit}
            />
            <div className="space-y-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
              <p className="flex items-center gap-2">
                <RefreshCw size={13} className="text-cyan" /> Recovery runs after every bot restart and reconciles active rooms with Discord.
              </p>
              <p className="flex items-center gap-2">
                <Clock size={13} className="text-amber" /> Scheduler ticks every 30 seconds with an overlap guard.
              </p>
              <p className="flex items-center gap-2">
                <ShieldCheck size={13} className="text-mint" /> Expired permission rules and temporary admins are cleaned automatically.
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      <Callout tone="rose" title="The occupied-room guarantee">
        Chamber never deletes a room while a human is connected. Lifetime expiry on an occupied room sends a warning, extends it
        by 15 minutes, and waits for the room to empty. This is enforced in the engine, not just the UI.
      </Callout>

      <SaveBar dirty={dirty && canEdit} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}

export default AutomationPage;
