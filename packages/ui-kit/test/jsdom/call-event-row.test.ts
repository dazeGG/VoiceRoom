import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { CallEventRow } from '@voiceroom/ui-kit/components';

afterEach(() => vi.useRealTimers());

test.each([
  ['outgoing', 'Исходящий звонок', 720_000, '12 мин'],
  ['incoming', 'Входящий звонок', 59_000, 'меньше минуты'],
  ['incoming', 'Входящий звонок', 3_900_000, '1 ч 05 мин']
] as const)('a finished %s call shows the mutual duration and time', (kind, title, durationMs, duration) => {
  render(CallEventRow, { props: { kind, durationMs, time: '21:40' } });
  expect(screen.getByRole('article').textContent).toContain(title);
  expect(screen.getByText(`· ${duration}`)).toBeTruthy();
  expect(screen.getByText('21:40')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

test.each([
  ['no-answer', 'outgoing', 'Нет ответа', 'Исходящий'],
  ['declined', 'incoming', 'Звонок отклонён', 'Входящий'],
  ['declined', 'outgoing', 'Звонок отклонён', 'Исходящий']
] as const)('a %s row uses metadata relative to an %s viewer', (kind, direction, title, metadata) => {
  render(CallEventRow, { props: { kind, direction, time: '10:02' } });
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.getByText(metadata)).toBeTruthy();
  expect(screen.getByText('10:02')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

test('a missed row offers callback without editable-message actions', async () => {
  const view = render(CallEventRow, { props: { kind: 'missed', time: '09:12' } });
  expect(screen.getByText('Пропущенный звонок')).toBeTruthy();
  expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: 'Перезвонить' })]);
  await userEvent.click(screen.getByRole('button', { name: 'Перезвонить' }));
  expect(view.emitted('action')).toEqual([['callback']]);
  await view.rerender({ showAction: false });
  expect(screen.queryByRole('button')).toBeNull();
});

test('a live row switches from join to return when the viewer joins', async () => {
  const view = render(CallEventRow, { props: { kind: 'live', startedAt: Date.now() - 271_000, peerName: 'Аня' } });
  expect(screen.getByText('Аня в звонке')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Присоединиться' }));
  await view.rerender({ joined: true });
  expect(screen.getByText('Вы в звонке')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Вернуться в звонок' }));
  expect(view.emitted('action')).toEqual([['join'], ['return']]);
});

test('the quiet live timer updates until the same row becomes a finished call', async () => {
  vi.useFakeTimers();
  const view = render(CallEventRow, { props: { kind: 'live', startedAt: Date.now() - 3_911_000 } });
  const row = screen.getByRole('article');
  const timer = screen.getByRole('timer');
  expect(timer.getAttribute('aria-live')).toBe('off');
  expect(timer.textContent).toBe('1:05:11');
  await vi.advanceTimersByTimeAsync(1000);
  expect(timer.textContent).toBe('1:05:12');
  await view.rerender({ kind: 'outgoing', durationMs: 3_900_000 });
  expect(screen.getByRole('article')).toBe(row);
  expect(screen.queryByRole('timer')).toBeNull();
  expect(screen.getByText('· 1 ч 05 мин')).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});
