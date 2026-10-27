import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import * as service from '@/platform/desktop-app-icon';
import { createPinia, setActivePinia } from 'pinia';
import { THEME_STORAGE_KEY, useThemeStore } from '@/shared/theme/theme.store';

function installBridge(bridge: unknown) {
  Object.defineProperty(window, 'voiceRoomDesktopAppIcon', { configurable: true, value: bridge, writable: true });
}

beforeEach(() => setActivePinia(createPinia()));

afterEach(() => {
  Reflect.deleteProperty(window, 'voiceRoomDesktopAppIcon');
  useThemeStore().setTheme('graphite-volt');
  localStorage.clear();
  document.documentElement.className = '';
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

  useThemeStore().initTheme();

  expect(setThemeBridge).toHaveBeenCalledExactlyOnceWith('graphite-coral');
});

test('starting the app with no saved theme reports the default one', () => {
  const setThemeBridge = vi.fn(async () => ({}));
  installBridge({ getTheme: async () => ({}), setTheme: setThemeBridge });

  useThemeStore().initTheme();

  expect(setThemeBridge).toHaveBeenCalledExactlyOnceWith('graphite-volt');
});

test('picking a theme tells the desktop shell so the app icon follows it', () => {
  const setThemeBridge = vi.fn(async () => ({}));
  installBridge({ getTheme: async () => ({}), setTheme: setThemeBridge });

  useThemeStore().setTheme('graphite-ice');

  expect(setThemeBridge).toHaveBeenCalledExactlyOnceWith('graphite-ice');
  expect(document.documentElement.classList.contains('theme--graphite-ice')).toBe(true);
});

test('picking a theme in a plain browser still applies it', () => {
  useThemeStore().setTheme('graphite-coral');

  expect(document.documentElement.classList.contains('theme--graphite-coral')).toBe(true);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('graphite-coral');
});
