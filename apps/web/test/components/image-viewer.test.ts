import { fireEvent, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { Dialog, Pressable } from '@voiceroom/ui-kit/components';
import { expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import AttachmentLightbox from '@/shared/chat/AttachmentLightbox.vue';
import { defined } from '../helpers/assert.ts';
import { renderWithApp } from '../helpers/render.ts';

const items = [
  { src: 'blob:pending-image', alt: 'ещё не отправлено' },
  { src: '/api/media/a.webp', downloadHref: '/api/media/a.webp?download=1', alt: 'в чате' }
];

async function open(index = 0) {
  const onClose = vi.fn();
  const Host = defineComponent(() => {
    const viewing = ref(true);
    return () =>
      viewing.value
        ? h(AttachmentLightbox, {
            items,
            index,
            onClose: () => {
              viewing.value = false;
              onClose();
            }
          })
        : null;
  });
  await renderWithApp(Host);
  return { onClose, dialog: await screen.findByRole('dialog', { name: `Изображение ${index + 1} из 2` }) };
}

test('the viewer opens any source, including an image still in the composer', async () => {
  const { dialog } = await open(0);
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('blob:pending-image');
});

test('arrows move between images, and a downloadable one offers a download link', async () => {
  const { dialog } = await open(0);
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть просмотр' })));
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('dialog', { name: 'Изображение 2 из 2' })).toBe(dialog);
  expect(screen.getByRole('link', { name: 'Скачать' }).getAttribute('href')).toBe('/api/media/a.webp?download=1');
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('dialog', { name: 'Изображение 1 из 2' })).toBe(dialog);
});

test('zoom goes up and down in steps between 100% and 600% and resets with 0', async () => {
  const { dialog } = await open(0);
  const scale = () => dialog.querySelector('.attachment-lightbox__scale')?.textContent;
  expect(screen.getByRole('button', { name: 'Уменьшить' })).toHaveProperty('disabled', true);
  await userEvent.click(screen.getByRole('button', { name: 'Увеличить' }));
  expect(scale()).toBe('140%');
  for (let index = 0; index < 20; index += 1) await fireEvent.keyDown(dialog, { key: '+' });
  expect(scale()).toBe('600%');
  await fireEvent.keyDown(dialog, { key: '0' });
  expect(scale()).toBe('100%');
  await fireEvent.wheel(defined(dialog.querySelector('img')?.parentElement, 'image frame'), { deltaY: -100 });
  expect(scale()).toBe('140%');
});

test('the close button closes the modal and reports its dismissal', async () => {
  const { onClose } = await open(0);
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('Escape dismisses only the viewer above an open dialog and returns focus to the attachment', async () => {
  const onClose = vi.fn();
  const Host = defineComponent(() => {
    const viewing = ref(false);
    return () =>
      h(Dialog, { open: true, title: 'Вложения', layer: 'auth', onClose }, () => [
        h(Pressable, { onClick: () => (viewing.value = true) }, () => 'Открыть изображение'),
        viewing.value ? h(AttachmentLightbox, { items, onClose: () => (viewing.value = false) }) : null
      ]);
  });
  await renderWithApp(Host);
  const opener = await screen.findByRole('button', { name: 'Открыть изображение' });
  await userEvent.click(opener);
  const close = await screen.findByRole('button', { name: 'Закрыть просмотр' });
  await vi.waitFor(() => expect(document.activeElement).toBe(close));
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('dialog', { name: 'Изображение 1 из 2' }).contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Изображение 1 из 2' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Вложения' })).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
});
