'use strict';

// HTTP client for the `music-bot` control plane.
//
// Two rules shape every method here, both from AC-9:
//
//   * **Nothing throws.** Every call returns a discriminated result. A WS
//     command handler that awaits this client must never see an exception
//     escape into the message queue.
//   * **Every call has a deadline.** Process isolation protects the room from a
//     bot that crashes; only an explicit timeout protects it from a bot that
//     hangs. `AbortController` bounds the whole request, response included.
//
// The bot authenticates with the same shared secret in both directions
// (`x-vr-music-secret`), matching the repository's `x-vr-*` convention.

const { MUSIC_EXPANSION_MAX_ITEMS } = require('@voice-room/shared/room-music');

const MUSIC_SECRET_HEADER = 'x-vr-music-secret';

// Control calls (play/stop/health) are small and must not hold the WS queue.
// Resolution runs yt-dlp inside the bot against VK, Rutube or YouTube and is
// allowed to be slow.
const MUSIC_BOT_CONTROL_TIMEOUT_MS = 3000;
const MUSIC_BOT_RESOLVE_TIMEOUT_MS = 10000;

// The shared secret is the whole authorization story for the control plane, in
// both directions. `server.js` already refuses to serve LiveKit when the gate
// secret is under 32 characters; this is the same floor for the same reason, in
// the one place both the outbound client and the inbound callback read it. A
// secret below it is treated as unset: the client disables itself (the feature
// reports `music_unavailable`) rather than running with a guessable secret.
const MUSIC_BOT_SECRET_MIN_LENGTH = 32;

function normalizeMusicBotSecret(value) {
  const secret = String(value || '').trim();
  return secret.length >= MUSIC_BOT_SECRET_MIN_LENGTH ? secret : '';
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/\/+$/, '');
}

function createMusicBotClient({
  baseUrl = process.env.MUSIC_BOT_URL,
  secret = process.env.MUSIC_BOT_SECRET,
  controlTimeoutMs = MUSIC_BOT_CONTROL_TIMEOUT_MS,
  resolveTimeoutMs = MUSIC_BOT_RESOLVE_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
} = {}) {
  const url = normalizeBaseUrl(baseUrl);
  const sharedSecret = normalizeMusicBotSecret(secret);
  const enabled = Boolean(url && sharedSecret && typeof fetchImpl === 'function');

  async function request(method, path, { body = null, timeoutMs = controlTimeoutMs } = {}) {
    if (!enabled) return { ok: false, code: 'music_unavailable', reason: 'not_configured' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${url}${path}`, {
        method,
        headers: {
          [MUSIC_SECRET_HEADER]: sharedSecret,
          ...(body == null ? {} : { 'content-type': 'application/json' })
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      // Fail open: an unreachable or hung bot degrades the session to
      // `unavailable`, it never propagates as a room-level failure.
      return {
        ok: false,
        code: 'music_unavailable',
        reason: error?.name === 'AbortError' ? 'timeout' : 'transport'
      };
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok) return { ok: true, status: response.status, data: payload || {} };
    return {
      ok: false,
      status: response.status,
      code: 'music_unavailable',
      reason: 'rejected',
      botError: typeof payload?.error === 'string' ? payload.error : ''
    };
  }

  // POST /resolve -> { status, kind, sourceId, title, totalAvailable, truncated, items[] }
  // Each item carries `source` and `videoId`; the caller rebuilds the shared
  // `MusicTrackRef` from those two rather than trusting a ref off the wire.
  async function resolveLink(link, limit = MUSIC_EXPANSION_MAX_ITEMS) {
    return request('POST', '/resolve', {
      body: { link, limit },
      timeoutMs: resolveTimeoutMs
    });
  }

  // POST /sessions/:roomId/play. The bot never derives the LiveKit room name and
  // never mints its own token: both are handed to it here, scoped to one room.
  async function play(roomId, { sessionEpoch, item, livekit }) {
    return request('POST', `/sessions/${encodeURIComponent(roomId)}/play`, {
      body: { sessionEpoch, item, livekit }
    });
  }

  // DELETE /sessions/:roomId. Omitting sessionEpoch stops unconditionally, which
  // is what startup reconciliation and room teardown want.
  async function stop(roomId, sessionEpoch = null) {
    const query = Number.isSafeInteger(sessionEpoch) && sessionEpoch >= 0
      ? `?sessionEpoch=${sessionEpoch}`
      : '';
    return request('DELETE', `/sessions/${encodeURIComponent(roomId)}${query}`);
  }

  async function health() {
    return request('GET', '/healthz');
  }

  return Object.freeze({
    enabled,
    health,
    play,
    resolveLink,
    stop
  });
}

module.exports = {
  MUSIC_BOT_CONTROL_TIMEOUT_MS,
  MUSIC_BOT_RESOLVE_TIMEOUT_MS,
  MUSIC_BOT_SECRET_MIN_LENGTH,
  MUSIC_SECRET_HEADER,
  createMusicBotClient,
  normalizeMusicBotSecret
};
