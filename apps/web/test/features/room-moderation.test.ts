import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../../src/lib/api/moderation', () => ({
  putBan: vi.fn(),
  unban: vi.fn()
}));

const api = await import('../../src/lib/api/moderation');
const { BAN_DURATIONS, banExpiryLabel, banRoomMember, banSubjectName, liftRoomBan } = await import('../../src/lib/features/home/model/room-moderation.ts');

const ban = (overrides: Record<string, unknown> = {}) => ({ id: 'ban-1', expiresAt: null, subject: { kind: 'account', profile: { displayName: 'Анна', login: 'anna' } }, ...overrides }) as never;

beforeEach(() => vi.clearAllMocks());

test('owners choose a ban of an hour, a day, a week or forever', () => {
  expect(BAN_DURATIONS.map((option) => option.value)).toEqual(['1h', '1d', '7d', 'permanent']);
});

test('a ban reports who and for how long, with an undo that lifts it', async () => {
  vi.mocked(api.putBan).mockResolvedValue(ban());
  vi.mocked(api.unban).mockResolvedValue(ban());
  const notify = vi.fn();

  await banRoomMember('room-a', { userId: 'u-anna', name: 'Анна' }, '1d', notify);
  expect(api.putBan).toHaveBeenCalledWith('room-a', { userId: 'u-anna', guestIp: null, duration: '1d', reason: '' }, expect.any(String));
  const [message, options] = notify.mock.calls[0] as [string, { undo: { label: string; run: () => void } }];
  expect(message).toBe('Анна заблокирован на 1 день');
  expect(options.undo.label).toBe('Отменить');

  options.undo.run();
  await vi.waitFor(() => expect(notify).toHaveBeenLastCalledWith('Блокировка отменена'));
  expect(api.unban).toHaveBeenCalledWith('room-a', 'ban-1');
});

test('failures are reported as errors with the server message or a fallback', async () => {
  vi.mocked(api.putBan).mockRejectedValue(new Error(''));
  const notify = vi.fn();
  await expect(banRoomMember('room-a', { userId: 'u', name: 'X' }, '1h', notify)).resolves.toBeNull();
  expect(notify).toHaveBeenCalledWith('Не удалось заблокировать участника', { variant: 'error' });

  vi.mocked(api.unban).mockRejectedValue(new Error('Нет прав'));
  await expect(liftRoomBan('room-a', ban(), notify)).resolves.toBe(false);
  expect(notify).toHaveBeenLastCalledWith('Нет прав', { variant: 'error' });
});

test('the bans list names people instead of showing raw ids', () => {
  expect(banSubjectName(ban())).toBe('Анна');
  expect(banSubjectName(ban({ subject: { kind: 'guest', profile: null } }))).toBe('Гость');
  expect(banSubjectName(ban({ subject: { kind: 'account', profile: null } }))).toBe('Участник');
  expect(banExpiryLabel(ban())).toBe('Навсегда');
  expect(banExpiryLabel(ban({ expiresAt: Date.UTC(2026, 9, 1) }))).toMatch(/^До /);
});
