import { ShieldCheck, SlidersHorizontal, UserCog, Users, Zap } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useChannels } from '../lib/hooks';
import { useConfigForm, RoleMultiPicker } from '../components/ConfigForm';
import { Badge, Callout, PageHeader, SaveBar, SectionCard, Field, OfflineNotice } from '../components/ui';

export function PermissionsPage() {
  const { guildId, detail, channels } = useGuild();
  const channelData = useChannels(guildId);
  const { form, update, dirty, save, saving, reset } = useConfigForm(guildId, detail.config);
  const canEdit = detail.access.admin;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experience"
        title="Permissions & access"
        description="Decide who can configure Chamber, moderate every room, and jump the queue. Room-level permissions live inside each room's control panel."
        actions={<Badge tone="accent"><ShieldCheck size={11} /> Role based</Badge>}
      />

      {!detail.bot.online ? <OfflineNotice message="Use role IDs while the bot is offline. Live role validation resumes automatically." /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard icon={UserCog} title="Dashboard administrators" description="Full access to every setting, room, analytics and the danger zone." accent="accent">
          <Field label="Administrator roles" hint="Members with these roles can manage configuration even without Discord's Manage Server permission.">
            <RoleMultiPicker
              values={form.adminRoleIds}
              onChange={(values) => update('adminRoleIds', values)}
              roles={channelData.data?.roles}
            />
          </Field>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent-soft" />
            Server owner, Administrator and Manage Server members always have administrator access.
          </div>
        </SectionCard>

        <SectionCard icon={Users} title="Staff moderators" description="Can inspect rooms, resolve access requests, admit queues and moderate members. Cannot edit configuration." accent="cyan">
          <Field label="Staff roles" hint="Room owners and temporary room admins are always able to manage their own rooms.">
            <RoleMultiPicker
              values={form.staffRoleIds}
              onChange={(values) => update('staffRoleIds', values)}
              roles={channelData.data?.roles}
            />
          </Field>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-faint">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-cyan" />
            Staff actions are written to the audit log with the actor, target and timestamp.
          </div>
        </SectionCard>

        <SectionCard icon={Zap} title="Queue priority" description="Members with priority roles are placed ahead of the normal queue." accent="amber">
          <Field label="Priority roles" hint="Priority affects queue order only. It never bypasses room privacy or bans.">
            <RoleMultiPicker
              values={form.queuePriorityRoleIds}
              onChange={(values) => update('queuePriorityRoleIds', values)}
              roles={channelData.data?.roles}
            />
          </Field>
        </SectionCard>

        <SectionCard icon={SlidersHorizontal} title="How room permissions work" description="A layered permission model enforced by the bot." accent="mint">
          <ul className="space-y-3 text-xs leading-relaxed text-muted">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span><strong className="text-soft">Discord overwrites</strong> are rebuilt after every change: everyone, allow-list, bans, owner, temp admins and the bot itself.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
              <span><strong className="text-soft">Owner & temp admins</strong> always retain access. Temporary admins can moderate but cannot delete the room or change privacy.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
              <span><strong className="text-soft">Bans always win</strong> over allow-list entries, and expired temporary permissions are cleaned up by the scheduler.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose" />
              <span><strong className="text-soft">Dashboard writes require staff access</strong> verified live against Discord roles whenever the bot is online.</span>
            </li>
          </ul>
        </SectionCard>
      </div>

      {!canEdit ? (
        <Callout tone="amber" title="Read-only">
          Staff can view permission design, but only administrators can save role configuration.
        </Callout>
      ) : null}

      <SaveBar dirty={dirty && canEdit} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}

export default PermissionsPage;
