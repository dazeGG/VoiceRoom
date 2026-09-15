import { WHATS_NEW_VERSION, hasUnseenWhatsNew } from '@voice-room/shared/account-security';
import type { WhatsNewState } from '$lib/api/auth';

export interface WhatsNewSlide {
  image: string;
  alt: string;
  title: string;
  text: string;
  action?: 'security';
}

// Two to four headline changes, a line of text each; everything else belongs
// in the release notes. The pictures are screenshots of the real app (544×408
// at 2x) kept in static/whats-new/<version>/. For the next release, bump
// WHATS_NEW_VERSION in the shared contract together with these slides.
export const WHATS_NEW_SLIDES: readonly WhatsNewSlide[] = [
  {
    image: '/whats-new/2.6.0/emoji.webp',
    alt: 'Переписка с эмодзи; над полем сообщения видно, что собеседник выбирает эмодзи',
    title: 'Эмодзи везде одинаковые',
    text: 'Кнопка эмодзи в поле сообщения, и на любом компьютере они выглядят так же.'
  },
  {
    image: '/whats-new/2.6.0/links.webp',
    alt: 'Сообщение со ссылкой на игру в Steam и карточкой с обложкой, названием и описанием',
    title: 'Превью ссылок',
    text: 'Под сообщением со ссылкой сразу видно, что за страница.'
  },
  {
    image: '/whats-new/2.6.0/security.webp',
    alt: 'Окно «Новый вход в аккаунт» с устройством, городом и кнопками «Это не я» и «Это я»',
    title: 'Аккаунт под защитой',
    text: 'О входе с нового устройства спросим сразу, а в настройках видны все сеансы.',
    action: 'security'
  }
];

// How long a slide stays up before the next one comes on its own.
export const WHATS_NEW_SLIDE_MS = 6000;

export function shouldShowWhatsNew(state: WhatsNewState): boolean {
  return state.current === WHATS_NEW_VERSION && hasUnseenWhatsNew(state.lastSeen, state.current);
}
