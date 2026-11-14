import { t } from '@/shared/i18n';
import { putBan, unban, type Ban, type ModerationDuration } from '@/api/moderation';
import { kickRoomPeer } from '@/api/rooms';
import { newId } from '@/shared/new-id';
import { dateTime } from '@/shared/utils/date-format';
import { displayNameOf } from '@/shared/utils/display-name';

// Room owners moderate from two settings dialogs (in the room and in the lobby)
// that each show toasts through their own stack, so moderation reports through
// this one callback shape and each dialog adapts it.
export type ModerationNoticeOptions = {
  variant?: 'error';
  description?: string;
  undo?: { label: string; run: () => void };
};

export type ModerationNotice = (message: string, options?: ModerationNoticeOptions) => void;

export const BAN_DURATIONS: ReadonlyArray<{ value: ModerationDuration; label: string; phrase: string }> = [
  {
    value: '1h',
    get label() {
      return t('1 час');
    },
    get phrase() {
      return t('на 1 час');
    }
  },
  {
    value: '1d',
    get label() {
      return t('1 день');
    },
    get phrase() {
      return t('на 1 день');
    }
  },
  {
    value: '7d',
    get label() {
      return t('7 дней');
    },
    get phrase() {
      return t('на 7 дней');
    }
  },
  {
    value: 'permanent',
    get label() {
      return t('Навсегда');
    },
    get phrase() {
      return t('навсегда');
    }
  }
];

export const BAN_UNDO_DURATION_MS = 6000;

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function banSubjectName(ban: Ban): string {
  const profile = ban.subject.profile;
  if (profile) return displayNameOf(profile);
  return ban.subject.kind === 'guest' ? t('Гость') : t('Участник');
}

export function banExpiryLabel(ban: Ban): string {
  if (ban.expiresAt == null) return t('Навсегда');
  return t('До {p0}', { p0: dateTime(ban.expiresAt) });
}

/** Takes a person out of the live call; they can come back by the link. */
export async function kickRoomMember(
  roomId: string,
  member: { peerId: string; name: string },
  notify: ModerationNotice
): Promise<boolean> {
  try {
    await kickRoomPeer(roomId, member.peerId);
    notify(t('{p0} выгнан из комнаты', { p0: member.name }), { description: t('Сможет вернуться по ссылке') });
    return true;
  } catch (cause) {
    notify(errorMessage(cause, t('Не удалось выгнать участника')), { variant: 'error' });
    return false;
  }
}

export async function banRoomMember(
  roomId: string,
  member: { userId: string; name: string },
  duration: ModerationDuration,
  notify: ModerationNotice
): Promise<Ban | null> {
  const phrase = BAN_DURATIONS.find((option) => option.value === duration)?.phrase ?? '';
  try {
    const ban = await putBan(roomId, { userId: member.userId, guestIp: null, duration, reason: '' }, newId());
    notify(t('{p0} заблокирован {p1}', { p0: member.name, p1: phrase }).trim(), {
      undo: { label: t('Отменить'), run: () => void liftRoomBan(roomId, ban, notify, t('Блокировка отменена')) }
    });
    return ban;
  } catch (cause) {
    notify(errorMessage(cause, t('Не удалось заблокировать участника')), { variant: 'error' });
    return null;
  }
}

export async function liftRoomBan(
  roomId: string,
  ban: Ban,
  notify: ModerationNotice,
  message = t('{p0} разблокирован', { p0: banSubjectName(ban) })
): Promise<boolean> {
  try {
    await unban(roomId, ban.id);
    notify(message);
    return true;
  } catch (cause) {
    notify(errorMessage(cause, t('Не удалось снять блокировку')), { variant: 'error' });
    return false;
  }
}
