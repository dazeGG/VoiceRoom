import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ListItem } from '@voiceroom/ui-kit/components';

test('an interactive row activates by click, Enter and Space and keeps its actions separate', async () => {
  const user = userEvent.setup();
  const activate = vi.fn();
  const view = render(ListItem, {
    props: { text: 'Аня', interactive: true, onActivate: activate },
    attrs: { 'aria-haspopup': 'dialog' },
    slots: { actions: '<button type="button">Написать</button>' }
  });
  const row = screen.getByRole('button', { name: 'Аня' });
  const action = screen.getByRole('button', { name: 'Написать' });

  await user.tab();
  expect(document.activeElement).toBe(row);
  expect(row.getAttribute('aria-haspopup')).toBe('dialog');
  await user.keyboard('{Enter} ');
  await user.click(row);
  expect(view.emitted('activate')).toHaveLength(3);

  await user.tab();
  expect(document.activeElement).toBe(action);
  await user.click(action);
  expect(activate).toHaveBeenCalledTimes(3);
});

test('a disabled row does not activate and a static row can show a caption and time', async () => {
  const activate = vi.fn();
  const view = render(ListItem, {
    props: { text: 'Аня', caption: 'В сети', time: '12:00', interactive: true, disabled: true, onActivate: activate }
  });
  await userEvent.click(screen.getByRole('button', { name: 'Аня', description: 'В сети 12:00' }));
  expect(activate).not.toHaveBeenCalled();

  await view.rerender({ interactive: false });
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('В сети')).toBeTruthy();
  expect(screen.getByText('12:00')).toBeTruthy();
});
