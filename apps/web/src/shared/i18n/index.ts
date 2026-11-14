import { getActivePinia } from 'pinia';
import { useLocaleStore } from './locale.store';
import { setLocaleReader } from './runtime.ts';

// Read the store inside each translation so Vue tracks the current locale.
setLocaleReader(() => (getActivePinia() ? useLocaleStore().current : 'ru'));

export { getLocale, t, formatNumber } from './runtime.ts';
export { useLocaleStore, LOCALE_STORAGE_KEY } from './locale.store';
export type { AppLocale } from '@voice-room/shared/localization';
