'use strict';

const crypto = require('node:crypto');
const { firstPreviewableUrl, normalizeLinkPreview } = require('@voice-room/shared/link-preview');
const { decodeHtmlBody, extractLinkPreviewMetadata } = require('../../lib/link-preview-html');

const READY_TTL_MS = 24 * 60 * 60 * 1000;
const FAILED_TTL_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_FETCHES = 2;
const MAX_WAITING_FETCHES = 100;

// Builds the preview of the first link in a message after the message was
// sent, stores it on the message and asks the caller to re-publish it. A link
// is fetched at most once at a time and then served from the cache; failures
// are remembered too, for a shorter while.
function createLinkPreviewService({
  repository,
  fetcher,
  storage,
  processImage,
  onRoomPreview = async () => {},
  onDirectPreview = async () => {},
  logger = console,
  now = Date.now
}) {
  const inflight = new Map();
  const waiting = [];
  let active = 0;

  function hashUrl(url) {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  // A finished fetch hands its slot to the next waiter instead of releasing it,
  // so a caller that arrives in the same tick cannot take the same slot twice.
  async function withFetchSlot(task) {
    if (active >= MAX_CONCURRENT_FETCHES) await new Promise((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }

  async function storeImage(imageUrl) {
    try {
      const fetched = await fetcher.fetchImage(imageUrl);
      const processed = await processImage(fetched.body);
      if (!processed) return null;
      await storage.save(processed.key, processed.buffer);
      return { key: processed.key, width: processed.width, height: processed.height };
    } catch {
      // A page whose image cannot be used still gets a text preview.
      return null;
    }
  }

  async function buildPreview(url) {
    const page = await fetcher.fetchPage(url);
    const metadata = extractLinkPreviewMetadata(decodeHtmlBody(page.body, page.contentType), page.url);
    if (!metadata.title && !metadata.description) return null;
    const image = metadata.imageUrl ? await storeImage(metadata.imageUrl) : null;
    return normalizeLinkPreview({ url, ...metadata, image });
  }

  async function resolvePreview(url) {
    const urlHash = hashUrl(url);
    const cached = await repository.getCached(urlHash, now());
    if (cached) return cached.status === 'ready' ? normalizeLinkPreview(cached.preview) : null;
    if (inflight.has(urlHash)) return inflight.get(urlHash);
    // Under a flood of new links, skip rather than queue without bound.
    if (active >= MAX_CONCURRENT_FETCHES && waiting.length >= MAX_WAITING_FETCHES) return null;

    const job = withFetchSlot(async () => {
      let preview = null;
      let failureCode = 'no_metadata';
      try {
        preview = await buildPreview(url);
      } catch (error) {
        failureCode = String(error?.code || 'fetch_failed').slice(0, 32);
      }
      await repository.saveCached({
        urlHash,
        url,
        preview,
        failureCode,
        now: now(),
        ttlMs: preview ? READY_TTL_MS : FAILED_TTL_MS
      });
      return preview;
    }).finally(() => inflight.delete(urlHash));
    inflight.set(urlHash, job);
    return job;
  }

  async function previewRoomMessage({ roomId, messageId, text }) {
    const url = firstPreviewableUrl(text);
    const preview = url ? await resolvePreview(url) : null;
    if (await repository.setRoomMessagePreview({ roomId, messageId, text, preview })) {
      await onRoomPreview({ roomId, messageId });
    }
  }

  async function previewDirectMessage({ messageId, senderId, recipientId, text }) {
    const url = firstPreviewableUrl(text);
    const preview = url ? await resolvePreview(url) : null;
    if (await repository.setDirectMessagePreview({ messageId, senderId, text, preview })) {
      await onDirectPreview({ messageId, senderId, recipientId });
    }
  }

  function inBackground(task) {
    void task().catch((error) => {
      logger.warn?.('Link preview failed:', error?.message || error);
    });
  }

  return {
    previewDirectMessage,
    previewRoomMessage,
    pruneExpired: () => repository.pruneExpired(now()),
    scheduleDirectMessage: (input) => inBackground(() => previewDirectMessage(input)),
    scheduleRoomMessage: (input) => inBackground(() => previewRoomMessage(input))
  };
}

module.exports = { FAILED_TTL_MS, READY_TTL_MS, createLinkPreviewService };
