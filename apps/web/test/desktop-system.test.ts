// The desktop shell's system signals: game mode toggles a class that pauses
// looping animations, and wake-ups reach the handler. Without the bridge
// (a browser, an older shell) nothing happens.

import { afterEach, expect, test } from 'vitest';
import { freshImport, muteWarnings, stubWindow } from './helpers/fresh-module.ts';
import type * as DesktopSystem from '../src/lib/platform/desktop-system.ts';

const flush = () => new Promise((resolveFlush) => setImmediate(resolveFlush));

afterEach(() => {
  document.documentElement.classList.remove('vr-game-mode');
});

function fakeBridge(initialGameMode = false) {
  let stateHandler: ((payload: unknown) => void) | null = null;
  let wakeHandler: ((payload: unknown) => void) | null = null;
  let resolveState: (value: unknown) => void = () => {};
  const bridge = {
    getState: () => new Promise((resolveValue) => (resolveState = resolveValue)),
    onState: (handler: (payload: unknown) => void) => {
      stateHandler = handler;
      return () => (stateHandler = null);
    },
    onWake: (handler: (payload: unknown) => void) => {
      wakeHandler = handler;
      return () => (wakeHandler = null);
    }
  };
  return {
    bridge,
    answerState: () => resolveState({ gameMode: initialGameMode }),
    pushState: (payload: unknown) => stateHandler?.(payload),
    pushWake: (payload: unknown) => wakeHandler?.(payload),
    subscribed: () => Boolean(stateHandler && wakeHandler)
  };
}

async function load(bridge?: unknown) {
  stubWindow(bridge ? { voiceRoomDesktopSystem: bridge } : {});
  muteWarnings();
  return freshImport<typeof DesktopSystem>('/src/lib/platform/desktop-system.ts');
}

test('without a desktop bridge binding is a no-op', async () => {
  const system = await load();
  const unbind = system.bindDesktopSystem({ onWake: () => {} });
  expect(document.documentElement.classList.contains('vr-game-mode')).toBe(false);
  unbind();
});

test('game mode follows the shell and is cleared on unbind', async () => {
  const fake = fakeBridge(true);
  const system = await load(fake.bridge);
  const changes: boolean[] = [];
  const unbind = system.bindDesktopSystem({ onWake: () => {}, onGameModeChange: (active) => changes.push(active) });

  await flush(); // the first request goes out on a microtask
  fake.answerState();
  await flush();
  expect(document.documentElement.classList.contains('vr-game-mode')).toBe(true);

  fake.pushState({ gameMode: false });
  expect(document.documentElement.classList.contains('vr-game-mode')).toBe(false);
  fake.pushState({ gameMode: 'yes' });
  expect(document.documentElement.classList.contains('vr-game-mode')).toBe(false);
  fake.pushState({ gameMode: true });
  expect(document.documentElement.classList.contains('vr-game-mode')).toBe(true);
  expect(changes).toEqual([true, false, false, true]);

  unbind();
  expect(fake.subscribed()).toBe(false);
  expect(document.documentElement.classList.contains('vr-game-mode')).toBe(false);
});

test('a pushed state is not overwritten by the late answer to the first request', async () => {
  const fake = fakeBridge(true);
  const system = await load(fake.bridge);
  const unbind = system.bindDesktopSystem({ onWake: () => {} });
  await flush();
  fake.pushState({ gameMode: false });
  fake.answerState();
  await flush();
  expect(document.documentElement.classList.contains('vr-game-mode')).toBe(false);
  unbind();
});

test('the shell window state feeds the app visibility, and an older shell counts as visible', async () => {
  const fake = fakeBridge();
  const system = await load(fake.bridge);
  const visibility = await import('../src/lib/platform/app-visibility.ts');
  const unbind = system.bindDesktopSystem({ onWake: () => {} });
  fake.pushState({ gameMode: false, windowVisible: false });
  expect(visibility.isAppVisible()).toBe(false);
  fake.pushState({ gameMode: false });
  expect(visibility.isAppVisible()).toBe(true);
  fake.pushState({ gameMode: false, windowVisible: false });
  unbind();
  expect(visibility.isAppVisible()).toBe(true);
  expect(system.normalizeWindowVisible(null)).toBe(true);
  expect(system.normalizeWindowVisible({ windowVisible: 'no' })).toBe(true);
});

test('wake-ups reach the handler with a known reason only', async () => {
  const fake = fakeBridge();
  const system = await load(fake.bridge);
  const reasons: string[] = [];
  const unbind = system.bindDesktopSystem({ onWake: (reason) => reasons.push(reason) });
  fake.pushWake({ reason: 'resume' });
  fake.pushWake({ reason: 'unlock-screen' });
  fake.pushWake({ reason: 'shutdown' });
  fake.pushWake(null);
  expect(reasons).toEqual(['resume', 'unlock-screen']);
  unbind();
  fake.pushWake({ reason: 'resume' });
  expect(reasons).toHaveLength(2);
});
