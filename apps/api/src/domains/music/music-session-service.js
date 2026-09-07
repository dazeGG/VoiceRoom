'use strict';

// Server-side authority for the shared room player.
//
// The queue, the currently playing item, the epoch and the watchdog all live
// here; the client is never the source of truth about what is playing (AC-3).
// The state map itself is injected — it is materialized beside `presenceRooms`
// in `server.js`, because `room-runtime.js` owns no state of its own.
//
// Every limit, timing constant and error code comes from
// `@voice-room/shared/room-music`. Nothing in this file re-declares 50, 100,
// 2000, 6000 or 15000.

const crypto = require('node:crypto');
const {
  MUSIC_EXPANSION_MAX_ITEMS,
  MUSIC_WATCHDOG_GRACE_MS,
  buildMusicSession,
  normalizeMusicQueueItem,
  normalizeMusicTrackRef,
  planMusicEnqueue
} = require('@voice-room/shared/room-music');
const { mintMusicBotToken, musicBotIdentityFor } = require('./music-bot-token');

// Not part of the shared wire contract: this ceiling protects the upstream
// sources (VK, Rutube, YouTube) from being hammered by one peer through the
// bot's single egress address, which the queue caps alone do not do (a peer can
// stay under 100 queued items and still hammer /resolve).
//
// It is one budget shared by *every* music command, not an enqueue-only one.
// Skip and remove are not cheap: each accepted one runs advance -> startNext ->
// a fresh bot /play, whose first act is a live yt-dlp stream-URL resolve plus
// an ffmpeg spawn. A peer who enqueued a 50-video playlist with one token could
// otherwise spam skip on items they authored and issue one upstream request per
// skip, which defeats the point of limiting enqueue at all. A single shared
// budget is also harder to game than per-command budgets, which would just be
// added together by an attacker.
const MUSIC_COMMAND_RATE_LIMIT = 5;
const MUSIC_COMMAND_RATE_WINDOW_MS = 10000;

// The bucket map is swept once it grows past this, so a long-lived static room
// cannot accumulate one entry per address that ever issued a command. Anything
// comfortably above the number of distinct callers active inside a 10s window
// does the job; the sweep is O(size) and runs only when the map is over it.
const MUSIC_COMMAND_HISTORY_SWEEP_SIZE = 64;

const MUSIC_STATE_EVENT = 'room.music.state';
const MUSIC_POSITION_EVENT = 'room.music.position';

function createSessionState(roomId) {
  return {
    roomId,
    status: 'idle',
    currentItem: null,
    queue: [],
    positionMs: 0,
    positionAt: null,
    sessionEpoch: 0,
    watchdog: null,
    starting: false,
    restartPending: false,
    commandHistory: new Map()
  };
}

function joinArtists(value) {
  if (!Array.isArray(value)) return '';
  return value.filter((name) => typeof name === 'string' && name.trim()).join(', ');
}

function createMusicSessionService({
  musicRooms,
  botClient,
  publish,
  getLiveKitConfig,
  getLiveKitRoomName,
  removeLiveKitParticipant = async () => {},
  now = Date.now,
  setTimeout: scheduleTimeout = globalThis.setTimeout,
  clearTimeout: cancelTimeout = globalThis.clearTimeout
}) {
  if (!musicRooms) throw new TypeError('musicRooms map is required');

  function peek(roomId) {
    return musicRooms.get(roomId) || null;
  }

  function ensure(roomId) {
    let state = musicRooms.get(roomId);
    if (!state) {
      state = createSessionState(roomId);
      musicRooms.set(roomId, state);
    }
    return state;
  }

  function toWire(state) {
    return buildMusicSession({
      status: state.status,
      currentItem: state.currentItem,
      positionMs: state.positionMs,
      positionAt: state.positionAt,
      queue: state.queue,
      sessionEpoch: state.sessionEpoch
    });
  }

  // Every room.music.* event goes out activeOnly. The snapshot gate alone would
  // still leak the queue and its authors into the lobby through incremental
  // updates, because preview subscribers are room-detail subscribers too.
  function emitState(state) {
    publish(state.roomId, MUSIC_STATE_EVENT, {
      roomId: state.roomId,
      music: toWire(state),
      musicBotIdentity: musicBotIdentityFor(state.roomId)
    });
  }

  // musicBotIdentity rides on every incremental event, not only the snapshot:
  // the bot can leave the room on its own initiative (a 409/410 from our
  // callbacks, or five unacknowledged heartbeats), so a client that joined late
  // or reconnected must be able to learn the identity without a fresh snapshot.
  function emitPosition(state) {
    publish(state.roomId, MUSIC_POSITION_EVENT, {
      roomId: state.roomId,
      musicBotIdentity: musicBotIdentityFor(state.roomId),
      sessionEpoch: state.sessionEpoch,
      itemId: state.currentItem?.id || null,
      positionMs: state.positionMs,
      positionAt: state.positionAt
    });
  }

  function clearWatchdog(state) {
    if (state.watchdog) {
      cancelTimeout(state.watchdog);
      state.watchdog = null;
    }
  }

  // A lost `track-ended` must never stall the queue for good (AC-8). The delay
  // is the remaining track time plus the shared grace window; with an unknown
  // duration it degrades into a heartbeat-loss watchdog of exactly the grace
  // window, which is the same guarantee expressed with less information.
  function armWatchdog(state) {
    clearWatchdog(state);
    const duration = Number(state.currentItem?.durationMs) || 0;
    const remaining = duration > 0 ? Math.max(0, duration - state.positionMs) : 0;
    const epoch = state.sessionEpoch;
    state.watchdog = scheduleTimeout(() => {
      state.watchdog = null;
      if (state.sessionEpoch !== epoch) return;
      void advance(state.roomId, 'watchdog');
    }, remaining + MUSIC_WATCHDOG_GRACE_MS);
    if (typeof state.watchdog?.unref === 'function') state.watchdog.unref();
  }

  function isStale(state, sessionEpoch, itemId) {
    if (!state || state.sessionEpoch !== sessionEpoch) return true;
    return !state.currentItem || state.currentItem.id !== itemId;
  }

  // NOT keyed on peerId. A peer id is whatever the client sent at join — any
  // 8-80 character `[A-Za-z0-9_-]` string — so leaving and rejoining under a
  // fresh random one would hand the caller a fresh budget at zero cost and make
  // the limit decorative. The account id is the identity a caller cannot mint,
  // and the connecting address is the closest stand-in for a guest who has
  // none. Guests behind one NAT therefore share a budget; that is the intended
  // trade, since the thing being protected is the bot's single egress address.
  function rateKeyFor({ accountUserId, clientIp, peerId }) {
    if (accountUserId) return `user:${accountUserId}`;
    if (clientIp) return `ip:${clientIp}`;
    // No account and no address is not a normal peer. Fail closed onto one
    // shared bucket rather than back onto the client-chosen peer id.
    void peerId;
    return 'anonymous';
  }

  // Buckets whose newest stamp has fallen out of the window can never refuse
  // anything, so they are pure growth. Swept here rather than on peer removal:
  // the key is an account or an address, which outlives any one peer record.
  function pruneCommandHistory(state, at) {
    for (const [key, stamps] of state.commandHistory) {
      const newest = stamps[stamps.length - 1];
      if (newest == null || at - newest >= MUSIC_COMMAND_RATE_WINDOW_MS) {
        state.commandHistory.delete(key);
      }
    }
  }

  // Charged before authorship is checked, so a caller cannot probe other
  // people's items for free either.
  function checkCommandRate(state, identity) {
    const at = now();
    if (state.commandHistory.size > MUSIC_COMMAND_HISTORY_SWEEP_SIZE) {
      pruneCommandHistory(state, at);
    }
    const key = rateKeyFor(identity);
    const history = (state.commandHistory.get(key) || []).filter(
      (stamp) => at - stamp < MUSIC_COMMAND_RATE_WINDOW_MS
    );
    if (history.length >= MUSIC_COMMAND_RATE_LIMIT) {
      state.commandHistory.set(key, history);
      return false;
    }
    history.push(at);
    state.commandHistory.set(key, history);
    return true;
  }

  // A resolved entry is always a single playable video, whatever the link was:
  // the bot expands a playlist on its side. `source` and `videoId` are the only
  // fields the shared contract needs to rebuild the canonical ref, and the
  // contract — not this file — decides which ids a source accepts.
  function resolvedTrackToItem(track, peerId) {
    const trackRef = normalizeMusicTrackRef({
      source: track?.source,
      kind: 'video',
      videoId: track?.videoId == null ? '' : String(track.videoId)
    });
    if (!trackRef) return null;
    return normalizeMusicQueueItem({
      id: crypto.randomUUID(),
      trackRef,
      addedBy: peerId,
      title: typeof track?.title === 'string' ? track.title : '',
      artist: joinArtists(track?.artists),
      coverUrl: typeof track?.coverUrl === 'string' ? track.coverUrl : '',
      durationMs: Number.isSafeInteger(track?.durationMs) && track.durationMs >= 0
        ? track.durationMs
        : null
    });
  }

  async function buildPlayRequest(state, item) {
    const livekit = getLiveKitConfig();
    if (!livekit.apiKey || !livekit.apiSecret) return null;
    const roomName = getLiveKitRoomName(state.roomId);
    const identity = musicBotIdentityFor(state.roomId);
    const token = await mintMusicBotToken({
      apiKey: livekit.apiKey,
      apiSecret: livekit.apiSecret,
      livekitRoom: roomName,
      identity
    });
    if (!token) return null;
    return {
      sessionEpoch: state.sessionEpoch,
      // The bot resolves the stream URL inside this call, so it needs to
      // identify the video itself. `sourceUrl` is what yt-dlp takes; `source`
      // and `videoId` travel with it so the bot can pick its extractor and log
      // the item without re-parsing a URL the shared contract already parsed.
      item: {
        itemId: item.id,
        source: item.trackRef.source,
        videoId: item.trackRef.videoId,
        sourceUrl: item.trackRef.sourceUrl,
        durationMs: item.durationMs || 0,
        title: item.title
      },
      livekit: { roomName, token, identity, url: livekit.url || '' }
    };
  }

  // Starts the head of the queue when nothing is playing. Re-entrancy is guarded
  // by `starting`: enqueue, advance and the watchdog can all reach here.
  //
  // The guard defers rather than drops. `botClient.play` can take seconds (the
  // bot resolves a stream URL with yt-dlp and spawns ffmpeg), and a skip landing
  // in that window runs `advance`, which nulls `currentItem` and calls back in
  // here. If that call simply returned, nothing would ever re-drive the queue: the
  // in-flight start bails on its own `currentItem` check, and the watchdog is
  // only armed after a successful play. The session would sit at `resolving`
  // with a non-empty queue and no timer, forever.
  async function startNext(roomId) {
    const state = peek(roomId);
    if (!state) return;
    if (state.starting) {
      state.restartPending = true;
      return;
    }
    if (state.currentItem || state.queue.length === 0) return;

    state.starting = true;
    state.restartPending = false;
    try {
      await runStartNext(roomId, state);
    } finally {
      state.starting = false;
    }

    // Re-drive only for a wake-up that actually arrived while we were awaiting,
    // and only when the queue really is stalled. The flag is cleared before the
    // re-entry, so this converges instead of spinning.
    const pending = state.restartPending;
    state.restartPending = false;
    if (
      pending
      && musicRooms.get(roomId) === state
      && !state.currentItem
      && state.queue.length > 0
    ) {
      await startNext(roomId);
    }
  }

  async function runStartNext(roomId, state) {
    while (!state.currentItem && state.queue.length > 0) {
      const item = state.queue.shift();
      state.sessionEpoch += 1;
      state.currentItem = item;
      state.status = 'resolving';
      state.positionMs = 0;
      state.positionAt = null;
      emitState(state);

      const body = await buildPlayRequest(state, item);
      if (musicRooms.get(roomId) !== state) return;
      if (!body) {
        // No LiveKit credentials: the feature cannot work at all here.
        state.currentItem = null;
        state.status = 'unavailable';
        emitState(state);
        return;
      }

      const result = await botClient.play(roomId, body);
      if (musicRooms.get(roomId) !== state) return;
      // A concurrent stop/skip already moved the session on. That operation
      // owns the session now; it also set `restartPending`, so the caller
      // re-drives the queue if it left one behind.
      if (state.currentItem?.id !== item.id) return;

      if (result.ok) {
        state.status = 'playing';
        state.positionAt = now();
        armWatchdog(state);
        emitState(state);
        return;
      }

      // Mapping is by HTTP status, per the frozen bot contract. Only a 400
      // (invalid_request / invalid_link) means "this one item is bad" and is
      // worth dropping. 429 room_capacity_exceeded and every 503 mean "not
      // now", so the item is kept. A 409 stale_epoch means a newer operation
      // already superseded this start; that operation owns the session.
      if (result.status === 400) {
        state.currentItem = null;
        continue;
      }
      if (result.status === 409) {
        state.currentItem = null;
        return;
      }

      // Unreachable, hung, saturated or broken bot: keep the item, degrade
      // the session to `unavailable` so the player says so (AC-9).
      state.queue.unshift(item);
      state.currentItem = null;
      state.status = 'unavailable';
      emitState(state);
      return;
    }
    if (!state.currentItem) {
      state.status = 'idle';
      emitState(state);
    }
  }

  // Ends the current item and moves on. State is mutated and broadcast before
  // any bot call so clients converge within AC-4's budget even if the bot hangs.
  async function advance(roomId, reason = 'ended') {
    const state = peek(roomId);
    if (!state) return;
    clearWatchdog(state);
    const endedEpoch = state.sessionEpoch;
    state.currentItem = null;
    state.positionMs = 0;
    state.positionAt = null;
    state.sessionEpoch += 1;
    state.status = state.queue.length > 0 ? 'resolving' : 'idle';
    emitState(state);

    if (state.queue.length === 0) {
      // Nothing left: the bot must leave the room rather than sit there muted.
      void stopBot(roomId, endedEpoch, reason);
      return;
    }
    await startNext(roomId);
  }

  // `sessionEpoch` is the epoch of the session being ended, not the one that
  // replaced it. The bot refuses a DELETE older than the session it is running
  // (`session.py`: `session_epoch < session.session_epoch` -> stale_epoch), so
  // passing it through is what stops a slow teardown from killing a newer
  // session that has already started. Only `reconcile`, which deliberately
  // stops unconditionally, passes null.
  async function stopBot(roomId, sessionEpoch, reason) {
    try {
      await botClient.stop(roomId, Number.isSafeInteger(sessionEpoch) ? sessionEpoch : null);
    } catch (error) {
      console.error('Failed to stop music bot session:', error);
    }
    // Belt and braces for AC-4: even a bot that ignores DELETE is evicted.
    if (reason === 'stopped') {
      try {
        await removeLiveKitParticipant(roomId, musicBotIdentityFor(roomId));
      } catch (error) {
        console.error('Failed to remove music bot participant:', error);
      }
    }
  }

  async function enqueue(state, peerId, trackRef) {
    const resolved = await botClient.resolveLink(trackRef.sourceUrl, MUSIC_EXPANSION_MAX_ITEMS);
    if (!resolved.ok) {
      // `source_unavailable` is the one failure the caller can act on, and the
      // one place a bot error *name* is read rather than its status. The link
      // parsed fine and names a source in the shared contract; this deployment
      // simply cannot reach it (YouTube without `MUSIC_BOT_PROXY`, typically).
      // Reporting that as `invalid_link` sends the user off editing a link that
      // was never wrong, and it is not a session failure either — the room may
      // be happily playing a VK video — so the session status is left alone.
      if (resolved.botError === 'source_unavailable') {
        return { ok: false, code: 'source_unavailable' };
      }
      // Otherwise status-driven, not code-name-driven: 400 is the bot's only
      // "your input was bad" answer. Everything else — 401, 429, every 503
      // including `not_found` — is a service condition and shows as unavailable.
      if (resolved.status === 400) return { ok: false, code: 'invalid_link' };
      // A failed /resolve says this enqueue failed, not that playback died.
      // Painting an audibly-playing session `unavailable` puts "музыка
      // недоступна" over music the room can hear, until the next heartbeat
      // corrects it. The caller is told either way.
      if (!state.currentItem) {
        state.status = 'unavailable';
        emitState(state);
      }
      return { ok: false, code: 'music_unavailable' };
    }

    const tracks = Array.isArray(resolved.data?.items) ? resolved.data.items : [];
    const items = tracks.map((track) => resolvedTrackToItem(track, peerId)).filter(Boolean);
    // AC-6 lives entirely in planMusicEnqueue: expansion ceiling, queue cap and
    // the all-or-nothing overflow rule. Never re-implemented here.
    const plan = planMusicEnqueue({ queueLength: state.queue.length, items });
    if (!plan) return { ok: false, code: 'invalid_link' };
    if (!plan.ok) return { ok: false, code: plan.code };

    state.queue.push(...plan.items);
    if (state.status === 'unavailable' && !state.currentItem) state.status = 'idle';
    emitState(state);
    void startNext(state.roomId);
    return { ok: true };
  }

  function findQueueIndex(state, itemId) {
    return state.queue.findIndex((item) => item.id === itemId);
  }

  // Authorship is keyed on peerId, never accountUserId: guests carry a null
  // account id, so comparing on it would make every guest the author of every
  // other guest's item.
  function mayControl(item, peerId, isMaster) {
    return Boolean(isMaster || (item && item.addedBy === peerId));
  }

  async function dropItem(state, peerId, isMaster, itemId) {
    if (state.currentItem && (itemId == null || state.currentItem.id === itemId)) {
      if (!mayControl(state.currentItem, peerId, isMaster)) return { ok: false, code: 'forbidden' };
      await advance(state.roomId, 'skipped');
      return { ok: true };
    }
    if (itemId == null) return { ok: true };

    const index = findQueueIndex(state, itemId);
    if (index < 0) return { ok: true };
    if (!mayControl(state.queue[index], peerId, isMaster)) return { ok: false, code: 'forbidden' };
    state.queue.splice(index, 1);
    emitState(state);
    return { ok: true };
  }

  async function stopAll(state, isMaster) {
    if (!isMaster) return { ok: false, code: 'forbidden' };
    clearWatchdog(state);
    const endedEpoch = state.sessionEpoch;
    state.queue = [];
    state.currentItem = null;
    state.positionMs = 0;
    state.positionAt = null;
    state.sessionEpoch += 1;
    state.status = 'idle';
    emitState(state);
    void stopBot(state.roomId, endedEpoch, 'stopped');
    return { ok: true };
  }

  async function handleCommand({
    roomId,
    peerId,
    accountUserId = '',
    clientIp = '',
    isMaster = false,
    isStatic = false,
    command
  }) {
    if (!roomId || !peerId || !command) return { ok: false, code: 'invalid_link' };
    // The feature exists only in static rooms; the gate is checked server-side
    // even though the UI hides the player (AC-7).
    if (!isStatic) return { ok: false, code: 'room_not_static' };
    if (!botClient.enabled) return { ok: false, code: 'music_unavailable' };

    const state = ensure(roomId);
    // One budget for every command type, masters included: stop is not free
    // either (it costs a bot DELETE plus a LiveKit RemoveParticipant).
    if (!checkCommandRate(state, { accountUserId, clientIp, peerId })) {
      return { ok: false, code: 'forbidden' };
    }
    if (command.type === 'room.music.enqueue') return enqueue(state, peerId, command.trackRef);
    if (command.type === 'room.music.skip') return dropItem(state, peerId, isMaster, command.itemId);
    if (command.type === 'room.music.remove') return dropItem(state, peerId, isMaster, command.itemId);
    if (command.type === 'room.music.stop') return stopAll(state, isMaster);
    return { ok: false, code: 'invalid_link' };
  }

  function handleTrackEnded({ roomId, sessionEpoch, itemId }) {
    const state = peek(roomId);
    if (isStale(state, sessionEpoch, itemId)) return { ok: false, code: 'stale' };
    void advance(roomId, 'ended');
    return { ok: true };
  }

  // AC-10: positionMs is authoritative only through this callback. The server
  // never computes it from `now - startedAt`.
  function handleHeartbeat({ roomId, sessionEpoch, itemId, positionMs, status }) {
    const state = peek(roomId);
    if (isStale(state, sessionEpoch, itemId)) return { ok: false, code: 'stale' };
    const position = Number(positionMs);
    state.positionMs = Number.isSafeInteger(position) && position >= 0 ? position : state.positionMs;
    state.positionAt = now();
    const previousStatus = state.status;
    if (status === 'playing' || state.status === 'resolving') state.status = 'playing';
    armWatchdog(state);
    if (previousStatus !== state.status) emitState(state);
    else emitPosition(state);
    return { ok: true };
  }

  // The single way a session leaves `musicRooms`. Deleting the entry without
  // going through here strands the watchdog timer, which then fires against a
  // state nothing owns — the leak `reconcile` used to have.
  function discardSession(roomId) {
    const state = peek(roomId);
    if (!state) return null;
    clearWatchdog(state);
    state.commandHistory.clear();
    musicRooms.delete(roomId);
    return state;
  }

  // The room is empty. Tear the session down completely — there is nobody left
  // to hear it and nobody left to control it.
  function handleRoomEmpty(roomId) {
    const state = discardSession(roomId);
    if (!state) return;
    if (state.currentItem || state.queue.length > 0 || state.status !== 'idle') {
      void stopBot(roomId, state.sessionEpoch, 'stopped');
    }
  }

  function getSnapshotBlock(roomId) {
    const state = peek(roomId);
    return {
      music: state ? toWire(state) : buildMusicSession({}),
      musicBotIdentity: musicBotIdentityFor(roomId)
    };
  }

  // API restart wipes the in-memory queue, so any room the bot is still playing
  // in is orphaned by definition. The bot's control-plane loss detector clears
  // those by itself; this probe surfaces them in the log so a stuck container is
  // visible rather than silent, and sweeps every room id we can name.
  async function reconcile({ roomIds = [] } = {}) {
    if (!botClient.enabled) return { ok: false, code: 'music_unavailable' };
    for (const roomId of roomIds) {
      discardSession(roomId);
      // Unconditional on purpose: after a restart the API knows no epoch that
      // could be compared against whatever the bot is still running.
      await botClient.stop(roomId, null);
    }
    const health = await botClient.health();
    const orphans = Number(health.data?.rooms) || 0;
    if (health.ok && orphans > roomIds.length) {
      console.warn(
        `music-bot reports ${orphans} active room session(s) the API does not own; `
        + 'they will self-terminate when their heartbeats stop being acknowledged.'
      );
    }
    return { ok: health.ok, orphans };
  }

  function shutdown() {
    for (const state of musicRooms.values()) clearWatchdog(state);
    musicRooms.clear();
  }

  return Object.freeze({
    getSnapshotBlock,
    handleCommand,
    handleHeartbeat,
    handleRoomEmpty,
    handleTrackEnded,
    reconcile,
    shutdown
  });
}

module.exports = {
  MUSIC_COMMAND_RATE_LIMIT,
  MUSIC_COMMAND_RATE_WINDOW_MS,
  MUSIC_POSITION_EVENT,
  MUSIC_STATE_EVENT,
  createMusicSessionService
};
