import type { AppLocale } from '@voice-room/shared/localization';
import { localeTag } from '@voice-room/shared/localization';
import { english, french, russian, type MessageKey } from './catalog.ts';

// Node callers use Russian until the browser adapter supplies its reactive reader.
let readLocale: () => AppLocale = () => 'ru';

export function setLocaleReader(reader: () => AppLocale): void {
  readLocale = reader;
}

export function getLocale(): AppLocale {
  return readLocale();
}

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
  const locale = getLocale();
  let translated: string | undefined;
  switch (locale) {
    case 'en':
      translated = english[key];
      break;
    case 'fr':
      translated = french[key];
      break;
    default:
      translated = russian[key];
  }
  const text = translated ?? key;
  const values = new Map(Object.entries(parameters ?? {}));
  // Split only the app template once: inserted user text is never another placeholder.
  return text
    .split(/(\{[a-zA-Z0-9_]+\})/g)
    .map((part) => {
      const name = part.slice(1, -1);
      if (!part.startsWith('{') || !part.endsWith('}') || !values.has(name)) return part;
      const value = values.get(name);
      return typeof value === 'number' ? formatNumber(value) : String(value);
    })
    .join('');
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(localeTag(getLocale())).format(value);
}
