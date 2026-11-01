import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import prisma from '@chamber/db';
import { AUDIT_ACTIONS, UPLOAD_LIMITS, imageUploadSchema } from '@chamber/shared';
import config from '../../config.js';
import { logger } from '../../logger.js';
import { AppError, ForbiddenError } from '../../lib/errors.js';
import { currentUserId, guildAccess } from '../middleware.js';
import { writeAudit } from '../../services/auditService.js';

const router = express.Router();

const uploadsDir = path.join(config.storageDir, 'uploads');

// The declared mime type is only a hint, so the bytes decide the stored
// extension. Formats that can carry script (SVG, HTML) are not accepted at all.
const SIGNATURES = [
  {
    ext: 'png',
    mime: 'image/png',
    matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { ext: 'jpg', mime: 'image/jpeg', matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  {
    ext: 'webp',
    mime: 'image/webp',
    matches: (bytes) =>
      bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { ext: 'gif', mime: 'image/gif', matches: (bytes) => bytes.subarray(0, 6).toString('latin1').startsWith('GIF8') },
];

const detectImage = (bytes) => SIGNATURES.find((entry) => entry.matches(bytes)) ?? null;

// Banners are replaced far more often than they are read, so files that no room
// references are swept once they are older than the grace window.
async function pruneOrphans() {
  const referenced = await prisma.activeRoom.findMany({
    where: { bannerUrl: { startsWith: '/api/uploads/' } },
    select: { bannerUrl: true },
  });
  const keep = new Set(referenced.map((row) => path.basename(String(row.bannerUrl))));
  const graceMs = 60 * 60 * 1000;
  const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !keep.has(entry.name))
      .map(async (entry) => {
        const stats = await fs.stat(path.join(uploadsDir, entry.name));
        if (stats.mtimeMs < Date.now() - graceMs) await fs.rm(path.join(uploadsDir, entry.name), { force: true });
      }),
  );
}

router.post('/:guildId/uploads', guildAccess({ staff: true }), async (req, res, next) => {
  try {
    const { data, mimeType } = imageUploadSchema.parse(req.body);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > UPLOAD_LIMITS.maxBytes) {
      throw new AppError('Images must stay under 4 MB.', { code: 'UPLOAD_TOO_LARGE', status: 413 });
    }

    const image = detectImage(bytes);
    if (!image) {
      throw new AppError('Only PNG, JPEG, WebP and GIF images can be uploaded.', {
        code: 'UNSUPPORTED_IMAGE',
        status: 415,
      });
    }
    if (image.mime !== mimeType) {
      throw new ForbiddenError(`The file is a ${image.mime} image, not the declared ${mimeType}.`);
    }

    await fs.mkdir(uploadsDir, { recursive: true });
    const name = `${crypto.randomBytes(12).toString('base64url')}.${image.ext}`;
    await fs.writeFile(path.join(uploadsDir, name), bytes, { mode: 0o644 });

    pruneOrphans().catch((error) => logger.warn({ err: error }, 'Upload sweep failed'));

    await writeAudit({
      guildId: req.guildContext.guild.id,
      actorId: currentUserId(req),
      actorName: req.session.user.username,
      action: AUDIT_ACTIONS.UPLOAD_CREATED,
      category: 'CONFIG',
      targetType: 'upload',
      targetId: name,
      metadata: { bytes: bytes.length, mimeType: image.mime },
      req,
    });

    res.status(201).json({ url: `/api/uploads/${name}`, bytes: bytes.length, mimeType: image.mime });
  } catch (error) {
    next(error);
  }
});

export { uploadsDir };
export default router;
