import { defineStore } from 'pinia';
import { ref, watchEffect, type WatchHandle } from 'vue';

export type PageScreen = '' | 'start' | 'checking' | 'room' | 'entry-error' | 'not-found' | 'moderation';

/**
 * Page state that styles read from `<body>`. Svelte kept it in `document.body.dataset`;
 * here it lives in one store and `installBodyClasses()` mirrors it as classes.
 */
export const usePageStore = defineStore('page', () => {
  const screen = ref<PageScreen>('');
  const chatOpen = ref(false);
  const lobbyEmbedded = ref(false);
  const screenView = ref(false);
  const stripCollapsed = ref(false);
  const stageSummary = ref<'' | 'hidden'>('');
  const desktopScreenFullscreen = ref(false);
  return { screen, chatOpen, lobbyEmbedded, screenView, stripCollapsed, stageSummary, desktopScreenFullscreen };
});

const SCREEN_CLASS_PREFIX = 'screen--';
const DESKTOP_FULLSCREEN_CLASS = 'screen--desktop-fullscreen';

/**
 * Sets the BEM classes of the page store on `<body>`: `screen--<name>`, `chat--open`,
 * `lobby--embedded`, `screen-view--open`, `strip--collapsed`, `stage-summary--hidden`, `screen--desktop-fullscreen`.
 * Call once after the active Pinia is set; returns the handle that stops it.
 */
export function installBodyClasses(): WatchHandle {
  const page = usePageStore();
  return watchEffect(
    () => {
      const { classList } = document.body;
      for (const name of [...classList]) {
        if (name.startsWith(SCREEN_CLASS_PREFIX) && name !== DESKTOP_FULLSCREEN_CLASS) classList.remove(name);
      }
      if (page.screen) classList.add(`${SCREEN_CLASS_PREFIX}${page.screen}`);
      classList.toggle('chat--open', page.chatOpen);
      classList.toggle('lobby--embedded', page.lobbyEmbedded);
      classList.toggle('screen-view--open', page.screenView);
      classList.toggle('strip--collapsed', page.stripCollapsed);
      classList.toggle('stage-summary--hidden', page.stageSummary === 'hidden');
      classList.toggle(DESKTOP_FULLSCREEN_CLASS, page.desktopScreenFullscreen);
    },
    { flush: 'sync' }
  );
}
