import { formatNumber, getLocale, setLocaleReader, setMessageReader, t as translate } from '@voiceroom/ui-kit/i18n';
import type { AppLocale } from '@voiceroom/shared/localization';
import { english, french, russian, type MessageKey } from './catalog.ts';

const catalogs: Readonly<Record<AppLocale, Readonly<Record<string, string | undefined>>>> = {
  en: english,
  fr: french,
  ru: russian
};

setMessageReader((locale, key) => {
  const catalog = catalogs[locale];
  return Object.hasOwn(catalog, key) ? catalog[key] : undefined;
});

export { formatNumber, getLocale, setLocaleReader };

type Placeholder<Key extends string> = Key extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholder<Rest>
  : never;

/** Translate explicit app-owned copy; interpolation never interprets HTML. */
export function t<Key extends MessageKey>(
  key: Key,
  ...[parameters]: [Placeholder<Key>] extends [never]
    ? [parameters?: Readonly<Record<string, unknown>>]
    : [parameters: Readonly<Record<Placeholder<Key>, unknown>>]
): string {
  return translate(key, parameters);
}
