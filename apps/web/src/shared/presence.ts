import { t } from '@/shared/i18n';
import type { PresenceStatus } from '@voice-room/shared/contracts/users';
import { isPresenceStatus } from '@voice-room/shared/validation';

export type { PresenceStatus };

export function normalizePresenceStatus(value: unknown, fallback: PresenceStatus = 'online'): PresenceStatus {
  return isPresenceStatus(value) ? value : fallback;
}

export function effectivePresenceStatus(
  online: boolean,
  presenceStatus: unknown,
  doNotDisturb = false
): PresenceStatus {
  if (!online) return 'offline';
  return normalizePresenceStatus(presenceStatus, doNotDisturb ? 'dnd' : 'online');
}

export function presenceStatusLabel(status: PresenceStatus): string {
  switch (status) {
    case 'away':
      return t('Отошёл');
    case 'dnd':
      return t('Не беспокоить');
    case 'offline':
      return t('Не в сети');
    default:
      return t('В сети');
  }
}
