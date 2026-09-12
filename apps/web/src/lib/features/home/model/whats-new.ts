import { WHATS_NEW_VERSION, hasUnseenWhatsNew } from '@voice-room/shared/account-security';
import type { WhatsNewState } from '$lib/api/auth';

export type WhatsNewIcon = 'devices' | 'key' | 'password';

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
    title: 'Коды восстановления',
    text: 'Забыли пароль — войдите по логину и одному из десяти одноразовых кодов. Создать их можно там же.'
  },
  {
    icon: 'password',
    title: 'Смена пароля',
    text: 'Пароль теперь меняется во вкладке «Безопасность», рядом с кодами и устройствами.'
  }
];

export function shouldShowWhatsNew(state: WhatsNewState): boolean {
  return state.current === WHATS_NEW_VERSION && hasUnseenWhatsNew(state.lastSeen, state.current);
}
