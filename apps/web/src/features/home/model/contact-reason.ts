import type { ContactDecision } from '@voiceroom/shared/contracts/privacy';
import { t } from '@/shared/i18n';

export function contactReason(reason: ContactDecision, login: string): string {
  switch (reason) {
    case 'allowed':
      return t('Можно написать');
    case 'blocked':
      return t('Сообщения недоступны');
    case 'friends_only':
      return t('@{login} принимает сообщения только от друзей', { login });
    case 'not_selected':
      return t('@{login} принимает сообщения только от выбранных пользователей', { login });
    case 'chat_cap':
      return t('Лимит новых чатов с незнакомыми людьми на сегодня исчерпан');
    case 'unanswered_cap':
      return t('Дождитесь ответа, чтобы отправить ещё одно сообщение');
  }
}
