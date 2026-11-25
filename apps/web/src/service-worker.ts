/// <reference lib="webworker" />

import { isArray, isRecord } from '@voiceroom/shared/guards';
import {
  callNotificationRoute,
  callPushTag,
  isCallPushType,
  parseCallPushPayload,
  parsePushPayload,
  type CallPushPayload,
  type PushPayload
} from '@voiceroom/shared/notifications';

declare const self: ServiceWorkerGlobalScope;

function serviceWorkerRunsOnMobile(): boolean {
  const nav = self.navigator;
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  const userAgent = nav.userAgent || '';
  const platform = nav.platform || '';
  // WorkerNavigator does not declare it, but Chromium's service workers expose it.
  const touchPoints = 'maxTouchPoints' in nav ? nav.maxTouchPoints : undefined;
  const maxTouchPoints = typeof touchPoints === 'number' && Number.isFinite(touchPoints) ? touchPoints : 0;
  return (
    /android|iphone|ipod|ipad|windows phone|mobile/i.test(userAgent) ||
    (/^MacIntel$/i.test(platform) && maxTouchPoints > 1)
  );
}

type CallFence = { tag: string; revision: number; expiresAt: number };
let callPushWork = Promise.resolve();

function isCallFence(value: unknown): value is CallFence {
  return (
    isRecord(value) &&
    typeof value.tag === 'string' &&
    typeof value.revision === 'number' &&
    typeof value.expiresAt === 'number'
  );
}

async function focusedWindow(): Promise<boolean> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.some((client) => client.visibilityState === 'visible' && client.focused);
}

function show(payload: PushPayload) {
  return self.registration.showNotification(payload.title || 'VoiceRoom', {
    body: payload.body || '',
    data: payload,
    icon: '/voiceroom-icon.svg',
    tag: payload.tag || payload.dedupeKey || 'voice-room'
  });
}

async function closeByTag(tag: string) {
  for (const notification of await self.registration.getNotifications({ tag })) notification.close();
}

async function closeEarlierAttempts({ callId, attempt }: CallPushPayload) {
  if (attempt === 1) return;
  const prefix = `call:${callId}:`;
  for (const notification of await self.registration.getNotifications()) {
    if (!notification.tag.startsWith(prefix)) continue;
    const previousAttempt = Number(notification.tag.slice(prefix.length));
    if (previousAttempt > 0 && previousAttempt < attempt) notification.close();
  }
}

async function handleCallPush(payload: CallPushPayload) {
  const now = Date.now();
  if (payload.expiresAt <= now) return;
  const cache = await self.caches.open('voiceroom-call-notifications-v1');
  const key = new URL('/.call-notification-fences', self.location.origin).href;
  const stored: unknown = await (await cache.match(key))?.json();
  const fences = new Map(
    (isArray(stored) ? stored.filter(isCallFence) : [])
      .filter((fence) => fence.expiresAt > now)
      .map((fence) => [fence.tag, fence])
  );

  function remember(tag: string): boolean {
    const latest = fences.get(tag);
    if (latest && latest.revision >= payload.revision) return false;
    fences.set(tag, { tag, revision: payload.revision, expiresAt: payload.expiresAt });
    return true;
  }
  const callTag = `call:${payload.callId}:incoming`;
  if (payload.type === 'call.state') {
    if (remember(callTag)) await closeEarlierAttempts(payload);
    if (remember(payload.tag)) await closeByTag(payload.tag);
    const missedTag = callPushTag(payload.callId, 'missed');
    if (payload.dismissMissed && remember(missedTag)) await closeByTag(missedTag);
  } else if (payload.type === 'call.incoming') {
    // A newer attempt supersedes notifications for earlier attempts on this device.
    if (remember(callTag) && remember(payload.tag)) {
      await closeEarlierAttempts(payload);
      if (!(await focusedWindow()) && payload.expiresAt > Date.now()) await show(payload);
    }
  } else if (remember(payload.tag) && !(await focusedWindow()) && payload.expiresAt > Date.now()) {
    await show(payload);
  }
  await cache.put(key, Response.json([...fences.values()]));
}

async function handlePush(event: PushEvent) {
  if (serviceWorkerRunsOnMobile()) return;
  let input: unknown;
  try {
    input = event.data?.json();
  } catch {
    input = { body: event.data?.text() || '' };
  }
  if (isRecord(input) && isCallPushType(input.type)) {
    const payload = parseCallPushPayload(input);
    if (!payload) return;
    const next = callPushWork.then(() => handleCallPush(payload));
    callPushWork = next.catch(() => {});
    return next;
  }
  if (await focusedWindow()) return;
  const payload = parsePushPayload(input);
  if (payload.expiresAt === undefined || payload.expiresAt > Date.now()) await show(payload);
}

self.addEventListener('push', (event) => event.waitUntil(handlePush(event)));

async function callTarget(payload: CallPushPayload): Promise<string> {
  const url = new URL(payload.url, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname !== '/') return '/';
  const peerId = url.searchParams.get('dm');
  if (peerId) return callNotificationRoute(payload.callId, peerId);
  if (url.searchParams.get('call') !== payload.callId) return '/';
  try {
    const response = await fetch(`/api/call-rings/notification/${encodeURIComponent(payload.callId)}`, {
      cache: 'no-store'
    });
    const result: unknown = response.ok ? await response.json() : null;
    if (isRecord(result) && result.ok === true && typeof result.peerUserId === 'string' && result.peerUserId) {
      return callNotificationRoute(payload.callId, result.peerUserId);
    }
  } catch {
    // An offline or signed-out browser can still go to app home.
  }
  return '/';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      // The DOM types a notification's data as any; read it as unknown and let parsePushPayload check it.
      const data: unknown = Reflect.get(event.notification, 'data');
      const call = parseCallPushPayload(data);
      const path = call ? await callTarget(call) : parsePushPayload(data).url;
      const target = new URL(path || '/', self.location.origin);
      if (target.origin !== self.location.origin) target.href = new URL('/', self.location.origin).href;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const sameOrigin = windows.find((client) => new URL(client.url).origin === target.origin);
      if (sameOrigin) {
        await sameOrigin.navigate(target.href);
        await sameOrigin.focus();
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

export {};
