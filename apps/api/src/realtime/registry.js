'use strict';

const crypto = require('node:crypto');
const { buildServerEnvelope, sendWsEnvelope } = require('./envelope');
const { toWsAccountEvent } = require('./account-events');

function createConnectionId(prefix) {
  return `${prefix}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
}

function createConnectionRegistry({
  maxConnectionsPerUser,
  maxGuestConnectionsPerIp = 0,
  keepaliveMs,
  isUserOnline,
  onPresenceChange,
  onConnectionClose,
  getFriendIds
}) {
  const userConnections = new Map();
  const guestConnectionsByIp = new Map();
  const roomDetailConnections = new Map();
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
      guestIp: null,
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

  function addGuestConnection(socket, guestIp = 'unknown') {
    const connection = createConnectionRecord(null, socket);
    connection.guestIp = guestIp || 'unknown';
    let set = guestConnectionsByIp.get(connection.guestIp);
    if (!set) {
      set = new Set();
      guestConnectionsByIp.set(connection.guestIp, set);
    }
    set.add(connection);
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

    unregisterConnectionFromAllRooms(connection);

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
    } else if (connection.guestIp) {
      const set = guestConnectionsByIp.get(connection.guestIp);
      if (set) {
        set.delete(connection);
        if (set.size === 0) guestConnectionsByIp.delete(connection.guestIp);
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
      // Do not touch lastHeartbeatAt here: a successful send only means the
      // frame was queued locally, not that the client is alive. Liveness is
      // tracked from inbound ping/hello frames so pruneStale can reap
      // half-open sockets that still accept writes.
      if (sendToConnection(connection, envelope)) {
        delivered += 1;
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

  function guestConnectionCount(guestIp) {
    const set = guestConnectionsByIp.get(guestIp || 'unknown');
    return set ? set.size : 0;
  }

  function rejectGuestOverLimit(guestIp) {
    return maxGuestConnectionsPerIp > 0 && guestConnectionCount(guestIp) >= maxGuestConnectionsPerIp;
  }

  function registerConnectionForRoom(connection, roomId) {
    if (!connection || !roomId) return;
    let set = roomDetailConnections.get(roomId);
    if (!set) {
      set = new Set();
      roomDetailConnections.set(roomId, set);
    }
    set.add(connection);
  }

  function unregisterConnectionForRoom(connection, roomId) {
    const set = roomDetailConnections.get(roomId);
    if (!set) return;
    set.delete(connection);
    if (set.size === 0) roomDetailConnections.delete(roomId);
  }

  function unregisterConnectionFromAllRooms(connection) {
    for (const roomId of connection.previewRoomIds || []) {
      unregisterConnectionForRoom(connection, roomId);
    }
    if (connection.activeVoice?.roomId) unregisterConnectionForRoom(connection, connection.activeVoice.roomId);
  }

  function roomDetailSubscribers(roomId) {
    return roomDetailConnections.get(roomId) || new Set();
  }

  function touch(connection) {
    connection.lastHeartbeatAt = Date.now();
  }

  function pruneStale(now = Date.now()) {
    const stale = [];
    // 5x keepalive: background tabs throttle timers, so a healthy client's
    // ping interval can stretch to ~60s; 3x (45s) would reap live tabs.
    for (const connection of connections.values()) {
      if (now - connection.lastHeartbeatAt > keepaliveMs * 5) stale.push(connection);
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
    registerConnectionForRoom,
    rejectGuestOverLimit,
    rejectOverLimit,
    roomDetailSubscribers,
    sendReady,
    sendToConnection,
    sendToUser,
    touch,
    pruneStale,
    unregisterConnectionForRoom,
    unregisterConnectionFromAllRooms,
    userConnections
  };
}

module.exports = {
  createConnectionRegistry
};