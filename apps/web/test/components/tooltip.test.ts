import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';
import { Tooltip } from '@voiceroom/ui-kit/components';
import { stubOverlayDom } from '../helpers/overlay-dom';

beforeEach(stubOverlayDom);

test('focus opens a standalone tooltip and renders each shortcut key', async () => {
  render(Tooltip, {
    props: { text: 'Выключить микрофон', shortcut: ['Ctrl', 'M'] },
    slots: { default: '<button type="button">Микрофон</button>' }
  });
  const button = screen.getByRole('button', { name: 'Микрофон' });
  await userEvent.tab();
  const tooltip = await screen.findByRole('tooltip');
  expect(tooltip.textContent).toContain('Выключить микрофон');
  expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
  expect(Array.from(document.querySelectorAll('kbd'), (key) => key.textContent)).toEqual(['Ctrl', 'M']);
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});

test('pointer hover waits 400 milliseconds before showing the tooltip', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const view = render(Tooltip, {
    props: { text: 'Открыть настройки' },
    slots: { default: '<button type="button">Настройки</button>' }
  });
  try {
    await user.hover(screen.getByRole('button', { name: 'Настройки' }));
    await vi.advanceTimersByTimeAsync(399);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await nextTick();
    expect(screen.getByRole('tooltip', { name: 'Открыть настройки' })).toBeTruthy();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
