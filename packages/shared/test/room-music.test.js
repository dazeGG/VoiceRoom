'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cjs = require('../src/room-music');
const { KNOWN_CLIENT_TYPES } = require('../src/realtime');

// A YouTube video id is exactly 11 characters, so the fixture pads rather than
// interpolating the index directly: an id that does not match the contract's
// own pattern would make every item here silently unnormalizable.
function videoIdFor(index) {
  return `vid${String(index).padStart(8, '0')}`;
}

function makeItem(index) {
  return {
    id: `item-${index}`,
    trackRef: { source: 'youtube', kind: 'video', videoId: videoIdFor(index) },
    addedBy: `peer-${index}`,
    title: `Track ${index}`,
    artist: 'Artist',
    coverUrl: null,
    durationMs: 180000
  };
}

test('normalizeMusicLink canonicalizes every accepted shape of all three sources', () => {
  const cases = [
    // VK: the site addresses a video as <ownerId>_<videoId>, negative owner = community.
    ['https://vkvideo.ru/video-1234_5678', 'vk:video:-1234_5678', 'https://vkvideo.ru/video-1234_5678'],
    ['https://vk.com/video1234_5678', 'vk:video:1234_5678', 'https://vkvideo.ru/video1234_5678'],
    ['https://vk.com/clip-1_2', 'vk:video:-1_2', 'https://vkvideo.ru/video-1_2'],
    ['https://vk.com/playlist/-1_2', 'vk:playlist:-1_2', 'https://vkvideo.ru/playlist/-1_2'],
    ['https://vk.com/video/playlist/-1_2', 'vk:playlist:-1_2', 'https://vkvideo.ru/playlist/-1_2'],
    ['https://vk.com/feed?z=video-1_2%2Fpl_post_1', 'vk:video:-1_2', 'https://vkvideo.ru/video-1_2'],

    // Rutube: 32 lowercase hex for a video, numeric for a playlist.
    [
      'https://rutube.ru/video/0123456789abcdef0123456789abcdef/',
      'rutube:video:0123456789abcdef0123456789abcdef',
      'https://rutube.ru/video/0123456789abcdef0123456789abcdef/'
    ],
    [
      'https://rutube.ru/shorts/0123456789abcdef0123456789abcdef/',
      'rutube:video:0123456789abcdef0123456789abcdef',
      'https://rutube.ru/video/0123456789abcdef0123456789abcdef/'
    ],
    [
      'https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef',
      'rutube:video:0123456789abcdef0123456789abcdef',
      'https://rutube.ru/video/0123456789abcdef0123456789abcdef/'
    ],
    ['https://rutube.ru/plst/12345/', 'rutube:playlist:12345', 'https://rutube.ru/plst/12345/'],

    // YouTube: 11-character video ids, mixed-length playlist ids.
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube:video:dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube:video:dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube:video:dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'youtube:video:dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    [
      'https://music.youtube.com/playlist?list=OLAK5uy_abc',
      'youtube:playlist:OLAK5uy_abc',
      'https://www.youtube.com/playlist?list=OLAK5uy_abc'
    ]
  ];

  for (const [input, id, sourceUrl] of cases) {
    const ref = cjs.normalizeMusicLink(input);
    assert.ok(ref, `expected ${input} to normalize`);
    assert.equal(ref.id, id, input);
    assert.equal(ref.sourceUrl, sourceUrl, input);
    assert.equal(cjs.MUSIC_SOURCES.includes(ref.source), true, input);
    // Exactly one of the two id fields is populated, per the declared shape.
    assert.equal(ref.kind === 'video' ? ref.playlistId : ref.videoId, null, input);
  }
});

test('a watch link carrying a list= normalizes to the video, not the mix', () => {
  // Copying the address bar mid-video yields ?v=...&list=RD..., an auto-generated
  // mix nobody asked to queue. The explicit /playlist form is how a playlist is
  // enqueued, so these two links must not collapse onto the same ref.
  const video = cjs.normalizeMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ');
  assert.equal(video.kind, 'video');
  assert.equal(video.id, 'youtube:video:dQw4w9WgXcQ');

  const playlist = cjs.normalizeMusicLink('https://www.youtube.com/playlist?list=RDdQw4w9WgXcQ');
  assert.equal(playlist.kind, 'playlist');
  assert.notEqual(playlist.id, video.id);
});

test('normalizeMusicLink tolerates host, scheme and path variants', () => {
  const canonical = cjs.normalizeMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  for (const variant of [
    'youtube.com/watch?v=dQw4w9WgXcQ',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=42',
    '  https://youtu.be/dQw4w9WgXcQ  '
  ]) {
    assert.deepEqual(cjs.normalizeMusicLink(variant), canonical, variant);
  }

  // Regional and mirror VK hosts address the same video and must dedupe.
  const vk = cjs.normalizeMusicLink('https://vkvideo.ru/video-1_2');
  for (const variant of ['https://vk.com/video-1_2', 'https://vk.ru/video-1_2', 'https://m.vk.com/video-1_2']) {
    assert.deepEqual(cjs.normalizeMusicLink(variant), vk, variant);
  }
});

test('normalizeMusicLink rejects malformed, foreign and hostile links', () => {
  for (const bad of [
    null,
    undefined,
    42,
    {},
    '',
    '   ',
    'https://music.yandex.ru/track/42',
    'https://soundcloud.com/artist/track',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    // A lookalike host must not pass on a suffix match.
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=tooshort',
    'https://www.youtube.com/watch?v=waaaaaaaaaytoolong',
    'https://www.youtube.com/channel/UCabcdefghij',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://www.youtube.com/playlist',
    'https://vk.com/video-1_2_3',
    'https://vk.com/videoabc_def',
    'https://vk.com/id12345',
    'https://rutube.ru/video/NOTHEX/',
    'https://rutube.ru/video/0123456789abcdef/',
    'https://rutube.ru/plst/abc/',
    'javascript:alert(1)//www.youtube.com/watch?v=dQw4w9WgXcQ',
    `https://www.youtube.com/watch?v=dQw4w9WgXcQ&q=${'x'.repeat(2100)}`
  ]) {
    assert.equal(cjs.normalizeMusicLink(bad), null, String(bad).slice(0, 60));
  }
});

test('normalizeMusicTrackRef round-trips a ref and rejects cross-source ids', () => {
  for (const link of [
    'https://vkvideo.ru/video-1_2',
    'https://rutube.ru/plst/12345/',
    'https://youtu.be/dQw4w9WgXcQ'
  ]) {
    const ref = cjs.normalizeMusicLink(link);
    assert.deepEqual(cjs.normalizeMusicTrackRef(ref), ref, link);
    // The raw link string is an accepted ref too.
    assert.deepEqual(cjs.normalizeMusicTrackRef(link), ref, link);
  }

  // Each source validates ids with its own pattern, so a well-formed id from one
  // source must not be accepted under another.
  assert.equal(cjs.normalizeMusicTrackRef({ source: 'youtube', kind: 'video', videoId: '-1_2' }), null);
  assert.equal(cjs.normalizeMusicTrackRef({ source: 'vk', kind: 'video', videoId: 'dQw4w9WgXcQ' }), null);
  assert.equal(cjs.normalizeMusicTrackRef({ source: 'rutube', kind: 'video', videoId: 'dQw4w9WgXcQ' }), null);

  // The id field must match the kind: a video ref carrying only a playlistId is
  // not silently reinterpreted.
  assert.equal(cjs.normalizeMusicTrackRef({ source: 'youtube', kind: 'video', playlistId: 'PLabc' }), null);
  assert.equal(cjs.normalizeMusicTrackRef({ source: 'youtube', kind: 'playlist', videoId: 'dQw4w9WgXcQ' }), null);

  assert.equal(cjs.normalizeMusicTrackRef({ source: 'spotify', kind: 'video', videoId: 'dQw4w9WgXcQ' }), null);
  assert.equal(cjs.normalizeMusicTrackRef({ source: 'youtube', kind: 'album', videoId: 'dQw4w9WgXcQ' }), null);
  assert.equal(cjs.normalizeMusicTrackRef({ kind: 'video', videoId: 'dQw4w9WgXcQ' }), null);
  assert.equal(cjs.normalizeMusicTrackRef(null), null);
});

test('only a playlist ref is expandable', () => {
  assert.equal(cjs.isMusicExpandableRef('https://www.youtube.com/playlist?list=PLabc'), true);
  assert.equal(cjs.isMusicExpandableRef('https://rutube.ru/plst/12345/'), true);
  assert.equal(cjs.isMusicExpandableRef('https://vk.com/playlist/-1_2'), true);
  assert.equal(cjs.isMusicExpandableRef('https://youtu.be/dQw4w9WgXcQ'), false);
  assert.equal(cjs.isMusicExpandableRef('https://vkvideo.ru/video-1_2'), false);
  assert.equal(cjs.isMusicExpandableRef('https://example.com'), false);
});

test('CJS and ESM builds expose the same normalization behaviour', async () => {
  const esm = await import('../src/room-music.mjs');
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).filter((key) => key !== 'default').sort());
  assert.deepEqual(
    esm.normalizeMusicLink('https://youtu.be/dQw4w9WgXcQ'),
    cjs.normalizeMusicLink('https://youtu.be/dQw4w9WgXcQ')
  );
  assert.deepEqual(
    esm.normalizeMusicLink('https://vk.com/clip-1_2'),
    cjs.normalizeMusicLink('https://vk.com/clip-1_2')
  );
  assert.equal(esm.MUSIC_QUEUE_MAX_ITEMS, 100);
  assert.equal(esm.MUSIC_EXPANSION_MAX_ITEMS, 50);
});

test('limits, sources and error codes are the contract values the plan fixes', () => {
  assert.equal(cjs.MUSIC_QUEUE_MAX_ITEMS, 100);
  assert.equal(cjs.MUSIC_EXPANSION_MAX_ITEMS, 50);
  assert.deepEqual([...cjs.MUSIC_SESSION_STATUSES], ['idle', 'resolving', 'playing', 'unavailable']);
  assert.deepEqual([...cjs.MUSIC_TRACK_REF_KINDS], ['video', 'playlist']);

  // The source list is part of the wire contract and does not vary per
  // deployment: whether a source is reachable is the bot's fact, reported as
  // `source_unavailable`, not something the client is rebuilt to learn.
  assert.deepEqual([...cjs.MUSIC_SOURCES], ['vk', 'rutube', 'youtube']);
  assert.equal(cjs.isMusicSource('youtube'), true);
  assert.equal(cjs.isMusicSource('yandex'), false);
  for (const source of cjs.MUSIC_SOURCES) {
    assert.ok(cjs.MUSIC_SOURCE_HOSTS[source].length > 0, source);
    assert.ok(cjs.MUSIC_CANONICAL_HOSTS[source], source);
  }

  assert.deepEqual([...cjs.MUSIC_ERROR_CODES], [
    'forbidden',
    'room_not_static',
    'queue_capacity_exceeded',
    'invalid_link',
    'source_unavailable',
    'music_unavailable'
  ]);
  assert.equal(cjs.isMusicErrorCode('source_unavailable'), true);
  assert.equal(cjs.isMusicErrorCode('forbidden'), true);
  assert.equal(cjs.isMusicErrorCode('nope'), false);
  assert.equal(cjs.isMusicSessionStatus('playing'), true);
  assert.equal(cjs.isMusicSessionStatus('paused'), false);
});

test('planMusicEnqueue caps an expansion at 50 items', () => {
  const items = Array.from({ length: 120 }, (_, index) => makeItem(index));
  const plan = cjs.planMusicEnqueue({ queueLength: 0, items });
  assert.equal(plan.ok, true);
  assert.equal(plan.items.length, 50);
  assert.equal(plan.items[49].id, 'item-49');
});

test('planMusicEnqueue rejects the whole link when the expansion does not fit (AC-6)', () => {
  const expansion = Array.from({ length: 50 }, (_, index) => makeItem(index));
  assert.deepEqual(cjs.planMusicEnqueue({ queueLength: 50, items: expansion }), { ok: true, items: expansion });

  const overflow = cjs.planMusicEnqueue({ queueLength: 51, items: expansion });
  assert.deepEqual(overflow, { ok: false, code: 'queue_capacity_exceeded' });
  assert.equal('items' in overflow, false, 'overflow must never hand back a partial batch');

  assert.deepEqual(cjs.planMusicEnqueue({ queueLength: 100, items: [makeItem(0)] }), {
    ok: false,
    code: 'queue_capacity_exceeded'
  });
  assert.deepEqual(cjs.planMusicEnqueue({ queueLength: 99, items: [makeItem(0)] }), {
    ok: true,
    items: [makeItem(0)]
  });
  assert.deepEqual(cjs.planMusicEnqueue({ queueLength: 0, items: [] }), { ok: false, code: 'invalid_link' });
  assert.equal(cjs.planMusicEnqueue({ queueLength: 101, items: [makeItem(0)] }), null);
  assert.equal(cjs.planMusicEnqueue({ queueLength: -1, items: [makeItem(0)] }), null);
  assert.equal(cjs.planMusicEnqueue({ queueLength: 1.5, items: [makeItem(0)] }), null);
  assert.equal(cjs.planMusicEnqueue({ queueLength: 0, items: 'nope' }), null);
  assert.equal(cjs.planMusicEnqueue(), null);
});

test('normalizeMusicQueueItem enforces the item shape', () => {
  assert.deepEqual(cjs.normalizeMusicQueueItem(makeItem(1)), {
    id: 'item-1',
    trackRef: cjs.normalizeMusicTrackRef({ source: 'youtube', kind: 'video', videoId: videoIdFor(1) }),
    addedBy: 'peer-1',
    title: 'Track 1',
    artist: 'Artist',
    coverUrl: null,
    durationMs: 180000
  });
  const withLink = cjs.normalizeMusicQueueItem({ ...makeItem(2), trackRef: 'https://vkvideo.ru/video-1_2' });
  assert.equal(withLink.trackRef.id, 'vk:video:-1_2');
  assert.equal(cjs.normalizeMusicQueueItem({ ...makeItem(3), durationMs: null }).durationMs, null);
  assert.equal(cjs.normalizeMusicQueueItem({ ...makeItem(3), coverUrl: '' }).coverUrl, null);

  for (const broken of [
    null,
    'item',
    { ...makeItem(4), id: '' },
    { ...makeItem(4), addedBy: '   ' },
    { ...makeItem(4), title: '' },
    { ...makeItem(4), trackRef: 'https://example.com/track/1' },
    { ...makeItem(4), trackRef: { source: 'youtube', kind: 'video' } },
    { ...makeItem(4), durationMs: -1 },
    { ...makeItem(4), durationMs: 'long' }
  ]) {
    assert.equal(cjs.normalizeMusicQueueItem(broken), null);
  }
});

test('normalizeMusicQueueItem accepts only https cover art', async () => {
  // coverUrl is rendered straight into an <img src> and the edge CSP sets no
  // img-src directive, so the scheme is constrained at this boundary.
  const cover = (value) => cjs.normalizeMusicQueueItem({ ...makeItem(1), coverUrl: value })?.coverUrl;

  assert.equal(cover('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(cover('  https://i.ytimg.com/vi/x/cover.jpg  '), 'https://i.ytimg.com/vi/x/cover.jpg');

  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
    'data:text/html,<script>alert(1)</script>',
    'http://i.ytimg.com/vi/x/cover.jpg',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//i.ytimg.com/vi/x/cover.jpg',
    '/relative/cover.jpg',
    'i.ytimg.com/vi/x/cover.jpg',
    'not a url at all'
  ]) {
    assert.equal(cover(hostile), null, `cover art must reject ${hostile}`);
  }

  // A rejected cover degrades to null; it never keeps the track out of the queue.
  const item = cjs.normalizeMusicQueueItem({ ...makeItem(1), coverUrl: 'javascript:alert(1)' });
  assert.equal(item.id, 'item-1');
  assert.equal(item.title, 'Track 1');

  const esm = await import('../src/room-music.mjs');
  assert.equal(esm.normalizeMusicQueueItem({ ...makeItem(1), coverUrl: 'javascript:alert(1)' }).coverUrl, null);
  assert.equal(
    esm.normalizeMusicQueueItem({ ...makeItem(1), coverUrl: 'https://i.ytimg.com/vi/x/cover.jpg' }).coverUrl,
    'https://i.ytimg.com/vi/x/cover.jpg'
  );
});

test('session normalization keeps the 100-item cap and heartbeat staleness rule', () => {
  const queue = Array.from({ length: 100 }, (_, index) => makeItem(index));
  const session = cjs.normalizeMusicSession({
    status: 'playing',
    currentItem: makeItem(0),
    positionMs: 1200,
    positionAt: 1_000_000,
    queue,
    sessionEpoch: 3
  });
  assert.equal(session.contractVersion, 1);
  assert.equal(session.queue.length, 100);
  assert.equal(session.status, 'playing');
  assert.equal(session.sessionEpoch, 3);

  assert.equal(cjs.normalizeMusicSession({ status: 'playing', queue: [...queue, makeItem(100)] }), null);
  assert.equal(cjs.normalizeMusicSession({ status: 'paused' }), null);
  assert.equal(cjs.normalizeMusicSession({ status: 'idle', positionMs: -1 }), null);
  assert.equal(cjs.normalizeMusicSession({ status: 'idle', currentItem: { id: 'x' } }), null);

  assert.equal(cjs.MUSIC_HEARTBEAT_INTERVAL_MS, 2000);
  assert.equal(cjs.MUSIC_POSITION_STALE_MS, 6000);
  assert.equal(cjs.MUSIC_WATCHDOG_GRACE_MS, 15000);
  assert.equal(cjs.isMusicPositionStale(1000, 7000), false);
  assert.equal(cjs.isMusicPositionStale(1000, 7001), true);
  assert.equal(cjs.isMusicPositionStale(null, 7000), true);
});

test('buildMusicSession fills defaults and drops unusable entries', () => {
  assert.deepEqual(cjs.buildMusicSession(), {
    contractVersion: 1,
    status: 'idle',
    currentItem: null,
    positionMs: 0,
    positionAt: null,
    queue: [],
    sessionEpoch: 0
  });
  const built = cjs.buildMusicSession({ status: 'bogus', queue: [makeItem(1), { id: 'broken' }], positionMs: -5 });
  assert.equal(built.status, 'idle');
  assert.equal(built.queue.length, 1);
  assert.equal(built.positionMs, 0);
});

test('normalizeMusicCommand validates the four client payloads', () => {
  assert.deepEqual(cjs.normalizeMusicCommand('room.music.enqueue', { link: 'https://youtu.be/dQw4w9WgXcQ' }), {
    type: 'room.music.enqueue',
    trackRef: cjs.normalizeMusicLink('https://youtu.be/dQw4w9WgXcQ')
  });
  assert.equal(cjs.normalizeMusicCommand('room.music.enqueue', { link: 'https://example.com' }), null);
  assert.deepEqual(cjs.normalizeMusicCommand('room.music.skip', {}), { type: 'room.music.skip', itemId: null });
  assert.deepEqual(cjs.normalizeMusicCommand('room.music.skip', { itemId: 'i-1' }), {
    type: 'room.music.skip',
    itemId: 'i-1'
  });
  assert.equal(cjs.normalizeMusicCommand('room.music.skip', { itemId: '' }), null);
  assert.deepEqual(cjs.normalizeMusicCommand('room.music.remove', { itemId: 'i-1' }), {
    type: 'room.music.remove',
    itemId: 'i-1'
  });
  assert.equal(cjs.normalizeMusicCommand('room.music.remove', {}), null);
  assert.deepEqual(cjs.normalizeMusicCommand('room.music.stop'), { type: 'room.music.stop' });
  assert.equal(cjs.normalizeMusicCommand('room.music.pause', {}), null);
});

test('normalizeMusicCommand accepts an already-shaped trackRef on enqueue', async () => {
  const canonical = cjs.normalizeMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  // The documented union member is enqueue{trackRef}; a caller that already holds
  // a ref must not have to re-serialize it back into a link.
  assert.deepEqual(cjs.normalizeMusicCommand('room.music.enqueue', { trackRef: canonical }), {
    type: 'room.music.enqueue',
    trackRef: canonical
  });
  assert.deepEqual(
    cjs.normalizeMusicCommand('room.music.enqueue', {
      trackRef: { source: 'vk', kind: 'video', videoId: '-1_2' }
    }),
    {
      type: 'room.music.enqueue',
      trackRef: cjs.normalizeMusicTrackRef({ source: 'vk', kind: 'video', videoId: '-1_2' })
    }
  );
  // A trackRef may also be the raw link string.
  assert.deepEqual(cjs.normalizeMusicCommand('room.music.enqueue', { trackRef: 'https://youtu.be/dQw4w9WgXcQ' }), {
    type: 'room.music.enqueue',
    trackRef: cjs.normalizeMusicLink('https://youtu.be/dQw4w9WgXcQ')
  });
  // A malformed trackRef is rejected rather than falling back to link/url.
  assert.equal(cjs.normalizeMusicCommand('room.music.enqueue', { trackRef: { source: 'youtube', kind: 'video' } }), null);
  assert.equal(cjs.normalizeMusicCommand('room.music.enqueue', { trackRef: { source: 'nope', kind: 'video', videoId: 'dQw4w9WgXcQ' } }), null);
  assert.equal(
    cjs.normalizeMusicCommand('room.music.enqueue', {
      trackRef: { source: 'youtube', kind: 'video', videoId: 'not-an-id' },
      link: 'https://youtu.be/dQw4w9WgXcQ'
    }),
    null
  );
  // `link`/`url` stay link-only, so an object there cannot smuggle in a ref.
  assert.equal(cjs.normalizeMusicCommand('room.music.enqueue', { link: canonical }), null);

  const esm = await import('../src/room-music.mjs');
  assert.deepEqual(esm.normalizeMusicCommand('room.music.enqueue', { trackRef: canonical }), {
    type: 'room.music.enqueue',
    trackRef: canonical
  });
});

test('the four music commands are known client types', () => {
  for (const type of cjs.MUSIC_CLIENT_COMMAND_TYPES) {
    assert.equal(KNOWN_CLIENT_TYPES.has(type), true, type);
  }
});

test('declarations mirror the runtime contract', () => {
  const declarations = require('node:fs').readFileSync(require.resolve('../src/room-music.d.ts'), 'utf8');
  assert.match(declarations, /MUSIC_QUEUE_MAX_ITEMS: 100/);
  assert.match(declarations, /MUSIC_EXPANSION_MAX_ITEMS: 50/);
  assert.match(declarations, /'idle' \| 'resolving' \| 'playing' \| 'unavailable'/);
  assert.match(declarations, /'vk' \| 'rutube' \| 'youtube'/);
  assert.match(declarations, /queue_capacity_exceeded/);
  assert.match(declarations, /source_unavailable/);
  for (const name of Object.keys(cjs)) {
    assert.match(declarations, new RegExp(`\\b${name}\\b`), `${name} missing from room-music.d.ts`);
  }
});
