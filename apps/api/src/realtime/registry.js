'use strict';

const crypto = require('node:crypto');
const { buildServerEnvelope, sendWsEnvelope } = require('./envelope');
const { toWsAccountEvent } = require('./account-events');

function createConnectionId(prefix) {
  return `${prefix}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
}

function createConnectionRegistry({
  maxConnectionsPerUser,
  keepaliveMs,
  isUserOnline,
  onPresenceChange,
  onConnectionClose,
  getFriendIds
}) {
  const userConnections = new Map();
  const connections = new Map();

  function connectionCount(userId) {
    if (!userId) return 0;
    const set = userConnections.get(userId);
    return set ? set.size : 0;
  }

  function createConnectionRecord(userId, socket) {
    return {
      id: createConnectionId(userId || 'guest'),
      userId: userId || null,
      guest: !userId,
      socket,
      previewRoomIds: new Set(),
      activeVoice: null,
      lastHeartbeatAt: Date.now(),
      closed: false
    };
  }

  function addConnection(userId, socket) {
    const connection = createConnectionRecord(userId, socket);

    let set = userConnections.get(userId);
    const wasOffline = !isUserOnline(userId);
    if (!set) {
      set = new Set();
      userConnections.set(userId, set);
    }
    set.add(connection);
    connections.set(connection.id, connection);

    if (wasOffline) {
      void notifyFriendsPresence(userId, true);
    }

    return connection;
  }

  function addGuestConnection(socket) {
    const connection = createConnectionRecord(null, socket);
    connections.set(connection.id, connection);
    return connection;
  }

  async function notifyFriendsPresence(userId, online) {
    if (!onPresenceChange || !userId) return;
    let friendIds = [];
    try {
      friendIds = await getFriendIds(userId);
    } catch (error) {
      console.error('Failed to load friends for WS presence:', error);
      return;
    }
    for (const friendId of friendIds) {
      onPresenceChange(friendId, userId, online);
    }
  }

  function removeConnection(connection) {
    if (!connection || connection.closed) return;
    connection.closed = true;

    if (onConnectionClose) {
      onConnectionClose(connection);
    }

    if (connection.userId) {
      const set = userConnections.get(connection.userId);
      if (set) {
        set.delete(connection);
        if (set.size === 0) userConnections.delete(connection.userId);
      }
      const stillOnline = isUserOnline(connection.userId);
      if (!stillOnline) {
        void notifyFriendsPresence(connection.userId, false);
      }
    }

    connections.delete(connection.id);
  }

  function sendToConnection(connection, envelope) {
    return sendWsEnvelope(connection.socket, envelope);
  }

  function sendToUser(userId, envelope) {
    const set = userConnections.get(userId);
    if (!set || set.size === 0) return 0;
    let delivered = 0;
    const failed = [];
    for (const connection of set) {
      if (sendToConnection(connection, envelope)) {
        delivered += 1;
        connection.lastHeartbeatAt = Date.now();
      } else {
        failed.push(connection);
      }
    }
    for (const connection of failed) removeConnection(connection);
    return delivered;
  }

  function broadcastAccountEvent(userId, legacyMessage) {
    const wsEvent = toWsAccountEvent(legacyMessage);
    if (!wsEvent) return 0;
    return sendToUser(userId, wsEvent);
  }

  function sendReady(connection, payload) {
    return sendToConnection(connection, buildServerEnvelope('ready', payload));
  }

  function rejectOverLimit(userId) {
    return connectionCount(userId) >= maxConnectionsPerUser;
  }

  function touch(connection) {
    connection.lastHeartbeatAt = Date.now();
  }

  function pruneStale(now = Date.now()) {
    const stale = [];
    for (const connection of connections.values()) {
      if (now - connection.lastHeartbeatAt > keepaliveMs * 3) stale.push(connection);
    }
    for (const connection of stale) {
      try {
        connection.socket.close(4000, 'Stale connection');
      } catch {
        // Ignore close failures during prune.
      }
      removeConnection(connection);
    }
  }

  return {
    addConnection,
    addGuestConnection,
    broadcastAccountEvent,
    connectionCount,
    connections,
    removeConnection,
    rejectOverLimit,
    sendReady,
    sendToConnection,
    sendToUser,
    touch,
    pruneStale,
    userConnections
  };
}

module.exports = {
  createConnectionRegistry
};