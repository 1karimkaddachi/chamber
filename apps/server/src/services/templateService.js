import prisma from '@chamber/db';
import { AppError, NotFoundError } from '../lib/errors.js';

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50) || 'template';
}

async function uniqueSlug(guildId, base) {
  let slug = base;
  let counter = 2;
  for (;;) {
    const existing = await prisma.roomTemplate.findFirst({
      where: { slug, OR: [{ guildId }, { guildId: null }] },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${base}-${counter}`;
    counter += 1;
  }
}

export async function listTemplates(guildId) {
  const [builtins, custom] = await Promise.all([
    prisma.roomTemplate.findMany({ where: { guildId: null, isBuiltin: true }, orderBy: { name: 'asc' } }),
    prisma.roomTemplate.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' } }),
  ]);
  return [...builtins, ...custom];
}

export async function getTemplate(guildId, templateId) {
  if (!templateId) return null;
  return prisma.roomTemplate.findFirst({
    where: { id: templateId, OR: [{ guildId }, { guildId: null }] },
  });
}

export async function createTemplate(guildId, input, { createdById = null } = {}) {
  const slug = await uniqueSlug(guildId, slugify(input.name));
  return prisma.roomTemplate.create({
    data: {
      guildId,
      name: input.name,
      slug,
      description: input.description ?? null,
      emoji: input.emoji ?? null,
      accentColor: input.accentColor ?? '#7c6cff',
      roomTypeKey: input.roomTypeKey ?? null,
      defaultPrivacy: input.defaultPrivacy ?? 'PUBLIC',
      defaultLimit: input.defaultLimit ?? 0,
      defaultBitrate: input.defaultBitrate ?? 64000,
      roomNameRule: input.roomNameRule ?? "{user}'s {type}",
      allowedRoleIds: input.allowedRoleIds ?? [],
      isBuiltin: false,
      createdById,
    },
  });
}

export async function updateTemplate(guildId, templateId, input) {
  const template = await prisma.roomTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.guildId !== guildId) throw new NotFoundError('Template not found.');
  if (template.isBuiltin) throw new AppError('Built-in templates cannot be edited. Duplicate it first.', { status: 400 });
  return prisma.roomTemplate.update({
    where: { id: templateId },
    data: {
      name: input.name,
      description: input.description ?? null,
      emoji: input.emoji ?? null,
      accentColor: input.accentColor,
      roomTypeKey: input.roomTypeKey ?? null,
      defaultPrivacy: input.defaultPrivacy,
      defaultLimit: input.defaultLimit,
      defaultBitrate: input.defaultBitrate,
      roomNameRule: input.roomNameRule,
      allowedRoleIds: input.allowedRoleIds,
    },
  });
}

export async function deleteTemplate(guildId, templateId) {
  const template = await prisma.roomTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.guildId !== guildId) throw new NotFoundError('Template not found.');
  if (template.isBuiltin) throw new AppError('Built-in templates cannot be deleted.', { status: 400 });
  const roomCount = await prisma.activeRoom.count({ where: { templateId } });
  if (roomCount > 0) {
    throw new AppError('This template is still used by active rooms. Change their template first.', { status: 409 });
  }
  await prisma.roomTemplate.delete({ where: { id: templateId } });
}

export async function duplicateTemplate(guildId, templateId, { createdById = null } = {}) {
  const source = await getTemplate(guildId, templateId);
  if (!source) throw new NotFoundError('Template not found.');
  return createTemplate(
    guildId,
    {
      name: `${source.name} copy`.slice(0, 50),
      description: source.description,
      emoji: source.emoji,
      accentColor: source.accentColor,
      roomTypeKey: source.roomTypeKey,
      defaultPrivacy: source.defaultPrivacy,
      defaultLimit: source.defaultLimit,
      defaultBitrate: source.defaultBitrate,
      roomNameRule: source.roomNameRule,
      allowedRoleIds: source.allowedRoleIds ?? [],
    },
    { createdById },
  );
}

export async function exportTemplates(guildId) {
  const templates = await prisma.roomTemplate.findMany({
    where: { guildId, isBuiltin: false },
    orderBy: { name: 'asc' },
  });
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    templates: templates.map((template) => ({
      name: template.name,
      slug: template.slug,
      description: template.description,
      emoji: template.emoji,
      accentColor: template.accentColor,
      roomTypeKey: template.roomTypeKey,
      defaultPrivacy: template.defaultPrivacy,
      defaultLimit: template.defaultLimit,
      defaultBitrate: template.defaultBitrate,
      roomNameRule: template.roomNameRule,
      allowedRoleIds: template.allowedRoleIds,
    })),
  };
}

export async function importTemplates(guildId, templates, { createdById = null } = {}) {
  const created = [];
  for (const template of templates) {
    created.push(await createTemplate(guildId, template, { createdById }));
  }
  return created;
}

export default {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  exportTemplates,
  importTemplates,
};
