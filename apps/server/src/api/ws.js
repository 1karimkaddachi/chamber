import cookie from 'cookie';
import signature from 'cookie-signature';
import { WebSocketServer } from 'ws';
import config from '../config.js';
import { logger } from '../logger.js';
import { getBotState } from '../lib/botState.js';
import { onDomainEvent } from '../lib/events.js';

function sessionFromRequest(req, store) {
  return new Promise((resolve) => {
    try {
      const parsed = cookie.parse(req.headers.cookie || '');
      const raw = parsed[config.session.name];
      if (!raw) return resolve(null);
      const sid = raw.startsWith('s:') ? signature.unsign(raw.slice(2), config.session.secret) : false;
      if (!sid) return resolve(null);
      store.get(sid, (error, session) => {
        if (error || !session?.user) return resolve(null);
        resolve(session);
      });
    } catch {
      resolve(null);
    }
  });
}

function canAccessGuild(session, guildId) {
  if (!guildId) return false;
  if (config.devAuth && config.devUser.guildId === guildId) return true;
  return Boolean(session.guilds?.some((guild) => guild.id === guildId));
}

export function attachWebSocket(server, store) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  server.on('upgrade', async (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const session = await sessionFromRequest(req, store);
    if (!session) {
      socket.destroy();
      return;
    }
    const guildId = url.searchParams.get('guildId');
    if (!canAccessGuild(session, guildId)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.guildId = guildId;
      ws.session = session;
      clients.add(ws);
      ws.send(JSON.stringify({ type: 'hello', data: { bot: getBotState(), guildId } }));

      ws.on('pong', () => {
        ws.isAlive = true;
      });
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
          if (message.type === 'subscribe' && canAccessGuild(ws.session, message.guildId)) {
            ws.guildId = message.guildId;
            ws.send(JSON.stringify({ type: 'subscribed', guildId: message.guildId }));
          }
        } catch {
          // Ignore malformed client frames.
        }
      });
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    });
  });

  const unsubscribe = onDomainEvent(({ type, payload, at }) => {
    const guildId = payload?.guildId ?? payload?.room?.guildId ?? null;
    if (!guildId) return;
    const raw = JSON.stringify({ type, data: payload, at });
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.guildId !== guildId) continue;
      try {
        ws.send(raw);
      } catch (error) {
        logger.debug({ err: error }, 'WebSocket broadcast failed');
      }
    }
  });

  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        // ignore
      }
    }
  }, 30000);
  heartbeat.unref?.();

  return {
    wss,
    broadcastGuild(guildId, type, payload) {
      const raw = JSON.stringify({ type, data: payload, at: new Date().toISOString() });
      for (const ws of clients) {
        if (ws.readyState === ws.OPEN && ws.guildId === guildId) ws.send(raw);
      }
    },
    close() {
      clearInterval(heartbeat);
      unsubscribe();
      for (const ws of clients) ws.terminate();
      wss.close();
    },
  };
}

export default attachWebSocket;
