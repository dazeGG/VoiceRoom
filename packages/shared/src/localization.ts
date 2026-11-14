/** Client-local language semantics shared by web, API and native clients. */
export const APP_LOCALES = ['ru', 'en', 'fr'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'ru';

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'ru' || value === 'en' || value === 'fr';
}

/** A supported base language, or null for an invalid/unsupported preference. */
export function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(tag)) return null;
  const [language] = tag.split('-');
  return isAppLocale(language) ? language : null;
}

/** Saved choice wins; otherwise use the first supported preference, then Russian. */
export function resolveLocale(preferences: readonly unknown[] = [], saved?: unknown): AppLocale {
  const selected = normalizeLocale(saved);
  if (selected) return selected;
  for (const preference of preferences) {
    const locale = normalizeLocale(preference);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function localeTag(locale: AppLocale): string {
  return locale === 'ru' ? 'ru-RU' : locale;
}
