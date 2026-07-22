'use strict';

class MessageReadError extends Error {
  constructor(code = 'invalid_read_cursor', statusCode = 400) {
    super('Invalid read cursor');
    this.name = 'MessageReadError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createMessageReadService({ cursorCodec, repository } = {}) {
  if (!cursorCodec?.decode) throw new TypeError('Cursor codec is required');
  if (!repository) throw new TypeError('Message read repository is required');

  function decode(cursor, purpose, context) {
    try {
      return cursorCodec.decode(cursor, { purpose, context });
    } catch {
      throw new MessageReadError();
    }
  }

  async function advanceRoom({ cursor, roomId, userId }) {
    const tuple = decode(cursor, 'room-read', `room:${roomId}`);
    const state = await repository.advanceRoom({ roomId, userId, tuple });
    if (!state) throw new MessageReadError('message_not_visible', 409);
    return { advanced: !state.unchanged, cursor };
  }

  async function advanceDm({ cursor, peerId, userId }) {
    const participants = userId < peerId ? [userId, peerId] : [peerId, userId];
    const tuple = decode(cursor, 'dm-read', `dm:${participants.join(':')}`);
    const state = await repository.advanceDm({ peerId, userId, tuple });
    if (!state) throw new MessageReadError('message_not_visible', 409);
    return { advanced: !state.unchanged, cursor };
  }

  return Object.freeze({ advanceDm, advanceRoom });
}

module.exports = { MessageReadError, createMessageReadService };
