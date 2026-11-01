import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import prisma from '@chamber/db';
import { createRoom, getRoomById } from '../src/services/roomService.js';
import { setClient } from '../src/lib/botState.js';
import { cv2Payload } from '../src/lib/ui.js';
import {
  controlPanel,
  membersPanel,
  privacyPanel,
  queuePanel,
  settingsPanel,
  statsPanel,
} from '../src/bot/panels.js';
import { handleButton, handleModal, handleSelectMenu } from '../src/bot/interactions.js';
import {
  GUILD_ID,
  OWNER_ID,
  createFakeWorld,
  makeMember,
  resetDatabase,
  seedGuild,
  seedTemplate,
  seedTrigger,
} from './helpers.js';

const STRANGER_ID = '100000000000000007';

const SPEC_ROWS = [
  ['Rename', 'User Limit', 'Lock', 'Unlock'],
  ['Hide', 'Reveal', 'Invite', 'Kick'],
  ['Transfer', 'Clone', 'Queue', 'Privacy'],
  ['Members', 'Settings', 'Statistics', 'Refresh'],
  ['Delete Room'],
];

function jsonOf(component) {
  return typeof component?.toJSON === 'function' ? component.toJSON() : component;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  visit(node);
  for (const value of Object.values(node)) walk(value, visit);
}

function actionButtons(container) {
  const found = [];
  walk(jsonOf(container), (node) => {
    if (node.type === 2 && typeof node.custom_id === 'string') found.push(node);
  });
  return found;
}

function panelText(...containers) {
  let text = '';
  for (const container of containers) {
    walk(jsonOf(container), (node) => {
      if (node.type === 10 && typeof node.content === 'string') text += `\n${node.content}`;
    });
  }
  return text;
}

function payloadText(payload) {
  return panelText(...(payload.components ?? []));
}

function makeInteraction(world, member, init = {}) {
  const interaction = {
    guild: world.guild,
    channel: world.lobby,
    member,
    user: member.user,
    customId: init.customId ?? '',
    values: init.values ?? [],
    deferred: false,
    replied: false,
    acknowledged: false,
    responses: [],
    modals: [],
    isButton: () => true,
    isAnySelectMenu: () => true,
    isModalSubmit: () => true,
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
      interaction.acknowledged = true;
    }),
    deferUpdate: vi.fn(async () => {
      interaction.deferred = true;
      interaction.acknowledged = true;
    }),
    reply: vi.fn(async (payload) => {
      interaction.replied = true;
      interaction.acknowledged = true;
      interaction.responses.push(payload);
      return { id: 'interaction-response', payload };
    }),
    editReply: vi.fn(async (payload) => {
      interaction.responses.push(payload);
      return { payload };
    }),
    followUp: vi.fn(async (payload) => {
      interaction.responses.push(payload);
      return { payload };
    }),
    update: vi.fn(async (payload) => {
      interaction.acknowledged = true;
      interaction.responses.push(payload);
      return { payload };
    }),
    showModal: vi.fn(async (modal) => {
      interaction.acknowledged = true;
      interaction.modals.push(modal);
    }),
    react: vi.fn(async () => undefined),
  };
  if (init.fields) {
    interaction.fields = { getTextInputValue: (key) => init.fields[key] };
  }
  return interaction;
}

async function dispatch(world, member, customId, init = {}) {
  const interaction = makeInteraction(world, member, { ...init, customId });
  if (init.fields) await handleModal(interaction);
  else if (init.values) await handleSelectMenu(interaction);
  else await handleButton(interaction);
  return interaction;
}

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

let world;
let guild;
let owner;
let stranger;
let triggerRow;
let room;

beforeEach(async () => {
  await resetDatabase();
  await seedGuild();
  world = createFakeWorld();
  guild = world.guild;
  owner = makeMember(guild, { id: OWNER_ID, username: 'Owner', channelId: world.trigger.id });
  stranger = makeMember(guild, { id: STRANGER_ID, username: 'Stranger' });
  triggerRow = await seedTrigger(GUILD_ID, world.trigger, world.category);
  const template = await seedTemplate(GUILD_ID);
  await prisma.guildConfig.update({
    where: { guildId: GUILD_ID },
    data: { lobbyChannelId: world.lobby.id, defaultTemplateId: template.id },
  });
  setClient(world.client);
  room = await createRoom({
    guild,
    ownerMember: owner,
    trigger: triggerRow,
    config: await prisma.guildConfig.findUnique({ where: { guildId: GUILD_ID } }),
  });
});

describe('Components V2 message contract', () => {
  it('never uses Discord embeds anywhere in the bot or services', () => {
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const offenders = sourceFiles(srcDir)
      .filter((file) => /EmbedBuilder|setEmbeds|addEmbeds|embeds\s*:/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(srcDir, file));
    expect(offenders).toEqual([]);
  });

  it('lays the control panel out in the five specified button rows', () => {
    const container = controlPanel(room);
    const rows = jsonOf(container).components.filter((component) => component.type === 1);
    expect(rows.map((row) => row.components.map((component) => component.label))).toEqual(SPEC_ROWS);
    expect(JSON.stringify(jsonOf(container))).not.toContain('embeds');
  });

  it('flags panel payloads as Components V2', () => {
    const payload = cv2Payload(controlPanel(room));
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.embeds).toBeUndefined();
  });
});

describe('control panel interactions', () => {
  it('answers every button instead of leaving it decorative', async () => {
    const actions = actionButtons(controlPanel(room)).map((button) => button.custom_id);
    expect(actions).toHaveLength(17);
    const silent = [];
    for (const customId of actions) {
      const interaction = await dispatch(world, owner, customId);
      if (!interaction.acknowledged) silent.push(customId);
    }
    expect(silent).toEqual([]);
  });

  it('completes every control panel action without an error panel', async () => {
    const failures = [];
    for (const button of actionButtons(controlPanel(room))) {
      const interaction = await dispatch(world, owner, button.custom_id);
      const text = interaction.responses.map(payloadText).join('\n');
      if (text.includes('⚠️')) failures.push(`${button.label}: ${text.trim().split('\n')[0]}`);
    }
    expect(failures).toEqual([]);
  });

  it('locks, hides and reveals the room for real', async () => {
    const F = PermissionFlagsBits;
    const everyone = (channel) => channel.lastOverwrites.find((overwrite) => overwrite.id === guild.id);
    const cases = [
      ['lock', { locked: true, hidden: false }, (entry) => entry.deny.includes(F.Connect)],
      ['unlock', { locked: false, hidden: false }, (entry) => entry.allow.includes(F.Connect)],
      ['hide', { locked: false, hidden: true }, (entry) => entry.deny.includes(F.ViewChannel)],
      ['reveal', { locked: false, hidden: false }, (entry) => entry.allow.includes(F.ViewChannel)],
    ];
    for (const [action, expected, check] of cases) {
      await dispatch(world, owner, `room:${action}:${room.id}`);
      const stored = await prisma.activeRoom.findUnique({ where: { id: room.id } });
      expect(stored.locked, action).toBe(expected.locked);
      expect(stored.hidden, action).toBe(expected.hidden);
      const overwrite = everyone(guild.channels.cache.get(room.channelId));
      expect(overwrite, action).toBeTruthy();
      expect(check(overwrite), action).toBe(true);
    }
  });

  it('renames through the modal and updates both Discord and the database', async () => {
    const modal = await dispatch(world, owner, `room:rename:${room.id}`);
    expect(modal.modals).toHaveLength(1);
    expect(jsonOf(modal.modals[0]).custom_id).toBe(`modal:rename:${room.id}`);

    const applied = await dispatch(world, owner, `modal:rename:${room.id}`, { fields: { name: 'Night Studio' } });
    expect(payloadText(applied.responses[0])).toContain('Renamed to **Night Studio**');
    const stored = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(stored.name).toBe('Night Studio');
    expect(guild.channels.cache.get(room.channelId).name).toBe('Night Studio');
  });

  it('applies the user limit modal and rejects impossible values', async () => {
    await dispatch(world, owner, `modal:limit:${room.id}`, { fields: { limit: '12' } });
    const stored = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(stored.userLimit).toBe(12);
    expect(guild.channels.cache.get(room.channelId).userLimit).toBe(12);

    const rejected = await dispatch(world, owner, `modal:limit:${room.id}`, { fields: { limit: 'abc' } });
    expect(payloadText(rejected.responses.at(-1))).toContain('⚠️');
    const unchanged = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(unchanged.userLimit).toBe(12);
  });

  it('clones the room into a second live room', async () => {
    const cloned = await dispatch(world, owner, `room:clone:${room.id}`);
    expect(payloadText(cloned.responses.at(-1))).toContain('Room cloned');
    const active = await prisma.activeRoom.findMany({ where: { guildId: GUILD_ID, status: 'ACTIVE' } });
    expect(active).toHaveLength(2);
    expect(active.map((entry) => entry.ownerId)).toEqual([OWNER_ID, OWNER_ID]);
  });

  it('opens member pickers, panels and statistics from the panel', async () => {
    const invite = await dispatch(world, owner, `room:invite:${room.id}`);
    expect(payloadText(invite.responses[0])).toContain('Invite a member');

    const kick = await dispatch(world, owner, `room:kick:${room.id}`);
    expect(payloadText(kick.responses[0])).toContain('Remove a member');

    const transfer = await dispatch(world, owner, `room:transfer:${room.id}`);
    expect(payloadText(transfer.responses[0])).toContain('Transfer ownership');

    const members = await dispatch(world, owner, `room:members:${room.id}`);
    expect(payloadText(members.responses[0])).toContain(`Members · ${room.name}`);

    const stats = await dispatch(world, owner, `room:stats:${room.id}`);
    expect(payloadText(stats.responses[0])).toContain(`Statistics · ${room.name}`);
    expect(payloadText(stats.responses[0])).toContain('Total joins');

    const settings = await dispatch(world, owner, `room:settings:${room.id}`);
    expect(payloadText(settings.responses[0])).toContain(`Settings · ${room.name}`);

    const queue = await dispatch(world, owner, `room:queue:${room.id}`);
    expect(payloadText(queue.responses[0])).toContain('The queue is empty');

    const privacy = await dispatch(world, owner, `room:privacy:${room.id}`);
    expect(payloadText(privacy.responses[0])).toContain('Password protection is verified by the bot');

    const deletion = await dispatch(world, owner, `room:delete:${room.id}`);
    expect(payloadText(deletion.responses[0])).toContain('Delete');
    const stillActive = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(stillActive.status).toBe('ACTIVE');
  });

  it('cancels a pending confirmation without touching the room', async () => {
    const cancelled = await dispatch(world, owner, `cancel:${room.id}`);
    expect(payloadText(cancelled.responses[0])).toContain('No changes were made.');
    const stored = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(stored.status).toBe('ACTIVE');
  });

  it('refuses controls from members who do not own or moderate the room', async () => {
    for (const action of ['privacy', 'settings', 'delete', 'transfer', 'clone']) {
      const interaction = await dispatch(world, stranger, `room:${action}:${room.id}`);
      const text = interaction.responses.map(payloadText).join('\n');
      expect(text, action).toContain('⚠️');
      expect(text, action).toMatch(/owner|staff|room/i);
    }
    const stored = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(stored.status).toBe('ACTIVE');
    expect(stored.locked).toBe(false);
  });

  it('answers every secondary panel button', async () => {
    const panels = [
      settingsPanel(room, { aiEnabled: false }),
      membersPanel(room, { liveMembers: [] }),
      privacyPanel(room),
      queuePanel(room, { entries: [] }),
      statsPanel(room, { history: [] }),
    ];
    const ids = panels
      .flatMap((container) => actionButtons(container).map((button) => button.custom_id))
      // "Admit next" is rendered disabled while the queue is empty, so its error is expected state.
      .filter((customId) => !customId.startsWith('queue:admit'));
    expect(ids.length).toBeGreaterThan(10);
    const silent = [];
    for (const customId of ids) {
      const interaction = await dispatch(world, owner, customId);
      if (!interaction.acknowledged) silent.push(customId);
    }
    expect(silent).toEqual([]);
  });
});

describe('password privacy mode', () => {
  it('shows a badge while the password is missing and clears it after the modal', async () => {
    await prisma.activeRoom.update({ where: { id: room.id }, data: { privacy: 'PASSWORD', passwordHash: null } });
    const pending = await getRoomById(room.id);
    expect(panelText(controlPanel(pending))).toContain('Waiting for you to set a password');

    const modal = await dispatch(world, owner, `sel:privacy:${room.id}`, { values: ['PASSWORD'] });
    expect(jsonOf(modal.modals[0]).custom_id).toBe(`modal:privacy-password:${room.id}`);

    const set = await dispatch(world, owner, `modal:privacy-password:${room.id}`, { fields: { password: 'st4rlab!' } });
    expect(payloadText(set.responses[0])).toContain('Password set');

    const stored = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(stored.privacy).toBe('PASSWORD');
    expect(stored.passwordHash).not.toBeNull();
    expect(stored.passwordHash).not.toContain('st4rlab!');
    expect(panelText(controlPanel(await getRoomById(room.id)))).not.toContain('Waiting for you to set a password');
  });

  it('changes privacy modes from the select menu and syncs Discord', async () => {
    const F = PermissionFlagsBits;
    const applied = await dispatch(world, owner, `sel:privacy:${room.id}`, { values: ['PRIVATE'] });
    expect(applied.acknowledged).toBe(true);
    const stored = await prisma.activeRoom.findUnique({ where: { id: room.id } });
    expect(stored.privacy).toBe('PRIVATE');
    const everyone = guild.channels
      .cache.get(room.channelId)
      .lastOverwrites.find((overwrite) => overwrite.id === guild.id);
    expect(everyone.deny).toContain(F.ViewChannel);
    expect(everyone.deny).toContain(F.Connect);
    const ownerOverwrite = guild.channels
      .cache.get(room.channelId)
      .lastOverwrites.find((overwrite) => overwrite.id === OWNER_ID);
    expect(ownerOverwrite.allow).toContain(F.Connect);
  });
});
