import { afterEach, expect, test, vi } from 'vitest';

import * as service from '../src/lib/platform/desktop-app-icon.ts';
import { initTheme, setTheme, THEME_STORAGE_KEY } from '../src/lib/shared/theme/theme.svelte';

function installBridge(bridge: unknown) {
  Object.defineProperty(window, 'voiceRoomDesktopAppIcon', { configurable: true, value: bridge, writable: true });
}

afterEach(() => {
  delete (window as { voiceRoomDesktopAppIcon?: unknown }).voiceRoomDesktopAppIcon;
  setTheme('graphite-volt');
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

test('the app icon report does nothing without the desktop bridge', async () => {
  expect(service.desktopAppIconAvailable()).toBe(false);
  await expect(service.reportDesktopAppIconTheme('graphite-ice')).resolves.toBeUndefined();
});

test('the app icon report hands the theme id to the desktop shell', async () => {
  const setThemeBridge = vi.fn(async () => ({ supported: true, theme: 'graphite-ice' }));
  installBridge({ getTheme: async () => ({}), setTheme: setThemeBridge });

  expect(service.desktopAppIconAvailable()).toBe(true);
  await service.reportDesktopAppIconTheme('graphite-ice');

  expect(setThemeBridge).toHaveBeenCalledExactlyOnceWith('graphite-ice');
});

test('the app icon report swallows a refusal from the shell', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  installBridge({
    getTheme: async () => ({}),
    setTheme: async () => {
      throw new Error('untrusted frame');
    }
  });

  await expect(service.reportDesktopAppIconTheme('graphite-ice')).resolves.toBeUndefined();
});

test('starting the app tells the desktop shell the saved theme', () => {
  const setThemeBridge = vi.fn(async () => ({}));
  installBridge({ getTheme: async () => ({}), setTheme: setThemeBridge });
  localStorage.setItem(THEME_STORAGE_KEY, 'graphite-coral');

  initTheme();

  expect(setThemeBridge).toHaveBeenCalledExactlyOnceWith('graphite-coral');
});

test('starting the app with no saved theme reports the default one', () => {
  const setThemeBridge = vi.fn(async () => ({}));
  installBridge({ getTheme: async () => ({}), setTheme: setThemeBridge });

  initTheme();

  expect(setThemeBridge).toHaveBeenCalledExactlyOnceWith('graphite-volt');
});

test('picking a theme tells the desktop shell so the app icon follows it', () => {
  const setThemeBridge = vi.fn(async () => ({}));
  installBridge({ getTheme: async () => ({}), setTheme: setThemeBridge });

  setTheme('graphite-ice');

  expect(setThemeBridge).toHaveBeenCalledExactlyOnceWith('graphite-ice');
  expect(document.documentElement.dataset.theme).toBe('graphite-ice');
});

test('picking a theme in a plain browser still applies it', () => {
  setTheme('graphite-coral');

  expect(document.documentElement.dataset.theme).toBe('graphite-coral');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('graphite-coral');
});
