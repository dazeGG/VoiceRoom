import { t } from '@/shared/i18n';
import { WHATS_NEW_VERSION, hasUnseenWhatsNew } from '@voice-room/shared/account-security';
import type { WhatsNew } from '@/api/auth';

export interface WhatsNewSlide {
  image: string;
  alt: string;
  title: string;
  text: string;
  action?: 'appearance';
}

// Two to four headline changes, a line of text each; everything else belongs
// in the release notes. The pictures are screenshots of the real app (544×408
// at 2x) kept in static/whats-new/<version>/. For the next release, bump
// WHATS_NEW_VERSION in the shared contract together with these slides.
export const WHATS_NEW_SLIDES: readonly [WhatsNewSlide, ...WhatsNewSlide[]] = [
  {
    image: '/whats-new/2.8.0/look.webp',
    get alt() {
      return t('Лобби VoiceRoom в новом графитовом оформлении: друзья слева, комната в эфире и список комнат');
    },
    get title() {
      return t('Новый внешний вид');
    },
    get text() {
      return t('Графитовая палитра, новый шрифт и заново нарисованные экраны: лобби, звонок, сообщения и настройки.');
    }
  },
  {
    image: '/whats-new/2.8.0/camera.webp',
    get alt() {
      return t(
        'Звонок в комнате: двое участников с включённой камерой и третий с аватаром, внизу панель управления с кнопкой камеры'
      );
    },
    get title() {
      return t('Камера в звонке');
    },
    get text() {
      return t('Включайте камеру кнопкой на панели звонка, а устройство выбирайте рядом, в меню.');
    }
  },
  {
    image: '/whats-new/2.8.0/accent.webp',
    get alt() {
      return t('Настройки, вкладка «Внешний вид»: три карточки темы Volt, Ice и Coral, выбрана Coral');
    },
    get title() {
      return t('Свой акцент');
    },
    get text() {
      return t('Выберите цвет акцента, Volt, Ice или Coral, и он сразу применится во всём приложении.');
    },
    action: 'appearance'
  }
];

// How long a slide stays up before the next one comes on its own.
export const WHATS_NEW_SLIDE_MS = 6000;

export function shouldShowWhatsNew(state: WhatsNew): boolean {
  return state.current === WHATS_NEW_VERSION && hasUnseenWhatsNew(state.lastSeen, state.current);
}
