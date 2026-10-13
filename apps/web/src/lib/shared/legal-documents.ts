// The public legal pages, linked from the landing page, the sign-up form and
// the account settings.

export type LegalDocument = 'terms' | 'privacy' | 'licenses';

export const LEGAL_DOCUMENTS: readonly {
  id: LegalDocument;
  href: '/terms' | '/privacy' | '/licenses';
  title: string;
}[] = [
  { id: 'terms', href: '/terms', title: 'Пользовательское соглашение' },
  { id: 'privacy', href: '/privacy', title: 'Политика обработки персональных данных' },
  { id: 'licenses', href: '/licenses', title: 'Лицензии' }
];
