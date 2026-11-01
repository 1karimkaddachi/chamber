import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CalendarClock,
  Check,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  DoorOpen,
  ListOrdered,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Unlock,
  Upload,
  UserX,
  Users,
} from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useRoomDetail, useRooms, useRoomTypes } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { formatDate, formatDuration, privacyMeta, relativeTime, roomTypeMeta, titleCase } from '../lib/format';
import {
  Badge,
  Button,
  Drawer,
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
  cn,
} from '../components/ui';
import type { ActiveRoom, PrivacyMode, RoomDetail, RoomMember } from '../types';

interface EditState {
  name: string;
  topic: string;
  userLimit: number;
  privacy: PrivacyMode;
  locked: boolean;
  hidden: boolean;
  password: string;
  emoji: string;
  theme: string;
  description: string;
  bannerUrl: string;
  rtcRegion: string;
  parentCategoryId: string;
}

export function ActiveRoomsPage() {
  const { guildId, detail, channels } = useGuild();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [privacyFilter, setPrivacyFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ActiveRoom | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ActiveRoom | null>(null);
  const [transferTarget, setTransferTarget] = useState<ActiveRoom | null>(null);
  const [transferUser, setTransferUser] = useState('');
  const [banTarget, setBanTarget] = useState<ActiveRoom | null>(null);
  const [banUser, setBanUser] = useState('');
  const [banReason, setBanReason] = useState('');
  const [kickTarget, setKickTarget] = useState<{ room: ActiveRoom; member: RoomMember } | null>(null);
  const [allowTarget, setAllowTarget] = useState<ActiveRoom | null>(null);
  const [allowUser, setAllowUser] = useState('');
  const rooms = useRooms(guildId, { search, type: typeFilter });
  const types = useRoomTypes(guildId);
  const roomDetail = useRoomDetail(guildId, selectedId);
  const canAdmin = detail.access.admin;
  const canModerate = detail.access.staff;
  const botOnline = detail.bot.online;

  const filtered = useMemo(
    () => (rooms.data ?? []).filter((room) => !privacyFilter || room.privacy === privacyFilter),
    [rooms.data, privacyFilter],
  );

  const typeName = (key: string | null) => (types.data ?? []).find((type) => type.key === key)?.name ?? roomTypeMeta(key).name;

  const invalidateRooms = () => {
    void queryClient.invalidateQueries({ queryKey: ['rooms', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['room', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['overview', guildId] });
    void queryClient.invalidateQueries({ queryKey: ['queues', guildId] });
  };

  const patch = useMutation({
    mutationFn: ({ room, body }: { room: ActiveRoom; body: Record<string, unknown> }) =>
      api(`/guilds/${guildId}/rooms/${room.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      success('Room updated');
      setEditing(null);
      setEditState(null);
      invalidateRooms();
    },
    onError: (error) => toastError('Could not update room', errorMessage(error)),
  });

  const action = useMutation({
    mutationFn: ({ room, actionName }: { room: ActiveRoom; actionName: string }) =>
      api(`/guilds/${guildId}/rooms/${room.id}/actions`, { method: 'POST', body: { action: actionName } }),
    onSuccess: (_data, variables) => {
      success(`Room ${variables.actionName === 'admit-next' ? 'queue admitted' : variables.actionName}`);
      invalidateRooms();
    },
    onError: (error) => toastError('Action failed', errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (room: ActiveRoom) => api(`/guilds/${guildId}/rooms/${room.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      success('Room deleted');
      setDeleteTarget(null);
      setSelectedId(null);
      invalidateRooms();
    },
    onError: (error) => toastError('Could not delete room', errorMessage(error)),
  });

  const transfer = useMutation({
    mutationFn: ({ room, userId }: { room: ActiveRoom; userId: string }) =>
      api(`/guilds/${guildId}/rooms/${room.id}/transfer`, { method: 'POST', body: { userId } }),
    onSuccess: () => {
      success('Ownership transferred');
      setTransferTarget(null);
      setTransferUser('');
      invalidateRooms();
    },
    onError: (error) => toastError('Could not transfer ownership', errorMessage(error)),
  });

  const moderation = useMutation({
    mutationFn: ({ room, body }: { room: ActiveRoom; body: Record<string, unknown> }) =>
      api(`/guilds/${guildId}/rooms/${room.id}/moderation`, { method: 'POST', body }),
    onSuccess: () => {
      success('Moderation applied');
      setBanTarget(null);
      setBanUser('');
      setBanReason('');
      setAllowTarget(null);
      setAllowUser('');
      invalidateRooms();
    },
    onError: (error) => toastError('Moderation failed', errorMessage(error)),
  });

  const memberAction = useMutation({
    mutationFn: ({ room, userId, actionName }: { room: ActiveRoom; userId: string; actionName: string }) =>
      api(`/guilds/${guildId}/rooms/${room.id}/members`, {
        method: 'POST',
        body: { action: actionName, userId },
      }),
    onSuccess: () => {
      success('Member action applied');
      setKickTarget(null);
      invalidateRooms();
    },
    onError: (error) => toastError('Member action failed', errorMessage(error)),
  });

  const bannerFileInput = useRef<HTMLInputElement>(null);

  const bannerUpload = useMutation({
    mutationFn: async (file: File) => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.readAsDataURL(file);
      });
      return api<{ url: string }>(`/guilds/${guildId}/uploads`, {
        method: 'POST',
        body: { data, mimeType: file.type },
      });
    },
    onSuccess: (result) => {
      setEditState((current) => current && { ...current, bannerUrl: result.url });
      success('Banner uploaded. Save the room to apply it.');
    },
    onError: (error) => toastError('Banner upload failed', errorMessage(error)),
  });

  const openEditor = (room: ActiveRoom) => {
    setEditing(room);
    setEditState({
      name: room.name,
      topic: room.topic ?? '',
      userLimit: room.userLimit,
      privacy: room.privacy,
      locked: room.locked,
      hidden: room.hidden,
      password: '',
      emoji: room.emoji ?? '',
      theme: room.theme ?? '#7c6cff',
      description: room.description ?? '',
      bannerUrl: room.bannerUrl ?? '',
      rtcRegion: room.rtcRegion ?? '',
      parentCategoryId: room.parentCategoryId ?? '',
    });
  };

  const saveEdit = () => {
    if (!editing || !editState) return;
    if (!editState.name.trim()) {
      toastError('Room name is required');
      return;
    }
    const body: Record<string, unknown> = {
      name: editState.name.trim(),
      topic: editState.topic.trim() || null,
      userLimit: editState.userLimit,
      privacy: editState.privacy,
      locked: editState.locked,
      hidden: editState.hidden,
      emoji: editState.emoji || null,
      theme: editState.theme || null,
      description: editState.description.trim() || null,
      bannerUrl: editState.bannerUrl.trim() || null,
      rtcRegion: editState.rtcRegion.trim() || null,
      parentCategoryId: editState.parentCategoryId || null,
    };
    if (editState.privacy === 'PASSWORD' && editState.password) body.password = editState.password;
    patch.mutate({ room: editing, body });
  };

  const openRoom = roomDetail.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Active rooms"
        description="Live temporary rooms across the server. Changes apply to Discord immediately and update the control panel."
        actions={
          <>
            <Badge tone={botOnline ? 'mint' : 'amber'}>{filtered.length} active</Badge>
            <Button variant="secondary" leftIcon={RefreshCw} onClick={() => void rooms.refetch()}>
              Refresh
            </Button>
          </>
        }
      />

      {!botOnline ? <OfflineNotice message="Live room actions are disabled while the bot is offline. You can still inspect rooms, queue and history." /> : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rooms or owners…" className="pl-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="sm:w-44">
            <option value="">All room types</option>
            {(types.data ?? []).map((type) => (
              <option key={type.id} value={type.key}>
                {type.emoji} {type.name}
              </option>
            ))}
          </Select>
          <Select value={privacyFilter} onChange={(event) => setPrivacyFilter(event.target.value)} className="sm:w-40">
            <option value="">All privacy</option>
            {['PUBLIC', 'PRIVATE', 'INVITE_ONLY', 'REQUEST', 'PASSWORD', 'FRIENDS', 'ROLE_RESTRICTED'].map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {rooms.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((room) => {
            const privacy = privacyMeta(room.privacy);
            const type = roomTypeMeta(room.roomTypeKey);
            return (
              <div
                key={room.id}
                className="group flex cursor-pointer flex-col gap-4 rounded-2xl border border-white/6 bg-white/[0.02] p-4 transition hover:border-white/12 hover:bg-white/[0.035] lg:flex-row lg:items-center lg:justify-between"
                onClick={() => setSelectedId(room.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setSelectedId(room.id);
                }}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-lg">
                    {room.emoji || type.emoji}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-ink">{room.name}</p>
                      <Badge tone={privacy.tone}>{privacy.emoji} {privacy.label}</Badge>
                      {room.locked ? <Badge tone="amber">Locked</Badge> : null}
                      {room.hidden ? <Badge tone="muted">Hidden</Badge> : null}
                    </div>
                    <p className="mt-1 text-[11px] text-faint">
                      @{room.ownerName} · {typeName(room.roomTypeKey)} · created {relativeTime(room.createdAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
                      <span className="inline-flex items-center gap-1">
                        <Users size={11} /> {room.memberCount}/{room.userLimit || '∞'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ListOrdered size={11} /> {room.queueCount} queued
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <DoorOpen size={11} /> {room.waitingCount} waiting
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Activity size={11} /> peak {room.peakMembers} · {room.totalJoins} joins
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1 self-end lg:self-center">
                  {canAdmin && botOnline ? (
                    <>
                      <IconButton
                        label={room.locked ? 'Unlock room' : 'Lock room'}
                        icon={room.locked ? Unlock : Lock}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.mutate({ room, actionName: room.locked ? 'unlock' : 'lock' });
                        }}
                      />
                      <IconButton
                        label={room.hidden ? 'Reveal room' : 'Hide room'}
                        icon={room.hidden ? Eye : EyeOff}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.mutate({ room, actionName: room.hidden ? 'reveal' : 'hide' });
                        }}
                      />
                      <IconButton
                        label="Edit room settings"
                        icon={Pencil}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditor(room);
                        }}
                      />
                    </>
                  ) : null}
                  <a
                    href={`https://discord.com/channels/${guildId}/${room.channelId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/10 px-2.5 text-[11px] text-soft transition hover:border-accent/30 hover:text-ink"
                  >
                    Discord <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={DoorOpen}
          title={rooms.data && rooms.data.length > 0 ? 'No rooms match these filters' : 'No active rooms'}
          description="Active rooms appear here the moment a member joins a trigger channel."
        />
      )}

      <Drawer
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={
          openRoom ? (
            <span className="flex items-center gap-2">
              <span>{openRoom.emoji || '🎧'}</span> {openRoom.name}
            </span>
          ) : (
            'Room details'
          )
        }
        subtitle={
          openRoom ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={privacyMeta(openRoom.privacy).tone}>
                {privacyMeta(openRoom.privacy).emoji} {privacyMeta(openRoom.privacy).label}
              </Badge>
              <Badge tone={openRoom.locked ? 'amber' : 'muted'}>{openRoom.locked ? 'Locked' : 'Unlocked'}</Badge>
              <Badge tone={openRoom.hidden ? 'muted' : 'mint'}>{openRoom.hidden ? 'Hidden' : 'Visible'}</Badge>
            </div>
          ) : null
        }
        footer={
          openRoom ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canAdmin && botOnline ? (
                <>
                  <Button variant="secondary" size="sm" leftIcon={Pencil} onClick={() => openEditor(openRoom)}>
                    Edit
                  </Button>
                  <Button variant="secondary" size="sm" leftIcon={Crown} onClick={() => setTransferTarget(openRoom)}>
                    Transfer
                  </Button>
                  <Button variant="danger" size="sm" leftIcon={Trash2} onClick={() => setDeleteTarget(openRoom)}>
                    Delete
                  </Button>
                </>
              ) : null}
              <a
                href={`https://discord.com/channels/${guildId}/${openRoom.channelId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-3 text-[11px] text-soft hover:text-ink"
              >
                Open in Discord <ExternalLink size={11} />
              </a>
            </div>
          ) : null
        }
      >
        {roomDetail.isLoading || !openRoom ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {openRoom.bannerUrl ? (
              <img
                src={openRoom.bannerUrl}
                alt={`${openRoom.name} banner`}
                className="h-32 w-full rounded-xl border border-white/10 object-cover"
                referrerPolicy="no-referrer"
              />
            ) : null}
            {openRoom.description ? (
              <p className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-muted">
                {openRoom.description}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Info label="Owner" value={openRoom.ownerName} />
              <Info label="Type" value={typeName(openRoom.roomTypeKey)} />
              <Info label="Members" value={`${openRoom.live?.count ?? openRoom.memberCount}/${openRoom.userLimit || '∞'}`} />
              <Info label="Bitrate" value={`${Math.round(openRoom.bitrate / 1000)} kbps`} />
              <Info label="Created" value={formatDate(openRoom.createdAt)} />
              <Info label="Expires" value={openRoom.expiresAt ? relativeTime(openRoom.expiresAt) : 'When empty'} />
              <Info label="Peak members" value={String(openRoom.peakMembers)} />
              <Info label="Total joins" value={String(openRoom.totalJoins)} />
              <Info label="Template" value={openRoom.templateName ?? 'None'} />
              <Info label="Queue" value={`${openRoom.queue.length} waiting`} />
            </div>

            <div className="flex flex-wrap gap-2">
              {canAdmin && botOnline ? (
                <>
                  <Button
                    size="sm"
                    variant={openRoom.locked ? 'success' : 'secondary'}
                    leftIcon={openRoom.locked ? Unlock : Lock}
                    onClick={() => action.mutate({ room: openRoom, actionName: openRoom.locked ? 'unlock' : 'lock' })}
                  >
                    {openRoom.locked ? 'Unlock' : 'Lock'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={openRoom.hidden ? Eye : EyeOff}
                    onClick={() => action.mutate({ room: openRoom, actionName: openRoom.hidden ? 'reveal' : 'hide' })}
                  >
                    {openRoom.hidden ? 'Reveal' : 'Hide'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={RefreshCw}
                    onClick={() => action.mutate({ room: openRoom, actionName: 'refresh' })}
                  >
                    Refresh panel
                  </Button>
                </>
              ) : null}
              {canModerate && botOnline && openRoom.queue.length > 0 ? (
                <Button
                  size="sm"
                  variant="success"
                  leftIcon={Check}
                  onClick={() => action.mutate({ room: openRoom, actionName: 'admit-next' })}
                >
                  Admit next
                </Button>
              ) : null}
              {canModerate && botOnline ? (
                <>
                  <Button size="sm" variant="secondary" leftIcon={Users} onClick={() => setAllowTarget(openRoom)}>
                    Allow member
                  </Button>
                  <Button size="sm" variant="danger" leftIcon={ShieldAlert} onClick={() => setBanTarget(openRoom)}>
                    Ban member
                  </Button>
                </>
              ) : null}
            </div>

            <SectionCard icon={Users} title={`Members · ${openRoom.live?.count ?? 0} connected`} className="border-white/6">
              {openRoom.live && openRoom.live.members.length > 0 ? (
                <div className="space-y-2">
                  {openRoom.live.members.map((member) => (
                    <div key={member.userId} className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
                      <div>
                        <p className="text-[12px] text-soft">{member.name ?? member.userId}</p>
                        <p className="text-[10px] text-faint">{member.role.toLowerCase()} · joined {formatDate(member.joinedAt)}</p>
                      </div>
                      {canModerate && botOnline && member.userId !== openRoom.ownerId ? (
                        <IconButton
                          label="Remove member"
                          icon={UserX}
                          variant="danger"
                          onClick={() => setKickTarget({ room: openRoom, member })}
                        />
                      ) : (
                        <Badge tone="muted">{member.role.toLowerCase()}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">No members are connected right now.</p>
              )}
            </SectionCard>

            <div className="grid gap-4">
              <DetailList
                icon={ListOrdered}
                title="Queue"
                empty="The queue is empty."
                items={openRoom.queue.map((entry) => ({
                  key: entry.id,
                  primary: entry.name ?? entry.userId,
                  secondary: `Position ${entry.position} · joined ${formatDate(entry.joinedAt)}`,
                  badge: entry.priority > 0 ? 'Priority' : undefined,
                }))}
              />
              <DetailList
                icon={DoorOpen}
                title="Waiting requests"
                empty="No pending access requests."
                items={openRoom.waiting
                  .filter((request) => request.status === 'PENDING')
                  .map((request) => ({
                    key: request.id,
                    primary: request.name ?? request.userId,
                    secondary: request.message ?? `Requested ${formatDate(request.createdAt)}`,
                  }))}
              />
              <DetailList
                icon={CalendarClock}
                title="Events"
                empty="No events for this room."
                items={openRoom.events.map((event) => ({
                  key: event.id,
                  primary: `${event.title} · ${event.status.toLowerCase()}`,
                  secondary: `${formatDate(event.startsAt)} · ${event._count?.participants ?? 0}/${event.participantLimit || '∞'} participants`,
                }))}
              />
            </div>

            {openRoom.bans.length > 0 ? (
              <SectionCard icon={ShieldAlert} title="Bans & blocks" className="border-white/6">
                <div className="space-y-2">
                  {openRoom.bans.map((ban) => (
                    <div key={ban.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/6 px-3 py-2 text-[11px]">
                      <span className="text-soft">{ban.name ?? ban.userId} · {ban.kind.toLowerCase()}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-faint">{ban.expiresAt ? `until ${formatDate(ban.expiresAt)}` : 'permanent'}</span>
                        {canModerate && botOnline ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              moderation.mutate({ room: openRoom, body: { action: 'unban', userId: ban.userId } })
                            }
                          >
                            Unban
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            ) : null}

            {openRoom.allowList.length > 0 ? (
              <SectionCard icon={Check} title="Allowed users" className="border-white/6">
                <div className="space-y-2">
                  {openRoom.allowList.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/6 px-3 py-2 text-[11px]">
                      <span className="text-soft">
                        {rule.targetType === 'ROLE' ? 'Role' : 'User'} · {rule.name ?? rule.targetId}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-faint">{rule.expiresAt ? `until ${formatDate(rule.expiresAt)}` : 'no expiry'}</span>
                        {canModerate && botOnline && rule.targetType === 'USER' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              moderation.mutate({ room: openRoom, body: { action: 'revoke', userId: rule.targetId } })
                            }
                          >
                            Revoke
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            ) : null}

            <SectionCard icon={Activity} title="Room history" className="border-white/6">
              {openRoom.history.length > 0 ? (
                <div className="space-y-2">
                  {openRoom.history.slice(0, 8).map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/6 px-3 py-2 text-[11px]">
                      <div className="min-w-0">
                        <p className="truncate text-soft">{entry.name}</p>
                        <p className="text-[10px] text-faint">{entry.endReason ?? 'closed'} · {formatDate(entry.endedAt)}</p>
                      </div>
                      <span className="shrink-0 text-faint">{formatDuration(entry.durationSeconds)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">No completed history for this owner yet.</p>
              )}
            </SectionCard>
          </div>
        )}
      </Drawer>

      <Modal
        open={Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setEditState(null);
        }}
        title={`Edit · ${editing?.name ?? 'room'}`}
        description="Changes apply to Discord immediately and refresh the control panel."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setEditState(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={patch.isPending} onClick={saveEdit}>
              Save room
            </Button>
          </div>
        }
      >
        {editState ? (
          <div className="space-y-4">
            <Field label="Room name">
              <Input
                value={editState.name}
                onChange={(event) => setEditState((current) => current && { ...current, name: event.target.value })}
                maxLength={100}
              />
            </Field>
            <Field label="Topic" hint="Shown in Discord channel details.">
              <Input
                value={editState.topic}
                onChange={(event) => setEditState((current) => current && { ...current, topic: event.target.value })}
                maxLength={1024}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="User limit" hint="0 means unlimited.">
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={editState.userLimit}
                  onChange={(event) =>
                    setEditState((current) => current && { ...current, userLimit: Math.max(0, Math.min(99, Number(event.target.value) || 0)) })
                  }
                />
              </Field>
              <Field label="Privacy">
                <Select
                  value={editState.privacy}
                  onChange={(event) =>
                    setEditState((current) => current && { ...current, privacy: event.target.value as PrivacyMode })
                  }
                >
                  {['PUBLIC', 'PRIVATE', 'INVITE_ONLY', 'REQUEST', 'PASSWORD', 'FRIENDS', 'ROLE_RESTRICTED'].map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {editState.privacy === 'PASSWORD' ? (
              <Field label="New password" hint="Leave blank to keep the existing password. Plaintext is hashed immediately.">
                <Input
                  type="password"
                  value={editState.password}
                  onChange={(event) => setEditState((current) => current && { ...current, password: event.target.value })}
                  minLength={4}
                  maxLength={64}
                />
              </Field>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-[100px_1fr]">
              <Field label="Emoji">
                <Input
                  value={editState.emoji}
                  onChange={(event) => setEditState((current) => current && { ...current, emoji: event.target.value })}
                  maxLength={16}
                  placeholder="🎧"
                />
              </Field>
              <Field label="Room accent / theme" hint="Displayed on the dashboard and the Components V2 panel.">
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(editState.theme) ? editState.theme : '#7c6cff'}
                    onChange={(event) => setEditState((current) => current && { ...current, theme: event.target.value })}
                    className="h-[42px] w-12 cursor-pointer rounded-xl border border-white/10 bg-transparent p-1"
                    aria-label="Room accent color"
                  />
                  <Input
                    value={editState.theme}
                    onChange={(event) => setEditState((current) => current && { ...current, theme: event.target.value })}
                    maxLength={7}
                  />
                </div>
              </Field>
            </div>
            <Field label="Description" hint="Room identity shown in the dashboard. Discord has no native voice-channel description.">
              <Input
                value={editState.description}
                onChange={(event) => setEditState((current) => current && { ...current, description: event.target.value })}
                maxLength={300}
                placeholder="A quiet lounge for the regulars"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Dashboard banner"
                hint="Paste an image URL or upload a PNG/JPEG/WebP/GIF under 4 MB. Discord has no native channel banner."
              >
                <div className="flex gap-2">
                  <Input
                    value={editState.bannerUrl}
                    onChange={(event) =>
                      setEditState((current) => current && { ...current, bannerUrl: event.target.value })
                    }
                    placeholder="https://…"
                    maxLength={500}
                  />
                  <input
                    ref={bannerFileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) bannerUpload.mutate(file);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="md"
                    leftIcon={Upload}
                    loading={bannerUpload.isPending}
                    onClick={() => bannerFileInput.current?.click()}
                  >
                    Upload
                  </Button>
                </div>
              </Field>
              <Field label="Voice region" hint="Deprecated by Discord for most servers. Chamber reports a warning if rejected.">
                <Input
                  value={editState.rtcRegion}
                  onChange={(event) => setEditState((current) => current && { ...current, rtcRegion: event.target.value })}
                  placeholder="automatic"
                  maxLength={40}
                />
              </Field>
              <Field label="Category" hint="Move the room to another Discord category.">
                <Select
                  value={editState.parentCategoryId}
                  onChange={(event) =>
                    setEditState((current) => current && { ...current, parentCategoryId: event.target.value })
                  }
                >
                  <option value="">No category</option>
                  {(channels?.categories ?? []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle
                checked={editState.locked}
                onChange={(value) => setEditState((current) => current && { ...current, locked: value })}
                label="Lock room"
                description="Prevents new members from joining."
              />
              <Toggle
                checked={editState.hidden}
                onChange={(value) => setEditState((current) => current && { ...current, hidden: value })}
                label="Hide room"
                description="Hides the channel from the channel list."
              />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete room?"
        description="Connected members will be disconnected and the room record closed. This cannot be undone."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget)}>
              Delete room
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          Delete <strong className="text-ink">{deleteTarget?.name}</strong>?
        </p>
      </Modal>

      <Modal
        open={Boolean(transferTarget)}
        onClose={() => setTransferTarget(null)}
        title="Transfer ownership"
        description="The new owner receives full control of the room. The current owner remains a member."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTransferTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={transfer.isPending}
              disabled={!/^\d{5,25}$/.test(transferUser)}
              onClick={() => transferTarget && transfer.mutate({ room: transferTarget, userId: transferUser })}
            >
              Transfer
            </Button>
          </div>
        }
      >
        <Field label="New owner Discord user ID" hint="Use the member's Discord ID. They must be in the server.">
          <Input value={transferUser} onChange={(event) => setTransferUser(event.target.value.replace(/\D/g, ''))} placeholder="123456789012345678" />
        </Field>
      </Modal>

      <Modal
        open={Boolean(banTarget)}
        onClose={() => setBanTarget(null)}
        title="Ban from room"
        description="This disconnects the member and prevents them from reconnecting."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBanTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={moderation.isPending}
              disabled={!/^\d{5,25}$/.test(banUser)}
              onClick={() => {
                if (!banTarget) return;
                moderation.mutate({
                  room: banTarget,
                  body: { action: 'ban', userId: banUser, reason: banReason || undefined, durationMinutes: 0 },
                });
              }}
            >
              Ban member
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Discord user ID">
            <Input value={banUser} onChange={(event) => setBanUser(event.target.value.replace(/\D/g, ''))} placeholder="123456789012345678" />
          </Field>
          <Field label="Reason" hint="Visible only in the dashboard and audit logs.">
            <Input value={banReason} onChange={(event) => setBanReason(event.target.value)} maxLength={200} placeholder="Optional reason" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(allowTarget)}
        onClose={() => {
          setAllowTarget(null);
          setAllowUser('');
        }}
        title="Allow a member"
        description="Adds a channel permission overwrite so the member can connect even when privacy restricts the room."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAllowTarget(null);
                setAllowUser('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={moderation.isPending}
              disabled={!/^\d{5,25}$/.test(allowUser)}
              onClick={() => {
                if (!allowTarget) return;
                moderation.mutate({ room: allowTarget, body: { action: 'allow', userId: allowUser } });
                setAllowTarget(null);
                setAllowUser('');
              }}
            >
              Allow member
            </Button>
          </div>
        }
      >
        <Field label="Discord user ID" hint="The member must be in the server.">
          <Input value={allowUser} onChange={(event) => setAllowUser(event.target.value.replace(/\D/g, ''))} placeholder="123456789012345678" />
        </Field>
      </Modal>

      <Modal
        open={Boolean(kickTarget)}
        onClose={() => setKickTarget(null)}
        title="Remove member?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setKickTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={memberAction.isPending}
              onClick={() =>
                kickTarget && memberAction.mutate({ room: kickTarget.room, userId: kickTarget.member.userId, actionName: 'remove' })
              }
            >
              Remove member
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          Remove <strong className="text-ink">{kickTarget?.member.name ?? kickTarget?.member.userId}</strong> from{' '}
          <strong className="text-ink">{kickTarget?.room.name}</strong>?
        </p>
      </Modal>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-0.5 truncate text-[12px] text-soft">{value}</p>
    </div>
  );
}

function DetailList({
  icon: Icon,
  title,
  items,
  empty,
}: {
  icon: typeof Users;
  title: string;
  items: Array<{ key: string; primary: string; secondary?: string; badge?: string }>;
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2.5">
        <Icon size={14} className="text-accent-soft" />
        <p className="text-[12px] font-medium text-ink">{title}</p>
      </div>
      {items.length > 0 ? (
        <div className="divide-y divide-white/5">
          {items.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] text-soft">{item.primary}</p>
                {item.secondary ? <p className="truncate text-[10px] text-faint">{item.secondary}</p> : null}
              </div>
              {item.badge ? <Badge tone="amber">{item.badge}</Badge> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-3 text-[11px] text-faint">{empty}</p>
      )}
    </div>
  );
}

export default ActiveRoomsPage;
