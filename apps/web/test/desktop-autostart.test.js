import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const webRoot = resolve(import.meta.dirname, '..');

// One Vite server for the whole file, without a file watcher: a server per
// test exhausts file watchers on CI runners and kills the test process.
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
    value: bridge === undefined ? {} : { voiceRoomDesktopAutostart: bridge },
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
  return server.ssrLoadModule('/src/lib/platform/desktop-autostart.ts');
}

test('desktop autostart service is unavailable without the shell bridge', async (t) => {
  const service = await loadService(t, undefined);

  assert.equal(service.desktopAutostartAvailable(), false);
  assert.equal(await service.readDesktopAutostartSettings(), null);
  assert.equal(await service.updateDesktopAutostartSettings({ openAtLogin: true }), null);
});

test('desktop autostart service normalizes shell results and sends only boolean fields', async (t) => {
  const calls = [];
  const service = await loadService(t, {
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

test('desktop autostart service swallows bridge failures', async (t) => {
  const service = await loadService(t, {
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

test('settings modal exposes desktop-only autostart switches', () => {
  const modal = readFileSync(resolve(webRoot, 'src/lib/features/home/components/SettingsModal.svelte'), 'utf8');

  assert.match(modal, /\{#if desktopApp && autostartAvailable\}[\s\S]*data-active=\{tab === 'app'\}[\s\S]*Приложение[\s\S]*\{\/if\}/);
  assert.match(
    modal,
    /\{:else if tab === 'app' && desktopApp && autostartAvailable\}[\s\S]*aria-label="Автозапуск"[\s\S]*changeAutostart\(\{ openAtLogin: !openAtLogin \}\)[\s\S]*aria-label="Автозапуск свёрнутым"[\s\S]*disabled=\{autostartSaving \|\| !autostartSupported \|\| !openAtLogin\}[\s\S]*changeAutostart\(\{ startMinimized: !startMinimized \}\)/
  );
});
