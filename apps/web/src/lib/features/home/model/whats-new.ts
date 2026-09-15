import { WHATS_NEW_VERSION, hasUnseenWhatsNew } from '@voice-room/shared/account-security';
import type { WhatsNewState } from '$lib/api/auth';

export type WhatsNewSceneId = 'emoji' | 'links' | 'security';

export interface WhatsNewSlide {
  scene: WhatsNewSceneId;
  title: string;
  text: string;
  action?: 'security';
}

// Two to four headline changes, a line of text each; everything else belongs
// in the release notes. For the next release, bump WHATS_NEW_VERSION in the
// shared contract together with these slides.
export const WHATS_NEW_SLIDES: readonly WhatsNewSlide[] = [
  { scene: 'emoji', title: 'Эмодзи везде одинаковые', text: 'Кнопка эмодзи в поле сообщения, и на любом компьютере они выглядят так же.' },
  { scene: 'links', title: 'Превью ссылок', text: 'Под сообщением со ссылкой сразу видно, что за страница.' },
  { scene: 'security', title: 'Аккаунт под защитой', text: 'Все устройства на виду, о новом входе предупредим, пароль вернут коды.', action: 'security' }
];

// How long a slide stays up before the next one comes on its own.
export const WHATS_NEW_SLIDE_MS = 6000;

export function shouldShowWhatsNew(state: WhatsNewState): boolean {
  return state.current === WHATS_NEW_VERSION && hasUnseenWhatsNew(state.lastSeen, state.current);
}
