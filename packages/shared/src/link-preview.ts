// A link preview is a snapshot the server takes of the first link in a
// message: the page title, description, site name and an optional image the
// server downloaded and keeps itself, so readers never load anything from the
// linked site.

export type LinkPreviewImage = { key: string; width: number; height: number };

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image: LinkPreviewImage | null;
};

const MAX_PREVIEW_URL_LENGTH = 2048;
export const MAX_LINK_PREVIEW_TITLE = 200 as const;
export const MAX_LINK_PREVIEW_DESCRIPTION = 300 as const;
export const MAX_LINK_PREVIEW_SITE_NAME = 80 as const;
export const MAX_LINK_PREVIEW_IMAGE_SIDE = 4096 as const;
export const LINK_PREVIEW_IMAGE_KEY_PATTERN = /^lp_[0-9a-f]{32}\.webp$/;

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`(){}[\]]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
// Control characters and the invisible direction marks that could make a
// title render as something other than what it says.
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

function toPreviewUrl(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  if (candidate.length > MAX_PREVIEW_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  url.hash = '';
  return url.href;
}

export function firstPreviewableUrl(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = toPreviewUrl(match[0].replace(TRAILING_PUNCTUATION, ''));
    if (url) return url;
  }
  return null;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(HIDDEN_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > max
    ? `${characters
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : text;
}

function normalizeImage(value: unknown): LinkPreviewImage | null {
  if (!value || typeof value !== 'object') return null;
  const { key, width, height } = value as { key?: unknown; width?: unknown; height?: unknown };
  if (typeof key !== 'string' || !LINK_PREVIEW_IMAGE_KEY_PATTERN.test(key)) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  const w = width as number;
  const h = height as number;
  if (w < 1 || h < 1 || w > MAX_LINK_PREVIEW_IMAGE_SIDE || h > MAX_LINK_PREVIEW_IMAGE_SIDE) return null;
  return { key, width: w, height: h };
}

export function normalizeLinkPreview(value: unknown): LinkPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const url = typeof input.url === 'string' ? toPreviewUrl(input.url) : null;
  if (!url) return null;
  const title = cleanText(input.title, MAX_LINK_PREVIEW_TITLE);
  const description = cleanText(input.description, MAX_LINK_PREVIEW_DESCRIPTION);
  if (!title && !description) return null;
  const siteName =
    cleanText(input.siteName, MAX_LINK_PREVIEW_SITE_NAME) || new URL(url).hostname.replace(/^www\./i, '');
  return { url, title, description, siteName, image: normalizeImage(input.image) };
}

export function linkPreviewImageUrl(key: unknown): string | null {
  return typeof key === 'string' && LINK_PREVIEW_IMAGE_KEY_PATTERN.test(key) ? `/api/link-previews/${key}` : null;
}
