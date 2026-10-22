// The shared pieces: a dialog closes by its cross and keeps Tab inside, a
// room without a name shows "#", a pill and a strip of numbers say what they
// are given, and a card names itself by its heading.

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Button, Dialog, Panel, Pill, RoomAvatar, Stat, Stats } from '../src/ui/index.tsx';

afterEach(cleanup);

test('a dialog closes by its cross, focuses its first field and keeps Tab inside', async () => {
  const onClose = vi.fn();
  render(
    <>
      <button type="button">снаружи</button>
      <Dialog open title="Блокировка" description="На время" onClose={onClose} footer={<Button>Готово</Button>}>
        <input aria-label="Причина" />
      </Dialog>
    </>
  );
  const dialog = screen.getByRole('dialog', { name: 'Блокировка' });
  expect(within(dialog).getByText('На время')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Причина' }));

  // From the last control (the cross) Tab comes back to the first, never outside.
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Готово' }));
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть' }));
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Причина' }));
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть' }));

  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a room goes by its first letter, an unnamed one by "#"', () => {
  const named = render(<RoomAvatar roomId="kitchen" name="кухня" />);
  expect(named.container.textContent).toBe('К');
  named.unmount();
  const unnamed = render(<RoomAvatar roomId="x1y2" name="" />);
  expect(unnamed.container.textContent).toBe('#');
});

test('a pill, a strip of numbers and a card say what they are given', () => {
  render(
    <Panel
      title="Сервер"
      aside={
        <Pill tone="success" dot>
          LiveKit работает
        </Pill>
      }
    >
      <Stats label="Сейчас">
        <Stat label="Процессор" value="42%" dot="success" />
        <Stat label="Жалобы" value="3" tone="danger" note="открытых" />
      </Stats>
    </Panel>
  );
  const card = screen.getByRole('region', { name: 'Сервер' });
  expect(within(card).getByText('LiveKit работает').closest('.ui-pill')?.getAttribute('data-tone')).toBe('success');
  const cells = within(screen.getByRole('list', { name: 'Сейчас' })).getAllByRole('listitem');
  expect(cells.map((cell) => cell.textContent)).toEqual(['Процессор42%', 'Жалобы3открытых']);
});
