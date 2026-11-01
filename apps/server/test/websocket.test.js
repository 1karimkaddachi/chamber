import { once } from 'node:events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import prisma from '@chamber/db';
import { createHttpServer } from '../src/api/app.js';
import { publish } from '../src/lib/events.js';
import { resetDatabase, seedGuild, GUILD_ID } from './helpers.js';

let app;
let server;
let sessionStore;
let port;

beforeAll(async () => {
  const created = createHttpServer();
  app = created.app;
  server = created.server;
  sessionStore = created.sessionStore;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

beforeEach(async () => {
  await resetDatabase();
  await seedGuild();
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  sessionStore?.close?.();
  await prisma.$disconnect();
});

function createMessageQueue(socket) {
  const buffered = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.type === message.type);
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    buffered.push(message);
  });
  return {
    wait(type, timeout = 5000) {
      const index = buffered.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(buffered.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.resolve === resolve);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`Timed out waiting for ${type}`));
        }, timeout);
        waiters.push({ type, resolve, timer });
      });
    },
  };
}

async function loginCookie() {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/dev-login').expect(200);
  return response.headers['set-cookie'][0].split(';')[0];
}

describe('realtime WebSocket', () => {
  it('authenticates with the session cookie and broadcasts guild events', async () => {
    const cookie = await loginCookie();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?guildId=${GUILD_ID}`, {
      headers: { Cookie: cookie },
    });
    const queue = createMessageQueue(socket);
    await once(socket, 'open');
    const hello = await queue.wait('hello');
    expect(hello.data.guildId).toBe(GUILD_ID);

    publish('config.updated', { guildId: GUILD_ID, config: { queueMaxSize: 9 } });
    const message = await queue.wait('config.updated');
    expect(message.data.config.queueMaxSize).toBe(9);

    publish('config.updated', { guildId: '900000000000000999', config: {} });
    await expect(queue.wait('config.updated', 200)).rejects.toThrow(/Timed out/);
    socket.close();
    await once(socket, 'close');
  });

  it('rejects sockets without an authenticated session', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?guildId=${GUILD_ID}`);
    const [error] = await once(socket, 'error');
    expect(error).toBeTruthy();
  });

  it('rejects sessions without access to the guild', async () => {
    const cookie = await loginCookie();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?guildId=900000000000000999`, {
      headers: { Cookie: cookie },
    });
    const [error] = await once(socket, 'error');
    expect(error).toBeTruthy();
  });
});
