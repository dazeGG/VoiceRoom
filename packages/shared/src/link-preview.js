'use strict';

// A link preview is a snapshot the server takes of the first link in a
// message: the page title, description, site name and an optional image the
// server downloaded and keeps itself, so readers never load anything from the
// linked site.

const MAX_PREVIEW_URL_LENGTH = 2048;
const MAX_LINK_PREVIEW_TITLE = 200;
const MAX_LINK_PREVIEW_DESCRIPTION = 300;
const MAX_LINK_PREVIEW_SITE_NAME = 80;
const MAX_LINK_PREVIEW_IMAGE_SIDE = 4096;
const LINK_PREVIEW_IMAGE_KEY_PATTERN = /^lp_[0-9a-f]{32}\.webp$/;

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`(){}[\]]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
// Control characters and the invisible direction marks that could make a
// title render as something other than what it says.
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

function toPreviewUrl(raw) {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  if (candidate.length > MAX_PREVIEW_URL_LENGTH) return null;
  let url;
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

function firstPreviewableUrl(text) {
  if (typeof text !== 'string') return null;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = toPreviewUrl(match[0].replace(TRAILING_PUNCTUATION, ''));
    if (url) return url;
  }
  return null;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(HIDDEN_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max - 1).join('').trimEnd()}…` : text;
}

function normalizeImage(value) {
  if (!value || typeof value !== 'object') return null;
  const { key, width, height } = value;
  if (typeof key !== 'string' || !LINK_PREVIEW_IMAGE_KEY_PATTERN.test(key)) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1 || width > MAX_LINK_PREVIEW_IMAGE_SIDE || height > MAX_LINK_PREVIEW_IMAGE_SIDE) return null;
  return { key, width, height };
}

function normalizeLinkPreview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = typeof value.url === 'string' ? toPreviewUrl(value.url) : null;
  if (!url) return null;
  const title = cleanText(value.title, MAX_LINK_PREVIEW_TITLE);
  const description = cleanText(value.description, MAX_LINK_PREVIEW_DESCRIPTION);
  if (!title && !description) return null;
  const siteName = cleanText(value.siteName, MAX_LINK_PREVIEW_SITE_NAME)
    || new URL(url).hostname.replace(/^www\./i, '');
  return { url, title, description, siteName, image: normalizeImage(value.image) };
}

function linkPreviewImageUrl(key) {
  return typeof key === 'string' && LINK_PREVIEW_IMAGE_KEY_PATTERN.test(key) ? `/api/link-previews/${key}` : null;
}

module.exports = {
  LINK_PREVIEW_IMAGE_KEY_PATTERN,
  MAX_LINK_PREVIEW_DESCRIPTION,
  MAX_LINK_PREVIEW_IMAGE_SIDE,
  MAX_LINK_PREVIEW_SITE_NAME,
  MAX_LINK_PREVIEW_TITLE,
  firstPreviewableUrl,
  linkPreviewImageUrl,
  normalizeLinkPreview
};
