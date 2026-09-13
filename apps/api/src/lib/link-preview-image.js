'use strict';

const crypto = require('node:crypto');
const sharp = require('sharp');

const MAX_INPUT_PIXELS = 40 * 1024 * 1024;
const MAX_SIDE = 640;
const MIN_SIDE = 32;

// Re-encodes a downloaded page image into a small WebP the API serves itself.
// Only the first frame of an animation is kept, and images too small to be a
// picture (tracking pixels, favicons) give no image at all.
async function processLinkPreviewImage(buffer) {
  const { data, info } = await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  if (info.width < MIN_SIDE || info.height < MIN_SIDE) return null;
  return {
    key: `lp_${crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)}.webp`,
    buffer: data,
    width: info.width,
    height: info.height
  };
}

module.exports = { processLinkPreviewImage };
