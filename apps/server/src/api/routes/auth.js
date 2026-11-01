import crypto from 'node:crypto';
import express from 'express';
import prisma from '@chamber/db';
import config from '../../config.js';
import { getClient, isBotOnline } from '../../lib/botState.js';
import { logger } from '../../logger.js';
import { ensureCsrf, requireAuth } from '../middleware.js';
import { computeAccess, ensureConfig } from '../../services/guildService.js';
import { writeAudit } from '../../services/auditService.js';

const router = express.Router();

const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

function webRedirect(res, path = '/') {
  return res.redirect(`${config.webOrigin.replace(/\/$/, '')}${path}`);
}

function loginError(res, code) {
  return webRedirect(res, `/login?error=${encodeURIComponent(code)}`);
}

function randomState() {
  return crypto.randomBytes(24).toString('hex');
}

function regenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function iconUrl(guild) {
  return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128` : null;
}

function hasManagePermission(guild) {
  if (guild.owner) return true;
  try {
    const permissions = BigInt(guild.permissions || '0');
    return (permissions & MANAGE_GUILD) !== 0n || (permissions & ADMINISTRATOR) !== 0n;
  } catch {
    return false;
  }
}

async function discordFetch(path, accessToken) {
  const response = await fetch(`https://discord.com/api${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Discord API ${path} returned ${response.status}`);
  return response.json();
}

async function buildGuildSession(userId, oauthGuilds) {
  const entries = new Map();
  for (const guild of oauthGuilds) {
    if (!hasManagePermission(guild)) continue;
    entries.set(guild.id, {
      id: guild.id,
      name: guild.name,
      icon: iconUrl(guild),
      owner: Boolean(guild.owner),
      permissions: String(guild.permissions ?? '0'),
      admin: true,
      staff: true,
      botPresent: false,
    });
  }

  if (isBotOnline()) {
    const client = getClient();
    for (const guild of client.guilds.cache.values()) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        const configRow = await ensureConfig(guild.id);
        const access = computeAccess(member, configRow, guild);
        if (!access.admin && !access.staff) continue;
        const existing = entries.get(guild.id) ?? {
          id: guild.id,
          name: guild.name,
          icon: guild.iconURL({ size: 128 }),
          owner: guild.ownerId === userId,
          permissions: '0',
          admin: access.admin,
          staff: access.staff,
          botPresent: true,
        };
        existing.admin = access.admin;
        existing.staff = access.staff;
        existing.botPresent = true;
        entries.set(guild.id, existing);
      } catch (error) {
        logger.debug({ err: error, guildId: guild.id }, 'Guild access probe failed');
      }
    }
  }

  for (const entry of entries.values()) {
    await ensureGuildRecord({
      id: entry.id,
      name: entry.name,
      icon: entry.icon,
      botPresent: isBotOnline() ? Boolean(getClient()?.guilds?.cache?.has(entry.id)) : false,
    }).catch(() => null);
  }

  return [...entries.values()];
}

router.get('/login', (req, res) => {
  if (!config.discord.clientId || !config.discord.clientSecret) {
    logger.warn('OAuth login requested but Discord OAuth is not configured');
    return loginError(res, 'oauth_not_configured');
  }
  const state = randomState();
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    response_type: 'code',
    redirect_uri: config.discord.redirectUri,
    scope: 'identify guilds',
    state,
    prompt: 'consent',
  });
  req.session.save(() => {
    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });
});

router.get('/callback', async (req, res) => {
  try {
    if (req.query.error) return loginError(res, String(req.query.error));
    if (!config.discord.clientId || !config.discord.clientSecret) {
      return loginError(res, 'oauth_not_configured');
    }
    const state = String(req.query.state || '');
    if (!state || !req.session.oauthState || state !== req.session.oauthState) {
      return loginError(res, 'state_mismatch');
    }
    delete req.session.oauthState;
    const code = String(req.query.code || '');
    if (!code) return loginError(res, 'missing_code');

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.discord.redirectUri,
      }),
    });
    if (!tokenResponse.ok) {
      logger.warn({ status: tokenResponse.status }, 'OAuth token exchange failed');
      return loginError(res, 'token_exchange_failed');
    }
    const token = await tokenResponse.json();
    const [user, guilds] = await Promise.all([
      discordFetch('/users/@me', token.access_token),
      discordFetch('/users/@me/guilds', token.access_token),
    ]);

    const guildEntries = await buildGuildSession(user.id, guilds);
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        username: user.username,
        globalName: user.global_name ?? null,
        avatar: user.avatar ?? null,
      },
      update: {
        username: user.username,
        globalName: user.global_name ?? null,
        avatar: user.avatar ?? null,
      },
    });

    await regenerate(req);
    req.session.user = {
      id: user.id,
      username: user.username,
      globalName: user.global_name ?? null,
      avatar: user.avatar ?? null,
    };
    req.session.guilds = guildEntries;
    ensureCsrf(req);
    await saveSession(req);

    await writeAudit({
      actorId: user.id,
      actorName: user.username,
      action: 'auth.login',
      category: 'AUTH',
      metadata: { guilds: guildEntries.length },
      req,
    });
    logger.info({ userId: user.id, guilds: guildEntries.length }, 'Dashboard login');
    return webRedirect(res, '/');
  } catch (error) {
    logger.error({ err: error }, 'OAuth callback failed');
    return loginError(res, 'login_failed');
  }
});

router.post('/dev-login', async (req, res) => {
  if (!config.devAuth) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }
  try {
    const userId = config.devUser.id;
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, username: config.devUser.username },
      update: { username: config.devUser.username },
    });

    let devGuild = null;
    if (config.devUser.guildId) {
      devGuild = await prisma.guild.upsert({
        where: { id: config.devUser.guildId },
        create: { id: config.devUser.guildId, name: 'Chamber Development', botPresent: false },
        update: { botPresent: false },
      });
      await ensureConfig(devGuild.id);
    }

    const allGuilds = await prisma.guild.findMany({ take: 25, orderBy: { createdAt: 'asc' } });
    const entries = allGuilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner: true,
      permissions: '0',
      admin: true,
      staff: true,
      botPresent: false,
    }));

    await regenerate(req);
    req.session.user = { id: userId, username: config.devUser.username, globalName: config.devUser.username, avatar: null };
    req.session.guilds = entries;
    ensureCsrf(req);
    await saveSession(req);
    await writeAudit({
      actorId: userId,
      actorName: config.devUser.username,
      action: 'auth.login',
      category: 'AUTH',
      metadata: { mode: 'development', guilds: entries.length },
      req,
    });
    return res.json({ ok: true, guilds: entries.length });
  } catch (error) {
    logger.error({ err: error }, 'Dev login failed');
    return res.status(500).json({ error: { code: 'DEV_LOGIN_FAILED', message: 'Development login failed.' } });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  const user = req.session.user;
  await writeAudit({
    actorId: user.id,
    actorName: user.username,
    action: 'auth.logout',
    category: 'AUTH',
    req,
  });
  req.session.destroy((error) => {
    if (error) logger.warn({ err: error }, 'Session destroy failed');
    res.clearCookie(config.session.name, { path: '/' });
    res.json({ ok: true });
  });
});

export default router;
