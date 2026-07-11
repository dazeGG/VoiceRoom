import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadRouter() {
  const source = readFileSync(new URL('../src/lib/shared/notifications/router.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: 'router.ts'
  }).outputText;
  const dir = mkdtempSync(join(tmpdir(), 'voice-room-notification-router-'));
  const file = join(dir, 'router.mjs');
  writeFileSync(file, output);
  return import(`${pathToFileURL(file).href}?v=${Date.now()}-${Math.random()}`);
}

function dmEvent(overrides = {}) {
  return {
    type: 'notification.dm.message',
    payload: {
      dedupeKey: overrides.dedupeKey ?? 'dm:msg-1',
      peer: { id: overrides.peerId ?? 'alice-id', displayName: overrides.peerName ?? 'Alice', login: 'alice' },
      message: { id: overrides.messageId ?? 'msg-1', body: overrides.body ?? 'hello from Alice', createdAt: 123 }
    }
  };
}

function roomEvent(overrides = {}) {
  return {
    type: 'notification.room.message',
    payload: {
      dedupeKey: overrides.dedupeKey ?? 'room:daily:message:msg-2',
      room: { roomId: overrides.roomId ?? 'daily', name: overrides.roomName ?? 'Daily' },
      sender: { id: overrides.senderId ?? 'bob-id', displayName: overrides.senderName ?? 'Bob', login: 'bob' },
      message: { id: overrides.messageId ?? 'msg-2', body: overrides.body ?? 'standup starts now', createdAt: 456 }
    }
  };
}

function friendRequestEvent(overrides = {}) {
  return {
    type: 'notification.friend.request',
    payload: {
      dedupeKey: overrides.dedupeKey ?? 'friend-request:req-1',
      requester: { id: overrides.requesterId ?? 'cara-id', displayName: 'Cara', login: 'cara' },
      requestId: overrides.requestId ?? 'req-1'
    }
  };
}

function acceptedEvent(overrides = {}) {
  return {
    type: 'notification.friend.accepted',
    payload: {
      dedupeKey: overrides.dedupeKey ?? 'friend-accepted:user-1:user-2',
      user: { id: overrides.userId ?? 'dana-id', displayName: 'Dana', login: 'dana' },
      context: overrides.context ?? { relationship: 'friend' }
    }
  };
}

test('routes notification payloads with visible non-private bodies and title formats', async () => {
  const router = await loadRouter();

  const dm = router.routeNotificationEvent(dmEvent(), { permission: 'granted', notificationsAvailable: true });
  assert.equal(dm.notify, true);
  assert.equal(dm.payload.title, 'Alice sent a message');
  assert.equal(dm.payload.body, 'hello from Alice');
  assert.equal(dm.payload.tag, 'dm:msg-1');
  assert.deepEqual(dm.payload.data, { kind: 'dm', peerId: 'alice-id', messageId: 'msg-1' });

  const room = router.routeNotificationEvent(roomEvent(), { permission: 'granted', notificationsAvailable: true });
  assert.equal(room.notify, true);
  assert.equal(room.payload.title, 'Bob in Daily');
  assert.equal(room.payload.body, 'standup starts now');
  assert.equal(room.payload.data.roomId, 'daily');

  const request = router.buildNotificationPayload(friendRequestEvent(), { privateNotifications: false });
  assert.equal(request.title, 'New friend request');
  assert.equal(request.body, 'Cara wants to be friends.');

  const accepted = router.buildNotificationPayload(acceptedEvent(), { privateNotifications: false });
  assert.equal(accepted.title, 'Friend request accepted');
  assert.equal(accepted.body, 'Dana accepted your friend request.');
});


test('invalid notification payloads no-op instead of creating incomplete browser payloads', async () => {
  const router = await loadRouter();

  const missingDmPeerId = dmEvent();
  delete missingDmPeerId.payload.peer.id;
  assert.equal(router.buildNotificationPayload(missingDmPeerId), null);
  assert.deepEqual(router.routeNotificationEvent(missingDmPeerId), { notify: false, reason: 'invalid-payload' });

  const missingRoomId = roomEvent();
  delete missingRoomId.payload.room.roomId;
  assert.equal(router.buildNotificationPayload(missingRoomId), null);
  assert.deepEqual(router.routeNotificationEvent(missingRoomId), { notify: false, reason: 'invalid-payload' });

  const missingFriendRequestId = friendRequestEvent();
  delete missingFriendRequestId.payload.requestId;
  assert.equal(router.buildNotificationPayload(missingFriendRequestId), null);
  assert.deepEqual(router.routeNotificationEvent(missingFriendRequestId), { notify: false, reason: 'invalid-payload' });

  const missingAcceptedUserId = acceptedEvent();
  delete missingAcceptedUserId.payload.user.id;
  assert.equal(router.buildNotificationPayload(missingAcceptedUserId), null);
  assert.deepEqual(router.routeNotificationEvent(missingAcceptedUserId), { notify: false, reason: 'invalid-payload' });
});

test('suppresses active exact DM and room targets, mutes, self, denied, and unavailable cases', async () => {
  const router = await loadRouter();

  assert.deepEqual(router.routeNotificationEvent({ type: 'pong', payload: { at: 1 } }).reason, 'not-notification-event');
  assert.equal(router.shouldNotify(dmEvent(), { permission: 'granted', notificationsAvailable: true }), true);
  assert.equal(router.routeNotificationEvent(dmEvent(), { notificationsAvailable: false }).reason, 'notifications-unavailable');
  assert.equal(router.routeNotificationEvent(dmEvent(), { permission: 'denied' }).reason, 'notification-permission-not-granted');
  assert.equal(router.routeNotificationEvent(dmEvent(), { userId: 'alice-id' }).reason, 'self-event');
  assert.equal(router.routeNotificationEvent(dmEvent(), { mutedPeerIds: ['alice-id'] }).reason, 'muted-peer');
  assert.equal(router.routeNotificationEvent(roomEvent(), { mutedRoomIds: new Set(['daily']) }).reason, 'muted-room');
  assert.equal(router.routeNotificationEvent(dmEvent(), { activeTarget: { kind: 'dm', peerId: 'alice-id' } }).reason, 'active-target');

  for (const kind of ['room', 'room-preview', 'room-chat']) {
    assert.equal(
      router.routeNotificationEvent(roomEvent(), { activeTarget: { kind, roomId: 'daily' } }).reason,
      'active-target'
    );
  }

  assert.equal(router.routeNotificationEvent(dmEvent(), { activeTarget: { kind: 'dm', peerId: 'other' } }).notify, true);
  assert.equal(router.routeNotificationEvent(roomEvent(), { activeTarget: { kind: 'room-preview', roomId: 'other' } }).notify, true);
});

test('truncates notification bodies conservatively with an ellipsis', async () => {
  const router = await loadRouter();

  assert.equal(router.truncateNotificationBody('  hello   world  ', 20), 'hello world');
  assert.equal(router.truncateNotificationBody('abcdef', 4), 'abc…');
  assert.equal(router.truncateNotificationBody('abcdef', 1), '…');
  assert.equal(router.truncateNotificationBody('abcdef', 0), '');

  const payload = router.buildNotificationPayload(dmEvent({ body: 'one two three four five' }), { privateNotifications: false });
  assert.equal(payload.body, 'one two three four five');

  const privatePayload = router.buildNotificationPayload(dmEvent({ body: 'secret text' }), { privateNotifications: true });
  assert.equal(privatePayload.body, 'Open VoiceRoom to view this notification.');
});

test('browser helpers dedupe by tag/key and never request permission outside explicit helper', async () => {
  const originalNotification = globalThis.Notification;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalLocalStorage = globalThis.localStorage;
  const originalBridge = globalThis.voiceRoomDesktopNotifications;
  const calls = [];
  let requestPermissionCalls = 0;

  class FakeNotification {
    static permission = 'granted';
    static async requestPermission() {
      requestPermissionCalls += 1;
      return 'granted';
    }
    constructor(title, options) {
      calls.push({ title, options });
      this.title = title;
      this.options = options;
    }
  }

  const storage = new Map();
  globalThis.Notification = FakeNotification;
  globalThis.BroadcastChannel = undefined;
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };

  try {
    const router = await loadRouter();
    router.resetNotificationDedupeForTests();
    const payload = router.buildNotificationPayload(dmEvent({ dedupeKey: 'dm:dedupe' }), { privateNotifications: false });

    assert.equal(router.getNotificationPermission(), 'granted');
    assert.equal(router.canUseNotifications(), true);
    assert.equal(router.routeNotificationEvent(dmEvent({ dedupeKey: 'dm:dedupe' }), { permission: 'granted' }).notify, true);
    assert.equal(requestPermissionCalls, 0, 'routing does not request permission');

    const first = router.showBrowserNotification(payload);
    const second = router.showBrowserNotification(payload);
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].title, 'Alice sent a message');
    assert.equal(requestPermissionCalls, 0, 'showing does not request permission');

    assert.equal(router.isNotificationDedupeKeyFresh('dm:dedupe'), true);
    assert.equal(router.consumeNotificationDedupeKey('dm:dedupe'), false);
    assert.equal(router.consumeNotificationDedupeKey('dm:other', { now: 10, ttlMs: 50 }), true);
    assert.equal(router.isNotificationDedupeKeyFresh('dm:other', 20), true);
    assert.equal(router.isNotificationDedupeKeyFresh('dm:other', 61), false);

    assert.equal(await router.requestNotificationPermissionFromUserAction(), 'granted');
    assert.equal(requestPermissionCalls, 1, 'explicit helper requests permission');
  } finally {
    if (originalNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = originalNotification;
    if (originalBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = originalBroadcastChannel;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
    if (originalBridge === undefined) delete globalThis.voiceRoomDesktopNotifications;
    else globalThis.voiceRoomDesktopNotifications = originalBridge;
  }
});

test('desktop bridge is preferred over page Notification and does not request permission', async () => {
  const originalNotification = globalThis.Notification;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalBridge = globalThis.voiceRoomDesktopNotifications;
  const bridgeCalls = [];
  const notificationCalls = [];
  let requestPermissionCalls = 0;

  class DeniedNotification {
    static permission = 'denied';
    static async requestPermission() {
      requestPermissionCalls += 1;
      return 'denied';
    }
    constructor(title, options) {
      notificationCalls.push({ title, options });
    }
  }

  globalThis.Notification = DeniedNotification;
  globalThis.BroadcastChannel = undefined;
  globalThis.voiceRoomDesktopNotifications = {
    show(payload) {
      bridgeCalls.push(payload);
      return { ok: true };
    }
  };

  try {
    const router = await loadRouter();
    router.resetNotificationDedupeForTests();
    const payload = router.buildNotificationPayload(dmEvent({ dedupeKey: 'dm:desktop' }), { privateNotifications: false });

    assert.equal(router.getNotificationPermission(), 'denied');
    assert.equal(router.getNotificationDeliveryPermission(), 'granted');
    assert.equal(router.canUseNotifications(), true);
    assert.equal(
      router.routeNotificationEvent(dmEvent({ dedupeKey: 'dm:desktop' }), { permission: router.getNotificationDeliveryPermission() }).notify,
      true
    );

    const result = router.showBrowserNotification(payload);
    assert.equal(result, null);
    assert.deepEqual(bridgeCalls, [
      {
        title: 'Alice sent a message',
        body: 'hello from Alice',
        tag: 'dm:desktop',
        dedupeKey: 'dm:desktop'
      }
    ]);
    assert.equal(notificationCalls.length, 0);
    assert.equal(requestPermissionCalls, 0);
  } finally {
    if (originalNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = originalNotification;
    if (originalBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = originalBroadcastChannel;
    if (originalBridge === undefined) delete globalThis.voiceRoomDesktopNotifications;
    else globalThis.voiceRoomDesktopNotifications = originalBridge;
  }
});

test('desktop bridge can satisfy an explicit notification UI action without browser Notification API', async () => {
  const originalNotification = globalThis.Notification;
  const originalBridge = globalThis.voiceRoomDesktopNotifications;

  delete globalThis.Notification;
  globalThis.voiceRoomDesktopNotifications = {
    show() {
      return { ok: true };
    }
  };

  try {
    const router = await loadRouter();
    assert.equal(router.getNotificationPermission(), 'unsupported');
    assert.equal(router.getNotificationDeliveryPermission(), 'granted');
    assert.equal(router.canUseNotifications(), true);
    assert.equal(await router.requestNotificationPermissionFromUserAction(), 'granted');
  } finally {
    if (originalNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = originalNotification;
    if (originalBridge === undefined) delete globalThis.voiceRoomDesktopNotifications;
    else globalThis.voiceRoomDesktopNotifications = originalBridge;
  }
});

test('desktop bridge unsupported result falls back to browser Notification', async () => {
  const originalNotification = globalThis.Notification;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalBridge = globalThis.voiceRoomDesktopNotifications;
  const notificationCalls = [];

  class FakeNotification {
    static permission = 'granted';
    constructor(title, options) {
      notificationCalls.push({ title, options });
      this.title = title;
      this.options = options;
    }
  }

  globalThis.Notification = FakeNotification;
  globalThis.BroadcastChannel = undefined;
  globalThis.voiceRoomDesktopNotifications = {
    async show() {
      return { ok: false, reason: 'unsupported' };
    }
  };

  try {
    const router = await loadRouter();
    router.resetNotificationDedupeForTests();
    const payload = router.buildNotificationPayload(roomEvent({ dedupeKey: 'room:desktop-fallback' }), { privateNotifications: false });
    const result = await router.showBrowserNotification(payload);

    assert.ok(result);
    assert.equal(notificationCalls.length, 1);
    assert.equal(notificationCalls[0].title, 'Bob in Daily');
    assert.equal(notificationCalls[0].options.tag, 'room:desktop-fallback');
  } finally {
    if (originalNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = originalNotification;
    if (originalBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = originalBroadcastChannel;
    if (originalBridge === undefined) delete globalThis.voiceRoomDesktopNotifications;
    else globalThis.voiceRoomDesktopNotifications = originalBridge;
  }
});

test('showBrowserNotification serializes dedupe through the Web Locks API', async () => {
  const originalNotification = globalThis.Notification;
  const originalNavigator = globalThis.navigator;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const calls = [];
  let tail = Promise.resolve();

  class FakeNotification {
    static permission = 'granted';
    constructor(title) {
      calls.push(title);
    }
  }

  globalThis.Notification = FakeNotification;
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(_name, callback) {
          const result = tail.then(callback);
          tail = result.catch(() => {});
          return result;
        }
      }
    }
  });

  try {
    const router = await loadRouter();
    router.resetNotificationDedupeForTests();
    const payload = { title: 'locked', body: 'body', tag: 'lock-key', dedupeKey: 'lock-key' };
    const [first, second] = await Promise.all([
      router.showBrowserNotification(payload),
      router.showBrowserNotification(payload)
    ]);
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(calls.length, 1);
  } finally {
    if (originalNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = originalNotification;
    if (originalNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
    if (originalBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = originalBroadcastChannel;
  }
});

test('showBrowserNotification no-ops when denied or unavailable', async () => {
  const originalNotification = globalThis.Notification;
  const originalBridge = globalThis.voiceRoomDesktopNotifications;
  const router = await loadRouter();
  router.resetNotificationDedupeForTests();

  try {
    delete globalThis.Notification;
    assert.equal(router.getNotificationPermission(), 'unsupported');
    assert.equal(router.canUseNotifications(), false);
    assert.equal(router.showBrowserNotification({ title: 'x', body: 'y', tag: 'z', dedupeKey: 'z' }), null);

    class DeniedNotification {
      static permission = 'denied';
      static async requestPermission() {
        throw new Error('must not be called');
      }
    }
    globalThis.Notification = DeniedNotification;
    assert.equal(router.showBrowserNotification({ title: 'x', body: 'y', tag: 'z2', dedupeKey: 'z2' }), null);
  } finally {
    if (originalNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = originalNotification;
    if (originalBridge === undefined) delete globalThis.voiceRoomDesktopNotifications;
    else globalThis.voiceRoomDesktopNotifications = originalBridge;
  }
});
