'use strict';

const MUSIC_CONTRACT_VERSION = 1;
const MUSIC_QUEUE_MAX_ITEMS = 100;
const MUSIC_EXPANSION_MAX_ITEMS = 50;
const MUSIC_HEARTBEAT_INTERVAL_MS = 2000;
const MUSIC_POSITION_STALE_MS = 6000;
const MUSIC_WATCHDOG_GRACE_MS = 15000;
const MUSIC_LINK_MAX_LENGTH = 2048;
const MUSIC_ID_MAX_LENGTH = 128;
const MUSIC_TITLE_MAX_LENGTH = 256;
const MUSIC_ARTIST_MAX_LENGTH = 256;
const MUSIC_COVER_URL_MAX_LENGTH = 1024;

const MUSIC_SESSION_STATUSES = Object.freeze(['idle', 'resolving', 'playing', 'unavailable']);
const MUSIC_TRACK_REF_KINDS = Object.freeze(['video', 'playlist']);

// Which platform a ref came from. This list is part of the wire contract and
// stays constant; whether a source can actually be reached from a given
// deployment is an operational fact the bot owns (see `source_unavailable`),
// not a shape the client gets to guess.
const MUSIC_SOURCES = Object.freeze(['vk', 'rutube', 'youtube']);

const MUSIC_ERROR_CODES = Object.freeze([
  'forbidden',
  'room_not_static',
  'queue_capacity_exceeded',
  'invalid_link',
  // The link is well-formed and the source is known, but this deployment cannot
  // reach it - YouTube without an egress proxy is the case this exists for.
  // Distinct from `invalid_link`, so the UI can say "not reachable from here"
  // rather than "bad link", and from `music_unavailable`, which is about the
  // bot itself being down rather than one source being out of reach.
  'source_unavailable',
  'music_unavailable'
]);
const MUSIC_CLIENT_COMMAND_TYPES = Object.freeze([
  'room.music.enqueue',
  'room.music.skip',
  'room.music.remove',
  'room.music.stop'
]);

// Every accepted link is canonicalized to one host per source so that equal
// refs compare equal: `vk.com/video-1_2` and `vkvideo.ru/video-1_2` address the
// same video and must dedupe against each other.
const VK_HOSTS = Object.freeze(['vk.com', 'vk.ru', 'm.vk.com', 'vkvideo.ru', 'vkvideo.com']);
const RUTUBE_HOSTS = Object.freeze(['rutube.ru']);
const YOUTUBE_HOSTS = Object.freeze([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'youtu.be'
]);
const MUSIC_SOURCE_HOSTS = Object.freeze({
  vk: VK_HOSTS,
  rutube: RUTUBE_HOSTS,
  youtube: YOUTUBE_HOSTS
});
const MUSIC_CANONICAL_HOSTS = Object.freeze({
  vk: 'vkvideo.ru',
  rutube: 'rutube.ru',
  youtube: 'www.youtube.com'
});

// VK addresses a video as `<ownerId>_<videoId>`, where a negative owner is a
// community. Playlists use the same pair shape.
const VK_PAIR_PATTERN = /^-?[0-9]{1,20}_[0-9]{1,20}$/;
// Rutube video ids are 32 lowercase hex characters; its playlists are numeric.
const RUTUBE_VIDEO_ID_PATTERN = /^[0-9a-f]{32}$/;
const RUTUBE_PLAYLIST_ID_PATTERN = /^[0-9]{1,20}$/;
// YouTube video ids are exactly 11 URL-safe characters. Playlist ids vary in
// length by type (PL..., OLAK5uy_..., RD...) within the same alphabet.
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

const ID_PATTERNS = Object.freeze({
  vk: { video: VK_PAIR_PATTERN, playlist: VK_PAIR_PATTERN },
  rutube: { video: RUTUBE_VIDEO_ID_PATTERN, playlist: RUTUBE_PLAYLIST_ID_PATTERN },
  youtube: { video: YOUTUBE_VIDEO_ID_PATTERN, playlist: YOUTUBE_PLAYLIST_ID_PATTERN }
});

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= maxLength ? text : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMusicSessionStatus(value) {
  return MUSIC_SESSION_STATUSES.includes(value);
}

function isMusicErrorCode(value) {
  return MUSIC_ERROR_CODES.includes(value);
}

function isMusicSource(value) {
  return MUSIC_SOURCES.includes(value);
}

// Every id reaching here has already matched one of the patterns above, and each
// of those alphabets is a subset of the unreserved URL characters. That is what
// makes the plain interpolation below safe: no accepted id can carry a `?`, `&`,
// `#` or `/` into the canonical URL and change what it addresses.
function buildTrackRef(parts) {
  const { source, kind } = parts;
  const videoId = parts.videoId ?? null;
  const playlistId = parts.playlistId ?? null;
  const host = MUSIC_CANONICAL_HOSTS[source];
  const ref = { source, kind, id: '', videoId, playlistId, sourceUrl: '' };

  if (kind === 'video') {
    ref.id = `${source}:video:${videoId}`;
    if (source === 'vk') ref.sourceUrl = `https://${host}/video${videoId}`;
    else if (source === 'rutube') ref.sourceUrl = `https://${host}/video/${videoId}/`;
    else ref.sourceUrl = `https://${host}/watch?v=${videoId}`;
  } else {
    ref.id = `${source}:playlist:${playlistId}`;
    if (source === 'vk') ref.sourceUrl = `https://${host}/playlist/${playlistId}`;
    else if (source === 'rutube') ref.sourceUrl = `https://${host}/plst/${playlistId}/`;
    else ref.sourceUrl = `https://${host}/playlist?list=${playlistId}`;
  }
  return ref;
}

function parseMusicUrl(value) {
  const text = cleanText(value, MUSIC_LINK_MAX_LENGTH);
  if (!text) return null;
  const candidate = SCHEME_PATTERN.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const source = MUSIC_SOURCES.find((name) => MUSIC_SOURCE_HOSTS[name].includes(host));
  return source ? { url, host, source } : null;
}

// vk.com/video-1_2, vkvideo.ru/video-1_2, vk.com/clip-1_2, /playlist/-1_2, and
// the `?z=video-1_2%2F...` form the site still emits from feed and wall links.
function parseVkLink(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const head = (segments[0] || '').toLowerCase();

  if (segments.length === 1) {
    const match = /^(?:video|clip)(-?[0-9]{1,20}_[0-9]{1,20})$/.exec(head);
    if (match) return buildTrackRef({ source: 'vk', kind: 'video', videoId: match[1] });
  }

  // /playlist/<owner>_<id> and /video/playlist/<owner>_<id>
  let playlistId = null;
  if (head === 'playlist') playlistId = segments[1] || '';
  else if (head === 'video' && (segments[1] || '').toLowerCase() === 'playlist') {
    playlistId = segments[2] || '';
  }
  if (playlistId && VK_PAIR_PATTERN.test(playlistId)) {
    return buildTrackRef({ source: 'vk', kind: 'playlist', playlistId });
  }

  const z = url.searchParams.get('z') || '';
  const zMatch = /^(?:video|clip)(-?[0-9]{1,20}_[0-9]{1,20})/.exec(z);
  if (zMatch) return buildTrackRef({ source: 'vk', kind: 'video', videoId: zMatch[1] });
  return null;
}

// rutube.ru/video/<32 hex>/, /shorts/<id>/, /play/embed/<id>, /plst/<id>/
function parseRutubeLink(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const head = (segments[0] || '').toLowerCase();

  if ((head === 'video' || head === 'shorts') && RUTUBE_VIDEO_ID_PATTERN.test(segments[1] || '')) {
    return buildTrackRef({ source: 'rutube', kind: 'video', videoId: segments[1] });
  }
  if (
    head === 'play' &&
    (segments[1] || '').toLowerCase() === 'embed' &&
    RUTUBE_VIDEO_ID_PATTERN.test(segments[2] || '')
  ) {
    return buildTrackRef({ source: 'rutube', kind: 'video', videoId: segments[2] });
  }
  if (head === 'plst' && RUTUBE_PLAYLIST_ID_PATTERN.test(segments[1] || '')) {
    return buildTrackRef({ source: 'rutube', kind: 'playlist', playlistId: segments[1] });
  }
  return null;
}

// youtu.be/<id>, /watch?v=<id>, /shorts|/embed|/live|/v/<id>, /playlist?list=<id>
//
// A `list=` alongside `watch?v=` is deliberately ignored: the person copied the
// address bar while one video was open, and there that list is usually an
// auto-generated mix (`RD...`) rather than something they meant to queue. The
// explicit /playlist form is how a playlist gets enqueued.
function parseYouTubeLink(url, host) {
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    return segments.length === 1 && YOUTUBE_VIDEO_ID_PATTERN.test(segments[0])
      ? buildTrackRef({ source: 'youtube', kind: 'video', videoId: segments[0] })
      : null;
  }

  const head = (segments[0] || '').toLowerCase();
  if (head === 'watch' && segments.length === 1) {
    const videoId = url.searchParams.get('v') || '';
    return YOUTUBE_VIDEO_ID_PATTERN.test(videoId)
      ? buildTrackRef({ source: 'youtube', kind: 'video', videoId })
      : null;
  }
  if (
    segments.length === 2 &&
    ['shorts', 'embed', 'live', 'v'].includes(head) &&
    YOUTUBE_VIDEO_ID_PATTERN.test(segments[1])
  ) {
    return buildTrackRef({ source: 'youtube', kind: 'video', videoId: segments[1] });
  }
  if (head === 'playlist' && segments.length === 1) {
    const playlistId = url.searchParams.get('list') || '';
    return YOUTUBE_PLAYLIST_ID_PATTERN.test(playlistId)
      ? buildTrackRef({ source: 'youtube', kind: 'playlist', playlistId })
      : null;
  }
  return null;
}

function normalizeMusicLink(value) {
  const parsed = parseMusicUrl(value);
  if (!parsed) return null;
  if (parsed.source === 'vk') return parseVkLink(parsed.url);
  if (parsed.source === 'rutube') return parseRutubeLink(parsed.url);
  return parseYouTubeLink(parsed.url, parsed.host);
}

function normalizeMusicTrackRef(value) {
  if (typeof value === 'string') return normalizeMusicLink(value);
  if (!isPlainObject(value)) return null;
  const source = typeof value.source === 'string' ? value.source : '';
  const kind = typeof value.kind === 'string' ? value.kind : '';
  if (!isMusicSource(source) || !MUSIC_TRACK_REF_KINDS.includes(kind)) return null;

  const raw = kind === 'video' ? value.videoId : value.playlistId;
  const id = typeof raw === 'string' ? raw : '';
  if (!ID_PATTERNS[source][kind].test(id)) return null;
  return kind === 'video'
    ? buildTrackRef({ source, kind, videoId: id })
    : buildTrackRef({ source, kind, playlistId: id });
}

function isMusicExpandableRef(value) {
  const ref = normalizeMusicTrackRef(value);
  return Boolean(ref) && ref.kind === 'playlist';
}

// Cover art is rendered straight into an <img src> and the edge CSP sets no
// img-src directive, so the scheme is constrained here at the contract boundary
// instead of in each consumer. Only https is accepted; an unusable cover
// degrades to null exactly as an over-long one already does, because decorative
// art must never keep a track out of the queue.
function cleanMusicCoverUrl(value) {
  const text = cleanText(value, MUSIC_COVER_URL_MAX_LENGTH);
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }
  return parsed.protocol === 'https:' ? text : '';
}

function normalizeMusicItemId(value) {
  return cleanText(value, MUSIC_ID_MAX_LENGTH) || null;
}

function normalizeMusicQueueItem(value) {
  if (!isPlainObject(value)) return null;
  const id = cleanText(value.id, MUSIC_ID_MAX_LENGTH);
  const addedBy = cleanText(value.addedBy, MUSIC_ID_MAX_LENGTH);
  const trackRef = normalizeMusicTrackRef(value.trackRef);
  const title = cleanText(value.title, MUSIC_TITLE_MAX_LENGTH);
  if (!id || !addedBy || !trackRef || !title) return null;

  const artist = cleanText(value.artist, MUSIC_ARTIST_MAX_LENGTH);
  const coverUrl = cleanMusicCoverUrl(value.coverUrl);
  let durationMs = null;
  if (value.durationMs != null) {
    const numeric = Number(value.durationMs);
    if (!Number.isSafeInteger(numeric) || numeric < 0) return null;
    durationMs = numeric;
  }
  return { id, trackRef, addedBy, title, artist, coverUrl: coverUrl || null, durationMs };
}

// AC-6: a playlist expands to at most MUSIC_EXPANSION_MAX_ITEMS entries, and
// those entries are added all-or-nothing against the queue cap. A link that does
// not fit entirely is rejected as a whole; partial adds never happen. Returns
// null when the input itself is structurally invalid.
function planMusicEnqueue(input = {}) {
  if (!isPlainObject(input) || !Array.isArray(input.items)) return null;
  const queueLength = Number(input.queueLength ?? 0);
  if (!Number.isSafeInteger(queueLength) || queueLength < 0 || queueLength > MUSIC_QUEUE_MAX_ITEMS) return null;
  if (input.items.length === 0) return { ok: false, code: 'invalid_link' };
  const items = input.items.slice(0, MUSIC_EXPANSION_MAX_ITEMS);
  if (queueLength + items.length > MUSIC_QUEUE_MAX_ITEMS) {
    return { ok: false, code: 'queue_capacity_exceeded' };
  }
  return { ok: true, items };
}

function isMusicPositionStale(positionAt, now = Date.now()) {
  const at = Number(positionAt);
  const reference = Number(now);
  if (!Number.isFinite(at) || !Number.isFinite(reference)) return true;
  return reference - at > MUSIC_POSITION_STALE_MS;
}

function normalizeMusicSession(value) {
  if (!isPlainObject(value) || !isMusicSessionStatus(value.status)) return null;
  if (value.queue != null && !Array.isArray(value.queue)) return null;
  const rawQueue = Array.isArray(value.queue) ? value.queue : [];
  if (rawQueue.length > MUSIC_QUEUE_MAX_ITEMS) return null;
  const queue = rawQueue.map(normalizeMusicQueueItem);
  if (queue.some((item) => !item)) return null;

  const currentItem = value.currentItem == null ? null : normalizeMusicQueueItem(value.currentItem);
  if (value.currentItem != null && !currentItem) return null;

  const positionMs = Number(value.positionMs ?? 0);
  if (!Number.isSafeInteger(positionMs) || positionMs < 0) return null;

  let positionAt = null;
  if (value.positionAt != null) {
    const numeric = Number(value.positionAt);
    if (!Number.isFinite(numeric)) return null;
    positionAt = numeric;
  }

  const sessionEpoch = Number(value.sessionEpoch ?? 0);
  if (!Number.isSafeInteger(sessionEpoch) || sessionEpoch < 0) return null;

  return {
    contractVersion: MUSIC_CONTRACT_VERSION,
    status: value.status,
    currentItem,
    positionMs,
    positionAt,
    queue,
    sessionEpoch
  };
}

function buildMusicSession(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const rawQueue = Array.isArray(source.queue) ? source.queue : [];
  const queue = rawQueue.map(normalizeMusicQueueItem).filter(Boolean).slice(0, MUSIC_QUEUE_MAX_ITEMS);
  const currentItem = source.currentItem == null ? null : normalizeMusicQueueItem(source.currentItem);
  const positionMs = Number(source.positionMs ?? 0);
  const positionAt = source.positionAt == null ? null : Number(source.positionAt);
  const sessionEpoch = Number(source.sessionEpoch ?? 0);
  return {
    contractVersion: MUSIC_CONTRACT_VERSION,
    status: isMusicSessionStatus(source.status) ? source.status : 'idle',
    currentItem,
    positionMs: Number.isSafeInteger(positionMs) && positionMs >= 0 ? positionMs : 0,
    positionAt: Number.isFinite(positionAt) ? positionAt : null,
    queue,
    sessionEpoch: Number.isSafeInteger(sessionEpoch) && sessionEpoch >= 0 ? sessionEpoch : 0
  };
}

// Payload shape only. Room scoping, authorship and the static-room rule stay in
// apps/api, which owns the room identity it validated at join time.
function normalizeMusicCommand(type, payload = {}) {
  if (!MUSIC_CLIENT_COMMAND_TYPES.includes(type)) return null;
  const source = isPlainObject(payload) ? payload : {};
  if (type === 'room.music.enqueue') {
    // A caller may send either a raw link or an already-shaped trackRef.
    // `link`/`url` stay link-only so an object there cannot smuggle in a ref.
    const trackRef = source.trackRef != null
      ? normalizeMusicTrackRef(source.trackRef)
      : normalizeMusicLink(source.link ?? source.url);
    return trackRef ? { type, trackRef } : null;
  }
  if (type === 'room.music.skip') {
    // No itemId means "skip whatever is playing now".
    if (source.itemId == null) return { type, itemId: null };
    const itemId = normalizeMusicItemId(source.itemId);
    return itemId ? { type, itemId } : null;
  }
  if (type === 'room.music.remove') {
    const itemId = normalizeMusicItemId(source.itemId);
    return itemId ? { type, itemId } : null;
  }
  return { type };
}


module.exports = {
  MUSIC_ARTIST_MAX_LENGTH,
  MUSIC_CANONICAL_HOSTS,
  MUSIC_CLIENT_COMMAND_TYPES,
  MUSIC_CONTRACT_VERSION,
  MUSIC_COVER_URL_MAX_LENGTH,
  MUSIC_ERROR_CODES,
  MUSIC_EXPANSION_MAX_ITEMS,
  MUSIC_HEARTBEAT_INTERVAL_MS,
  MUSIC_ID_MAX_LENGTH,
  MUSIC_LINK_MAX_LENGTH,
  MUSIC_POSITION_STALE_MS,
  MUSIC_QUEUE_MAX_ITEMS,
  MUSIC_SESSION_STATUSES,
  MUSIC_SOURCES,
  MUSIC_SOURCE_HOSTS,
  MUSIC_TITLE_MAX_LENGTH,
  MUSIC_TRACK_REF_KINDS,
  MUSIC_WATCHDOG_GRACE_MS,
  buildMusicSession,
  isMusicErrorCode,
  isMusicExpandableRef,
  isMusicPositionStale,
  isMusicSessionStatus,
  isMusicSource,
  normalizeMusicCommand,
  normalizeMusicItemId,
  normalizeMusicLink,
  normalizeMusicQueueItem,
  normalizeMusicSession,
  normalizeMusicTrackRef,
  planMusicEnqueue
};
