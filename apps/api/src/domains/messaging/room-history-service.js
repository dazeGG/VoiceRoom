'use strict';

const {
  buildHistoryEnvelope,
  normalizeHistoryRequest
} = require('@voice-room/shared/messaging-history');

class RoomHistoryError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'RoomHistoryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createRoomHistoryService({ repository, cursorCodec, visibilityPolicy, projectMessage, now = () => new Date() } = {}) {
  if (!repository) throw new TypeError('room history repository is required');
  if (!cursorCodec?.encode || !cursorCodec?.decode) throw new TypeError('cursor codec is required');

  function contextFor(roomId) {
    return `room:${roomId}`;
  }

  function encodeTuple(roomId, tuple, purpose = 'room-history') {
    return cursorCodec.encode({ purpose, context: contextFor(roomId), tuple });
  }

  function decodeTuple(roomId, cursor) {
    return cursorCodec.decode(cursor, { purpose: 'room-history', context: contextFor(roomId) });
  }

  function canView(message, access) {
    if (!visibilityPolicy) return true;
    if (typeof visibilityPolicy.canViewRoomMessage === 'function') {
      return visibilityPolicy.canViewRoomMessage({
        ...access,
        authorized: access?.authorized === true,
        message,
        roomId: message.roomId
      });
    }
    if (typeof visibilityPolicy.requireRoomMessage === 'function') {
      visibilityPolicy.requireRoomMessage({
        ...access,
        authorized: access?.authorized === true,
        message,
        roomId: message.roomId
      });
    }
    return true;
  }

  function toDto(roomId, message) {
    const tuple = { createdAtMicros: message.createdAtMicros, id: message.id };
    return {
      id: message.id,
      kind: 'room',
      createdAt: message.createdAt,
      author: {
        userId: message.authorUserId,
        peerId: message.peerId,
        name: message.name,
        avatarColorKey: message.avatarColorKey,
        avatarUrl: message.avatarKey ? `/api/avatars/${encodeURIComponent(message.avatarKey)}` : null,
        avatarAccent: message.avatarAccent
      },
      content: message.content || { type: 'text', text: message.text },
      editedAt: message.editedAt,
      expiresAt: message.expiresAt,
      attachments: message.attachments,
      replyTo: message.replyTo,
      replyPreview: message.replyPreview,
      cursor: encodeTuple(roomId, tuple),
      readCursor: encodeTuple(roomId, tuple, 'room-read')
    };
  }

  async function getPage({ roomId, query = {}, access = { authorized: true } } = {}) {
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) throw new RoomHistoryError('room_not_found', 404, 'Room not found');

    let normalizedQuery = query;
    if (query.mode === 'around' && !query.cursor && typeof query.messageId === 'string' && query.messageId.trim()) {
      const tuple = await repository.getAnchor?.({ roomId: normalizedRoomId, messageId: query.messageId.trim() });
      if (!tuple) throw new RoomHistoryError('message_not_found', 404, 'Message not found');
      normalizedQuery = { ...query, cursor: encodeTuple(normalizedRoomId, tuple) };
    }
    const parsed = normalizeHistoryRequest(normalizedQuery);
    if (!parsed.ok) throw new RoomHistoryError(parsed.code, 400, 'Invalid history cursor');
    if (!(await repository.roomExists(normalizedRoomId))) {
      throw new RoomHistoryError('room_not_found', 404, 'Room not found');
    }

    const { mode, limit, cursor } = parsed.request;
    let anchor;
    if (mode !== 'latest') {
      try {
        anchor = decodeTuple(normalizedRoomId, cursor);
      } catch {
        throw new RoomHistoryError('invalid_cursor', 400, 'Invalid history cursor');
      }
    }

    const method = {
      latest: 'listLatest',
      before: 'listBefore',
      after: 'listAfter',
      around: 'listAround'
    }[mode];
    const page = await repository[method]({
      roomId: normalizedRoomId,
      anchor,
      limit,
      now: now()
    });
    const visible = [];
    for (const message of page.messages) {
      if (await canView(message, access)) visible.push(message);
    }
    const projected = typeof projectMessage === 'function'
      ? await Promise.all(visible.map((message) => projectMessage({ message, roomId: normalizedRoomId, access })))
      : visible;
    const messages = projected.map((message) => toDto(normalizedRoomId, message));

    return buildHistoryEnvelope({
      mode,
      messages,
      pageInfo: {
        before: messages[0]?.cursor,
        after: messages.at(-1)?.cursor,
        around: mode === 'around' ? cursor : undefined,
        hasMoreBefore: page.hasMoreBefore,
        hasMoreAfter: page.hasMoreAfter
      }
    });
  }

  return { getPage };
}

module.exports = { RoomHistoryError, createRoomHistoryService };
