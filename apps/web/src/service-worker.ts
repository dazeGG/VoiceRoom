/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

type PushPayload = {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  dedupeKey?: string;
  type?: string;
};

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((client) => client.visibilityState === 'visible' && client.focused)) return;
    let payload: PushPayload = {};
    try {
      payload = event.data?.json() || {};
    } catch {
      payload = { body: event.data?.text() || '' };
    }
    await self.registration.showNotification(payload.title || 'VoiceRoom', {
      body: payload.body || '',
      data: { url: payload.url || '/', dedupeKey: payload.dedupeKey, type: payload.type },
      icon: '/icon.svg',
      tag: payload.tag || payload.dedupeKey || 'voice-room'
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(String(event.notification.data?.url || '/'), self.location.origin);
    if (target.origin !== self.location.origin) target.href = new URL('/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = windows.find((client) => new URL(client.url).origin === target.origin);
    if (sameOrigin) {
      await sameOrigin.navigate(target.href);
      await sameOrigin.focus();
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

export {};
