import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { Prisma } from '@chamber/db';
import config from '../config.js';
import { logger } from '../logger.js';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { createSessionLayer } from './session.js';
import { csrfProtection, originCheck, requireAuth } from './middleware.js';
import { attachWebSocket } from './ws.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import guildRoutes from './routes/guilds.js';
import catalogRoutes from './routes/catalog.js';
import roomRoutes from './routes/rooms.js';
import reservationRoutes from './routes/reservations.js';
import analyticsRoutes from './routes/analytics.js';
import advancedRoutes from './routes/advanced.js';
import uploadRoutes, { uploadsDir } from './routes/uploads.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function createHttpServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: config.serveWeb
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'", 'ws:', 'wss:'],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  // Room banners are served straight from disk; filenames are random, so the
  // folder is readable without a session but not listable.
  app.use('/api/uploads', express.static(uploadsDir, { index: false, maxAge: '1d' }));

  // Base64 uploads need more headroom than the 1 MB JSON default, and this
  // parser runs first so body-parser skips the smaller one for this route.
  app.use('/api/guilds/:guildId/uploads', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  const { store, middleware: sessionMiddleware } = createSessionLayer();
  app.use(sessionMiddleware);

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 400,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again.' } },
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' } },
  });

  app.use('/api', apiLimiter);
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/auth', authLimiter);
  app.use('/api', originCheck);
  app.use('/api', csrfProtection);

  app.use('/api/auth', authRoutes);
  app.use('/api', metaRoutes);
  app.use('/api/guilds', requireAuth, guildRoutes);
  app.use('/api/guilds', requireAuth, catalogRoutes);
  app.use('/api/guilds', requireAuth, roomRoutes);
  app.use('/api/guilds', requireAuth, reservationRoutes);
  app.use('/api/guilds', requireAuth, analyticsRoutes);
  app.use('/api/guilds', requireAuth, advancedRoutes);
  app.use('/api/guilds', requireAuth, uploadRoutes);

  app.use('/api', (_req, _res, next) => next(new NotFoundError('API route not found.')));

  if (config.serveWeb) {
    const webDist = path.resolve(moduleDir, '../../../web/dist');
    const indexFile = path.join(webDist, 'index.html');
    if (fs.existsSync(indexFile)) {
      app.use(express.static(webDist, { index: false, maxAge: '1h' }));
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
        res.sendFile(indexFile);
      });
    } else {
      logger.warn({ webDist }, 'SERVE_WEB is enabled but the dashboard build was not found');
    }
  }

  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) return next(new NotFoundError('Not found.'));
    next();
  });

  app.use((error, req, res, _next) => {
    if (error instanceof ZodError) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid values.',
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record does not exist.' } });
      }
      if (error.code === 'P2002') {
        return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with those values already exists.' } });
      }
      if (error.code === 'P2003') {
        return res.status(409).json({ error: { code: 'CONFLICT', message: 'This record is still referenced elsewhere.' } });
      }
    }
    if (error instanceof AppError) {
      return res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details ?? null },
      });
    }
    logger.error({ err: error, path: req.path, method: req.method }, 'Unhandled API error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' },
    });
  });

  const server = http.createServer(app);
  const ws = attachWebSocket(server, store);

  server.on('close', () => ws.close());

  return { app, server, sessionStore: store, ws };
}

export default createHttpServer;
