import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Callout } from '@voiceroom/ui-kit/components';

afterEach(() => vi.useRealTimers());

test('offers a localized close button and emits dismiss when activated', async () => {
  const view = render(Callout, { props: { title: 'Доступно обновление', dismissible: true } });
  expect(screen.getByText('Доступно обновление')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(view.emitted('dismiss')).toEqual([[]]);
});

test('the countdown stays quiet except for three milestone announcements and resets for a new deadline', async () => {
  vi.useFakeTimers();
  const view = render(Callout, { props: { layout: 'countdown', deadline: Date.now() + 300_000 } });
  const timer = screen.getByRole('timer');
  const status = screen.getByRole('status');
  const announcements: string[] = [];
  const observer = new MutationObserver(() => {
    if (status.textContent) announcements.push(status.textContent);
  });
  observer.observe(status, { childList: true, characterData: true, subtree: true });

  try {
    expect(timer.getAttribute('aria-live')).toBe('off');
    expect(timer.textContent).toContain('5:00');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(timer.textContent).toContain('4:01');
    expect(announcements).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(announcements).toEqual(['Вы одни в звонке. Отключим через 4:00']);
    expect(view.container.firstElementChild?.classList.contains('ui-callout--warning')).toBe(true);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(view.container.firstElementChild?.classList.contains('ui-callout--danger')).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(timer.textContent).toContain('0:00');
    expect(announcements).toEqual([
      'Вы одни в звонке. Отключим через 4:00',
      'Вы одни в звонке. Отключим через 1:00',
      'Вы одни в звонке. Отключим через 0:10'
    ]);
    expect(vi.getTimerCount()).toBe(0);

    await view.rerender({ deadline: Date.now() + 300_000 });
    expect(status.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(announcements).toHaveLength(4);
    expect(announcements.at(-1)).toBe('Вы одни в звонке. Отключим через 4:00');
  } finally {
    observer.disconnect();
  }
});

test('mounting a countdown already below the first milestone skips past announcements', () => {
  render(Callout, {
    props: { layout: 'countdown', title: 'Аня покидает звонок', deadline: Date.now() + 42_000 }
  });
  expect(screen.getByRole('timer').textContent).toContain('0:42');
  expect(screen.getByRole('status').textContent).toBe('');
  expect(screen.getByText('Аня покидает звонок')).toBeTruthy();
});
