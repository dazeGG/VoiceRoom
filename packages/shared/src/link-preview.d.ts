export const MAX_LINK_PREVIEW_TITLE: 200;
export const MAX_LINK_PREVIEW_DESCRIPTION: 300;
export const MAX_LINK_PREVIEW_SITE_NAME: 80;
export const MAX_LINK_PREVIEW_IMAGE_SIDE: 4096;
export const LINK_PREVIEW_IMAGE_KEY_PATTERN: RegExp;

export type LinkPreviewImage = { key: string; width: number; height: number };

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image: LinkPreviewImage | null;
};

export function firstPreviewableUrl(text: unknown): string | null;
export function normalizeLinkPreview(value: unknown): LinkPreview | null;
export function linkPreviewImageUrl(key: unknown): string | null;
