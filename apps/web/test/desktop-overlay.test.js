import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const webRoot = resolve(import.meta.dirname, '..');

let serverPromise = null;

function getServer() {
  serverPromise ??= createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: webRoot,
    server: { hmr: false, middlewareMode: true, watch: null }
  });
  return serverPromise;
}

after(async () => {
  if (serverPromise) await (await serverPromise).close();
});

async function loadService(t, bridge) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: bridge === undefined ? {} : { voiceRoomDesktopOverlay: bridge },
    writable: true
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  t.after(() => {
    delete globalThis.window;
    console.warn = originalWarn;
  });
  const server = await getServer();
  server.moduleGraph.invalidateAll();
  return server.ssrLoadModule('/src/lib/platform/desktop-overlay.ts');
}

test('desktop overlay service is unavailable without the shell bridge', async (t) => {
  const service = await loadService(t, undefined);
  assert.equal(service.desktopOverlayAvailable(), false);
  assert.equal(await service.readDesktopOverlaySettings(), null);
  assert.equal(await service.updateDesktopOverlaySettings({ enabled: false }), null);
  assert.equal(await service.previewDesktopOverlay(), false);
});

test('desktop overlay service normalizes settings and sends a typed patch', async (t) => {
  const calls = [];
  const service = await loadService(t, {
    getSettings: async () => ({ enabled: 1, opacity: 0.5, anchor: 'bottom-right', showParticipants: false }),
    setSettings: async (patch) => {
      calls.push(patch);
      return { enabled: false, opacity: 1.4, anchor: 'nope', clickThrough: false, interactiveBinding: null };
    },
    preview: async () => ({ ok: true }),
    setSnapshot: async () => ({}),
    setSuspended: async () => ({ ok: true })
  });

  assert.equal(service.desktopOverlayAvailable(), true);
  assert.deepEqual(await service.readDesktopOverlaySettings(), {
    anchor: 'bottom-right',
    clickThrough: true,
    enabled: true,
    interactiveBinding: {
      altKey: false,
      code: 'Backquote',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false
    },
    opacity: 0.5,
    showControls: true,
    showParticipants: false
  });
  assert.deepEqual(await service.updateDesktopOverlaySettings({
    enabled: false,
    opacity: 2,
    anchor: 'top-left',
    interactiveBinding: { code: 'KeyO', ctrlKey: true }
  }), {
    anchor: 'top-left',
    clickThrough: false,
    enabled: false,
    interactiveBinding: null,
    opacity: 1,
    showControls: true,
    showParticipants: true
  });
  assert.deepEqual(calls, [{
    anchor: 'top-left',
    enabled: false,
    interactiveBinding: { code: 'KeyO', ctrlKey: true },
    opacity: 1
  }]);
  assert.equal(await service.previewDesktopOverlay(), true);
});
