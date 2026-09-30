import crypto from 'node:crypto';
import sharp from 'sharp';
import { deriveAvatarAccent, dominantAvatarColor } from '@voice-room/shared/avatar-accent';
import { detectImageFormat } from './image-signature.mts';

const AVATAR_SIZE = 256;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40 * 1024 * 1024;

export type ProcessedAvatar = { accent: string; buffer: Buffer; hash: string };

function httpError(message: string, statusCode: number): Error & { statusCode: number; cause?: unknown } {
  const error = new Error(message) as Error & { statusCode: number; cause?: unknown };
  error.statusCode = statusCode;
  return error;
}

function detectAvatarFormat(buffer: Buffer): string {
  const format = detectImageFormat(buffer);
  return ['jpeg', 'png', 'webp'].includes(format) ? format : '';
}

async function processAvatar(buffer: unknown): Promise<ProcessedAvatar> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) {
    throw httpError('Avatar file must be at most 5 MB', 413);
  }
  if (!detectAvatarFormat(buffer)) {
    throw httpError('Only JPEG, PNG, and WebP images are supported', 415);
  }

  let output: Buffer;
  try {
    output = await sharp(buffer, {
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true
    })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
  } catch (cause) {
    const error = httpError('Invalid or unsafe image', 400);
    error.cause = cause;
    throw error;
  }

  const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const presentation = deriveAvatarAccent(dominantAvatarColor(data, info.width, info.height));
  return {
    accent: presentation.background,
    buffer: output,
    hash: crypto.createHash('sha256').update(output).digest('hex').slice(0, 8)
  };
}

function createAvatarKey(kind: string, id: unknown, hash: string): string {
  const normalizedId = String(id || '');
  const validId =
    kind === 'user'
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedId)
      : kind === 'room' && /^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/.test(normalizedId);
  if (!validId || !/^[a-f0-9]{8}$/.test(hash)) throw new Error('Invalid avatar key input');
  return `${kind === 'room' ? 'room' : 'av'}_${normalizedId}_${hash}.webp`;
}

export { AVATAR_SIZE, MAX_AVATAR_BYTES, createAvatarKey, detectAvatarFormat, processAvatar };
