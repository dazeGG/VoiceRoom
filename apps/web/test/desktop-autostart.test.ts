// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import { test, onTestFinished } from 'vitest';
import assert from 'node:assert/strict';

import * as service from '../src/lib/platform/desktop-autostart.ts';


// The service has no module state and reads `window` on every call, so one
// native import covers every bridge shape. Loading it through an in-process
// Vite server used to abort the whole test file with a V8 fatal on CI.
function useBridge(bridge) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: bridge === undefined ? {} : { voiceRoomDesktopAutostart: bridge },
    writable: true
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  onTestFinished(() => {
    console.warn = originalWarn;
  });
}

test('desktop autostart service is unavailable without the shell bridge', async () => {
  useBridge(undefined);

  assert.equal(service.desktopAutostartAvailable(), false);
  assert.equal(await service.readDesktopAutostartSettings(), null);
  assert.equal(await service.updateDesktopAutostartSettings({ openAtLogin: true }), null);
});

test('desktop autostart service normalizes shell results and sends only boolean fields', async () => {
  const calls = [];
  useBridge({
    getSettings: async () => ({ openAtLogin: 1, startMinimized: true, supported: true }),
    setSettings: async (patch) => {
      calls.push(patch);
      return { openAtLogin: true, reason: 'write-failed', startMinimized: 'yes', supported: true };
    }
  });

  assert.equal(service.desktopAutostartAvailable(), true);
  assert.deepEqual(await service.readDesktopAutostartSettings(), {
    openAtLogin: false,
    startMinimized: true,
    supported: true
  });
  assert.deepEqual(await service.updateDesktopAutostartSettings({ openAtLogin: true, startMinimized: 'yes' }), {
    openAtLogin: true,
    reason: 'write-failed',
    startMinimized: false,
    supported: true
  });
  assert.deepEqual(calls, [{ openAtLogin: true }]);
});

test('desktop autostart service swallows bridge failures', async () => {
  useBridge({
    getSettings: async () => {
      throw new Error('untrusted frame');
    },
    setSettings: async () => {
      throw new Error('untrusted frame');
    }
  });

  assert.equal(await service.readDesktopAutostartSettings(), null);
  assert.equal(await service.updateDesktopAutostartSettings({ startMinimized: true }), null);
});

