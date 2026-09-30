import { test, vi } from 'vitest';
import { freshImport } from './helpers/fresh-module.ts';
import type * as Router from '../src/lib/shared/notifications/router.ts';
import assert from 'node:assert/strict';

async function loadRouter() {
  return freshImport<typeof Router>('/src/lib/shared/notifications/router.ts');
}

function reasonOf(result: Router.NotificationRouteResult) {
  return result.notify ? null : result.reason;
}

function payloadOf(result: Router.NotificationRouteResult) {
  assert.equal(result.notify, true);
  return result.payload;
}

function built(payload: Router.BrowserNotificationPayload | null) {
  assert.ok(payload);
  return payload;
}

function dmEvent(
  overrides: { dedupeKey?: string; peerId?: string; peerName?: string; messageId?: string; body?: string } = {}
) {
  return {
    type: 'notification.dm.message' as const,
    payload: {
      dedupeKey: overrides.dedupeKey ?? 'dm:msg-1',
      peer: { id: overrides.peerId ?? 'alice-id', displayName: overrides.peerName ?? 'Alice', login: 'alice' },
      message: { id: overrides.messageId ?? 'msg-1', body: overrides.body ?? 'hello from Alice', createdAt: 123 }
    }
  };
}

function roomEvent(
  overrides: {
    dedupeKey?: string;
    roomId?: string;
    roomName?: string;
    senderId?: string;
    senderName?: string;
    messageId?: string;
    body?: string;
  } = {}
) {
  return {
    type: 'notification.room.message' as const,
    payload: {
      dedupeKey: overrides.dedupeKey ?? 'room:daily:message:msg-2',
      room: { roomId: overrides.roomId ?? 'daily', name: overrides.roomName ?? 'Daily' },
      sender: { id: overrides.senderId ?? 'bob-id', displayName: overrides.senderName ?? 'Bob', login: 'bob' },
      message: { id: overrides.messageId ?? 'msg-2', body: overrides.body ?? 'standup starts now', createdAt: 456 }
    }
  };
}

function friendRequestEvent(overrides: { dedupeKey?: string; requesterId?: string; requestId?: string } = {}) {
  return {
    type: 'notification.friend.request' as const,
    payload: {
      dedupeKey: overrides.dedupeKey ?? 'friend-request:req-1',
      requester: { id: overrides.requesterId ?? 'cara-id', displayName: 'Cara', login: 'cara' },
      requestId: overrides.requestId ?? 'req-1'
    }
  };
}

function acceptedEvent(overrides: { dedupeKey?: string; userId?: string; context?: Record<string, unknown> } = {}) {
  return {
    type: 'notification.friend.accepted' as const,
    payload: {
      dedupeKey: overrides.dedupeKey ?? 'friend-accepted:user-1:user-2',
      user: { id: overrides.userId ?? 'dana-id', displayName: 'Dana', login: 'dana' },
      context: overrides.context ?? { relationship: 'friend' }
    }
  };
}

test('routes notification payloads with visible non-private bodies and title formats', async () => {
  const router = await loadRouter();

  const dm = payloadOf(
    router.routeNotificationEvent(dmEvent(), { permission: 'granted', notificationsAvailable: true })
  );
  assert.equal(dm.title, 'Alice');
  assert.equal(dm.body, 'hello from Alice');
  assert.equal(dm.tag, 'dm:msg-1');
  assert.deepEqual(dm.data, { kind: 'dm', peerId: 'alice-id', messageId: 'msg-1', route: '/?dm=alice-id' });

  const room = payloadOf(
    router.routeNotificationEvent(roomEvent(), { permission: 'granted', notificationsAvailable: true })
  );
  assert.equal(room.title, 'Bob — Daily');
  assert.equal(room.body, 'standup starts now');
  assert.equal(room.data?.roomId, 'daily');
  assert.equal(room.data?.route, '/?room=daily&message=msg-2');
  assert.equal(room.tag, 'room:daily:message:msg-2');

  const request = built(router.buildNotificationPayload(friendRequestEvent(), { privateNotifications: false }));
  assert.equal(request.title, 'Новая заявка в друзья');
  assert.equal(request.body, 'Cara хочет добавить вас в друзья.');

  const accepted = built(router.buildNotificationPayload(acceptedEvent(), { privateNotifications: false }));
  assert.equal(accepted.title, 'Заявка в друзья принята');
  assert.equal(accepted.body, 'Dana теперь у вас в друзьях.');

  const fallbackRoom = roomEvent();
  Reflect.deleteProperty(fallbackRoom.payload.room, 'name');
  Reflect.deleteProperty(fallbackRoom.payload.message, 'body');
  const fallback = built(router.buildNotificationPayload(fallbackRoom, { privateNotifications: false }));
  assert.equal(fallback.title, 'Bob — daily');
  assert.equal(fallback.body, 'Новое сообщение');
});

test('invalid notification payloads no-op instead of creating incomplete browser payloads', async () => {
  const router = await loadRouter();

  const missingDmPeerId = dmEvent();
  Reflect.deleteProperty(missingDmPeerId.payload.peer, 'id');
  assert.equal(router.buildNotificationPayload(missingDmPeerId), null);
  assert.deepEqual(router.routeNotificationEvent(missingDmPeerId), { notify: false, reason: 'invalid-payload' });

  const missingRoomId = roomEvent();
  Reflect.deleteProperty(missingRoomId.payload.room, 'roomId');
  assert.equal(router.buildNotificationPayload(missingRoomId), null);
  assert.deepEqual(router.routeNotificationEvent(missingRoomId), { notify: false, reason: 'invalid-payload' });

  const missingFriendRequestId = friendRequestEvent();
  Reflect.deleteProperty(missingFriendRequestId.payload, 'requestId');
  assert.equal(router.buildNotificationPayload(missingFriendRequestId), null);
  assert.deepEqual(router.routeNotificationEvent(missingFriendRequestId), { notify: false, reason: 'invalid-payload' });

  const missingAcceptedUserId = acceptedEvent();
  Reflect.deleteProperty(missingAcceptedUserId.payload.user, 'id');
  assert.equal(router.buildNotificationPayload(missingAcceptedUserId), null);
  assert.deepEqual(router.routeNotificationEvent(missingAcceptedUserId), { notify: false, reason: 'invalid-payload' });
});

test('suppresses active exact DM and room targets, mutes, self, denied, and unavailable cases', async () => {
  const router = await loadRouter();

  assert.equal(reasonOf(router.routeNotificationEvent({ type: 'pong', payload: { at: 1 } })), 'not-notification-event');
  assert.equal(router.shouldNotify(dmEvent(), { permission: 'granted', notificationsAvailable: true }), true);
  assert.equal(
    reasonOf(router.routeNotificationEvent(dmEvent(), { notificationsAvailable: false })),
    'notifications-unavailable'
  );
  assert.equal(
    reasonOf(router.routeNotificationEvent(dmEvent(), { permission: 'denied' })),
    'notification-permission-not-granted'
  );
  assert.equal(reasonOf(router.routeNotificationEvent(dmEvent(), { userId: 'alice-id' })), 'self-event');
  assert.equal(reasonOf(router.routeNotificationEvent(dmEvent(), { mutedPeerIds: ['alice-id'] })), 'muted-peer');
  assert.equal(reasonOf(router.routeNotificationEvent(dmEvent(), { doNotDisturb: true })), 'do-not-disturb');
  assert.equal(
    reasonOf(router.routeNotificationEvent(roomEvent(), { mutedRoomIds: new Set(['daily']) })),
    'muted-room'
  );
  assert.equal(
    reasonOf(router.routeNotificationEvent(dmEvent(), { activeTarget: { kind: 'dm', peerId: 'alice-id' } })),
    'active-target'
  );

  for (const kind of ['room', 'room-preview', 'room-chat'] as const) {
    assert.equal(
      reasonOf(router.routeNotificationEvent(roomEvent(), { activeTarget: { kind, roomId: 'daily' } })),
      'active-target'
    );
  }

  assert.equal(
    router.routeNotificationEvent(dmEvent(), { activeTarget: { kind: 'dm', peerId: 'other' } }).notify,
    true
  );
  assert.equal(
    router.routeNotificationEvent(roomEvent(), { activeTarget: { kind: 'room-preview', roomId: 'other' } }).notify,
    true
  );
});

test('truncates notification bodies conservatively with an ellipsis', async () => {
  const router = await loadRouter();

  assert.equal(router.truncateNotificationBody('  hello   world  ', 20), 'hello world');
  assert.equal(router.truncateNotificationBody('abcdef', 4), 'abc…');
  assert.equal(router.truncateNotificationBody('abcdef', 1), '…');
  assert.equal(router.truncateNotificationBody('abcdef', 0), '');

  const payload = built(
    router.buildNotificationPayload(dmEvent({ body: 'one two three four five' }), {
      privateNotifications: false
    })
  );
  assert.equal(payload.body, 'one two three four five');

  const privatePayload = built(
    router.buildNotificationPayload(dmEvent({ body: 'secret text' }), {
      privateNotifications: true
    })
  );
  assert.equal(privatePayload.body, 'Откройте VoiceRoom, чтобы посмотреть уведомление.');
});

test('browser helpers dedupe by tag/key and never request permission outside explicit helper', async () => {
  const calls: Array<{ title: string; options: NotificationOptions | undefined }> = [];
  let requestPermissionCalls = 0;

  class FakeNotification {
    static permission = 'granted';
    static async requestPermission() {
      requestPermissionCalls += 1;
      return 'granted';
    }
    constructor(title: string, options?: NotificationOptions) {
      calls.push({ title, options });
    }
  }

  const storage = new Map<string, string>();
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key: string, value: unknown) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key)
  });

  const router = await loadRouter();
  router.resetNotificationDedupeForTests();
  const payload = built(
    router.buildNotificationPayload(dmEvent({ dedupeKey: 'dm:dedupe' }), {
      privateNotifications: false
    })
  );

  assert.equal(router.getNotificationPermission(), 'granted');
  assert.equal(router.canUseNotifications(), true);
  assert.equal(
    router.routeNotificationEvent(dmEvent({ dedupeKey: 'dm:dedupe' }), { permission: 'granted' }).notify,
    true
  );
  assert.equal(requestPermissionCalls, 0, 'routing does not request permission');

  const first = await router.showBrowserNotification(payload);
  const second = await router.showBrowserNotification(payload);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.title, 'Alice');
  assert.equal(requestPermissionCalls, 0, 'showing does not request permission');

  assert.equal(router.isNotificationDedupeKeyFresh('dm:dedupe'), true);
  assert.equal(router.consumeNotificationDedupeKey('dm:dedupe'), false);
  assert.equal(router.consumeNotificationDedupeKey('dm:other', { now: 10, ttlMs: 50 }), true);
  assert.equal(router.isNotificationDedupeKeyFresh('dm:other', 20), true);
  assert.equal(router.isNotificationDedupeKeyFresh('dm:other', 61), false);

  assert.equal(await router.requestNotificationPermissionFromUserAction(), 'granted');
  assert.equal(requestPermissionCalls, 1, 'explicit helper requests permission');
});

test('desktop bridge is preferred over page Notification and does not request permission', async () => {
  const bridgeCalls: Router.DesktopNotificationPayload[] = [];
  const notificationCalls: Array<{ title: string; options: NotificationOptions | undefined }> = [];
  let requestPermissionCalls = 0;

  class DeniedNotification {
    static permission = 'denied';
    static async requestPermission() {
      requestPermissionCalls += 1;
      return 'denied';
    }
    constructor(title: string, options?: NotificationOptions) {
      notificationCalls.push({ title, options });
    }
  }

  vi.stubGlobal('Notification', DeniedNotification);
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('voiceRoomDesktopNotifications', {
    show(payload: Router.DesktopNotificationPayload) {
      bridgeCalls.push(payload);
      return { ok: true };
    }
  });

  const router = await loadRouter();
  router.resetNotificationDedupeForTests();
  const payload = built(
    router.buildNotificationPayload(dmEvent({ dedupeKey: 'dm:desktop' }), {
      privateNotifications: false
    })
  );

  assert.equal(router.getNotificationPermission(), 'denied');
  assert.equal(router.getNotificationDeliveryPermission(), 'granted');
  assert.equal(router.canUseNotifications(), true);
  assert.equal(
    router.routeNotificationEvent(dmEvent({ dedupeKey: 'dm:desktop' }), {
      permission: router.getNotificationDeliveryPermission()
    }).notify,
    true
  );

  const result = await router.showBrowserNotification(payload);
  assert.equal(result, null);
  assert.deepEqual(bridgeCalls, [
    {
      title: 'Alice',
      body: 'hello from Alice',
      tag: 'dm:alice-id',
      dedupeKey: 'dm:desktop',
      route: '/?dm=alice-id'
    }
  ]);
  assert.equal(notificationCalls.length, 0);
  assert.equal(requestPermissionCalls, 0);
});

test('desktop bridge can satisfy an explicit notification UI action without browser Notification API', async () => {
  vi.stubGlobal('voiceRoomDesktopNotifications', {
    show() {
      return { ok: true };
    }
  });

  const router = await loadRouter();
  assert.equal(router.getNotificationPermission(), 'unsupported');
  assert.equal(router.getNotificationDeliveryPermission(), 'granted');
  assert.equal(router.canUseNotifications(), true);
  assert.equal(await router.requestNotificationPermissionFromUserAction(), 'granted');
});

test('desktop bridge unsupported result falls back to browser Notification', async () => {
  const notificationCalls: Array<{ title: string; options: NotificationOptions | undefined }> = [];

  class FakeNotification {
    static permission = 'granted';
    constructor(title: string, options?: NotificationOptions) {
      notificationCalls.push({ title, options });
    }
  }

  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('voiceRoomDesktopNotifications', {
    async show() {
      return { ok: false, reason: 'unsupported' };
    }
  });

  const router = await loadRouter();
  router.resetNotificationDedupeForTests();
  const payload = built(
    router.buildNotificationPayload(roomEvent({ dedupeKey: 'room:desktop-fallback' }), {
      privateNotifications: false
    })
  );
  const result = await router.showBrowserNotification(payload);

  assert.ok(result);
  assert.equal(notificationCalls.length, 1);
  assert.equal(notificationCalls[0]?.title, 'Bob — Daily');
  assert.equal(notificationCalls[0]?.options?.tag, 'room:desktop-fallback');
});

test('showBrowserNotification serializes dedupe through the Web Locks API', async () => {
  const calls: string[] = [];
  let tail: Promise<void> = Promise.resolve();

  class FakeNotification {
    static permission = 'granted';
    constructor(title: string) {
      calls.push(title);
    }
  }

  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('navigator', {
    locks: {
      request(_name: string, callback: () => unknown) {
        const result = tail.then(callback);
        tail = result.then(
          () => {},
          () => {}
        );
        return result;
      }
    }
  });

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
});

test('showBrowserNotification no-ops when denied or unavailable', async () => {
  const router = await loadRouter();
  router.resetNotificationDedupeForTests();

  assert.equal(router.getNotificationPermission(), 'unsupported');
  assert.equal(router.canUseNotifications(), false);
  assert.equal(await router.showBrowserNotification({ title: 'x', body: 'y', tag: 'z', dedupeKey: 'z' }), null);

  class DeniedNotification {
    static permission = 'denied';
    static async requestPermission() {
      throw new Error('must not be called');
    }
  }
  vi.stubGlobal('Notification', DeniedNotification);
  assert.equal(await router.showBrowserNotification({ title: 'x', body: 'y', tag: 'z2', dedupeKey: 'z2' }), null);
});
