// Facts the legal pages state about the operator and how long data is kept.
// The retention periods mirror the code (sessions, sign-in history, account
// deletion, the purge of deleted room messages, the rooms of stays in voice and
// the per-person activity rolled up after them, deploy backups, the container
// diagnostic journal retention); change them here when the code changes.

import { t } from '@/shared/i18n';
import { ACCOUNT_DELETION_GRACE_MS } from '@voice-room/shared/account-security';
import { VOICE_HISTORY_KEEP_DAYS } from '@voice-room/shared/contracts/admin';

const DAY_MS = 24 * 60 * 60 * 1000;

export const LEGAL = Object.freeze({
  service: 'VoiceRoom',
  site: 'voiceroom.ru',
  operator: t('Ефремов Владимир Владимирович'),
  operatorStatus: t('физическое лицо, плательщик налога на профессиональный доход (самозанятый)'),
  email: 'support@voiceroom.ru',
  effectiveDate: t('1 ноября 2026 г.'),
  /** The personal data policy changed on its own since. */
  privacyEffectiveDate: t('10 ноября 2026 г.'),
  minimumAge: 14,
  sessionDays: 30,
  loginHistoryDays: 90,
  deletionGraceDays: Math.round(ACCOUNT_DELETION_GRACE_MS / DAY_MS),
  deletedRoomMessagesDays: 30,
  voiceHistoryDays: VOICE_HISTORY_KEEP_DAYS,
  /** Production journal: 14-day retention plus hourly file rotation and expiry. */
  logDays: 15,
  backupDays: 30,
  responseWorkingDays: 10
});

export { LEGAL_DOCUMENTS, type LegalDocument } from '@/shared/legal-documents';
