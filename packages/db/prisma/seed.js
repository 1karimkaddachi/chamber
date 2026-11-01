import { PrismaClient } from '@prisma/client';
import { BUILTIN_ROOM_TYPES, BUILTIN_TEMPLATES } from '@chamber/shared';

const prisma = new PrismaClient();

const templateDefaults = (template) => ({
  name: template.name,
  description: template.description ?? null,
  emoji: template.emoji ?? null,
  accentColor: template.accentColor ?? '#7c6cff',
  roomTypeKey: template.roomTypeKey ?? null,
  defaultPrivacy: template.defaultPrivacy ?? 'PUBLIC',
  defaultLimit: template.defaultLimit ?? 0,
  defaultBitrate: template.defaultBitrate ?? 64000,
  roomNameRule: template.roomNameRule ?? "{user}'s {type}",
  allowedRoleIds: template.allowedRoleIds ?? [],
  isBuiltin: true,
});

async function seedTemplates() {
  for (const template of BUILTIN_TEMPLATES) {
    const existing = await prisma.roomTemplate.findFirst({
      where: { guildId: null, slug: template.slug },
    });
    if (existing) {
      await prisma.roomTemplate.update({
        where: { id: existing.id },
        data: templateDefaults(template),
      });
    } else {
      await prisma.roomTemplate.create({
        data: { ...templateDefaults(template), slug: template.slug, guildId: null },
      });
    }
  }
}

async function seedRoomTypes() {
  for (const type of BUILTIN_ROOM_TYPES) {
    const existing = await prisma.roomType.findFirst({
      where: { guildId: null, key: type.key },
    });
    if (existing) {
      await prisma.roomType.update({
        where: { id: existing.id },
        data: { ...type, isBuiltin: true },
      });
    } else {
      await prisma.roomType.create({
        data: { ...type, guildId: null, isBuiltin: true },
      });
    }
  }
}

async function seedDevelopmentAccess() {
  if (process.env.DEV_AUTH !== 'true') return;
  const guildId = process.env.DEV_AUTH_GUILD_ID;
  if (!guildId) return;

  const userId = process.env.DEV_AUTH_USER_ID || '100000000000000001';
  await prisma.user.upsert({
    where: { id: userId },
    update: { username: process.env.DEV_AUTH_USERNAME || 'Dev Operator' },
    create: { id: userId, username: process.env.DEV_AUTH_USERNAME || 'Dev Operator' },
  });

  const guild = await prisma.guild.upsert({
    where: { id: guildId },
    update: { botPresent: false },
    create: { id: guildId, name: 'Chamber Development', botPresent: false },
  });

  await prisma.guildConfig.upsert({
    where: { guildId },
    update: {},
    create: {
      guildId,
      setupCompleted: true,
      waitingRoomEnabled: false,
      queueEnabled: true,
      reservationsEnabled: true,
    },
  });

  console.log(`Development guild scaffolded: ${guild.name} (${guild.id})`);
}

async function main() {
  await seedTemplates();
  await seedRoomTypes();
  await seedDevelopmentAccess();
  const templates = await prisma.roomTemplate.count({ where: { isBuiltin: true } });
  const types = await prisma.roomType.count({ where: { isBuiltin: true } });
  console.log(`Seed complete — ${templates} built-in templates, ${types} built-in room types.`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
