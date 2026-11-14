// The public legal pages, linked from the landing page, the sign-up form and
// the account settings.

import { t } from '@/shared/i18n';
export type LegalDocument = 'terms' | 'privacy' | 'licenses';

export const LEGAL_DOCUMENTS: readonly {
  id: LegalDocument;
  href: '/terms' | '/privacy' | '/licenses';
  title: string;
}[] = [
  {
    id: 'terms',
    href: '/terms',
    get title() {
      return t('Пользовательское соглашение');
    }
  },
  {
    id: 'privacy',
    href: '/privacy',
    get title() {
      return t('Политика обработки персональных данных');
    }
  },
  {
    id: 'licenses',
    href: '/licenses',
    get title() {
      return t('Лицензии');
    }
  }
];
