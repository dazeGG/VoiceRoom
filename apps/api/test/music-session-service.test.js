'use strict';

// Server-side music authority: permissions, FIFO, advance, watchdog, stale
// callback rejection, position staleness, fail-open and teardown.
//
// These are deliberately storage-free. Everything the service touches is
// injected, so the whole state machine is exercised without a database and
// without real timers.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MUSIC_POSITION_STALE_MS,
  MUSIC_QUEUE_MAX_ITEMS,
  MUSIC_WATCHDOG_GRACE_MS,
  isMusicPositionStale,
  normalizeMusicCommand
} = require('@voice-room/shared/room-music');
const {
  MUSIC_COMMAND_RATE_LIMIT,
  createMusicSessionService
} = require('../src/domains/music/music-session-service');
const { musicBotIdentityFor } = require('../src/domains/music/music-bot-token');
const { normalizePeerId } = require('@voice-room/shared/validation');

const ROOM_ID = 'room-static';
const OWNER_PEER = 'peer-owner';
const AUTHOR_PEER = 'peer-author';
const STRANGER_PEER = 'peer-stranger';
const LINK = 'https://vkvideo.ru/video-12345_67890';

function createClock(start = 1_700_000_000_000) {
  let current = start;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => current,
    setTimeout(fn, delay) {
      const id = ++sequence;
      timers.set(id, { fn, at: current + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    advance(ms) {
      const target = current + ms;
      for (;;) {
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!due || timer.at < due[1].at)) due = [id, timer];
        }
        if (!due) break;
        timers.delete(due[0]);
        current = due[1].at;
        due[1].fn();
      }
      current = target;
    }
  };
}

// Lets an internal `void advance(...)` promise chain settle.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// A play request the test holds open, so a command can land while the session
// is `resolving` — the window where the bot is running yt-dlp and ffmpeg.
function createGate() {
  let release = () => {};
  const opened = new Promise((resolve) => { release = resolve; });
  return { opened, release };
}

// One entry of a bot `/resolve` response. `source` and `videoId` are the only
// fields the API turns into a trackRef, so they are what the shape tests below
// pin down.
function track(index, { durationMs = 180000, source = 'vk' } = {}) {
  return {
    source,
    videoId: `-12345_${1000 + index}`,
    title: `Track ${index}`,
    artists: ['Artist'],
    durationMs,
    coverUrl: null
  };
}

function createFakeBot({ resolve, play, enabled = true } = {}) {
  const calls = { resolve: [], play: [], stop: [], health: [] };
  return {
    enabled,
    calls,
    async resolveLink(link, limit) {
      calls.resolve.push({ link, limit });
      if (typeof resolve === 'function') return resolve(link, limit);
      return { ok: true, status: 200, data: { items: [track(1)] } };
    },
    async play(roomId, body) {
      calls.play.push({ roomId, body });
      if (typeof play === 'function') return play(roomId, body);
      return { ok: true, status: 202, data: {} };
    },
    async stop(roomId, sessionEpoch) {
      calls.stop.push({ roomId, sessionEpoch });
      return { ok: true, status: 200, data: {} };
    },
    async health() {
      calls.health.push({});
      return { ok: true, status: 200, data: { rooms: 0 } };
    }
  };
}

function createHarness({ bot = createFakeBot(), clock = createClock() } = {}) {
  const musicRooms = new Map();
  const events = [];
  const removedParticipants = [];
  const service = createMusicSessionService({
    musicRooms,
    botClient: bot,
    publish: (roomId, type, payload) => events.push({ roomId, type, payload }),
    getLiveKitConfig: () => ({
      apiKey: 'devkey',
      apiSecret: 'devsecretdevsecretdevsecretdevsecret',
      url: 'ws://livekit:7880'
    }),
    getLiveKitRoomName: (roomId) => `voice-room-${roomId}`,
    removeLiveKitParticipant: async (roomId, identity) => {
      removedParticipants.push({ roomId, identity });
    },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  const command = (type, payload) => normalizeMusicCommand(type, payload);
  // Each named peer stands for a distinct signed-in person unless a test says
  // otherwise, so `accountUserId` defaults from the peer id here rather than in
  // the service — the service must never derive identity from a peer id.
  const run = (peerId, type, payload, {
    isMaster = false,
    isStatic = true,
    accountUserId = `account-${peerId}`,
    clientIp = '203.0.113.7'
  } = {}) => service.handleCommand({
    roomId: ROOM_ID,
    peerId,
    accountUserId,
    clientIp,
    isMaster,
    isStatic,
    command: command(type, payload)
  });
  return { bot, clock, events, musicRooms, removedParticipants, run, service, state: () => musicRooms.get(ROOM_ID) };
}

test('every music command is rejected outside a static room', async () => {
  const h = createHarness();
  for (const [type, payload] of [
    ['room.music.enqueue', { link: LINK }],
    ['room.music.skip', {}],
    ['room.music.remove', { itemId: 'x' }],
    ['room.music.stop', {}]
  ]) {
    const result = await h.run(AUTHOR_PEER, type, payload, { isStatic: false });
    assert.deepEqual(result, { ok: false, code: 'room_not_static' }, `${type} must be refused`);
  }
  assert.equal(h.bot.calls.resolve.length, 0, 'a non-static room must never reach the bot');
});

test('authorship is keyed on peerId, so one guest cannot control another guest item', async () => {
  const h = createHarness();
  assert.deepEqual(await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }), { ok: true });
  await flush();
  const current = h.state().currentItem;
  assert.ok(current, 'the enqueued item must start playing');
  assert.equal(current.addedBy, AUTHOR_PEER);

  // Both peers are guests: accountUserId is null for each of them, so a check on
  // the account id would have made this succeed.
  assert.deepEqual(
    await h.run(STRANGER_PEER, 'room.music.skip', { itemId: current.id }),
    { ok: false, code: 'forbidden' }
  );
  assert.deepEqual(
    await h.run(STRANGER_PEER, 'room.music.remove', { itemId: current.id }),
    { ok: false, code: 'forbidden' }
  );
  assert.equal(h.state().currentItem.id, current.id, 'a refused skip must not change the session');

  assert.deepEqual(await h.run(AUTHOR_PEER, 'room.music.skip', { itemId: current.id }), { ok: true });
  await flush();
  assert.equal(h.state().currentItem, null);
});

test('the master may skip and remove items authored by anyone', async () => {
  const h = createHarness({
    bot: createFakeBot({ resolve: async () => ({ ok: true, data: { items: [track(1), track(2)] } }) })
  });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const current = h.state().currentItem;
  const queued = h.state().queue[0];

  assert.deepEqual(
    await h.run(OWNER_PEER, 'room.music.remove', { itemId: queued.id }, { isMaster: true }),
    { ok: true }
  );
  assert.equal(h.state().queue.length, 0);
  assert.deepEqual(
    await h.run(OWNER_PEER, 'room.music.skip', { itemId: current.id }, { isMaster: true }),
    { ok: true }
  );
  await flush();
  assert.equal(h.state().currentItem, null);
});

test('stop is master-only and empties the session immediately', async () => {
  const h = createHarness({
    bot: createFakeBot({ resolve: async () => ({ ok: true, data: { items: [track(1), track(2), track(3)] } }) })
  });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  assert.equal(h.state().queue.length, 2);

  assert.deepEqual(await h.run(AUTHOR_PEER, 'room.music.stop', {}), { ok: false, code: 'forbidden' });
  assert.ok(h.state().currentItem, 'a refused stop must leave playback running');

  // AC-4: state converges before any bot call is awaited.
  assert.deepEqual(await h.run(OWNER_PEER, 'room.music.stop', {}, { isMaster: true }), { ok: true });
  assert.equal(h.state().status, 'idle');
  assert.equal(h.state().currentItem, null);
  assert.equal(h.state().queue.length, 0);
  await flush();
  assert.equal(h.bot.calls.stop.at(-1).roomId, ROOM_ID);
  assert.deepEqual(h.removedParticipants.at(-1), {
    roomId: ROOM_ID,
    identity: musicBotIdentityFor(ROOM_ID)
  });
});

test('an expansion keeps FIFO order and advances to the next item on track-ended', async () => {
  const h = createHarness({
    bot: createFakeBot({ resolve: async () => ({ ok: true, data: { items: [track(1), track(2), track(3)] } }) })
  });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();

  assert.equal(h.state().currentItem.title, 'Track 1');
  assert.deepEqual(h.state().queue.map((item) => item.title), ['Track 2', 'Track 3']);

  const firstEpoch = h.state().sessionEpoch;
  const firstId = h.state().currentItem.id;
  assert.deepEqual(
    h.service.handleTrackEnded({ roomId: ROOM_ID, sessionEpoch: firstEpoch, itemId: firstId }),
    { ok: true }
  );
  await flush();
  assert.equal(h.state().currentItem.title, 'Track 2');
  assert.deepEqual(h.state().queue.map((item) => item.title), ['Track 3']);
  assert.ok(h.state().sessionEpoch > firstEpoch, 'the epoch must advance with the item');
});

test('a stale (sessionEpoch, itemId) pair is rejected on both callbacks', async () => {
  const h = createHarness({
    bot: createFakeBot({ resolve: async () => ({ ok: true, data: { items: [track(1), track(2)] } }) })
  });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const { sessionEpoch, currentItem } = h.state();

  assert.deepEqual(
    h.service.handleTrackEnded({ roomId: ROOM_ID, sessionEpoch: sessionEpoch - 1, itemId: currentItem.id }),
    { ok: false, code: 'stale' },
    'an old epoch must be refused'
  );
  assert.deepEqual(
    h.service.handleHeartbeat({ roomId: ROOM_ID, sessionEpoch, itemId: 'some-other-item', positionMs: 10 }),
    { ok: false, code: 'stale' },
    'an item the session is not playing must be refused'
  );
  assert.equal(h.state().currentItem.id, currentItem.id, 'a stale callback must not move the queue');

  // The live pair still works.
  assert.deepEqual(
    h.service.handleHeartbeat({ roomId: ROOM_ID, sessionEpoch, itemId: currentItem.id, positionMs: 4000 }),
    { ok: true }
  );
  assert.equal(h.state().positionMs, 4000);
});

test('the watchdog advances the queue when track-ended is lost', async () => {
  const clock = createClock();
  const h = createHarness({
    clock,
    bot: createFakeBot({
      resolve: async () => ({
        ok: true,
        data: { items: [track(1, { durationMs: 10000 }), track(2, { durationMs: 10000 })] }
      })
    })
  });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const firstId = h.state().currentItem.id;

  clock.advance(10000 + MUSIC_WATCHDOG_GRACE_MS - 1);
  await flush();
  assert.equal(h.state().currentItem.id, firstId, 'the watchdog must not fire early');

  clock.advance(2);
  await flush();
  assert.equal(h.state().currentItem.title, 'Track 2', 'a lost callback must not stall the queue');
});

test('position authority comes from the heartbeat and goes stale after the shared window', async () => {
  const clock = createClock();
  const h = createHarness({ clock });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const { sessionEpoch, currentItem } = h.state();

  h.service.handleHeartbeat({ roomId: ROOM_ID, sessionEpoch, itemId: currentItem.id, positionMs: 2000 });
  const positionAt = h.state().positionAt;
  assert.equal(positionAt, clock.now());
  assert.equal(isMusicPositionStale(positionAt, clock.now()), false);
  assert.equal(isMusicPositionStale(positionAt, clock.now() + MUSIC_POSITION_STALE_MS), false);
  assert.equal(isMusicPositionStale(positionAt, clock.now() + MUSIC_POSITION_STALE_MS + 1), true);

  // Wall-clock time passing on its own must never move the reported position.
  clock.advance(30000);
  assert.equal(h.state().positionMs, 2000);
});

test('a hung bot fails open to unavailable instead of throwing', async () => {
  const hungResolve = createHarness({
    bot: createFakeBot({
      resolve: async () => ({ ok: false, code: 'music_unavailable', reason: 'timeout' })
    })
  });
  assert.deepEqual(
    await hungResolve.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }),
    { ok: false, code: 'music_unavailable' }
  );
  assert.equal(hungResolve.state().status, 'unavailable');

  const hungPlay = createHarness({
    bot: createFakeBot({ play: async () => ({ ok: false, code: 'music_unavailable', reason: 'timeout' }) })
  });
  assert.deepEqual(await hungPlay.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }), { ok: true });
  await flush();
  assert.equal(hungPlay.state().status, 'unavailable');
  assert.equal(hungPlay.state().currentItem, null);
  assert.equal(hungPlay.state().queue.length, 1, 'the item is kept so it can be retried');
});

test('an expansion that does not fit entirely is refused as a whole (AC-6)', async () => {
  const many = Array.from({ length: 50 }, (_, index) => track(index + 1));
  const h = createHarness({ bot: createFakeBot({ resolve: async () => ({ ok: true, data: { items: many } }) }) });

  // Fill the queue to a point where the next 50 cannot fit under the cap.
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const filler = h.state().queue.slice();
  while (h.state().queue.length < MUSIC_QUEUE_MAX_ITEMS - 10) {
    h.state().queue.push({ ...filler[0], id: `filler-${h.state().queue.length}` });
  }
  const before = h.state().queue.length;

  assert.deepEqual(
    await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }),
    { ok: false, code: 'queue_capacity_exceeded' }
  );
  assert.equal(h.state().queue.length, before, 'a partial add must never happen');
});

test('every music command shares one rate budget', async () => {
  const h = createHarness();
  for (let index = 0; index < MUSIC_COMMAND_RATE_LIMIT; index += 1) {
    assert.deepEqual(await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }), { ok: true });
  }
  assert.deepEqual(
    await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }),
    { ok: false, code: 'forbidden' },
'the rate limit protects the single egress address the bot resolves through'
  );
  // The limit is per caller, not per room.
  assert.deepEqual(await h.run(STRANGER_PEER, 'room.music.enqueue', { link: LINK }), { ok: true });
});

test('the rate budget is keyed on the account, so a fresh peer id does not reset it', async () => {
  const h = createHarness();
  // A peer id is whatever the client sent at join. If the budget were keyed on
  // it, leaving and rejoining under a new random one would refill it for free
  // and the limit would be decorative.
  for (let index = 0; index < MUSIC_COMMAND_RATE_LIMIT; index += 1) {
    assert.deepEqual(
      await h.run(`churned-peer-${index}`, 'room.music.enqueue', { link: LINK }, {
        accountUserId: 'account-attacker'
      }),
      { ok: true }
    );
  }
  assert.deepEqual(
    await h.run('churned-peer-final', 'room.music.enqueue', { link: LINK }, {
      accountUserId: 'account-attacker'
    }),
    { ok: false, code: 'forbidden' },
    'a new peer id under the same account must not buy a new budget'
  );
  // A different account from the same address keeps its own budget.
  assert.deepEqual(
    await h.run('other-peer-1', 'room.music.enqueue', { link: LINK }, { accountUserId: 'account-other' }),
    { ok: true }
  );
});

test('a guest with no account is keyed on the connecting address', async () => {
  const h = createHarness();
  for (let index = 0; index < MUSIC_COMMAND_RATE_LIMIT; index += 1) {
    assert.deepEqual(
      await h.run(`guest-peer-${index}`, 'room.music.enqueue', { link: LINK }, {
        accountUserId: '',
        clientIp: '198.51.100.4'
      }),
      { ok: true }
    );
  }
  assert.deepEqual(
    await h.run('guest-peer-final', 'room.music.enqueue', { link: LINK }, {
      accountUserId: '',
      clientIp: '198.51.100.4'
    }),
    { ok: false, code: 'forbidden' },
    'guests behind one address share a budget: that is the point'
  );
  assert.deepEqual(
    await h.run('guest-elsewhere', 'room.music.enqueue', { link: LINK }, {
      accountUserId: '',
      clientIp: '198.51.100.5'
    }),
    { ok: true }
  );
});

test('spent rate buckets are swept instead of accumulating for the life of the room', async () => {
  const h = createHarness();
  // One command from each of many distinct addresses, as peer-id churn behind a
  // large NAT range would produce.
  for (let index = 0; index < 200; index += 1) {
    await h.run(`peer-${index}`, 'room.music.skip', { itemId: 'missing' }, {
      accountUserId: '',
      clientIp: `198.51.100.${index}`
    });
  }
  const beforeSweep = h.state().commandHistory.size;
  assert.ok(beforeSweep > 0);

  // Every bucket is now outside the window, so the next command must clear them
  // rather than let the map grow for the life of a long-lived static room.
  h.clock.advance(11000);
  await h.run('peer-final', 'room.music.skip', { itemId: 'missing' }, {
    accountUserId: '',
    clientIp: '198.51.100.250'
  });
  assert.equal(h.state().commandHistory.size, 1, 'only the live bucket may survive');
});

test('skip, remove and stop are throttled too, because each skip costs an upstream resolve', async () => {
  const many = Array.from({ length: 20 }, (_, index) => track(index + 1));
  const h = createHarness({ bot: createFakeBot({ resolve: async () => ({ ok: true, data: { items: many } }) }) });

  // One enqueue token buys a 20-item queue; skipping through it must not then
  // be free, or the enqueue budget protects nothing.
  assert.deepEqual(await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }), { ok: true });
  await flush();

  for (let index = 1; index < MUSIC_COMMAND_RATE_LIMIT; index += 1) {
    assert.deepEqual(
      await h.run(AUTHOR_PEER, 'room.music.skip', { itemId: h.state().currentItem.id }),
      { ok: true },
      `skip ${index} must be accepted`
    );
    await flush();
  }
  const playsAtLimit = h.bot.calls.play.length;
  assert.deepEqual(
    await h.run(AUTHOR_PEER, 'room.music.skip', { itemId: h.state().currentItem.id }),
    { ok: false, code: 'forbidden' }
  );
  assert.deepEqual(
    await h.run(AUTHOR_PEER, 'room.music.remove', { itemId: h.state().queue[0].id }),
    { ok: false, code: 'forbidden' }
  );
  assert.deepEqual(
    await h.run(AUTHOR_PEER, 'room.music.stop', {}, { isMaster: true }),
    { ok: false, code: 'forbidden' },
    'a master is not exempt: stop costs a bot DELETE and a LiveKit removal'
  );
  await flush();
  assert.equal(h.bot.calls.play.length, playsAtLimit, 'a throttled command must never reach the bot');

  // The window is a sliding one, so the peer is not banned, only slowed.
  h.clock.advance(11000);
  assert.deepEqual(
    await h.run(AUTHOR_PEER, 'room.music.skip', { itemId: h.state().currentItem.id }),
    { ok: true }
  );
});

test('a stop carries the epoch of the session it ends, so it cannot kill a newer one', async () => {
  const h = createHarness();
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const runningEpoch = h.bot.calls.play[0].body.sessionEpoch;

  await h.run(OWNER_PEER, 'room.music.stop', {}, { isMaster: true });
  await flush();

  // The bot refuses a DELETE older than the session it is running. Sending null
  // made that guard unreachable, so a slow teardown could evict a session that
  // had already started in its place.
  assert.equal(h.bot.calls.stop.at(-1).sessionEpoch, runningEpoch);
});

test('an exhausted queue and an emptied room both stop the bot at their own epoch', async () => {
  const h = createHarness();
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const endedEpoch = h.state().sessionEpoch;
  h.service.handleTrackEnded({
    roomId: ROOM_ID,
    sessionEpoch: endedEpoch,
    itemId: h.state().currentItem.id
  });
  await flush();
  assert.equal(h.bot.calls.stop.at(-1).sessionEpoch, endedEpoch);

  const other = createHarness();
  await other.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const liveEpoch = other.state().sessionEpoch;
  other.service.handleRoomEmpty(ROOM_ID);
  await flush();
  assert.equal(other.bot.calls.stop.at(-1).sessionEpoch, liveEpoch);
});

test('reconcile discards sessions through the same teardown, leaving no timer behind', async () => {
  const h = createHarness();
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  assert.ok(h.clock.pending() > 0, 'a playing session arms a watchdog');

  const result = await h.service.reconcile({ roomIds: [ROOM_ID] });
  assert.equal(result.ok, true);
  assert.equal(h.musicRooms.has(ROOM_ID), false);
  // A bare `musicRooms.delete` leaves the watchdog armed against a state
  // nothing owns any more.
  assert.equal(h.clock.pending(), 0, 'the watchdog must be cancelled with the session');
  assert.equal(h.bot.calls.stop.at(-1).sessionEpoch, null, 'a restart knows no epoch to compare');
});

test('an emptied room tears the session down and stops the bot', async () => {
  const h = createHarness();
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  assert.ok(h.musicRooms.has(ROOM_ID));
  const stopsBefore = h.bot.calls.stop.length;

  h.service.handleRoomEmpty(ROOM_ID);
  await flush();

  assert.equal(h.musicRooms.has(ROOM_ID), false, 'the session state must be discarded');
  assert.equal(h.clock.pending(), 0, 'the watchdog must be cancelled');
  assert.ok(h.bot.calls.stop.length > stopsBefore, 'the bot must be told to leave');

  // Teardown of a room that never played must be silent and safe.
  h.service.handleRoomEmpty('room-never-used');
});

test('one bot identity string reaches the token, the play body, the snapshot and every event', async () => {
  const h = createHarness();
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const { sessionEpoch, currentItem } = h.state();
  h.service.handleHeartbeat({ roomId: ROOM_ID, sessionEpoch, itemId: currentItem.id, positionMs: 1000 });

  const expected = musicBotIdentityFor(ROOM_ID);
  const play = h.bot.calls.play[0].body;
  assert.equal(play.livekit.identity, expected, 'identity must be sent explicitly, never left to the bot');
  assert.equal(play.livekit.roomName, `voice-room-${ROOM_ID}`, 'the bot never derives the room name');
  assert.ok(play.livekit.token, 'the bot never mints its own token');

  // The identity claim inside the token must agree with the field beside it: a
  // mismatch here is silent, the client simply never subscribes.
  const claims = JSON.parse(Buffer.from(play.livekit.token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.sub, expected);

  assert.equal(h.service.getSnapshotBlock(ROOM_ID).musicBotIdentity, expected);
  const stateEvents = h.events.filter((event) => event.type === 'room.music.state');
  const positionEvents = h.events.filter((event) => event.type === 'room.music.position');
  assert.ok(stateEvents.length > 0 && positionEvents.length > 0);
  for (const event of [...stateEvents, ...positionEvents]) {
    assert.equal(event.payload.musicBotIdentity, expected, `${event.type} must carry the identity`);
  }
});

test('the bot identity is unreachable as a peer id, so no participant can impersonate it', () => {
  // Peer ids are caller-supplied and only have to pass normalizePeerId. A bot
  // identity that satisfied that pattern could be claimed by an ordinary
  // participant of a static room: their screen-share audio would land in every
  // client's music lane, invisible to the participant list, to per-peer mute
  // and to kick, and the duplicate identity would evict the real bot.
  const identity = musicBotIdentityFor(ROOM_ID);
  assert.equal(normalizePeerId(identity), '', 'the identity must not be a valid peer id');
  assert.ok(/[^A-Za-z0-9_-]/.test(identity), 'the separator must be outside the peer-id alphabet');
});

test('a skip during an in-flight play still drives the queue on', async () => {
  const gate = createGate();
  let plays = 0;
  const bot = createFakeBot({
    resolve: async () => ({ ok: true, data: { items: [track(1), track(2)] } }),
    play: async () => {
      plays += 1;
      if (plays === 1) await gate.opened;
      return { ok: true, status: 202, data: {} };
    }
  });
  const h = createHarness({ bot });

  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  assert.equal(h.state().status, 'resolving', 'the first play must still be in flight');
  const stuck = h.state().currentItem;
  assert.equal(stuck.title, 'Track 1');

  assert.deepEqual(await h.run(AUTHOR_PEER, 'room.music.skip', { itemId: stuck.id }), { ok: true });
  assert.equal(h.state().currentItem, null, 'AC-4: the skip converges before any bot call');

  gate.release();
  await flush();
  await flush();

  // Without a deferred restart the session sits at `resolving` with a non-empty
  // queue, no current item and no watchdog — stalled until the room dies.
  assert.equal(h.state().currentItem?.title, 'Track 2', 'the queue must be re-driven');
  assert.equal(h.state().status, 'playing');
  assert.equal(bot.calls.play.length, 2);
  assert.equal(h.state().queue.length, 0);
});

test('removing the current item during an in-flight play behaves like a skip', async () => {
  const gate = createGate();
  let plays = 0;
  const bot = createFakeBot({
    resolve: async () => ({ ok: true, data: { items: [track(1), track(2)] } }),
    play: async () => {
      plays += 1;
      if (plays === 1) await gate.opened;
      return { ok: true, status: 202, data: {} };
    }
  });
  const h = createHarness({ bot });

  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const stuck = h.state().currentItem;

  assert.deepEqual(await h.run(AUTHOR_PEER, 'room.music.remove', { itemId: stuck.id }), { ok: true });
  gate.release();
  await flush();
  await flush();

  assert.equal(h.state().currentItem?.title, 'Track 2');
  assert.equal(h.state().status, 'playing');
});

test('a skip during an in-flight play with an empty queue lands idle, not resolving', async () => {
  const gate = createGate();
  const bot = createFakeBot({
    play: async () => {
      await gate.opened;
      return { ok: true, status: 202, data: {} };
    }
  });
  const h = createHarness({ bot });

  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const stuck = h.state().currentItem;

  assert.deepEqual(await h.run(AUTHOR_PEER, 'room.music.skip', { itemId: stuck.id }), { ok: true });
  gate.release();
  await flush();
  await flush();

  assert.equal(h.state().status, 'idle');
  assert.equal(h.state().currentItem, null);
  assert.equal(bot.calls.play.length, 1, 'nothing is left to start, so nothing is re-driven');
  assert.ok(bot.calls.stop.length > 0, 'an exhausted queue takes the bot out of the room');
});

test('a stop during an in-flight play is not undone when that play returns', async () => {
  const gate = createGate();
  const bot = createFakeBot({
    resolve: async () => ({ ok: true, data: { items: [track(1), track(2)] } }),
    play: async () => {
      await gate.opened;
      return { ok: true, status: 202, data: {} };
    }
  });
  const h = createHarness({ bot });

  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  assert.equal(h.state().status, 'resolving');

  assert.deepEqual(await h.run(OWNER_PEER, 'room.music.stop', {}, { isMaster: true }), { ok: true });
  gate.release();
  await flush();
  await flush();

  // The in-flight start owns a superseded item; it must neither claim `playing`
  // nor resurrect the emptied queue.
  assert.equal(h.state().status, 'idle');
  assert.equal(h.state().currentItem, null);
  assert.equal(h.state().queue.length, 0);
  assert.equal(bot.calls.play.length, 1);
  assert.equal(h.clock.pending(), 0, 'no watchdog may survive a stop');
});

test('bot failures map by HTTP status, not by guessing at the error name', async () => {
  // 400 is the only "your input was bad" answer.
  const badLink = createHarness({
    bot: createFakeBot({
      resolve: async () => ({ ok: false, status: 400, code: 'music_unavailable', botError: 'invalid_link' })
    })
  });
  assert.deepEqual(
    await badLink.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }),
    { ok: false, code: 'invalid_link' }
  );
  assert.notEqual(badLink.state().status, 'unavailable', 'a bad link must not degrade the session');

  // Every 503 — including not_found — is a service condition.
  for (const botError of ['not_found', 'stream_failed', 'resolve_failed']) {
    const h = createHarness({
      bot: createFakeBot({ resolve: async () => ({ ok: false, status: 503, code: 'music_unavailable', botError }) })
    });
    assert.deepEqual(
      await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK }),
      { ok: false, code: 'music_unavailable' },
      `503 ${botError} must read as unavailable`
    );
    assert.equal(h.state().status, 'unavailable');
  }
});

test('source_unavailable is the one bot error read by name, and it is not a bad link', async () => {
  // A YouTube link on a stack whose MUSIC_BOT_SOURCES is the default `vk,rutube`.
  // The link parsed against the same shared contract the client uses, so calling
  // it invalid would send the user off editing something that was correct.
  const h = createHarness({
    bot: createFakeBot({
      resolve: async () => ({ ok: false, status: 503, code: 'music_unavailable', botError: 'source_unavailable' })
    })
  });
  assert.deepEqual(
    await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: 'https://youtu.be/dQw4w9WgXcQ' }),
    { ok: false, code: 'source_unavailable' }
  );
  assert.notEqual(
    h.state().status,
    'unavailable',
    'one unreachable source is not a broken session — the room may be playing a VK video'
  );
});

test('the resolved source and video id survive into the emitted payload and the play body', async () => {
  const h = createHarness({
    bot: createFakeBot({ resolve: async () => ({ ok: true, status: 200, data: { items: [track(1)] } }) })
  });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();

  // Asserted on the emitted event, not on internal state: an API that put the
  // right ref in its own map and the wrong field name on the wire is exactly the
  // failure the previous wave shipped green.
  const emitted = h.events.filter((event) => event.type === 'room.music.state').at(-1);
  const ref = emitted.payload.music.currentItem.trackRef;
  assert.deepEqual(ref, {
    source: 'vk',
    kind: 'video',
    id: 'vk:video:-12345_1001',
    videoId: '-12345_1001',
    playlistId: null,
    sourceUrl: 'https://vkvideo.ru/video-12345_1001'
  });

  // The bot has to be able to fetch the item from what the API sends it.
  const item = h.bot.calls.play[0].body.item;
  assert.equal(item.source, 'vk');
  assert.equal(item.videoId, '-12345_1001');
  assert.equal(item.sourceUrl, 'https://vkvideo.ru/video-12345_1001');
  assert.equal(item.trackId, undefined, 'the Yandex-shaped field must be gone, not merely unused');
});

test('a saturated bot keeps the item; only a 400 on play discards it', async () => {
  const saturated = createHarness({
    bot: createFakeBot({
      resolve: async () => ({ ok: true, data: { items: [track(1), track(2)] } }),
      play: async () => ({ ok: false, status: 429, code: 'music_unavailable', botError: 'room_capacity_exceeded' })
    })
  });
  await saturated.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  assert.equal(saturated.state().status, 'unavailable');
  assert.equal(saturated.state().queue.length, 2, '429 means "not now", so nothing is thrown away');
  assert.equal(saturated.bot.calls.play.length, 1, 'a saturated bot must not be hammered down the queue');

  const badItem = createHarness({
    bot: createFakeBot({
      resolve: async () => ({ ok: true, data: { items: [track(1), track(2)] } }),
      play: async (roomId, body) => (body.item.title === 'Track 1'
        ? { ok: false, status: 400, code: 'music_unavailable', botError: 'invalid_request' }
        : { ok: true, status: 202, data: {} })
    })
  });
  await badItem.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  assert.equal(badItem.state().currentItem.title, 'Track 2', 'one unplayable item must not stall the queue');
  assert.equal(badItem.state().status, 'playing');
});

test('the session tolerates the bot leaving on its own initiative', async () => {
  const clock = createClock();
  const h = createHarness({
    clock,
    bot: createFakeBot({
      resolve: async () => ({ ok: true, data: { items: [track(1, { durationMs: 8000 }), track(2)] } })
    })
  });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const playsBefore = h.bot.calls.play.length;

  // The bot self-terminated: no track-ended, no further heartbeats, no DELETE
  // from us. The watchdog is the only thing left, and it must recover.
  clock.advance(8000 + MUSIC_WATCHDOG_GRACE_MS + 1);
  await flush();
  assert.equal(h.state().currentItem.title, 'Track 2');
  assert.equal(h.bot.calls.play.length, playsBefore + 1, 'the next item re-establishes the session');
});

test('items follow one another without a DELETE between them', async () => {
  const h = createHarness({
    bot: createFakeBot({ resolve: async () => ({ ok: true, data: { items: [track(1), track(2)] } }) })
  });
  await h.run(AUTHOR_PEER, 'room.music.enqueue', { link: LINK });
  await flush();
  const { sessionEpoch, currentItem } = h.state();

  h.service.handleTrackEnded({ roomId: ROOM_ID, sessionEpoch, itemId: currentItem.id });
  await flush();
  assert.equal(h.state().currentItem.title, 'Track 2');
  assert.equal(h.bot.calls.stop.length, 0, 'the bot keeps its connection and track between items');

  // Only an exhausted queue takes the bot out of the room.
  h.service.handleTrackEnded({
    roomId: ROOM_ID,
    sessionEpoch: h.state().sessionEpoch,
    itemId: h.state().currentItem.id
  });
  await flush();
  assert.equal(h.state().status, 'idle');
  assert.equal(h.bot.calls.stop.length, 1);
});

test('the snapshot block is idle and names the bot identity before anything plays', () => {
  const h = createHarness();
  const block = h.service.getSnapshotBlock(ROOM_ID);
  assert.equal(block.musicBotIdentity, musicBotIdentityFor(ROOM_ID));
  assert.equal(block.music.status, 'idle');
  assert.deepEqual(block.music.queue, []);
  assert.equal(block.music.currentItem, null);
});
