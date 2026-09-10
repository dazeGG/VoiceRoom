import type { RealtimeEvent } from '../../api/realtime';

export type NotificationEventType =
  | 'notification.dm.message'
  | 'notification.room.message'
  | 'notification.friend.request'
  | 'notification.friend.accepted';

export type NotificationActor = {
  id: string;
  displayName?: string;
  login?: string;
  avatarColorKey?: string;
  avatarAccent?: string | null;
  avatarUrl?: string | null;
};

export type NotificationMessageBrief = {
  id: string;
  body: string;
  createdAt: number;
};

export type NotificationRoomContext = {
  roomId: string;
  name?: string;
  avatarUrl?: string | null;
};

export type NotificationDmMessageEvent = {
  type: 'notification.dm.message';
  payload: {
    dedupeKey: string;
    peer: NotificationActor;
    message: NotificationMessageBrief;
  };
};

export type NotificationRoomMessageEvent = {
  type: 'notification.room.message';
  payload: {
    dedupeKey: string;
    room: NotificationRoomContext;
    sender: NotificationActor;
    message: NotificationMessageBrief;
  };
};

export type NotificationFriendRequestEvent = {
  type: 'notification.friend.request';
  payload: {
    dedupeKey: string;
    requester: NotificationActor;
    requestId: string;
  };
};

export type NotificationFriendAcceptedEvent = {
  type: 'notification.friend.accepted';
  payload: {
    dedupeKey: string;
    user: NotificationActor;
    context?: Record<string, unknown>;
  };
};

export type NotificationRealtimeEvent =
  | NotificationDmMessageEvent
  | NotificationRoomMessageEvent
  | NotificationFriendRequestEvent
  | NotificationFriendAcceptedEvent;

export type NotificationPermissionState = 'default' | 'denied' | 'granted' | 'unsupported';

export type NotificationActiveTarget =
  | { kind: 'dm'; peerId: string }
  | { kind: 'room'; roomId: string }
  | { kind: 'room-preview'; roomId: string }
  | { kind: 'room-chat'; roomId: string };

export type BrowserNotificationPayload = {
  title: string;
  body: string;
  tag: string;
  dedupeKey: string;
  data?: Record<string, unknown>;
};

export type DesktopNotificationPayload = {
  title: string;
  body: string;
  tag: string;
  dedupeKey: string;
  route?: string;
};

export type DesktopNotificationBridgeResult = { ok?: boolean; reason?: string } | null | undefined | void;

export type DesktopNotificationBridge = {
  show: (payload: DesktopNotificationPayload) => DesktopNotificationBridgeResult | Promise<DesktopNotificationBridgeResult>;
};

export type NotificationRouteOptions = {
  userId?: string | null;
  activeTarget?: NotificationActiveTarget | null;
  mutedPeerIds?: readonly string[] | Set<string> | null;
  mutedRoomIds?: readonly string[] | Set<string> | null;
  privateNotifications?: boolean;
  doNotDisturb?: boolean;
  notificationsAvailable?: boolean;
  permission?: NotificationPermissionState;
  now?: number;
  dedupeTtlMs?: number;
};

export type NotificationRouteResult =
  | { notify: true; payload: BrowserNotificationPayload }
  | { notify: false; reason: string };

const DEFAULT_BODY = 'New message';
const PRIVATE_BODY = 'Open VoiceRoom to view this notification.';
const MAX_BODY_LENGTH = 120;
const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const DEDUPE_PREFIX = 'voice-room:notification-dedupe:';
const DEDUPE_CHANNEL = 'voice-room:notification-dedupe';

const memoryDedupe = new Map<string, number>();
let dedupeChannel: BroadcastChannel | null | undefined;

function getDesktopNotificationBridge(): DesktopNotificationBridge | null {
  const candidate = (globalThis as typeof globalThis & { voiceRoomDesktopNotifications?: unknown }).voiceRoomDesktopNotifications;
  if (!candidate || typeof candidate !== 'object') return null;
  const bridge = candidate as Partial<DesktopNotificationBridge>;
  return typeof bridge.show === 'function' ? (bridge as DesktopNotificationBridge) : null;
}

function hasId(collection: readonly string[] | Set<string> | null | undefined, value: string | null | undefined): boolean {
  if (!collection || !value) return false;
  return collection instanceof Set ? collection.has(value) : collection.includes(value);
}

function actorLabel(actor: Pick<NotificationActor, 'displayName' | 'login' | 'id'> | null | undefined, fallback: string): string {
  const name = actor?.displayName?.trim() || actor?.login?.trim() || actor?.id?.trim();
  return name || fallback;
}

function roomLabel(room: Pick<NotificationRoomContext, 'name' | 'roomId'> | null | undefined): string {
  return room?.name?.trim() || room?.roomId?.trim() || 'Room';
}

function isNotificationRealtimeEvent(event: RealtimeEvent | NotificationRealtimeEvent): event is NotificationRealtimeEvent {
  return (
    event.type === 'notification.dm.message' ||
    event.type === 'notification.room.message' ||
    event.type === 'notification.friend.request' ||
    event.type === 'notification.friend.accepted'
  );
}

function activeTargetSuppresses(event: NotificationRealtimeEvent, activeTarget: NotificationActiveTarget | null | undefined): boolean {
  if (!activeTarget) return false;
  if (event.type === 'notification.dm.message') {
    return activeTarget.kind === 'dm' && activeTarget.peerId === event.payload?.peer?.id;
  }
  if (event.type === 'notification.room.message') {
    return (
      (activeTarget.kind === 'room' || activeTarget.kind === 'room-preview' || activeTarget.kind === 'room-chat') &&
      activeTarget.roomId === event.payload?.room?.roomId
    );
  }
  return false;
}

function eventSenderId(event: NotificationRealtimeEvent): string | undefined {
  if (event.type === 'notification.dm.message') return event.payload?.peer?.id;
  if (event.type === 'notification.room.message') return event.payload?.sender?.id;
  if (event.type === 'notification.friend.request') return event.payload?.requester?.id;
  if (event.type === 'notification.friend.accepted') return event.payload?.user?.id;
  return undefined;
}

function eventDedupeKey(event: NotificationRealtimeEvent): string | undefined {
  return event.payload?.dedupeKey;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasActorLabel(actor: Pick<NotificationActor, 'displayName' | 'login'> | null | undefined): boolean {
  return isNonEmptyString(actor?.displayName) || isNonEmptyString(actor?.login);
}

function getLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function cleanupMemoryDedupe(now: number): void {
  for (const [key, expiresAt] of memoryDedupe) {
    if (expiresAt <= now) memoryDedupe.delete(key);
  }
}

function dedupeStorageKey(key: string): string {
  return `${DEDUPE_PREFIX}${key}`;
}

function getDedupeChannel(): BroadcastChannel | null {
  if (dedupeChannel !== undefined) return dedupeChannel;
  if (typeof globalThis.BroadcastChannel === 'undefined') {
    dedupeChannel = null;
    return dedupeChannel;
  }
  try {
    dedupeChannel = new globalThis.BroadcastChannel(DEDUPE_CHANNEL);
    dedupeChannel.onmessage = (event) => {
      const key = typeof event.data?.key === 'string' ? event.data.key : '';
      const expiresAt = typeof event.data?.expiresAt === 'number' ? event.data.expiresAt : 0;
      if (key && expiresAt > Date.now()) memoryDedupe.set(key, expiresAt);
    };
  } catch {
    dedupeChannel = null;
  }
  return dedupeChannel;
}

export function truncateNotificationBody(body: string | null | undefined, maxLength = MAX_BODY_LENGTH): string {
  const normalized = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (maxLength <= 0) return '';
  if (normalized.length <= maxLength) return normalized;
  if (maxLength === 1) return '…';
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof globalThis.Notification === 'undefined') return 'unsupported';
  return globalThis.Notification.permission as NotificationPermissionState;
}

export function getNotificationDeliveryPermission(): NotificationPermissionState {
  return getDesktopNotificationBridge() ? 'granted' : getNotificationPermission();
}

export function canUseNotifications(): boolean {
  return Boolean(getDesktopNotificationBridge()) || typeof globalThis.Notification !== 'undefined';
}

export async function requestNotificationPermissionFromUserAction(): Promise<NotificationPermissionState> {
  if (!canUseNotifications()) return 'unsupported';
  if (typeof globalThis.Notification?.requestPermission !== 'function') {
    return getDesktopNotificationBridge() ? 'granted' : 'unsupported';
  }
  return (await globalThis.Notification.requestPermission()) as NotificationPermissionState;
}

export function resetNotificationDedupeForTests(): void {
  memoryDedupe.clear();
  if (dedupeChannel) dedupeChannel.close();
  dedupeChannel = undefined;
}

export function markNotificationDedupeKeySeen(
  key: string,
  { now = Date.now(), ttlMs = DEFAULT_DEDUPE_TTL_MS }: { now?: number; ttlMs?: number } = {}
): void {
  if (!key) return;
  const expiresAt = now + Math.max(0, ttlMs);
  memoryDedupe.set(key, expiresAt);
  const storage = getLocalStorage();
  try {
    storage?.setItem(dedupeStorageKey(key), String(expiresAt));
  } catch {
    // Storage may be unavailable or full; in-memory dedupe still applies.
  }
  try {
    getDedupeChannel()?.postMessage({ key, expiresAt });
  } catch {
    // BroadcastChannel is best-effort cross-tab dedupe.
  }
}

export function isNotificationDedupeKeyFresh(key: string, now = Date.now()): boolean {
  if (!key) return false;
  cleanupMemoryDedupe(now);
  const memoryExpiry = memoryDedupe.get(key) ?? 0;
  if (memoryExpiry > now) return true;

  const storage = getLocalStorage();
  try {
    const raw = storage?.getItem(dedupeStorageKey(key));
    const expiresAt = raw ? Number(raw) : 0;
    if (expiresAt > now) {
      memoryDedupe.set(key, expiresAt);
      return true;
    }
    if (raw) storage?.removeItem(dedupeStorageKey(key));
  } catch {
    // Ignore storage read failures.
  }
  return false;
}

export function consumeNotificationDedupeKey(
  key: string,
  { now = Date.now(), ttlMs = DEFAULT_DEDUPE_TTL_MS }: { now?: number; ttlMs?: number } = {}
): boolean {
  if (isNotificationDedupeKeyFresh(key, now)) return false;
  markNotificationDedupeKeySeen(key, { now, ttlMs });
  return true;
}

export function buildNotificationPayload(
  event: NotificationRealtimeEvent,
  { privateNotifications = false }: Pick<NotificationRouteOptions, 'privateNotifications'> = {}
): BrowserNotificationPayload | null {
  const dedupeKey = eventDedupeKey(event);
  if (!isNonEmptyString(dedupeKey)) return null;

  if (event.type === 'notification.dm.message') {
    if (!isNonEmptyString(event.payload?.peer?.id) || !isNonEmptyString(event.payload?.message?.id)) return null;
    const peerName = actorLabel(event.payload.peer, 'Friend');
    return {
      title: `${peerName} sent a message`,
      body: privateNotifications ? PRIVATE_BODY : truncateNotificationBody(event.payload.message?.body || DEFAULT_BODY),
      tag: dedupeKey,
      dedupeKey,
      data: { kind: 'dm', peerId: event.payload.peer?.id, messageId: event.payload.message?.id }
    };
  }

  if (event.type === 'notification.room.message') {
    if (
      !isNonEmptyString(event.payload?.room?.roomId) ||
      (!isNonEmptyString(event.payload?.sender?.id) && !hasActorLabel(event.payload?.sender)) ||
      !isNonEmptyString(event.payload?.message?.id)
    ) {
      return null;
    }
    const senderName = actorLabel(event.payload.sender, 'Someone');
    const name = roomLabel(event.payload.room);
    return {
      title: `${senderName} in ${name}`,
      body: privateNotifications ? PRIVATE_BODY : truncateNotificationBody(event.payload.message?.body || DEFAULT_BODY),
      tag: dedupeKey,
      dedupeKey,
      data: {
        kind: 'room',
        roomId: event.payload.room?.roomId,
        senderId: event.payload.sender?.id,
        messageId: event.payload.message?.id
      }
    };
  }

  if (event.type === 'notification.friend.request') {
    if (!isNonEmptyString(event.payload?.requester?.id) || !isNonEmptyString(event.payload?.requestId)) return null;
    const requesterName = actorLabel(event.payload.requester, 'Someone');
    return {
      title: 'New friend request',
      body: privateNotifications ? PRIVATE_BODY : `${requesterName} wants to be friends.`,
      tag: dedupeKey,
      dedupeKey,
      data: { kind: 'friend-request', requesterId: event.payload.requester?.id, requestId: event.payload.requestId }
    };
  }

  if (!isNonEmptyString(event.payload?.user?.id)) return null;
  const userName = actorLabel(event.payload.user, 'Someone');
  return {
    title: 'Friend request accepted',
    body: privateNotifications ? PRIVATE_BODY : `${userName} accepted your friend request.`,
    tag: dedupeKey,
    dedupeKey,
    data: { kind: 'friend-accepted', userId: event.payload.user?.id }
  };
}

export function shouldNotify(event: RealtimeEvent | NotificationRealtimeEvent, options: NotificationRouteOptions = {}): boolean {
  return routeNotificationEvent(event, options).notify;
}


export function routeNotificationEvent(
  event: RealtimeEvent | NotificationRealtimeEvent,
  options: NotificationRouteOptions = {}
): NotificationRouteResult {
  if (!isNotificationRealtimeEvent(event)) return { notify: false, reason: 'not-notification-event' };
  if (options.doNotDisturb) return { notify: false, reason: 'do-not-disturb' };
  if (options.notificationsAvailable === false) return { notify: false, reason: 'notifications-unavailable' };
  if (options.permission && options.permission !== 'granted') return { notify: false, reason: 'notification-permission-not-granted' };

  const senderId = eventSenderId(event);
  if (options.userId && senderId === options.userId) return { notify: false, reason: 'self-event' };
  if (activeTargetSuppresses(event, options.activeTarget)) return { notify: false, reason: 'active-target' };

  if (event.type === 'notification.dm.message' && hasId(options.mutedPeerIds, event.payload?.peer?.id)) {
    return { notify: false, reason: 'muted-peer' };
  }
  if (event.type === 'notification.room.message' && hasId(options.mutedRoomIds, event.payload?.room?.roomId)) {
    return { notify: false, reason: 'muted-room' };
  }

  const payload = buildNotificationPayload(event, options);
  if (!payload) return { notify: false, reason: 'invalid-payload' };
  return { notify: true, payload };
}

function toDesktopNotificationPayload(payload: BrowserNotificationPayload): DesktopNotificationPayload {
  const route = typeof payload.data?.route === 'string' ? payload.data.route : undefined;
  return {
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    dedupeKey: payload.dedupeKey,
    ...(route ? { route } : {})
  };
}

function showPageNotification(payload: BrowserNotificationPayload): Notification | null {
  if (typeof globalThis.Notification === 'undefined' || globalThis.Notification.permission !== 'granted') return null;
  return new globalThis.Notification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    data: payload.data
  });
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return Boolean(value && typeof (value as PromiseLike<T>).then === 'function');
}

function shouldFallbackToBrowserNotification(result: DesktopNotificationBridgeResult): boolean {
  return Boolean(result && typeof result === 'object' && result.ok === false);
}

function deliverBrowserNotification(payload: BrowserNotificationPayload): Notification | Promise<Notification | null> | null {
  const bridge = getDesktopNotificationBridge();
  if (!bridge && (!canUseNotifications() || getNotificationPermission() !== 'granted')) return null;
  if (!consumeNotificationDedupeKey(payload.dedupeKey || payload.tag)) return null;
  if (!bridge) return showPageNotification(payload);

  try {
    const result = bridge.show(toDesktopNotificationPayload(payload));
    if (isPromiseLike<DesktopNotificationBridgeResult>(result)) {
      return Promise.resolve(result)
        .then((resolved) => (shouldFallbackToBrowserNotification(resolved) ? showPageNotification(payload) : null))
        .catch(() => showPageNotification(payload));
    }
    return shouldFallbackToBrowserNotification(result) ? showPageNotification(payload) : null;
  } catch {
    return showPageNotification(payload);
  }
}

export function showBrowserNotification(payload: BrowserNotificationPayload): Notification | Promise<Notification | null> | null {
  const locks = globalThis.navigator?.locks;
  if (!locks) return deliverBrowserNotification(payload);
  const key = payload.dedupeKey || payload.tag;
  return (locks.request(
    `voice-room-notification:${key}`,
    () => Promise.resolve(deliverBrowserNotification(payload))
  ) as unknown as Promise<Notification | null>).catch(() => null);
}
