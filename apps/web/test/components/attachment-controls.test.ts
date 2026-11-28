import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import AttachmentComposer from '@/shared/chat/AttachmentComposer.vue';
import AttachmentUploadControl from '@/shared/chat/AttachmentUploadControl.vue';
import { AttachmentComposeStore, type ComposeDraft } from '@/shared/chat/attachment-compose';

function draft(id: string, overrides: Partial<ComposeDraft> = {}): ComposeDraft {
  return {
    id,
    context: 'dm',
    state: 'ready',
    mimeType: 'image/webp',
    bytes: 15,
    width: 24,
    height: 24,
    createdAt: null,
    updatedAt: null,
    failureCode: null,
    file: null,
    previewUrl: null,
    progress: 0,
    error: null,
    ...overrides
  };
}

test('photos still open and offer retry and removal as their state changes', async () => {
  const store = new AttachmentComposeStore('dm', 'photo-controls');
  store.drafts = [
    draft('photo-ready', { previewUrl: '/preview' }),
    draft('photo-failed', { state: 'failed', error: 'Offline' }),
    draft('photo-processing', { state: 'processing' })
  ];
  const remove = vi.spyOn(store, 'remove').mockResolvedValue(undefined);
  const retry = vi.spyOn(store, 'retry').mockResolvedValue(undefined);
  render(AttachmentComposer, { props: { store } });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Открыть изображение 1' }));
  const viewer = await screen.findByRole('dialog');
  await user.click(within(viewer).getByRole('button', { name: 'Закрыть просмотр' }));
  expect(screen.getByRole('progressbar', { name: 'Обработка изображения' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: 'photo-failed' }));
  await user.click(screen.getByRole('button', { name: 'Удалить изображение 1' }));
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'photo-ready' }));
});

test('each photo draft carries its upload state as a modifier, a failed upload as failed', () => {
  const store = new AttachmentComposeStore('dm', 'photo-states');
  store.drafts = [
    draft('ready', { previewUrl: '/preview' }),
    draft('processing', { state: 'processing' }),
    draft('offline', { state: 'uploading', error: 'Offline' })
  ];
  const { container } = render(AttachmentComposer, { props: { store } });
  const states = [...container.querySelectorAll('.attachment-composer__draft')].map((item) =>
    [...item.classList].find((name) => name.startsWith('attachment-composer__draft--'))
  );
  expect(states).toEqual([
    'attachment-composer__draft--ready',
    'attachment-composer__draft--processing',
    'attachment-composer__draft--failed'
  ]);
});

test('a failed diagnostics draft can be removed without an image or a download', async () => {
  const store = new AttachmentComposeStore('dm', 'diagnostics-controls');
  store.drafts = [
    draft('diagnostics', {
      kind: 'diagnostics',
      state: 'failed',
      bytes: null,
      name: null,
      width: null,
      height: null
    })
  ];
  const remove = vi.spyOn(store, 'remove').mockResolvedValue(undefined);
  render(AttachmentComposer, { props: { store } });
  expect(screen.getByText('Диагностика', { exact: true })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Скачать файл' })).toBeNull();
  expect(screen.getByRole('progressbar', { name: 'Загрузка диагностики' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Удалить файл' }));
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'diagnostics' }));
});

test('the attach menu publishes a useful error if report generation fails', async () => {
  const store = new AttachmentComposeStore('dm', 'diagnostics-build-failure');
  const buildDiagnostics = vi
    .fn<() => Promise<File>>()
    .mockRejectedValueOnce(new Error('Device lookup failed'))
    .mockRejectedValueOnce(null);
  const onError = vi.fn();
  render(AttachmentUploadControl, { props: { store, buildDiagnostics, onError } });
  const user = userEvent.setup();
  for (const message of ['Device lookup failed', 'Не удалось приложить диагностику']) {
    await user.click(screen.getByRole('button', { name: 'Добавить вложение' }));
    await user.click(screen.getByRole('menuitem', { name: 'Приложить диагностику' }));
    await vi.waitFor(() => expect(onError).toHaveBeenLastCalledWith(message));
  }
});

test('the photo menu forwards selected files and shows an error if the upload fails', async () => {
  const store = new AttachmentComposeStore('room', 'photo-selection');
  const addFiles = vi.spyOn(store, 'addFiles').mockRejectedValue(new Error('Network unavailable'));
  const onError = vi.fn();
  const view = render(AttachmentUploadControl, { props: { store, onError } });
  const input = view.container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing image file input');
  const user = userEvent.setup();
  const photo = new File(['image'], 'photo.png', { type: 'image/png' });
  await user.click(screen.getByRole('button', { name: 'Добавить вложение' }));
  await user.click(screen.getByRole('menuitem', { name: 'Загрузить фото' }));
  await user.upload(input, photo);
  expect(addFiles).toHaveBeenCalledWith([photo]);
  expect(onError).toHaveBeenCalledWith('Network unavailable');
});
