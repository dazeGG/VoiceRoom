
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRoomStore, mapMessage, mapRoom } = require('../src/lib/room-store');

function createFakePool(handler) {
  const calls = [];
  const client = {
    query: async (text, values = []) => {
      calls.push({ scope: 'client', text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      return handler(text, values, calls);
    },
    release() {
      calls.push({ scope: 'client', text: 'release', values: [] });
    }
  };

  return {
    calls,
    async query(text, values = []) {
      calls.push({ scope: 'pool', text, values });
      return handler(text, values, calls);
    },
    async connect() {
      calls.push({ scope: 'pool', text: 'connect', values: [] });
      return client;
    },
    async end() {
      calls.push({ scope: 'pool', text: 'end', values: [] });
    }
  };
}

test('mapRoom maps PostgreSQL row shape to API room shape with ephemeral peers map', () => {
  const room = mapRoom({
    avatar_key: 'room_abcdefghij_deadbeef.webp',
    id: 'abc123',
    creator_ip: '127.0.0.1',
    is_static: true,
    created_at: new Date(1000),
    updated_at: new Date(2000),
    empty_since: null
  });

  assert.equal(room.id, 'abc123');
  assert.equal(room.avatarKey, 'room_abcdefghij_deadbeef.webp');
  assert.equal(room.creatorIp, '127.0.0.1');
  assert.equal(room.isStatic, true);
  assert.equal(room.createdAt, 1000);
  assert.equal(room.updatedAt, 2000);
  assert.equal(room.emptySince, null);
  assert.ok(room.peers instanceof Map);
  assert.equal(room.name, '');
  assert.equal('emoji' in room, false);
});

test('createRoom inserts durable room row with parameterized SQL', async () => {
  const pool = createFakePool(() => ({
    rows: [{
      id: 'room1', creator_ip: 'ip', is_static: true,
      created_at: new Date(1000), updated_at: new Date(1000), empty_since: new Date(1000)
    }],
    rowCount: 1
  }));
  const store = createRoomStore({ pool });

  const room = await store.createRoom({ roomId: 'room1', creatorIp: 'ip', isStatic: true, now: 1000 });

  assert.equal(room.id, 'room1');
  assert.match(pool.calls[0].text, /INSERT INTO rooms/);
  assert.deepEqual(pool.calls[0].values.slice(0, 3), ['room1', 'ip', true]);
  assert.doesNotMatch(pool.calls[0].text, /room_icon_key|room_color_key|emoji/);
});

test('updateRoomAvatar only updates active static rooms', async () => {
  const pool = createFakePool((text, values) => {
    assert.match(text, /is_static = true/);
    assert.match(text, /deleted_at IS NULL/);
    assert.equal(values[0], 'abcdefghij');
    assert.equal(values[1], 'room_abcdefghij_deadbeef.webp');
    return {
      rows: [{
        id: values[0], avatar_key: values[1], creator_ip: '', is_static: true,
        created_at: new Date(1000), updated_at: values[2], empty_since: null
      }],
      rowCount: 1
    };
  });
  const room = await createRoomStore({ pool }).updateRoomAvatar(
    'abcdefghij',
    'room_abcdefghij_deadbeef.webp',
    2000
  );
  assert.equal(room.avatarKey, 'room_abcdefghij_deadbeef.webp');
});

test('swapRoomAvatar locks the room row and returns the exact key it replaced', async () => {
  const oldKey = 'room_abcdefghij_0123abcd.webp';
  const nextKey = 'room_abcdefghij_deadbeef.webp';
  const pool = createFakePool((text, values) => {
    if (/SELECT avatar_key/.test(text)) {
      assert.match(text, /deleted_at IS NULL/);
      assert.match(text, /is_static = true/);
      assert.match(text, /FOR UPDATE/);
      return { rows: [{ avatar_key: oldKey }], rowCount: 1 };
    }
    if (/UPDATE rooms SET avatar_key/.test(text)) {
      return {
        rows: [{
          id: values[0], avatar_key: values[1], creator_ip: '', is_static: true,
          created_at: new Date(1000), updated_at: values[2], empty_since: null
        }],
        rowCount: 1
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  const result = await createRoomStore({ pool }).swapRoomAvatar('abcdefghij', nextKey, 2000);

  assert.equal(result.previousAvatarKey, oldKey);
  assert.equal(result.room.avatarKey, nextKey);
  assert.ok(pool.calls.some(({ text }) => text === 'BEGIN'));
  assert.ok(pool.calls.some(({ text }) => text === 'COMMIT'));
});

test('appendMessage uses a transaction, verifies room existence, inserts row, and enforces cap', async () => {
  const pool = createFakePool((text) => {
    if (/SELECT id FROM rooms/.test(text)) return { rows: [{ id: 'room1' }], rowCount: 1 };
    if (/INSERT INTO room_messages/.test(text)) {
      return {
        rows: [{
          id: 'msg1', room_id: 'room1', peer_id: 'peer1', name: 'Ada', text: 'hello',
          created_at: new Date(1000), expires_at: new Date(2000)
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ maxMessagesPerRoom: 2, pool });

  const message = await store.appendMessage('room1', {
    id: 'msg1', peerId: 'peer1', name: 'Ada', text: 'hello', createdAt: 1000, expiresAt: 2000
  }, 1000);

  assert.deepEqual(message, {
    id: 'msg1', avatarAccent: null, avatarColorKey: message.avatarColorKey, avatarKey: null,
    roomId: 'room1', peerId: 'peer1', name: 'Ada', text: 'hello', createdAt: 1000, expiresAt: 2000,
    authorUserId: null, editedAt: null
  });
  assert.ok(pool.calls.some((call) => call.text === 'BEGIN'));
  assert.ok(pool.calls.some((call) => /INSERT INTO room_messages/.test(call.text)));
  assert.ok(pool.calls.some((call) => /row_number\(\) OVER/.test(call.text)));
  assert.ok(pool.calls.some((call) => call.text === 'COMMIT'));
});

test('appendMessage does not persist a profile-name snapshot for account messages', async () => {
  let insertedValues;
  const pool = createFakePool((text, values) => {
    if (/SELECT id FROM rooms/.test(text)) return { rows: [{ id: 'room1' }], rowCount: 1 };
    if (/INSERT INTO room_messages/.test(text)) {
      insertedValues = values;
      return {
        rows: [{
          id: 'msg1', room_id: 'room1', peer_id: 'peer1', name: '', text: 'hello',
          created_at: new Date(1000), expires_at: new Date(2000), author_user_id: 'user1'
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });

  await createRoomStore({ pool }).appendMessage('room1', {
    id: 'msg1', peerId: 'peer1', name: 'Outdated profile', text: 'hello',
    createdAt: 1000, expiresAt: 2000, authorUserId: 'user1'
  }, 1000);

  assert.equal(insertedValues[3], '');
  assert.equal(insertedValues[7], 'user1');
});

test('editMessage updates active room message text and maps its edit timestamp', async () => {
  const pool = createFakePool((text, values) => {
    assert.match(text, /UPDATE room_messages/);
    assert.match(text, /edited_at = current_timestamp/);
    assert.match(text, /deleted_at IS NULL/);
    assert.deepEqual(values, ['room1', 'msg1', 'updated']);
    return {
      rows: [{
        id: 'msg1', room_id: 'room1', peer_id: 'peer1', name: 'Ada', text: 'updated',
        created_at: new Date(1000), edited_at: new Date(3000), expires_at: new Date(5000)
      }],
      rowCount: 1
    };
  });

  const message = await createRoomStore({ pool }).editMessage('room1', 'msg1', 'updated');
  assert.equal(message.text, 'updated');
  assert.equal(message.editedAt, 3000);
});

test('room notification recipients ignore legacy server-side room mute rows', async () => {
  const pool = createFakePool((text, values) => {
    if (/FROM room_bans/.test(text)) {
      assert.match(text, /revoked_at IS NULL/);
      assert.match(text, /expires_at IS NULL OR expires_at > \$3/);
      assert.deepEqual(values.slice(0, 2), ['room1', ['owner-user', 'bookmark-user']]);
      return { rows: [], rowCount: 0 };
    }
    assert.match(text, /FROM room_memberships/);
    assert.match(text, /FROM room_bookmarks/);
    assert.doesNotMatch(text, /notification_room_mutes/);
    assert.deepEqual(values, ['room1']);
    return {
      rows: [{ user_id: 'owner-user' }, { user_id: 'bookmark-user' }],
      rowCount: 2
    };
  });

  const recipients = await createRoomStore({ pool }).listNotificationRecipientUserIds('room1');
  assert.deepEqual(recipients, ['owner-user', 'bookmark-user']);
});

test('getRoomUnreadCount counts active messages after the user read cursor and excludes own posts', async () => {
  const pool = createFakePool((text, values) => {
    assert.match(text, /LEFT JOIN room_chat_reads/);
    assert.match(text, /m\.created_at > COALESCE\(rcr\.last_read_at/);
    assert.match(text, /m\.author_user_id IS DISTINCT FROM \$2/);
    assert.deepEqual(values.slice(0, 2), ['room1', 'user1']);
    return { rows: [{ unread_count: 4 }], rowCount: 1 };
  });

  const count = await createRoomStore({ pool }).getRoomUnreadCount('room1', 'user1', 5000);
  assert.equal(count, 4);
  assert.equal(pool.calls[0].values[2].getTime(), 5000);
});

test('markRoomChatRead upserts a monotonic cursor only for visible rooms', async () => {
  const pool = createFakePool((text, values) => {
    assert.match(text, /INSERT INTO room_chat_reads/);
    assert.match(text, /\$2::varchar\(36\)/);
    assert.match(text, /\$3::timestamptz/);
    assert.match(text, /FROM room_memberships/);
    assert.match(text, /FROM room_bookmarks/);
    assert.match(text, /ON CONFLICT \(room_id, user_id\) DO UPDATE/);
    assert.match(text, /GREATEST\(room_chat_reads\.last_read_at, EXCLUDED\.last_read_at\)/);
    assert.deepEqual(values.slice(0, 2), ['room1', 'user1']);
    return { rows: [{ last_read_at: new Date(5000) }], rowCount: 1 };
  });

  const lastReadAt = await createRoomStore({ pool }).markRoomChatRead('room1', 'user1', 5000);
  assert.equal(lastReadAt, 5000);
});

test('listVisibleRoomsForUser returns per-user unread metadata', async () => {
  const pool = createFakePool((text, values) => {
    assert.match(text, /LEFT JOIN room_chat_reads/);
    assert.match(text, /AS unread_count/);
    assert.match(text, /AS last_message_at/);
    assert.deepEqual(values, ['user1']);
    return {
      rows: [{
        id: 'room1', is_static: true, relationship: 'owner', unread_count: 3,
        last_message_at: new Date(4000), created_at: new Date(1000), updated_at: new Date(2000)
      }],
      rowCount: 1
    };
  });

  const rooms = await createRoomStore({ pool }).listVisibleRoomsForUser('user1');
  assert.equal(rooms[0].unreadCount, 3);
  assert.equal(rooms[0].lastMessageAt, 4000);
});

test('listMessages soft-deletes expired messages before selecting active rows', async () => {
  const pool = createFakePool((text) => {
    if (/SELECT \*/.test(text)) {
      return {
        rows: [{
          id: 'msg1', room_id: 'room1', peer_id: '', name: '', text: 'hello',
          avatar_key: 'av_123e4567-e89b-12d3-a456-426614174000_deadbeef.webp',
          avatar_accent: '#49303f',
          created_at: new Date(1000), expires_at: new Date(2000)
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const messages = await store.listMessages('room1', { now: 1500, limit: 10 });

  assert.deepEqual(messages, [mapMessage({
    id: 'msg1', room_id: 'room1', peer_id: '', name: '', text: 'hello',
    avatar_key: 'av_123e4567-e89b-12d3-a456-426614174000_deadbeef.webp',
    avatar_accent: '#49303f',
    created_at: new Date(1000), expires_at: new Date(2000)
  })]);
  assert.match(pool.calls[0].text, /UPDATE room_messages/);
  assert.match(pool.calls[1].text, /LEFT JOIN room_peer_identities/);
  assert.match(pool.calls[1].text, /LEFT JOIN users/);
  assert.match(pool.calls[1].text, /COALESCE\(NULLIF\(u\.display_name, ''\), u\.login, recent\.name\) AS name/);
  assert.equal(messages[0].avatarAccent, '#49303f');
  assert.match(messages[0].avatarKey, /^av_/);
  assert.match(pool.calls[1].text, /ORDER BY recent.created_at ASC, recent.id ASC/);
});


test('createRoomWithQuota enforces room limits inside one advisory-locked transaction', async () => {
  const pool = createFakePool((text) => {
    if (/COUNT\(\*\)::int AS count/.test(text)) return { rows: [{ count: 0 }], rowCount: 1 };
    if (/INSERT INTO rooms/.test(text)) {
      return {
        rows: [{
          id: 'room-quota', creator_ip: 'ip', is_static: false,
          created_at: new Date(1000), updated_at: new Date(1000), empty_since: new Date(1000)
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    isStatic: false,
    maxTempRoomsPerIp: 1,
    maxRooms: 10,
    roomId: 'room-quota',
    now: 1000
  });

  assert.equal(result.status, 'created');
  assert.equal(result.room.id, 'room-quota');
  assert.ok(pool.calls.some((call) => call.text === 'BEGIN'));
  assert.ok(pool.calls.some((call) => /pg_advisory_xact_lock/.test(call.text)));
  assert.ok(pool.calls.some((call) => /creator_ip = \$1/.test(call.text)));
  assert.ok(pool.calls.some((call) => /is_static = false/.test(call.text)));
  assert.ok(pool.calls.some((call) => /SELECT COUNT\(\*\)::int AS count FROM rooms/.test(call.text)));
  const insertCall = pool.calls.find((call) => /INSERT INTO rooms/.test(call.text));
  assert.ok(insertCall);
  assert.doesNotMatch(insertCall.text, /room_icon_key|room_color_key|emoji/);
  assert.ok(pool.calls.some((call) => call.text === 'COMMIT'));
});

test('createRoomWithQuota creates owner membership for authenticated static rooms', async () => {
  const pool = createFakePool((text) => {
    if (/room_memberships rm/.test(text)) return { rows: [{ count: 0 }], rowCount: 1 };
    if (/SELECT COUNT\(\*\)::int AS count FROM rooms/.test(text)) return { rows: [{ count: 0 }], rowCount: 1 };
    if (/INSERT INTO rooms/.test(text)) {
      return {
        rows: [{
          id: 'owned-room', creator_ip: 'ip', is_static: true, owner_id: 'user-1',
          created_at: new Date(1000), updated_at: new Date(1000), empty_since: new Date(1000)
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    isStatic: true,
    ownerId: 'user-1',
    maxOwnedStaticRoomsPerUser: 3,
    maxRooms: 10,
    roomId: 'owned-room',
    now: 1000
  });

  assert.equal(result.status, 'created');
  assert.equal(result.room.ownerId, 'user-1');
  assert.ok(pool.calls.some((call) => /JOIN rooms r ON r.id = rm.room_id/.test(call.text)));
  assert.ok(pool.calls.some((call) => /INSERT INTO room_memberships/.test(call.text)));
});

test('createRoomWithQuota requires an owner for static rooms', async () => {
  const pool = createFakePool((text) => {
    if (/INSERT INTO rooms/.test(text)) throw new Error('insert should not run');
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    isStatic: true,
    maxOwnedStaticRoomsPerUser: 3,
    maxRooms: 10,
    roomId: 'anon-static'
  });

  assert.deepEqual(result, { room: null, status: 'auth_required' });
});

test('createRoomWithQuota enforces static ownership quota per user', async () => {
  const pool = createFakePool((text) => {
    if (/room_memberships rm/.test(text)) return { rows: [{ count: 3 }], rowCount: 1 };
    if (/INSERT INTO rooms/.test(text)) throw new Error('insert should not run');
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    isStatic: true,
    ownerId: 'user-1',
    maxOwnedStaticRoomsPerUser: 3,
    maxRooms: 10,
    roomId: 'owned-room-4'
  });

  assert.deepEqual(result, { room: null, status: 'quota_exceeded' });
});

test('createRoomWithQuota returns quota status without inserting when per-IP temp cap is full', async () => {
  const pool = createFakePool((text) => {
    if (/creator_ip = \$1/.test(text)) return { rows: [{ count: 1 }], rowCount: 1 };
    if (/INSERT INTO rooms/.test(text)) throw new Error('insert should not run');
    return { rows: [{ count: 0 }], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    maxTempRoomsPerIp: 1,
    maxRooms: 10,
    roomId: 'blocked-room'
  });

  assert.deepEqual(result, { room: null, status: 'quota_exceeded' });
  assert.equal(pool.calls.some((call) => /INSERT INTO rooms/.test(call.text)), false);
});


test('getOrCreatePeerIdentity creates, reuses, and rejects mismatched tokens by hash', async () => {
  const identities = new Map();
  const pool = createFakePool((text, values) => {
    if (/SELECT \* FROM room_peer_identities/.test(text)) {
      const row = identities.get(`${values[0]}:${values[1]}`);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/INSERT INTO room_peer_identities/.test(text)) {
      assert.match(text, /ON CONFLICT \(room_id, peer_id\) DO NOTHING/);
      const row = {
        id: values[0],
        room_id: values[1],
        peer_id: values[2],
        session_token_hash: values[3],
        avatar_color_key: values[4],
        display_name: values[5],
        created_at: values[6],
        last_seen_at: values[6]
      };
      identities.set(`${values[1]}:${values[2]}`, row);
      return { rows: [row], rowCount: 1 };
    }
    if (/UPDATE room_peer_identities/.test(text)) {
      const row = identities.get(`${values[0]}:${values[1]}`);
      row.last_seen_at = values[2];
      row.display_name = values[3];
      if (values[4]) row.avatar_color_key = values[4];
      return { rows: [row], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const created = await store.getOrCreatePeerIdentity({ roomId: 'room1', peerId: 'peer123456', sessionToken: 'token-a', displayName: 'Ada', avatarColorKey: 'green', now: 1000 });
  assert.equal(created.status, 'created');
  assert.equal(created.identity.avatarColorKey, 'green');
  assert.notEqual(created.identity.sessionTokenHash, 'token-a');

  const reused = await store.getOrCreatePeerIdentity({ roomId: 'room1', peerId: 'peer123456', sessionToken: 'token-a', displayName: 'Ada 2', avatarColorKey: 'rose', now: 2000 });
  assert.equal(reused.status, 'reused');
  assert.equal(reused.identity.avatarColorKey, 'rose');
  assert.equal(reused.identity.displayName, 'Ada 2');

  const mismatch = await store.getOrCreatePeerIdentity({ roomId: 'room1', peerId: 'peer123456', sessionToken: 'token-b', now: 3000 });
  assert.equal(mismatch.status, 'token_mismatch');
});


test('getOrCreatePeerIdentity recovers when concurrent first-touch insert wins the unique key', async () => {
  let insertAttempts = 0;
  const existingRow = {
    id: 'identity-1',
    room_id: 'room-race',
    peer_id: 'peer123456',
    session_token_hash: null,
    avatar_color_key: 'rose',
    display_name: 'Winner',
    created_at: new Date(1000),
    last_seen_at: new Date(1000)
  };
  const pool = createFakePool((text, values) => {
    if (/SELECT \* FROM room_peer_identities/.test(text)) {
      if (insertAttempts === 0) return { rows: [], rowCount: 0 };
      return { rows: [existingRow], rowCount: 1 };
    }
    if (/INSERT INTO room_peer_identities/.test(text)) {
      assert.match(text, /ON CONFLICT \(room_id, peer_id\) DO NOTHING/);
      insertAttempts += 1;
      existingRow.session_token_hash = values[3];
      return { rows: [], rowCount: 0 };
    }
    if (/UPDATE room_peer_identities/.test(text)) {
      existingRow.last_seen_at = values[2];
      existingRow.display_name = values[3];
      return { rows: [existingRow], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.getOrCreatePeerIdentity({
    roomId: 'room-race',
    peerId: 'peer123456',
    sessionToken: 'token-a',
    displayName: 'Retry',
    now: 2000
  });

  assert.equal(result.status, 'reused');
  assert.equal(result.identity.avatarColorKey, 'rose');
  assert.equal(result.identity.displayName, 'Retry');
});
