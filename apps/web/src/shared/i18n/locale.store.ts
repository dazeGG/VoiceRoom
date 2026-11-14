import { defineStore } from 'pinia';
import { ref } from 'vue';
import { normalizeLocale, resolveLocale, type AppLocale } from '@voice-room/shared/localization';

export const LOCALE_STORAGE_KEY = 'voiceroom.locale';

export const useLocaleStore = defineStore('locale', () => {
  const current = ref<AppLocale>('ru');
  const saveFailed = ref(false);
  const ready = ref(false);
  let dispose: (() => void) | null = null;
  let selectionVersion = 0;
  let pushedVersion = 0;

  function apply(locale: AppLocale): void {
    current.value = locale;
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }

  function browserLocale(): AppLocale {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // A blocked store must not prevent the application from starting.
    }
    const locale = resolveLocale(typeof navigator === 'undefined' ? [] : navigator.languages, stored);
    if (!normalizeLocale(stored)) {
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      } catch {
        /* Keep the detected session choice. */
      }
    }
    return locale;
  }

  async function init(): Promise<void> {
    dispose?.();
    dispose = null;
    const bridge = typeof window === 'undefined' ? undefined : window.voiceRoomLocale;
    if (bridge) {
      let pushed = false;
      dispose = bridge.subscribe((value) => {
        const locale = normalizeLocale(value);
        if (!locale) return;
        pushed = true;
        pushedVersion += 1;
        apply(locale);
      });
      try {
        const locale = normalizeLocale(await bridge.get());
        if (!pushed && locale) apply(locale);
      } catch {
        if (!pushed) apply(browserLocale());
      }
    } else {
      apply(browserLocale());
      const onStorage = (event: StorageEvent): void => {
        if (event.key === LOCALE_STORAGE_KEY) apply(browserLocale());
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
        dispose = () => window.removeEventListener('storage', onStorage);
      }
    }
    ready.value = true;
  }

  async function select(locale: AppLocale): Promise<void> {
    const version = ++selectionVersion;
    saveFailed.value = false;
    const bridge = typeof window === 'undefined' ? undefined : window.voiceRoomLocale;
    if (bridge) {
      const beforePush = pushedVersion;
      try {
        const saved = normalizeLocale(await bridge.set(locale));
        if (!saved) throw new Error('Invalid desktop language');
        if (version === selectionVersion && pushedVersion === beforePush) apply(saved);
      } catch {
        if (version === selectionVersion) saveFailed.value = true;
      }
      return;
    }
    apply(locale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      saveFailed.value = true;
    }
  }

  function stop(): void {
    dispose?.();
    dispose = null;
  }

  return { current, ready, saveFailed, init, select, stop };
});
