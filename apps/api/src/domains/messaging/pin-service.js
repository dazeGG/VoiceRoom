'use strict';

// Any room participant may pin, so the only guard against a room turning into
// an unbounded pin list is this cap. Discord uses 50; matching it keeps the
// pinned bar scrollable rather than endless.
const MAX_PINS_PER_ROOM = 50;

class PinServiceError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'PinServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeRoomId(value) {
  const roomId = typeof value === 'string' ? value.trim() : '';
  if (!roomId || roomId.length > 48) {
    throw new PinServiceError('Invalid room', 'invalid_room', 400);
  }
  return roomId;
}

function normalizeMessageId(value) {
  const messageId = typeof value === 'string' ? value.trim() : '';
  if (!messageId || messageId.length > 64) {
    throw new PinServiceError('Invalid message', 'invalid_message', 400);
  }
  return messageId;
}

function requireAccount(viewer) {
  if (!viewer?.id || viewer.guest === true || viewer.isGuest === true) {
    throw new PinServiceError('Account required', 'account_required', 403);
  }
  return viewer;
}

function createPinService({ repository, publish, maxPins = MAX_PINS_PER_ROOM } = {}) {
  if (!repository?.listPins || !repository?.pin || !repository?.unpin) {
    throw new TypeError('Pin repository is required');
  }
  const publisher = typeof publish === 'function' ? publish : () => false;
  const transact = typeof repository.transaction === 'function'
    ? (callback) => repository.transaction(callback)
    : (callback) => callback(null);

  async function snapshot(roomId, client = null) {
    const pins = await repository.listPins({ roomId, limit: maxPins, client });
    return { pins, count: pins.length };
  }

  async function list({ roomId: rawRoomId } = {}) {
    const roomId = normalizeRoomId(rawRoomId);
    return snapshot(roomId);
  }

  async function pin({ roomId: rawRoomId, messageId: rawMessageId, viewer } = {}) {
    const roomId = normalizeRoomId(rawRoomId);
    const messageId = normalizeMessageId(rawMessageId);
    const account = requireAccount(viewer);

    const mutation = await transact(async (client) => {
      await repository.lockRoom?.({ roomId, client });
      const visible = await repository.findVisibleMessage({ roomId, messageId, client });
      if (!visible) throw new PinServiceError('Message is not available', 'message_not_found', 404);

      // The room-scoped transaction lock makes count + insert one atomic cap
      // decision even when many users pin different messages concurrently.
      const count = await repository.countPins({ roomId, client });
      if (count >= maxPins) {
        const already = await repository.listPins({ roomId, limit: maxPins, client });
        if (!already.some((entry) => entry.messageId === messageId)) {
          throw new PinServiceError(
            `В комнате уже ${maxPins} закреплённых сообщений`,
            'pin_limit_reached',
            409
          );
        }
      }

      const result = await repository.pin({ roomId, messageId, userId: account.id, client });
      return { changed: result.changed, snapshot: await snapshot(roomId, client) };
    });
    if (mutation.changed) {
      await publisher({ roomId, action: 'pinned', messageId, actorUserId: account.id, ...mutation.snapshot });
    }
    return mutation.snapshot;
  }

  async function unpin({ roomId: rawRoomId, messageId: rawMessageId, viewer } = {}) {
    const roomId = normalizeRoomId(rawRoomId);
    const messageId = normalizeMessageId(rawMessageId);
    const account = requireAccount(viewer);

    const mutation = await transact(async (client) => {
      await repository.lockRoom?.({ roomId, client });
      const result = await repository.unpin({ roomId, messageId, client });
      return { changed: result.changed, snapshot: await snapshot(roomId, client) };
    });
    if (mutation.changed) {
      await publisher({ roomId, action: 'unpinned', messageId, actorUserId: account.id, ...mutation.snapshot });
    }
    return mutation.snapshot;
  }

  async function refresh({ roomId: rawRoomId, action = 'refreshed', messageId = '' } = {}) {
    const roomId = normalizeRoomId(rawRoomId);
    const current = await snapshot(roomId);
    await publisher({ roomId, action, messageId, actorUserId: null, ...current });
    return current;
  }

  return Object.freeze({ list, pin, refresh, unpin });
}

module.exports = { MAX_PINS_PER_ROOM, PinServiceError, createPinService };
