// Decides an image's container from its leading bytes, never from a
// Content-Type header or a file name. Everything sharp decodes goes through
// this first, so a remote or uploaded file cannot steer libvips into a decoder
// we never meant to expose (HEIF/AVIF via libheif, SVG via librsvg, TIFF...).

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageFormat(buffer: unknown): ImageFormat | '' {
  if (!Buffer.isBuffer(buffer)) return '';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'gif';
  return '';
}

export function isAllowedImage(buffer: unknown, allowed: readonly ImageFormat[]): boolean {
  const format = detectImageFormat(buffer);
  return format !== '' && allowed.includes(format);
}
