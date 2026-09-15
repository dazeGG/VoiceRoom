import { WHATS_NEW_VERSION, hasUnseenWhatsNew } from '@voice-room/shared/account-security';
import type { WhatsNewState } from '$lib/api/auth';

export type WhatsNewIcon = 'devices' | 'key' | 'signin' | 'deletion' | 'emoji' | 'drafts' | 'links';

export interface WhatsNewItem {
  icon: WhatsNewIcon;
  title: string;
  text: string;
}

// What the current announcement lists. For the next release, bump
// WHATS_NEW_VERSION in the shared contract together with this list.
export const WHATS_NEW_ITEMS: readonly WhatsNewItem[] = [
  {
    icon: 'devices',
    title: 'Устройства',
    text: 'Во вкладке «Безопасность» видно, где открыт аккаунт: браузер или приложение, система, город и последний визит. Чужой сеанс можно завершить — он сразу выйдет и из звонка.'
  },
  {
    icon: 'key',
    title: 'Коды восстановления и смена пароля',
    text: 'Забыли пароль — войдите по логину и одному из десяти одноразовых кодов. Коды создаются и пароль меняется там же, в «Безопасности».'
  },
  {
    icon: 'signin',
    title: 'Вход с нового устройства',
    text: 'Если в аккаунт вошли с незнакомого браузера или города, на остальных устройствах появится вопрос. «Это не я» сразу завершит тот сеанс и предложит сменить пароль.'
  },
  {
    icon: 'deletion',
    title: 'Удаление аккаунта',
    text: 'Аккаунт можно удалить в «Безопасности». Семь дней его можно вернуть в прежнем виде — достаточно снова войти с паролем.'
  },
  {
    icon: 'emoji',
    title: 'Эмодзи',
    text: 'Кнопка эмодзи в поле сообщения, а сами эмодзи в сообщениях, именах и реакциях выглядят одинаково на любом компьютере — флаги на Windows тоже.'
  },
  {
    icon: 'drafts',
    title: 'Черновики и «печатает»',
    text: 'Недописанное сообщение остаётся в каждом чате, а над полем видно, кто сейчас печатает или выбирает эмодзи.'
  },
  {
    icon: 'links',
    title: 'Превью ссылок',
    text: 'Под сообщением со ссылкой появляется карточка страницы: картинка, заголовок и описание.'
  }
];

export function shouldShowWhatsNew(state: WhatsNewState): boolean {
  return state.current === WHATS_NEW_VERSION && hasUnseenWhatsNew(state.lastSeen, state.current);
}
