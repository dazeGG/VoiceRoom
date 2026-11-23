import { screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { h } from 'vue';
import { Button, Dialog, Panel, Pill, RoomAvatar, Section, Stat, Stats } from '../src/ui/index.ts';
import { renderWithApp } from './helpers/render.ts';

test('a dialog focuses its first field and closes by its cross', async () => {
  const onClose = vi.fn();
  renderWithApp(Dialog, {
    props: { open: true, title: 'Блокировка', description: 'На время', onClose },
    slots: {
      default: () => h('input', { 'aria-label': 'Причина' }),
      footer: () => h(Button, {}, () => 'Готово')
    }
  });
  const dialog = await screen.findByRole('dialog', { name: 'Блокировка', description: 'На время' });
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Причина' })));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a room goes by its first letter, an unnamed one by "#"', () => {
  const view = renderWithApp(RoomAvatar, { props: { roomId: 'kitchen', name: 'кухня' } });
  expect(view.container.textContent).toBe('К');
  view.unmount();
  const unnamed = renderWithApp(RoomAvatar, { props: { roomId: 'x1y2', name: '' } });
  expect(unnamed.container.textContent).toBe('#');
});

test('a pill, a strip of numbers and a card say what they are given', () => {
  renderWithApp(Panel, {
    props: { title: 'Сервер' },
    slots: {
      aside: () => h(Pill, { tone: 'success', dot: true }, () => 'LiveKit работает'),
      default: () =>
        h(Stats, { label: 'Сейчас' }, () => [
          h(Stat, { label: 'Процессор', dot: 'success' }, () => '42%'),
          h(Stat, { label: 'Жалобы', tone: 'danger', note: 'открытых' }, () => '3')
        ])
    }
  });
  const card = screen.getByRole('region', { name: 'Сервер' });
  expect(
    within(card).getByText('LiveKit работает').closest('.admin-pill')?.classList.contains('admin-tone--success')
  ).toBe(true);
  const cells = within(screen.getByRole('list', { name: 'Сейчас' })).getAllByRole('listitem');
  expect(cells.map((cell) => cell.textContent)).toEqual(['Процессор42%', 'Жалобы3открытых']);
});

test('a folded section keeps its state and controls when opened again', async () => {
  window.localStorage.clear();
  const render = () =>
    renderWithApp(Section, {
      props: { page: 'rooms', id: 'history', title: 'История' },
      slots: {
        default: () => h('input', { 'aria-label': 'Комната' }),
        link: () => h(Button, {}, () => 'Все звонки')
      }
    });
  const user = userEvent.setup();
  const view = render();
  const heading = screen.getByRole('button', { name: 'История', expanded: true });
  await user.type(screen.getByRole('textbox', { name: 'Комната' }), 'Кухня');
  await user.click(heading);
  expect(screen.getByRole('button', { name: 'История', expanded: false })).toBe(heading);
  expect(screen.queryByRole('textbox', { name: 'Комната' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Все звонки' })).toBeTruthy();
  await user.click(heading);
  expect(screen.getByRole('textbox', { name: 'Комната' })).toHaveProperty('value', 'Кухня');
  await user.click(heading);
  view.unmount();
  render();
  expect(screen.getByRole('button', { name: 'История', expanded: false })).toBeTruthy();
});
