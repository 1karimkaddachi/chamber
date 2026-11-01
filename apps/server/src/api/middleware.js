import crypto from 'node:crypto';
import prisma from '@chamber/db';
import config from '../config.js';
import { getClient, isBotOnline } from '../lib/botState.js';
import { AppError, BotOfflineError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { isSnowflake } from '../lib/discord.js';
import { computeAccess, ensureConfig, getGuildBundle } from '../services/guildService.js';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function ensureCsrf(req) {
  if (!req.session) return null;
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

export function requireAuth(req, _res, next) {
  if (!req.session?.user) {
    return next(new AppError('Authentication required.', { status: 401, code: 'UNAUTHENTICATED' }));
  }
  next();
}

export function originCheck(req, _res, next) {
  if (!MUTATING.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const self = `${req.protocol}://${req.get('host')}`;
  const allowed = new Set([
    config.webOrigin,
    self,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
  ]);
  if (!allowed.has(origin)) {
    return next(new ForbiddenError('Request origin is not allowed.'));
  }
  next();
}

export function csrfProtection(req, _res, next) {
  if (!MUTATING.has(req.method)) return next();
  const exempt = ['/auth/login', '/auth/callback', '/auth/dev-login'];
  if (exempt.some((path) => req.path === path || req.path.endsWith(path))) return next();
  const expected = req.session?.csrfToken;
  const provided = req.get('x-csrf-token');
  if (!expected || !provided) {
    return next(new ForbiddenError('Missing CSRF token. Refresh the dashboard and try again.'));
  }
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new ForbiddenError('Invalid CSRF token. Refresh the dashboard and try again.'));
  }
  next();
}

function sessionGuildAccess(req, guildId) {
  const entry = req.session?.guilds?.find((guild) => guild.id === guildId) ?? null;
  const isDevGuild = config.devAuth && config.devUser.guildId === guildId;
  return {
    entry,
    admin: Boolean(entry?.admin || isDevGuild),
    staff: Boolean(entry?.admin || entry?.staff || isDevGuild),
  };
}

export async function resolveGuildContext(req, guildId, { admin = false, staff = false } = {}) {
  if (!isSnowflake(guildId)) throw new AppError('Invalid guild ID.');
  const bundle = await getGuildBundle(guildId);
  if (!bundle) throw new NotFoundError('This server is not registered with Chamber.');
  const configRow = bundle.config ?? (await ensureConfig(guildId));

  let discordGuild = null;
  let access = null;
  let member = null;
  let botOnline = false;

  if (isBotOnline()) {
    const client = getClient();
    discordGuild = client.guilds.cache.get(guildId) ?? null;
    if (discordGuild) {
      botOnline = true;
      member = await discordGuild.members.fetch(req.session.user.id).catch(() => null);
      if (!member) throw new ForbiddenError('You are not a member of this server.');
      access = computeAccess(member, configRow, discordGuild);
    }
  }

  if (!access) {
    const sessionAccess = sessionGuildAccess(req, guildId);
    if (!sessionAccess.entry && !sessionAccess.admin) {
      throw new ForbiddenError('You do not have access to this server.');
    }
    access = {
      owner: Boolean(sessionAccess.entry?.owner),
      admin: sessionAccess.admin,
      staff: sessionAccess.staff,
    };
  }

  if (admin && !access.admin) throw new ForbiddenError('Server administrator access is required.');
  if (staff && !access.staff) throw new ForbiddenError('Staff access is required.');

  return {
    guild: bundle.guild,
    config: configRow,
    access,
    member,
    discordGuild,
    botOnline,
  };
}

export function guildAccess(options = {}) {
  return async (req, _res, next) => {
    try {
      req.guildContext = await resolveGuildContext(req, req.params.guildId, options);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireBot(req) {
  const context = req.guildContext;
  if (!context?.discordGuild || !context?.botOnline) {
    throw new BotOfflineError();
  }
  return context.discordGuild;
}

export function currentUserId(req) {
  return req.session.user.id;
}

export async function ensureUserPreference(userId) {
  return prisma.dashboardPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export default {
  ensureCsrf,
  requireAuth,
  originCheck,
  csrfProtection,
  resolveGuildContext,
  guildAccess,
  requireBot,
};
