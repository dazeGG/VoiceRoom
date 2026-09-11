import { putBan, unban, type ActiveBan, type ModerationDuration } from '$lib/api/moderation';

// Room owners moderate from two settings dialogs (in the room and in the lobby)
// that each show toasts through their own stack, so moderation reports through
// this one callback shape and each dialog adapts it.
export type ModerationNoticeOptions = {
  variant?: 'error';
  undo?: { label: string; run: () => void };
};

export type ModerationNotice = (message: string, options?: ModerationNoticeOptions) => void;

export const BAN_DURATIONS: ReadonlyArray<{ value: ModerationDuration; label: string; phrase: string }> = [
  { value: '1h', label: '1 час', phrase: 'на 1 час' },
  { value: '1d', label: '1 день', phrase: 'на 1 день' },
  { value: '7d', label: '7 дней', phrase: 'на 7 дней' },
  { value: 'permanent', label: 'Навсегда', phrase: 'навсегда' }
];

export const BAN_UNDO_DURATION_MS = 10_000;

function idempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function banSubjectName(ban: ActiveBan): string {
  const profile = ban.subject.profile;
  if (profile) return profile.displayName || profile.login;
  return ban.subject.kind === 'guest' ? 'Гость' : 'Участник';
}

export function banExpiryLabel(ban: ActiveBan): string {
  if (ban.expiresAt == null) return 'Навсегда';
  return `До ${new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(ban.expiresAt)}`;
}

export async function banRoomMember(
  roomId: string,
  member: { userId: string; name: string },
  duration: ModerationDuration,
  notify: ModerationNotice
): Promise<ActiveBan | null> {
  const phrase = BAN_DURATIONS.find((option) => option.value === duration)?.phrase ?? '';
  try {
    const ban = await putBan(roomId, { userId: member.userId, guestIp: null, duration, reason: '' }, idempotencyKey());
    notify(`${member.name} заблокирован ${phrase}`.trim(), {
      undo: { label: 'Отменить', run: () => void liftRoomBan(roomId, ban, notify, 'Блокировка отменена') }
    });
    return ban;
  } catch (cause) {
    notify(errorMessage(cause, 'Не удалось заблокировать участника'), { variant: 'error' });
    return null;
  }
}

export async function liftRoomBan(
  roomId: string,
  ban: ActiveBan,
  notify: ModerationNotice,
  message = `${banSubjectName(ban)} разблокирован`
): Promise<boolean> {
  try {
    await unban(roomId, ban.id);
    notify(message);
    return true;
  } catch (cause) {
    notify(errorMessage(cause, 'Не удалось снять блокировку'), { variant: 'error' });
    return false;
  }
}
