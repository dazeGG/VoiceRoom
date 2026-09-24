// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';



async function loadService(bridge) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: bridge === undefined ? {} : { voiceRoomDesktopOverlay: bridge },
    writable: true
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  onTestFinished(() => {
    console.warn = originalWarn;
  });
  vi.resetModules();
  return import('../src/lib/platform/desktop-overlay.ts');
}

test('desktop overlay service is unavailable without the shell bridge', async () => {
  const service = await loadService(undefined);
  assert.equal(service.desktopOverlayAvailable(), false);
  assert.equal(await service.readDesktopOverlaySettings(), null);
  assert.equal(await service.updateDesktopOverlaySettings({ enabled: false }), null);
});

test('desktop overlay service normalizes settings and sends a typed patch', async () => {
  const calls = [];
  const service = await loadService({
    getSettings: async () => ({
      allowedExecutables: ['mygame.exe', 3, ''],
      anchor: 'bottom-right',
      avatarSize: 'large',
      clickThrough: false,
      enabled: 1,
      opacity: 0.5
    }),
    setSettings: async (patch) => {
      calls.push(patch);
      return { anchor: 'nope', enabled: false, showNames: false };
    },
    setSnapshot: async () => ({})
  });

  assert.equal(service.desktopOverlayAvailable(), true);
  assert.deepEqual(await service.readDesktopOverlaySettings(), {
    anchor: 'bottom-right',
    avatarSize: 'large',
    enabled: true,
    showNames: true,
    allowedExecutables: ['mygame.exe']
  });
  assert.deepEqual(await service.updateDesktopOverlaySettings({
    anchor: 'top-left',
    avatarSize: 'huge',
    enabled: false,
    opacity: 0.2,
    showNames: false
  }), {
    anchor: 'top-left',
    avatarSize: 'medium',
    enabled: false,
    showNames: false,
    allowedExecutables: []
  });
  assert.deepEqual(calls, [{ anchor: 'top-left', enabled: false, showNames: false }]);

  await service.updateDesktopOverlaySettings({ avatarSize: 'small' });
  assert.deepEqual(calls.at(-1), { avatarSize: 'small' });
});

test('desktop overlay snapshot carries mute and stream state once per change', async () => {
  const snapshots = [];
  const service = await loadService({
    getSettings: async () => ({}),
    setSettings: async () => ({}),
    setSnapshot: async (snapshot) => {
      snapshots.push(snapshot);
      return {};
    }
  });
  const participant = {
    id: 'a',
    micMuted: true,
    name: 'Ann',
    outputMuted: false,
    self: false,
    speaking: true,
    streaming: true
  };

  service.syncDesktopOverlaySnapshot([participant]);
  service.syncDesktopOverlaySnapshot([{ ...participant }]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(snapshots, [{ participants: [participant] }]);
});
