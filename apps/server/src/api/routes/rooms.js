import express from 'express';
import prisma from '@chamber/db';
import {
  memberActionSchema,
  moderationSchema,
  roomActionSchema,
  roomEventInputSchema,
  roomUpdateSchema,
  transferSchema,
} from '@chamber/shared';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { currentUserId, guildAccess, requireBot } from '../middleware.js';
import { fetchMemberById } from '../../lib/discord.js';
import {
  allowMember,
  banMember,
  buildRoomContext,
  deleteRoom,
  demoteMember,
  getRoomById,
  inviteMember,
  kickMember,
  listActiveRooms,
  moveMember,
  promoteMember,
  refreshLobby,
  refreshPanel,
  resetRoom,
  revokeAccess,
  toPublicRoom,
  transferOwnership,
  unbanMember,
  updateRoom,
  voiceModerate,
} from '../../services/roomService.js';
import { resolveWaitingRequest } from '../../services/privacyService.js';
import { admitEntryById, admitNext, listQueue } from '../../services/queueService.js';
import {
  cancelRoomEvent,
  createRoomEvent,
  listRoomEvents,
} from '../../services/eventService.js';
import { writeAudit } from '../../services/auditService.js';

const router = express.Router();

async function loadRoom(context, roomId) {
  const room = await getRoomById(roomId);
  if (!room || room.guildId !== context.guild.id) throw new NotFoundError('Room not found.');
  return room;
}

async function namesFor(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, username: true, globalName: true },
  });
  return new Map(users.map((user) => [user.id, user.globalName || user.username || user.id]));
}

router.get('/:guildId/rooms', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const rooms = await listActiveRooms(req.guildContext.guild.id, {
      search: req.query.search ? String(req.query.search) : '',
      type: req.query.type ? String(req.query.type) : '',
    });
    res.json(rooms);
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/waiting', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const requests = await prisma.waitingRequest.findMany({
      where: { status: 'PENDING', room: { guildId: req.guildContext.guild.id, status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      include: { room: { select: { id: true, name: true, channelId: true, privacy: true } } },
      take: 100,
    });
    const nameMap = await namesFor(requests.map((request) => request.userId));
    res.json(
      requests.map((request) => ({
        ...request,
        name: nameMap.get(request.userId) ?? request.userId,
        roomName: request.room.name,
        channelId: request.room.channelId,
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/queues', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const entries = await prisma.queueEntry.findMany({
      where: { status: 'WAITING', room: { guildId: req.guildContext.guild.id, status: 'ACTIVE' } },
      orderBy: [{ priority: 'desc' }, { joinedAt: 'asc' }],
      include: { room: { select: { id: true, name: true, channelId: true, userLimit: true, privacy: true } } },
      take: 200,
    });
    const nameMap = await namesFor(entries.map((entry) => entry.userId));
    const groups = new Map();
    for (const entry of entries) {
      const group = groups.get(entry.roomId) ?? {
        roomId: entry.roomId,
        roomName: entry.room.name,
        channelId: entry.room.channelId,
        userLimit: entry.room.userLimit,
        privacy: entry.room.privacy,
        entries: [],
      };
      group.entries.push({
        id: entry.id,
        userId: entry.userId,
        name: nameMap.get(entry.userId) ?? entry.userId,
        priority: entry.priority,
        joinedAt: entry.joinedAt,
        position: group.entries.length + 1,
      });
      groups.set(entry.roomId, group);
    }
    res.json([...groups.values()]);
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/rooms/:roomId', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const context = req.guildContext;
    const room = await loadRoom(context, req.params.roomId);
    const [queue, waiting, events, history] = await Promise.all([
      listQueue(room.id),
      prisma.waitingRequest.findMany({
        where: { roomId: room.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      listRoomEvents(room.id),
      prisma.roomHistory.findMany({
        where: { OR: [{ roomId: room.id }, { ownerId: room.ownerId }] },
        orderBy: { endedAt: 'desc' },
        take: 20,
      }),
    ]);
    const nameMap = await namesFor([
      ...(room.members ?? []).map((member) => member.userId),
      ...queue.map((entry) => entry.userId),
      ...waiting.map((entry) => entry.userId),
      ...(room.bans ?? []).map((ban) => ban.userId),
      ...(room.permissions ?? []).map((rule) => rule.targetId),
    ]);
    let live = null;
    if (context.discordGuild) {
      const roomContext = await buildRoomContext(context.discordGuild, room);
      live = {
        members: roomContext.liveMembers.map((member) => ({
          ...member,
          name: nameMap.get(member.userId) ?? member.userId,
        })),
        count: roomContext.liveCount,
        queueCount: roomContext.queueCount,
        waitingCount: roomContext.waitingCount,
        typeName: roomContext.typeName,
      };
    }
    res.json({
      ...toPublicRoom(room),
      live,
      ownerName: nameMap.get(room.ownerId) ?? toPublicRoom(room).ownerName,
      members: (room.members ?? []).map((member) => ({
        ...member,
        name: nameMap.get(member.userId) ?? member.userId,
      })),
      allowList: (room.permissions ?? []).map((rule) => ({
        ...rule,
        name: rule.targetType === 'USER' ? nameMap.get(rule.targetId) ?? rule.targetId : null,
      })),
      bans: (room.bans ?? []).map((ban) => ({
        ...ban,
        name: nameMap.get(ban.userId) ?? ban.userId,
      })),
      queue: queue.map((entry, index) => ({
        ...entry,
        position: index + 1,
        name: nameMap.get(entry.userId) ?? entry.userId,
      })),
      waiting: waiting.map((entry) => ({
        ...entry,
        name: nameMap.get(entry.userId) ?? entry.userId,
      })),
      events,
      history,
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:guildId/rooms/:roomId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const patch = roomUpdateSchema.parse(req.body);
    const result = await updateRoom({
      guild,
      room,
      patch,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/:guildId/rooms/:roomId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const result = await deleteRoom({
      guild,
      room,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      reason: 'Deleted from dashboard',
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/rooms/:roomId/actions', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const { action } = roomActionSchema.parse(req.body);
    if (action === 'delete') {
      const result = await deleteRoom({
        guild,
        room,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
        reason: 'Deleted from dashboard',
      });
      return res.json(result);
    }
    if (action === 'refresh') {
      await refreshPanel(guild.client, room.id);
      await refreshLobby(guild.client, room.guildId);
      return res.json({ ok: true });
    }
    if (action === 'reset') {
      await resetRoom({
        guild,
        room,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
      return res.json({ ok: true });
    }
    if (action === 'admit-next') {
      const entry = await admitNext({
        client: guild.client,
        guild,
        room,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
      return res.json({ ok: true, userId: entry.userId });
    }
    if (action === 'clone') {
      throw new AppError('Room cloning is available from the Discord control panel.');
    }
    const map = {
      lock: { locked: true },
      unlock: { locked: false },
      hide: { hidden: true },
      reveal: { hidden: false },
    };
    const patch = map[action];
    if (!patch) throw new AppError('Unsupported room action.');
    const result = await updateRoom({
      guild,
      room,
      patch,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/rooms/:roomId/members', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const input = memberActionSchema.parse(req.body);
    const target = await fetchMemberById(guild, input.userId);
    if (!target) throw new AppError('That member is not in the server.');
    if (input.action === 'invite') {
      await inviteMember({
        guild,
        room,
        targetMember: target,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    } else if (input.action === 'remove') {
      await kickMember({
        guild,
        room,
        userId: input.userId,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    } else if (input.action === 'promote') {
      await promoteMember({
        guild,
        room,
        userId: input.userId,
        durationMinutes: input.durationMinutes ?? null,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    } else if (input.action === 'demote') {
      await demoteMember({
        guild,
        room,
        userId: input.userId,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    } else if (input.action === 'move') {
      await moveMember({
        guild,
        room,
        userId: input.userId,
        destinationChannelId: input.destinationChannelId,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    } else {
      await voiceModerate({
        guild,
        room,
        userId: input.userId,
        action: input.action,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/rooms/:roomId/moderation', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const input = moderationSchema.parse(req.body);
    if (input.action === 'ban' || input.action === 'block') {
      await banMember({
        guild,
        room,
        userId: input.userId,
        kind: input.action === 'block' ? 'BLOCK' : 'BAN',
        reason: input.reason ?? null,
        durationMinutes: input.durationMinutes ?? 0,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    } else if (input.action === 'allow') {
      await allowMember({
        guild,
        room,
        userId: input.userId,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    } else if (input.action === 'revoke') {
      const result = await revokeAccess({
        guild,
        room,
        userId: input.userId,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
      return res.json(result);
    } else {
      await unbanMember({
        guild,
        room,
        userId: input.userId,
        actorId: currentUserId(req),
        actorName: req.session.user.username,
      });
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/rooms/:roomId/transfer', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const { userId } = transferSchema.parse(req.body);
    const result = await transferOwnership({
      guild,
      room,
      targetUserId: userId,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/rooms/:roomId/queue', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const entries = await listQueue(room.id);
    const nameMap = await namesFor(entries.map((entry) => entry.userId));
    res.json(entries.map((entry, index) => ({ ...entry, position: index + 1, name: nameMap.get(entry.userId) ?? entry.userId })));
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/rooms/:roomId/queue/admit', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const entryId = req.body?.entryId ? String(req.body.entryId) : null;
    const entry = entryId
      ? await admitEntryById({
          client: guild.client,
          guild,
          room,
          entryId,
          actorId: currentUserId(req),
          actorName: req.session.user.username,
        })
      : await admitNext({
          client: guild.client,
          guild,
          room,
          actorId: currentUserId(req),
          actorName: req.session.user.username,
        });
    res.json({ ok: true, userId: entry.userId });
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/rooms/:roomId/waiting', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const requests = await prisma.waitingRequest.findMany({
      where: { roomId: room.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const nameMap = await namesFor(requests.map((request) => request.userId));
    res.json(requests.map((request) => ({ ...request, name: nameMap.get(request.userId) ?? request.userId })));
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/rooms/:roomId/waiting/:requestId', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const accept = Boolean(req.body?.accept);
    const result = await resolveWaitingRequest({
      client: guild.client,
      guild,
      room,
      requestId: req.params.requestId,
      accept,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/rooms/:roomId/events', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const room = await loadRoom(req.guildContext, req.params.roomId);
    res.json(await listRoomEvents(room.id));
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/rooms/:roomId/events', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const input = roomEventInputSchema.parse(req.body);
    const event = await createRoomEvent({
      client: guild.client,
      guild,
      room,
      creator: { id: req.session.user.id, username: req.session.user.username },
      input,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    res.status(201).json(event);
  } catch (error) {
    next(error);
  }
});

router.delete('/:guildId/rooms/:roomId/events/:eventId', guildAccess({ admin: true }), async (req, res, next) => {
  try {
    const guild = requireBot(req);
    const room = await loadRoom(req.guildContext, req.params.roomId);
    const event = await prisma.roomEvent.findFirst({
      where: { id: req.params.eventId, roomId: room.id, guildId: room.guildId },
    });
    if (!event) throw new NotFoundError('Event not found.');
    await cancelRoomEvent({
      client: guild.client,
      event,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
