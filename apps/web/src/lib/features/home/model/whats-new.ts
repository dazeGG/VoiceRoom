import { WHATS_NEW_VERSION, hasUnseenWhatsNew } from '@voice-room/shared/account-security';
import type { WhatsNewState } from '$lib/api/auth';

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
export const WHATS_NEW_SLIDES: readonly WhatsNewSlide[] = [
  {
    image: '/whats-new/2.8.0/look.webp',
    alt: 'Лобби VoiceRoom в новом графитовом оформлении: друзья слева, комната в эфире и список комнат',
    title: 'Новый внешний вид',
    text: 'Графитовая палитра, новый шрифт и заново нарисованные экраны: лобби, звонок, сообщения и настройки.'
  },
  {
    image: '/whats-new/2.8.0/camera.webp',
    alt: 'Звонок в комнате: двое участников с включённой камерой и третий с аватаром, внизу панель управления с кнопкой камеры',
    title: 'Камера в звонке',
    text: 'Включайте камеру кнопкой на панели звонка, а устройство выбирайте рядом, в меню.'
  },
  {
    image: '/whats-new/2.8.0/accent.webp',
    alt: 'Настройки, вкладка «Внешний вид»: три карточки темы Volt, Ice и Coral, выбрана Coral',
    title: 'Свой акцент',
    text: 'Выберите цвет акцента, Volt, Ice или Coral, и он сразу применится во всём приложении.',
    action: 'appearance'
  }
];

// How long a slide stays up before the next one comes on its own.
export const WHATS_NEW_SLIDE_MS = 6000;

export function shouldShowWhatsNew(state: WhatsNewState): boolean {
  return state.current === WHATS_NEW_VERSION && hasUnseenWhatsNew(state.lastSeen, state.current);
}
