// The colour theme: the choice is remembered in localStorage and applied as
// a `theme--<id>` class on the root element, where the --vr-* tokens swap. The
// desktop app is told the active theme so its app icon follows it.
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { reportDesktopAppIconTheme } from '../../platform/desktop-app-icon';

export const THEMES = [
  { id: 'graphite-volt', label: 'Volt' },
  { id: 'graphite-ice', label: 'Ice' },
  { id: 'graphite-coral', label: 'Coral' }
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'graphite-volt';
export const THEME_STORAGE_KEY = 'voiceroom.theme';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const theme of THEMES) root.classList.remove(`theme--${theme.id}`);
  root.classList.add(`theme--${id}`);
}

export const useThemeStore = defineStore('theme', () => {
  const themeState = reactive<{ current: ThemeId }>({ current: DEFAULT_THEME });

  /** Reads the saved choice and applies it; call once when the app starts. */
  function initTheme(): void {
    themeState.current = readStoredTheme();
    applyTheme(themeState.current);
    void reportDesktopAppIconTheme(themeState.current);
  }

  function setTheme(id: ThemeId): void {
    themeState.current = id;
    applyTheme(id);
    void reportDesktopAppIconTheme(id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // The choice still applies for this session.
    }
  }

  return { themeState, initTheme, setTheme };
});
