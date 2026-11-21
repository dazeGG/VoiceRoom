import { localeTag, type AppLocale } from '@voiceroom/shared/localization';

type MessageReader = (locale: AppLocale, key: string) => string | undefined;

// The host supplies translations and a reactive locale reader at its entry point.
let readLocale: () => AppLocale = () => 'ru';
let readMessage: MessageReader = () => undefined;

export function setLocaleReader(reader: () => AppLocale): void {
  readLocale = reader;
}

export function setMessageReader(reader: MessageReader): void {
  readMessage = reader;
}

export function getLocale(): AppLocale {
  return readLocale();
}

export function t(key: string, parameters?: Readonly<Record<string, unknown>>): string {
  const text = readMessage(getLocale(), key) ?? key;
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
