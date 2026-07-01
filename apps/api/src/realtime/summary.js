'use strict';

const { buildRoomRealtimeSummary } = require('@voice-room/shared/realtime');

function buildRoomRealtimeSummaryFromLobbyRoom(room, peers, resolveAvatarColorKey) {
  const peerList = Array.isArray(peers) ? peers : [];
  return buildRoomRealtimeSummary(room, peerList, resolveAvatarColorKey);
}

function createSummaryCoalescer({ delayMs, flush }) {
  const pending = new Map();

  function schedule(roomId) {
    if (pending.has(roomId)) return;
    const timer = setTimeout(() => {
      pending.delete(roomId);
      flush(roomId);
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
    pending.set(roomId, timer);
  }

  function cancel(roomId) {
    const timer = pending.get(roomId);
    if (!timer) return;
    clearTimeout(timer);
    pending.delete(roomId);
  }

  function clear() {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  }

  return { schedule, cancel, clear };
}

module.exports = {
  buildRoomRealtimeSummaryFromLobbyRoom,
  createSummaryCoalescer
};