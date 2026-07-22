'use strict';

const {
  buildHistoryEnvelope,
  normalizeHistoryRequest
} = require('@voice-room/shared/messaging-history');

class DmHistoryError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'DmHistoryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function canonicalParticipants(userId, peerId) {
  return userId < peerId ? [userId, peerId] : [peerId, userId];
}

function createDmHistoryService({ repository, cursorCodec, visibilityPolicy, projectMessage } = {}) {
  if (!repository) throw new TypeError('DM history repository is required');
  if (!cursorCodec?.encode || !cursorCodec?.decode) throw new TypeError('cursor codec is required');

  function contextFor(userId, peerId) {
    return `dm:${canonicalParticipants(userId, peerId).join(':')}`;
  }

  function encodeTuple(userId, peerId, tuple, purpose = 'dm-history') {
    return cursorCodec.encode({ purpose, context: contextFor(userId, peerId), tuple });
  }

  function decodeTuple(userId, peerId, cursor) {
    return cursorCodec.decode(cursor, { purpose: 'dm-history', context: contextFor(userId, peerId) });
  }

  function canView(message, userId) {
    if (!visibilityPolicy) {
      return message.senderId === userId || message.recipientId === userId;
    }
    const context = { message, userId, viewerId: userId };
    if (typeof visibilityPolicy.canViewDirectMessage === 'function') {
      return visibilityPolicy.canViewDirectMessage(context);
    }
    if (typeof visibilityPolicy.requireDirectMessage === 'function') {
      visibilityPolicy.requireDirectMessage(context);
    }
    return true;
  }

  function toDto(userId, peerId, message) {
    const tuple = { createdAtMicros: message.createdAtMicros, id: message.id };
    return {
      id: message.id,
      kind: 'dm',
      createdAt: message.createdAt,
      author: { userId: message.senderId },
      recipientId: message.recipientId,
      content: { type: 'text', text: message.body },
      editedAt: message.editedAt,
      readAt: message.readAt,
      metadata: message.metadata,
      attachments: message.attachments,
      replyTo: message.replyTo,
      replyPreview: message.replyPreview,
      cursor: encodeTuple(userId, peerId, tuple),
      readCursor: encodeTuple(userId, peerId, tuple, 'dm-read')
    };
  }

  async function getPage({ userId, peerId, query = {} } = {}) {
    const viewer = String(userId || '').trim();
    const peer = String(peerId || '').trim();
    if (!viewer) throw new DmHistoryError('authentication_required', 401, 'Authentication required');
    if (!peer || viewer === peer) throw new DmHistoryError('thread_not_found', 404, 'Thread not found');

    const parsed = normalizeHistoryRequest(query);
    if (!parsed.ok) throw new DmHistoryError(parsed.code, 400, 'Invalid history cursor');
    if (!(await repository.canReadThread({ userId: viewer, peerId: peer }))) {
      throw new DmHistoryError('thread_forbidden', 403, 'Thread is not available');
    }

    const { mode, limit, cursor } = parsed.request;
    let anchor;
    if (mode !== 'latest') {
      try {
        anchor = decodeTuple(viewer, peer, cursor);
      } catch {
        throw new DmHistoryError('invalid_cursor', 400, 'Invalid history cursor');
      }
    }

    const method = {
      latest: 'listLatest',
      before: 'listBefore',
      after: 'listAfter',
      around: 'listAround'
    }[mode];
    const page = await repository[method]({ userId: viewer, peerId: peer, anchor, limit });
    const visible = [];
    for (const message of page.messages) {
      if (await canView(message, viewer)) visible.push(message);
    }
    const projected = typeof projectMessage === 'function'
      ? await Promise.all(visible.map((message) => projectMessage({ message, userId: viewer, peerId: peer })))
      : visible;
    const messages = projected.map((message) => toDto(viewer, peer, message));

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

module.exports = { DmHistoryError, canonicalParticipants, createDmHistoryService };
