/// <reference lib="webworker" />

import { parsePushPayload, type PushPayload } from '@voice-room/shared/notifications';

declare const self: ServiceWorkerGlobalScope;

function serviceWorkerRunsOnMobile(): boolean {
  const nav = self.navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  const userAgent = nav.userAgent || '';
  const platform = nav.platform || '';
  const maxTouchPoints = Number.isFinite(nav.maxTouchPoints) ? Number(nav.maxTouchPoints) : 0;
  return (
    /android|iphone|ipod|ipad|windows phone|mobile/i.test(userAgent) ||
    (/^MacIntel$/i.test(platform) && maxTouchPoints > 1)
  );
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      if (serviceWorkerRunsOnMobile()) return;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.some((client) => client.visibilityState === 'visible' && client.focused)) return;
      let payload: PushPayload;
      try {
        payload = parsePushPayload(event.data?.json());
      } catch {
        payload = { body: event.data?.text() || '' };
      }
      if (payload.expiresAt !== undefined && payload.expiresAt <= Date.now()) return;
      await self.registration.showNotification(payload.title || 'VoiceRoom', {
        body: payload.body || '',
        data: {
          url: payload.url || '/',
          dedupeKey: payload.dedupeKey,
          notificationId: payload.notificationId,
          revision: payload.revision,
          type: payload.type
        },
        icon: '/voiceroom-icon.svg',
        tag: payload.tag || payload.dedupeKey || 'voice-room'
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const target = new URL(parsePushPayload(event.notification.data).url || '/', self.location.origin);
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
