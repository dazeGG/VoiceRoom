import { screen } from '@testing-library/vue';
import { afterEach, expect, test, vi } from 'vitest';
import AppSettings from '@/features/home/components/settings/AppSettings.vue';
import { renderWithApp } from '../helpers/render';

afterEach(() => vi.unstubAllGlobals());

test.each([
  { desktopApp: true, buildHash: '41c913b0abcdef', label: 'Сборка 1.8.0 · 41c913b0' },
  { desktopApp: true, buildHash: null, label: 'Сборка 1.8.0' },
  { desktopApp: true, buildHash: undefined, label: 'Сборка 1.8.0' },
  { desktopApp: false, buildHash: '41c913b0', label: null }
])('the application settings show desktop build information ($label)', async ({ desktopApp, buildHash, label }) => {
  vi.stubGlobal('voiceRoomDesktop', { version: '1.8.0', buildHash });
  await renderWithApp(AppSettings, {
    props: {
      support: { desktopApp, mac: false, globalHotkeys: false, autostart: false, overlay: false, diagnostics: false }
    }
  });
  expect(screen.queryByText(/^Сборка /)?.textContent ?? null).toBe(label);
});
