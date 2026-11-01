import { describe, expect, it } from 'vitest';
import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import { buildOverwrites } from '../src/services/permissions.js';

const F = PermissionFlagsBits;
const baseRoom = {
  ownerId: 'owner',
  privacy: 'PUBLIC',
  locked: false,
  hidden: false,
  members: [{ userId: 'admin', role: 'ADMIN', tempAdminUntil: null }],
  permissions: [
    { targetType: 'USER', targetId: 'allowed', allowConnect: true, expiresAt: null },
    { targetType: 'ROLE', targetId: 'role1', allowConnect: true, expiresAt: null },
  ],
  bans: [{ userId: 'banned', expiresAt: null }],
};

function entry(overwrites, id, type) {
  return overwrites.find((overwrite) => overwrite.id === id && overwrite.type === type);
}

describe('permission overwrites', () => {
  it('keeps public rooms open and enforces bans, owner and bot access', () => {
    const overwrites = buildOverwrites(baseRoom, { everyoneRoleId: 'everyone', botId: 'bot' });
    const everyone = entry(overwrites, 'everyone', OverwriteType.Role);
    expect(everyone.allow).toContain(F.Connect);
    expect(everyone.allow).toContain(F.ViewChannel);
    expect(everyone.deny).not.toContain(F.Connect);

    const banned = entry(overwrites, 'banned', OverwriteType.Member);
    expect(banned.deny).toContain(F.Connect);
    expect(banned.deny).toContain(F.ViewChannel);

    const owner = entry(overwrites, 'owner', OverwriteType.Member);
    expect(owner.allow).toContain(F.Connect);
    expect(owner.allow).toContain(F.MoveMembers);

    const admin = entry(overwrites, 'admin', OverwriteType.Member);
    expect(admin.allow).toContain(F.MuteMembers);

    const allowed = entry(overwrites, 'allowed', OverwriteType.Member);
    expect(allowed.allow).toContain(F.Connect);

    const role = entry(overwrites, 'role1', OverwriteType.Role);
    expect(role.allow).toContain(F.Connect);

    const bot = entry(overwrites, 'bot', OverwriteType.Member);
    expect(bot.allow).toContain(F.ManageChannels);
  });

  it('locks rooms without disconnecting current members', () => {
    const overwrites = buildOverwrites(
      { ...baseRoom, locked: true },
      { everyoneRoleId: 'everyone', keepMemberIds: ['current'] },
    );
    const everyone = entry(overwrites, 'everyone', OverwriteType.Role);
    expect(everyone.deny).toContain(F.Connect);
    expect(everyone.allow).toContain(F.ViewChannel);
    expect(entry(overwrites, 'current', OverwriteType.Member).allow).toContain(F.Connect);
  });

  it('hides rooms entirely from everyone', () => {
    const overwrites = buildOverwrites({ ...baseRoom, hidden: true }, { everyoneRoleId: 'everyone' });
    const everyone = entry(overwrites, 'everyone', OverwriteType.Role);
    expect(everyone.deny).toContain(F.ViewChannel);
    expect(everyone.deny).toContain(F.Connect);
  });

  it('makes private rooms invisible', () => {
    const overwrites = buildOverwrites({ ...baseRoom, privacy: 'PRIVATE' }, { everyoneRoleId: 'everyone' });
    const everyone = entry(overwrites, 'everyone', OverwriteType.Role);
    expect(everyone.deny).toContain(F.ViewChannel);
    expect(everyone.deny).toContain(F.Connect);
  });

  it('honours temporary admin expiry and permission expiry', () => {
    const past = new Date(Date.now() - 60_000);
    const overwrites = buildOverwrites(
      {
        ...baseRoom,
        members: [{ userId: 'admin', role: 'ADMIN', tempAdminUntil: past }],
        permissions: [{ targetType: 'USER', targetId: 'allowed', allowConnect: true, expiresAt: past }],
      },
      { everyoneRoleId: 'everyone' },
    );
    expect(entry(overwrites, 'admin', OverwriteType.Member)).toBeUndefined();
    expect(entry(overwrites, 'allowed', OverwriteType.Member)).toBeUndefined();
  });
});
