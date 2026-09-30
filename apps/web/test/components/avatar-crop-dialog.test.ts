import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import AvatarCropDialog from '../../src/lib/shared/ui/AvatarCropDialog/AvatarCropDialog.svelte';
import { stubCanvasAndImages } from '../helpers/fake-canvas.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(onSave = vi.fn(async (_blob: Blob) => {})) {
  const file = new File(['picture'], 'me.png', { type: 'image/png' });
  const onClose = vi.fn();
  render(AvatarCropDialog, {
    props: { open: true, file, name: 'Аня', shape: 'circle', kind: 'user', title: 'Аватар профиля', onClose, onSave }
  });
  return { onSave, onClose };
}

test('the crop is exported as a 256px webp square once the picked image has loaded', async () => {
  const { exports } = stubCanvasAndImages();
  const { onSave } = renderDialog();

  const done = screen.getByRole('button', { name: 'Готово' });
  await vi.waitFor(() => expect(done).toHaveProperty('disabled', false));
  await userEvent.click(done);

  expect(exports).toEqual([{ width: 256, height: 256, type: 'image/webp' }]);
  expect(onSave).toHaveBeenCalledTimes(1);
  const blob = onSave.mock.calls[0]?.[0];
  expect(blob).toBeInstanceOf(Blob);
  expect(blob?.type).toBe('image/webp');
});

test('a failed export is shown in the dialog and nothing is saved', async () => {
  stubCanvasAndImages({ failExport: true });
  const { onSave } = renderDialog();

  const done = screen.getByRole('button', { name: 'Готово' });
  await vi.waitFor(() => expect(done).toHaveProperty('disabled', false));
  await userEvent.click(done);

  expect(screen.getByRole('alert').textContent).toBe('Не удалось подготовить изображение');
  expect(onSave).not.toHaveBeenCalled();
});

test('cancel and Escape close without saving', async () => {
  stubCanvasAndImages();
  const { onSave, onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onSave).not.toHaveBeenCalled();
});
