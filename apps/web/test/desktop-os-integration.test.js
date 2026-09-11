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

// Every load gets fresh module instances, so module-level state (sync
// de-duplication, the in-app navigation mark) never leaks between tests.
async function loadModule(t, modulePath, windowValue = {}) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowValue, writable: true });
  const originalWarn = console.warn;
  console.warn = () => {};
  t.after(() => {
    delete globalThis.window;
    console.warn = originalWarn;
  });
  const server = await getServer();
  server.moduleGraph.invalidateAll();
  return server.ssrLoadModule(modulePath);
}

const flush = () => new Promise((resolveFlush) => setImmediate(resolveFlush));

test('desktop links normalize shell payloads and ignore anything unexpected', async (t) => {
  let handler = null;
  let unsubscribed = false;
  const service = await loadModule(t, '/src/lib/platform/desktop-links.ts', {
    voiceRoomDesktopLinks: {
      onOpen: (next) => {
        handler = next;
        return () => { unsubscribed = true; };
      }
    }
  });

  assert.deepEqual(service.normalizeDesktopLink({ kind: 'room', roomId: 'abc123', route: '/r/abc123' }), { kind: 'room', roomId: 'abc123' });
  assert.deepEqual(service.normalizeDesktopLink({ kind: 'mention', roomId: 'abc123', messageId: 'm1' }), { kind: 'mention', roomId: 'abc123', messageId: 'm1' });
  assert.deepEqual(service.normalizeDesktopLink({ kind: 'dm', dmId: 'u-7' }), { kind: 'dm', dmId: 'u-7' });
  assert.deepEqual(service.normalizeDesktopLink({ kind: 'app' }), { kind: 'app' });
  for (const junk of [null, 'room', { kind: 'room', roomId: 'x' }, { kind: 'mention', roomId: 'abc123' }, { kind: 'dm', dmId: '../x' }, { kind: 'settings' }]) {
    assert.equal(service.normalizeDesktopLink(junk), null);
  }

  const received = [];
  const unbind = service.bindDesktopLinks((link) => received.push(link));
  handler({ kind: 'room', roomId: 'abc123' });
  handler({ kind: 'room', roomId: '!' });
  assert.deepEqual(received, [{ kind: 'room', roomId: 'abc123' }]);
  unbind();
  assert.equal(unsubscribed, true);
});

test('desktop links are a no-op without the shell bridge', async (t) => {
  const service = await loadModule(t, '/src/lib/platform/desktop-links.ts', {});
  assert.equal(typeof service.bindDesktopLinks(() => {}), 'function');
});

test('desktop call state is sent once per change and actions are filtered', async (t) => {
  const sent = [];
  let actionHandler = null;
  const service = await loadModule(t, '/src/lib/platform/desktop-call.ts', {
    voiceRoomDesktopCall: {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {};
      },
      setState: async (state) => sent.push(state)
    }
  });
  const active = { active: true, micMuted: false, outputMuted: true, roomId: 'abc123', roomName: 'Гостиная' };

  service.syncDesktopCallState(active);
  service.syncDesktopCallState({ ...active });
  service.syncDesktopCallState({ ...active, micMuted: true });
  service.syncDesktopCallState({ active: false, micMuted: true, outputMuted: true, roomId: 'abc123', roomName: 'x' });
  await flush();

  assert.deepEqual(sent, [active, { ...active, micMuted: true }, { active: false }]);

  const calls = [];
  service.bindDesktopCallActions({
    'toggle-mic': () => calls.push('mic'),
    'toggle-output': () => calls.push('output'),
    disconnect: () => calls.push('leave')
  });
  actionHandler({ action: 'toggle-output' });
  actionHandler({ action: 'disconnect' });
  actionHandler({ action: 'explode' });
  actionHandler(null);
  assert.deepEqual(calls, ['output', 'leave']);
});

test('desktop call state retries after a failed send', async (t) => {
  let fail = true;
  const sent = [];
  const service = await loadModule(t, '/src/lib/platform/desktop-call.ts', {
    voiceRoomDesktopCall: {
      onAction: () => () => {},
      setState: async (state) => {
        if (fail) throw new Error('untrusted');
        sent.push(state);
      }
    }
  });

  service.syncDesktopCallState({ active: false, micMuted: false, outputMuted: false, roomId: '', roomName: '' });
  await flush();
  fail = false;
  service.syncDesktopCallState({ active: false, micMuted: false, outputMuted: false, roomId: '', roomName: '' });
  await flush();
  assert.deepEqual(sent, [{ active: false }]);
});

test('desktop diagnostics copy, open logs and share the web context', async (t) => {
  const contexts = [];
  const service = await loadModule(t, '/src/lib/platform/desktop-diagnostics.ts', {
    voiceRoomDesktopDiagnostics: {
      copyInfo: async () => ({ ok: true }),
      getInfo: async () => ({ text: 'x' }),
      openLogsFolder: async () => ({ ok: false, reason: 'open-failed' }),
      setContext: async (context) => contexts.push(context)
    }
  });

  assert.equal(service.desktopDiagnosticsAvailable(), true);
  assert.equal(await service.copyDesktopDiagnostics(), true);
  assert.equal(await service.openDesktopLogsFolder(), false);

  service.syncDesktopDiagnosticsContext({ roomId: 'abc123', userId: 'u1' });
  service.syncDesktopDiagnosticsContext({ roomId: 'abc123', userId: 'u1' });
  service.syncDesktopDiagnosticsContext({ roomId: '', userId: 'u1' });
  await flush();
  assert.deepEqual(contexts, [{ roomId: 'abc123', userId: 'u1' }, { roomId: '', userId: 'u1' }]);
});

test('desktop diagnostics fail closed on bridge errors and without the bridge', async (t) => {
  const service = await loadModule(t, '/src/lib/platform/desktop-diagnostics.ts', {
    voiceRoomDesktopDiagnostics: {
      copyInfo: async () => { throw new Error('untrusted'); },
      getInfo: async () => ({ text: 'app: 1.3.0' }),
      openLogsFolder: async () => { throw new Error('untrusted'); },
      setContext: async () => {}
    }
  });

  assert.equal(await service.copyDesktopDiagnostics(), false);
  assert.equal(await service.openDesktopLogsFolder(), false);

  const bare = await loadModule(t, '/src/lib/platform/desktop-diagnostics.ts', {});
  assert.equal(bare.desktopDiagnosticsAvailable(), false);
  assert.equal(await bare.copyDesktopDiagnostics(), false);
});

test('open in app targets desktop browsers only with the right scheme', async (t) => {
  const service = await loadModule(t, '/src/lib/platform/open-in-app.ts', {});
  const windowsChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Safari/537.36';
  const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
  const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Safari/537.36';

  assert.equal(service.resolveAppLinkScheme('voiceroom.ru'), 'voiceroom');
  assert.equal(service.resolveAppLinkScheme('WWW.VoiceRoom.ru'), 'voiceroom');
  assert.equal(service.resolveAppLinkScheme('dev.voiceroom.ru'), 'voiceroom-dev');
  assert.equal(service.resolveAppLinkScheme('localhost'), 'voiceroom-dev');
  assert.equal(service.buildAppRoomLink('abc123', 'voiceroom.ru'), 'voiceroom://r/abc123');
  assert.equal(service.buildAppRoomLink('a/b', 'voiceroom.ru'), null);

  assert.equal(service.shouldOfferOpenInApp({ desktopBridge: false, userAgent: windowsChrome }), true);
  assert.equal(service.shouldOfferOpenInApp({ desktopBridge: false, userAgent: macSafari, maxTouchPoints: 0 }), true);
  assert.equal(service.shouldOfferOpenInApp({ desktopBridge: true, userAgent: windowsChrome }), false, 'inside the app');
  assert.equal(service.shouldOfferOpenInApp({ desktopBridge: false, userAgent: macSafari, maxTouchPoints: 5 }), false, 'iPad desktop mode');
  assert.equal(service.shouldOfferOpenInApp({ desktopBridge: false, userAgent: windowsChrome, mobile: true }), false);
  assert.equal(service.shouldOfferOpenInApp({ automated: true, desktopBridge: false, userAgent: windowsChrome }), false, 'Playwright and other webdriver sessions');
  assert.equal(service.shouldOfferOpenInApp({ desktopBridge: false, userAgent: linux }), false);
});

test('open in app navigates Chromium and uses a hidden frame in Firefox', async (t) => {
  const service = await loadModule(t, '/src/lib/platform/open-in-app.ts', {});
  const chromium = { document: {}, location: { href: 'https://voiceroom.ru/r/abc123' }, navigator: { userAgent: 'Chrome/146' } };
  service.launchAppLink('voiceroom://r/abc123', chromium);
  assert.equal(chromium.location.href, 'voiceroom://r/abc123');

  const appended = [];
  const frame = { hidden: false, remove() {}, src: '' };
  const firefox = {
    document: { body: { appendChild: (node) => appended.push(node) }, createElement: () => frame },
    location: { href: 'https://voiceroom.ru/r/abc123' },
    navigator: { userAgent: 'Mozilla/5.0 Firefox/150.0' }
  };
  service.launchAppLink('voiceroom://r/abc123', firefox);
  assert.equal(firefox.location.href, 'https://voiceroom.ru/r/abc123');
  assert.deepEqual(appended, [frame]);
  assert.equal(frame.hidden, true);
  assert.equal(frame.src, 'voiceroom://r/abc123');
});

test('in-app room reloads skip the open-in-app offer exactly for the next page', async (t) => {
  const storage = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, String(value))
    },
    writable: true
  });
  t.after(() => { delete globalThis.sessionStorage; });

  const marked = await loadModule(t, '/src/lib/platform/open-in-app.ts', {});
  marked.markInAppRoomNavigation();
  assert.equal(storage.size, 1);

  // A fresh module instance stands in for the reloaded page.
  const reloaded = await loadModule(t, '/src/lib/platform/open-in-app.ts', {});
  assert.equal(reloaded.consumeInAppRoomNavigation(), true);
  assert.equal(reloaded.consumeInAppRoomNavigation(), true, 'stable for every caller on the page');
  assert.equal(storage.size, 0, 'the mark is gone for later loads');

  const nextLoad = await loadModule(t, '/src/lib/platform/open-in-app.ts', {});
  assert.equal(nextLoad.consumeInAppRoomNavigation(), false);
});

test('room switch confirmation asks only when leaving another live call', async (t) => {
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, String(value))
    },
    writable: true
  });
  t.after(() => { delete globalThis.localStorage; });
  const model = await loadModule(t, '/src/lib/features/home/model/room-switch-confirmation.ts', {});

  assert.equal(model.shouldConfirmRoomSwitch({ confirmEnabled: true, connectedRoomId: 'room-a', targetRoomId: 'room-b' }), true);
  assert.equal(model.shouldConfirmRoomSwitch({ confirmEnabled: true, connectedRoomId: 'room-a', targetRoomId: 'room-a' }), false);
  assert.equal(model.shouldConfirmRoomSwitch({ confirmEnabled: true, connectedRoomId: null, targetRoomId: 'room-b' }), false);
  assert.equal(model.shouldConfirmRoomSwitch({ confirmEnabled: false, connectedRoomId: 'room-a', targetRoomId: 'room-b' }), false);

  assert.equal(model.readRoomSwitchConfirmEnabled(), true);
  assert.equal(model.applyRoomSwitchDecision({ proceed: false, dontAskAgain: true }), false);
  assert.equal(model.readRoomSwitchConfirmEnabled(), true, 'cancel never silences the question');
  assert.equal(model.applyRoomSwitchDecision({ proceed: true, dontAskAgain: false }), true);
  assert.equal(model.readRoomSwitchConfirmEnabled(), true);
  assert.equal(model.applyRoomSwitchDecision({ proceed: true, dontAskAgain: true }), true);
  assert.equal(model.readRoomSwitchConfirmEnabled(), false);
  assert.equal(storage.get(model.ROOM_SWITCH_CONFIRM_STORAGE_KEY), 'false');

  model.writeRoomSwitchConfirmEnabled(true);
  assert.equal(model.readRoomSwitchConfirmEnabled(), true);
  assert.equal(storage.has(model.ROOM_SWITCH_CONFIRM_STORAGE_KEY), false);
});

test('lobby routes every voice entry, desktop links and call controls through the new flows', () => {
  const lobby = readFileSync(resolve(webRoot, 'src/lib/features/home/LobbyPage.svelte'), 'utf8');

  assert.equal((lobby.match(/onEnter=\{\(\) => requestEnterRoom\(selectedRoom\.roomId\)\}/g) || []).length, 2);
  assert.doesNotMatch(lobby, /onEnter=\{\(\) => enterRoom\(/);
  assert.match(lobby, /function handleJoin[\s\S]*?requestEnterRoom\(roomId\);/);
  assert.match(lobby, /createDialogOpen = false;\s*requestEnterRoom\(roomId\);/);
  assert.match(lobby, /if \(initialRoomId && shouldOfferOpenInApp\(readOpenInAppSignals\(\)\) && !consumeInAppRoomNavigation\(\)\) \{[\s\S]*?openRoomInApp\(\);[\s\S]*?\} else if \(initialRoomId\) \{\s*selectRoomForVoiceEntry\(initialRoomId\);/);
  assert.match(lobby, /window\.addEventListener\(ENTER_ROOM_EVENT, onEnterRoomRequest\)/);
  assert.match(lobby, /function onEnterRoomRequest[\s\S]*?if \(roomId\) requestEnterRoom\(roomId\);/);

  const friends = readFileSync(resolve(webRoot, 'src/lib/features/home/model/friends.svelte.ts'), 'utf8');
  assert.doesNotMatch(friends, /window\.location\.assign\(`\/r\//, 'accepting an invite no longer reloads past the confirmation');
  assert.match(friends, /new CustomEvent\(ENTER_ROOM_EVENT, \{ detail: \{ roomId \} \}\)/);
  assert.match(lobby, /bindDesktopLinks\(openDesktopLink\)/);
  assert.match(lobby, /'toggle-mic': toggleActiveVoiceMic,\s*'toggle-output': toggleActiveVoiceDeafen,\s*disconnect: \(\) => void leaveConnectedVoiceRoom\(\)/);
  assert.match(lobby, /syncDesktopCallState\(\{\s*active: Boolean\(connectedVoiceRoomId\),\s*micMuted: voiceSession\.muted,\s*outputMuted: voiceSession\.deafened/);
  assert.match(lobby, /<RoomSwitchDialog[\s\S]*?onConfirm=\{\(dontAskAgain\) => resolveRoomSwitch\(true, dontAskAgain\)\}/);
  assert.match(lobby, /<OpenInAppScreen onRetry=\{openRoomInApp\} onContinue=\{continueRoomInBrowser\} \/>/);
});

test('guests get the open-in-app offer before auto-joining, and in-app reloads are marked', () => {
  const route = readFileSync(resolve(webRoot, 'src/routes/r/[roomId]/+page.svelte'), 'utf8');
  assert.match(route, /onMount\(\(\) => \{[\s\S]*?inAppNavigation = consumeInAppRoomNavigation\(\);[\s\S]*?boundaryReady = true;/);
  assert.match(route, /const guestOpenInApp = \$derived\([\s\S]*?!session\.user[\s\S]*?!inAppNavigation[\s\S]*?shouldOfferOpenInApp\(readOpenInAppSignals\(\)\)/);
  assert.match(route, /\{:else if guestOpenInApp\}\s*<OpenInAppScreen[\s\S]*?\{:else\}\s*\{#key routeRoomId\}\s*<RoomPage roomId=\{routeRoomId\} autoJoin \/>/);

  for (const file of ['src/lib/features/home/HomePage.svelte', 'src/lib/features/room/client/room/room.ts']) {
    const source = readFileSync(resolve(webRoot, file), 'utf8');
    assert.match(source, /function openRoom\(roomId: string\): void \{\s*markInAppRoomNavigation\(\);\s*window\.location\.href = `\/r\//, file);
  }
});

test('settings expose the room switch question and desktop diagnostics', () => {
  const modal = readFileSync(resolve(webRoot, 'src/lib/features/home/components/SettingsModal.svelte'), 'utf8');

  assert.match(modal, /aria-label="Спрашивать перед переходом в другую комнату"[\s\S]*?onclick=\{toggleRoomSwitchConfirm\}/);
  assert.match(modal, /\{#if diagnosticsAvailable\}[\s\S]*?openLogsFolder\(\)[\s\S]*?Открыть папку логов[\s\S]*?copyDiagnostics\(\)[\s\S]*?Скопировать информацию о системе/);
});
