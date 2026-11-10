// The public site's pages and the addresses they point to. Everything a search
// engine reads about a page (title, description, canonical address, sitemap)
// comes from here, so a page cannot be added without them.

import { APP_HOME, START_ROOM_HREF } from '@voice-room/shared/app-home';

/** The public host. Caddy marks every other host noindex (CANONICAL_HOST, Caddyfile). */
export const SITE_ORIGIN = 'https://voiceroom.ru';

/** Where the app starts. */
export const APP_HREF = APP_HOME;
/** The app makes a temporary room as soon as it opens (apps/web/src/features/home/model/start-room-request.ts). */
export { START_ROOM_HREF };

export const RELEASES_URL = 'https://github.com/dazeGG/VoiceRoomDesktop/releases/latest';
export const SOURCE_URL = 'https://github.com/dazeGG/VoiceRoom';
export const SELF_HOSTING_URL = 'https://github.com/dazeGG/VoiceRoom/blob/main/docs/SELF_HOSTING.md';
/** The command an unsigned macOS build needs once (apps/web/src/platform/desktop-builds.ts). */
export const QUARANTINE_CMD = 'sudo xattr -rd com.apple.quarantine /Applications/VoiceRoom.app';

export interface SitePage {
  path: string;
  /** The <title>: what the page answers first, then the name. */
  title: string;
  /** The search snippet, under 160 characters. */
  description: string;
  /** The page's name in the menu and the footer. */
  nav: string;
}

export const PAGES = {
  home: {
    path: '/',
    title: 'Голосовой чат по ссылке без регистрации — VoiceRoom',
    description:
      'Создайте комнату и отправьте ссылку: голос, демонстрация экрана со звуком, камера и чат в браузере. Бесплатно и без регистрации.',
    nav: 'Главная'
  },
  discord: {
    path: '/discord-alternative',
    title: 'Альтернатива Discord для общения с друзьями — VoiceRoom',
    description:
      'Голосовые комнаты по ссылке для своей компании: голос, экран со звуком, камера и чат. Друзьям не нужен аккаунт. Чем VoiceRoom отличается от Discord.',
    nav: 'Альтернатива Discord'
  },
  screen: {
    path: '/screen-sharing',
    title: 'Демонстрация экрана со звуком по ссылке — VoiceRoom',
    description:
      'Покажите экран другу по ссылке: экран или окно, звук видео и игр, режимы для игр и для текста. Зрителям не нужны регистрация и установка.',
    nav: 'Демонстрация экрана'
  },
  games: {
    path: '/voice-chat-for-games',
    title: 'Голосовой чат для игр с друзьями — VoiceRoom',
    description:
      'Голосовой чат для игр: шумоподавление, push-to-talk, хоткеи поверх игры и оверлей с говорящими. Друзья заходят по ссылке без регистрации.',
    nav: 'Для игр'
  },
  download: {
    path: '/download',
    title: 'Скачать VoiceRoom для Windows и macOS',
    description:
      'Приложение VoiceRoom для Windows и macOS: хоткеи поверх игр, оверлей, звук стрима без эха, трей и автозапуск. Бесплатно.',
    nav: 'Скачать'
  }
} as const satisfies Record<string, SitePage>;

/** The page Caddy answers an unknown address with, status 404; not a search result. */
export const NOT_FOUND_PAGE: SitePage = {
  path: '/404',
  title: 'Страница не найдена — VoiceRoom',
  description: 'Такой страницы нет. Создайте комнату или вернитесь на главную VoiceRoom.',
  nav: ''
};

/** The pages search engines are told about, in menu order. */
export const SITEMAP_PAGES: readonly SitePage[] = Object.values(PAGES);

/** The menu: every page but the home page, which the logo leads to. */
export const NAV_PAGES: readonly SitePage[] = SITEMAP_PAGES.filter((page) => page.path !== PAGES.home.path);

export const LEGAL_LINKS = [
  { href: '/privacy', label: 'Конфиденциальность' },
  { href: '/terms', label: 'Условия использования' },
  { href: '/licenses', label: 'Лицензии' }
] as const;

export function canonicalUrl(path: string): string {
  return new URL(path, SITE_ORIGIN).href;
}

/** The social preview picture (public/og.png), 1200×630. */
export const OG_IMAGE = { path: '/og.png', width: 1200, height: 630 } as const;
