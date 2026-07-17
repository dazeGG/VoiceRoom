import type { PresenceStatus } from '@voice-room/shared/validation';

export type { PresenceStatus };

const PRESENCE_STATUSES = new Set<PresenceStatus>(['online', 'away', 'dnd', 'offline']);

export function isPresenceStatus(value: unknown): value is PresenceStatus {
  return typeof value === 'string' && PRESENCE_STATUSES.has(value as PresenceStatus);
}

export function normalizePresenceStatus(
  value: unknown,
  fallback: PresenceStatus = 'online'
): PresenceStatus {
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
      return 'Отошёл';
    case 'dnd':
      return 'Не беспокоить';
    case 'offline':
      return 'Не в сети';
    default:
      return 'В сети';
  }
}
