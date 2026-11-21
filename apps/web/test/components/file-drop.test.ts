import { fireEvent, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { FileDrop } from '@voice-room/ui/components';
import { expect, test, vi } from 'vitest';

test('opens the file chooser by keyboard and reports each selection', async () => {
  const onFiles = vi.fn();
  const { container } = render(FileDrop, { props: { accept: 'image/*', multiple: true, onFiles } });
  const button = screen.getByRole('button', { name: 'Выбрать файл' });
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  const open = vi.spyOn(input, 'click');

  await userEvent.tab();
  expect(document.activeElement).toBe(button);
  await userEvent.keyboard('{Enter}');
  expect(open).toHaveBeenCalledOnce();

  const first = new File(['one'], 'one.png', { type: 'image/png' });
  const second = new File(['two'], 'two.png', { type: 'image/png' });
  await userEvent.upload(input, [first, second]);
  await userEvent.upload(input, [first]);
  expect(onFiles).toHaveBeenNthCalledWith(1, [first, second]);
  expect(onFiles).toHaveBeenNthCalledWith(2, [first]);
});

test('lights up during a file drag, clears on leave and filters dropped files', async () => {
  const onFiles = vi.fn();
  const { container } = render(FileDrop, { props: { accept: '.png', onFiles } });
  const zone = container.firstElementChild;
  if (!zone) throw new Error('drop zone not found');
  const image = new File(['avatar'], 'avatar.png', { type: 'image/png' });
  const text = new File(['text'], 'notes.txt', { type: 'text/plain' });
  const dataTransfer = { types: ['Files'], files: [text, image] };
  await fireEvent.dragEnter(zone, { dataTransfer });
  expect(zone.classList.contains('ui-dropzone--over')).toBe(true);
  await fireEvent.dragLeave(zone, { dataTransfer });
  expect(zone.classList.contains('ui-dropzone--over')).toBe(false);
  await fireEvent.dragEnter(zone, { dataTransfer });
  await fireEvent.drop(zone, { dataTransfer });
  expect(zone.classList.contains('ui-dropzone--over')).toBe(false);
  expect(onFiles).toHaveBeenCalledWith([image]);
});

test('the avatar variant exposes upload and remove actions', async () => {
  const onRemove = vi.fn();
  render(FileDrop, { props: { variant: 'avatar', avatar: { name: 'Лобби' }, onRemove, caption: 'Изображение PNG' } });
  expect(screen.getByRole('button', { name: 'Загрузить', description: 'Изображение PNG' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  expect(onRemove).toHaveBeenCalledOnce();
});
