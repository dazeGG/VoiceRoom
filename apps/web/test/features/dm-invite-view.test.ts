import { expect, test } from 'vitest';
import { inviteAnswerable, inviteTitle } from '../../src/lib/features/home/model/dm-invite-view.ts';

const pending = { roomId: 'r', roomName: 'Планёрка', status: 'pending' as const, expiresAt: 2_000 };

test('a pending invitation is answered only by the invited side and only before it runs out', () => {
  expect(inviteAnswerable(pending, false, 1_000)).toBe(true);
  expect(inviteAnswerable(pending, true, 1_000)).toBe(false);
  expect(inviteAnswerable(pending, false, 2_000)).toBe(false);
  expect(inviteAnswerable({ ...pending, expiresAt: null }, false, 9_999_999)).toBe(true);
  expect(inviteAnswerable({ ...pending, status: 'accepted' }, false, 1_000)).toBe(false);
});

test('the card title follows the outcome, then expiry, then which side is reading', () => {
  expect(inviteTitle({ ...pending, status: 'accepted' }, true, 1_000)).toBe('Принял приглашение');
  expect(inviteTitle({ ...pending, status: 'declined' }, false, 1_000)).toBe('Отклонил предложение');
  expect(inviteTitle({ ...pending, status: 'expired' }, false, 1_000)).toBe('Приглашение завершено');
  expect(inviteTitle(pending, false, 3_000)).toBe('Приглашение истекло');
  expect(inviteTitle(pending, true, 1_000)).toBe('Приглашение отправлено');
  expect(inviteTitle(pending, false, 1_000)).toBe('Приглашение в комнату');
});
