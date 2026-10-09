// The colour theme: the choice is remembered in localStorage and applied as
// data-theme on the root element, where theme.css swaps the --vr-* tokens.
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
  document.documentElement.dataset.theme = id;
}

export const themeState = $state<{ current: ThemeId }>({ current: DEFAULT_THEME });

/** Reads the saved choice and applies it; call once when the app starts. */
export function initTheme(): void {
  themeState.current = readStoredTheme();
  applyTheme(themeState.current);
}

export function setTheme(id: ThemeId): void {
  themeState.current = id;
  applyTheme(id);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // The choice still applies for this session.
  }
}
