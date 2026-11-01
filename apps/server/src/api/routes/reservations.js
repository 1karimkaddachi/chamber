import express from 'express';
import { reservationInputSchema } from '@chamber/shared';
import prisma from '@chamber/db';
import { currentUserId, guildAccess } from '../middleware.js';
import { cancelReservation, createReservation, listReservations } from '../../services/reservationService.js';
import { listGuildEvents } from '../../services/eventService.js';
import { NotFoundError } from '../../lib/errors.js';

const router = express.Router();

router.get('/:guildId/reservations', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const reservations = await listReservations(req.guildContext.guild.id, {
      status,
      take: Math.min(Number(req.query.take) || 100, 200),
    });
    res.json(reservations);
  } catch (error) {
    next(error);
  }
});

router.post('/:guildId/reservations', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const input = reservationInputSchema.parse(req.body);
    const reservation = await createReservation({
      guildId: req.guildContext.guild.id,
      host: req.session.user,
      input,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
    });
    res.status(201).json(reservation);
  } catch (error) {
    next(error);
  }
});

router.delete('/:guildId/reservations/:reservationId', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const existing = await prisma.reservation.findFirst({
      where: { id: req.params.reservationId, guildId: req.guildContext.guild.id },
    });
    if (!existing) throw new NotFoundError('Reservation not found.');
    const reservation = await cancelReservation({
      guildId: req.guildContext.guild.id,
      id: existing.id,
      userId: currentUserId(req),
      canManage: req.guildContext.access.staff,
      actorName: req.session.user.username,
    });
    res.json(reservation);
  } catch (error) {
    next(error);
  }
});

router.get('/:guildId/events', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    res.json(await listGuildEvents(req.guildContext.guild.id));
  } catch (error) {
    next(error);
  }
});

export default router;
