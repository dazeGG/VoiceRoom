// Facts the legal pages state about the operator and how long data is kept.
// The retention periods mirror the code (sessions, sign-in history, account
// deletion, the purge of deleted room messages, deploy backups); change them
// here when the code changes.

import { ACCOUNT_DELETION_GRACE_MS } from '@voice-room/shared/account-security';

const DAY_MS = 24 * 60 * 60 * 1000;

export const LEGAL = Object.freeze({
  service: 'Voice Room',
  site: 'voiceroom.ru',
  operator: 'Ефремов Владимир Владимирович',
  operatorStatus: 'физическое лицо, плательщик налога на профессиональный доход (самозанятый)',
  email: 'support@voiceroom.ru',
  effectiveDate: '13 октября 2026 г.',
  minimumAge: 14,
  sessionDays: 30,
  loginHistoryDays: 90,
  deletionGraceDays: Math.round(ACCOUNT_DELETION_GRACE_MS / DAY_MS),
  deletedRoomMessagesDays: 30,
  backupDays: 30,
  responseWorkingDays: 10
});

export { LEGAL_DOCUMENTS, type LegalDocument } from '$lib/shared/legal-documents';
