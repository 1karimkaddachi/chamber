import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import prisma from '@chamber/db';
import { roomUpdateSchema } from '@chamber/shared';
import { createHttpServer } from '../src/api/app.js';
import { uploadsDir } from '../src/api/routes/uploads.js';
import {
  resetDatabase,
  seedGuild,
  GUILD_ID,
  OWNER_ID,
} from './helpers.js';

let app;
let sessionStore;

beforeAll(() => {
  const server = createHttpServer();
  app = server.app;
  sessionStore = server.sessionStore;
});

beforeEach(async () => {
  await resetDatabase();
  await seedGuild();
});

afterAll(async () => {
  sessionStore?.close?.();
  await prisma.$disconnect();
});

async function login() {
  const agent = request.agent(app);
  await agent.post('/api/auth/dev-login').expect(200);
  const me = await agent.get('/api/me').expect(200);
  return { agent, me: me.body };
}

describe('dashboard API', () => {
  it('exposes public meta and health', async () => {
    const meta = await request(app).get('/api/meta').expect(200);
    expect(meta.body.devAuth).toBe(true);
    expect(meta.body.appName).toBe('Chamber');
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.database).toBe('ok');
    expect(health.body.bot.online).toBe(false);
  });

  it('rejects unauthenticated guild access', async () => {
    await request(app).get(`/api/guilds/${GUILD_ID}`).expect(401);
  });

  it('logs in, returns a CSRF token and enforces CSRF', async () => {
    const { agent, me } = await login();
    expect(me.user.id).toBe(OWNER_ID);
    expect(me.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(me.guilds.some((guild) => guild.id === GUILD_ID)).toBe(true);

    await agent.patch(`/api/guilds/${GUILD_ID}/config`).send({ queueMaxSize: 9 }).expect(403);
    await agent
      .patch(`/api/guilds/${GUILD_ID}/config`)
      .set('x-csrf-token', 'wrong')
      .send({ queueMaxSize: 9 })
      .expect(403);

    const updated = await agent
      .patch(`/api/guilds/${GUILD_ID}/config`)
      .set('x-csrf-token', me.csrfToken)
      .send({ queueMaxSize: 9 })
      .expect(200);
    expect(updated.body.queueMaxSize).toBe(9);
    const stored = await prisma.guildConfig.findUnique({ where: { guildId: GUILD_ID } });
    expect(stored.queueMaxSize).toBe(9);
  });

  it('preserves arrays and flags during partial configuration updates', async () => {
    const { agent, me } = await login();
    const staff = ['123456789012345678'];
    const admin = ['223456789012345678'];
    const priority = ['323456789012345678'];
    await agent
      .patch(`/api/guilds/${GUILD_ID}/config`)
      .set('x-csrf-token', me.csrfToken)
      .send({ staffRoleIds: staff, adminRoleIds: admin, queuePriorityRoleIds: priority })
      .expect(200);
    await agent
      .patch(`/api/guilds/${GUILD_ID}/config`)
      .set('x-csrf-token', me.csrfToken)
      .send({ queueMaxSize: 11 })
      .expect(200);
    const stored = await prisma.guildConfig.findUnique({ where: { guildId: GUILD_ID } });
    expect(stored.staffRoleIds).toEqual(staff);
    expect(stored.adminRoleIds).toEqual(admin);
    expect(stored.queuePriorityRoleIds).toEqual(priority);
    expect(stored.queueMaxSize).toBe(11);

    const trigger = await agent
      .post(`/api/guilds/${GUILD_ID}/triggers`)
      .set('x-csrf-token', me.csrfToken)
      .send({ channelId: '423456789012345678', name: 'Trigger', enabled: false })
      .expect(201);
    await agent
      .patch(`/api/guilds/${GUILD_ID}/triggers/${trigger.body.id}`)
      .set('x-csrf-token', me.csrfToken)
      .send({ name: 'Renamed trigger' })
      .expect(200);
    const storedTrigger = await prisma.triggerChannel.findUnique({ where: { id: trigger.body.id } });
    expect(storedTrigger.enabled).toBe(false);
    expect(storedTrigger.name).toBe('Renamed trigger');

    const category = await agent
      .post(`/api/guilds/${GUILD_ID}/categories`)
      .set('x-csrf-token', me.csrfToken)
      .send({ categoryId: '523456789012345678', name: 'Category', maxRooms: 5, enabled: false })
      .expect(201);
    await agent
      .patch(`/api/guilds/${GUILD_ID}/categories/${category.body.id}`)
      .set('x-csrf-token', me.csrfToken)
      .send({ name: 'Renamed category' })
      .expect(200);
    const storedCategory = await prisma.voiceCategory.findUnique({ where: { id: category.body.id } });
    expect(storedCategory.maxRooms).toBe(5);
    expect(storedCategory.enabled).toBe(false);
  });

  it('rejects cross-origin mutations', async () => {
    const { agent, me } = await login();
    await agent
      .patch(`/api/guilds/${GUILD_ID}/config`)
      .set('Origin', 'https://evil.example')
      .set('x-csrf-token', me.csrfToken)
      .send({ queueMaxSize: 9 })
      .expect(403);
  });

  it('validates configuration payloads', async () => {
    const { agent, me } = await login();
    const response = await agent
      .patch(`/api/guilds/${GUILD_ID}/config`)
      .set('x-csrf-token', me.csrfToken)
      .send({ emptyGraceSeconds: 1 })
      .expect(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('performs template CRUD through validated routes', async () => {
    const { agent, me } = await login();
    const created = await agent
      .post(`/api/guilds/${GUILD_ID}/templates`)
      .set('x-csrf-token', me.csrfToken)
      .send({
        name: 'API Template',
        description: 'Created from the API test',
        emoji: '🧪',
        accentColor: '#7c6cff',
        roomTypeKey: 'gaming',
        defaultPrivacy: 'PRIVATE',
        defaultLimit: 4,
        defaultBitrate: 96000,
        roomNameRule: "{user}'s API room",
        allowedRoleIds: [],
      })
      .expect(201);
    expect(created.body.slug).toBe('api-template');
    const templateId = created.body.id;

    const list = await agent.get(`/api/guilds/${GUILD_ID}/templates`).expect(200);
    expect(list.body.some((template) => template.id === templateId)).toBe(true);

    const duplicated = await agent
      .post(`/api/guilds/${GUILD_ID}/templates/${templateId}/duplicate`)
      .set('x-csrf-token', me.csrfToken)
      .expect(201);
    expect(duplicated.body.name).toContain('copy');

    await agent
      .delete(`/api/guilds/${GUILD_ID}/templates/${templateId}`)
      .set('x-csrf-token', me.csrfToken)
      .expect(200);
    expect(await prisma.roomTemplate.findUnique({ where: { id: templateId } })).toBeNull();
  });

  it('returns guild overview, premium and empty live collections', async () => {
    const { agent } = await login();
    const overview = await agent.get(`/api/guilds/${GUILD_ID}/overview?range=7d`).expect(200);
    expect(overview.body.series).toHaveLength(7);
    expect(overview.body.counts.activeRooms).toBe(0);
    const premium = await agent.get(`/api/guilds/${GUILD_ID}/premium`).expect(200);
    expect(premium.body.selfHosted).toBe(true);
    const rooms = await agent.get(`/api/guilds/${GUILD_ID}/rooms`).expect(200);
    expect(rooms.body).toEqual([]);
    const queues = await agent.get(`/api/guilds/${GUILD_ID}/queues`).expect(200);
    expect(queues.body).toEqual([]);
    const channels = await agent.get(`/api/guilds/${GUILD_ID}/channels`).expect(200);
    expect(channels.body.offline).toBe(true);
  });

  it('refuses live room operations while the bot is offline', async () => {
    const { agent, me } = await login();
    const room = await prisma.activeRoom.create({
      data: {
        guildId: GUILD_ID,
        channelId: '123456789012345678',
        ownerId: OWNER_ID,
        name: 'Offline room',
        privacy: 'PUBLIC',
      },
    });
    const detail = await agent.get(`/api/guilds/${GUILD_ID}/rooms/${room.id}`).expect(200);
    expect(detail.body.name).toBe('Offline room');
    await agent
      .patch(`/api/guilds/${GUILD_ID}/rooms/${room.id}`)
      .set('x-csrf-token', me.csrfToken)
      .send({ name: 'Renamed offline' })
      .expect(409);
    await agent
      .delete(`/api/guilds/${GUILD_ID}/rooms/${room.id}`)
      .set('x-csrf-token', me.csrfToken)
      .expect(409);
  });

  it('blocks guilds that are not in the session', async () => {
    const { agent } = await login();
    await prisma.guild.create({ data: { id: '900000000000000777', name: 'Other Guild' } });
    await agent.get('/api/guilds/900000000000000777').expect(403);
  });

  it('records audit entries for API mutations', async () => {
    const { agent, me } = await login();
    await agent
      .patch(`/api/guilds/${GUILD_ID}/config`)
      .set('x-csrf-token', me.csrfToken)
      .send({ queueMaxSize: 7 })
      .expect(200);
    const logs = await agent.get(`/api/guilds/${GUILD_ID}/logs?page=1`).expect(200);
    expect(logs.body.items.some((log) => log.action === 'config.updated')).toBe(true);
  });
});

describe('room banner uploads', () => {
  // A 1x1 transparent PNG, used so the byte-signature check has real input.
  const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const createdFiles = [];

  afterEach(async () => {
    await Promise.all(createdFiles.map((file) => fs.promises.rm(file, { force: true })));
    createdFiles.length = 0;
  });

  it('stores an accepted image, serves it and audits the upload', async () => {
    const { agent, me } = await login();
    const upload = await agent
      .post(`/api/guilds/${GUILD_ID}/uploads`)
      .set('x-csrf-token', me.csrfToken)
      .send({ data: PNG_BASE64, mimeType: 'image/png' })
      .expect(201);

    expect(upload.body.url).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]{16}\.png$/);
    const storedFile = path.join(uploadsDir, path.basename(upload.body.url));
    createdFiles.push(storedFile);
    expect(fs.existsSync(storedFile)).toBe(true);

    const served = await request(app).get(upload.body.url).responseType('blob').expect(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.body.toString('base64')).toBe(PNG_BASE64);

    const logs = await agent.get(`/api/guilds/${GUILD_ID}/logs?page=1`).expect(200);
    expect(logs.body.items.some((log) => log.action === 'upload.created')).toBe(true);
  });

  it('rejects payloads that are not an allowed image', async () => {
    const { agent, me } = await login();
    const post = (body) =>
      agent.post(`/api/guilds/${GUILD_ID}/uploads`).set('x-csrf-token', me.csrfToken).send(body);

    await post({ data: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'), mimeType: 'image/png' }).expect(
      415,
    );
    await post({ data: PNG_BASE64, mimeType: 'image/gif' }).expect(403);
    await post({ data: `${'A'.repeat(40)}!!!`, mimeType: 'image/png' }).expect(422);
    await post({ data: PNG_BASE64, mimeType: 'image/svg+xml' }).expect(422);
  });

  it('refuses anonymous and CSRF-token-less uploads before touching the disk', async () => {
    // The CSRF guard runs ahead of requireAuth, so an anonymous POST is refused
    // with 403 rather than 401. Either way no file is written.
    const listing = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).sort() : []);
    const before = listing();

    const anonymous = await request(app)
      .post(`/api/guilds/${GUILD_ID}/uploads`)
      .send({ data: PNG_BASE64, mimeType: 'image/png' });
    expect([401, 403]).toContain(anonymous.status);

    const { agent } = await login();
    await agent.post(`/api/guilds/${GUILD_ID}/uploads`).send({ data: PNG_BASE64, mimeType: 'image/png' }).expect(403);
    expect(listing()).toEqual(before);
  });

  it('accepts only http(s) URLs or paths this server uploaded', () => {
    const uploaded = roomUpdateSchema.parse({ bannerUrl: '/api/uploads/abcdefghijklmnop.png' });
    expect(uploaded.bannerUrl).toBe('/api/uploads/abcdefghijklmnop.png');
    expect(roomUpdateSchema.parse({ bannerUrl: 'https://cdn.example.com/banner.png' }).bannerUrl).toBe(
      'https://cdn.example.com/banner.png',
    );
    expect(roomUpdateSchema.parse({ bannerUrl: null }).bannerUrl).toBeNull();
    expect(() => roomUpdateSchema.parse({ bannerUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => roomUpdateSchema.parse({ bannerUrl: 'data:text/html;base64,PHNjcmlwdD4=' })).toThrow();
    expect(() => roomUpdateSchema.parse({ bannerUrl: '/api/uploads/../../.env' })).toThrow();
  });
});
