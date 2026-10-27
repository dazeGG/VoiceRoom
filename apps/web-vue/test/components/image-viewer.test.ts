import { fireEvent, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import AttachmentLightbox from '@/shared/chat/AttachmentLightbox.vue';
import { defined } from '../helpers/assert.ts';
import { renderWithApp } from '../helpers/render.ts';

const items = [
  { src: 'blob:pending-image', alt: 'ещё не отправлено' },
  { src: '/api/media/a.webp', downloadHref: '/api/media/a.webp?download=1', alt: 'в чате' }
];

async function open(index = 0) {
  const onClose = vi.fn();
  await renderWithApp(AttachmentLightbox, { props: { items, index, onClose } });
  return { onClose, dialog: screen.getByRole('dialog') };
}

test('the viewer opens any source, including an image still in the composer', async () => {
  const { dialog } = await open(0);
  expect(dialog.getAttribute('aria-label')).toBe('Изображение 1 из 2');
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('blob:pending-image');
});

test('arrows move between images, and a downloadable one offers a download link', async () => {
  const { dialog } = await open(0);
  await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(dialog.getAttribute('aria-label')).toBe('Изображение 2 из 2');
  expect(screen.getByRole('link', { name: 'Скачать' }).getAttribute('href')).toBe('/api/media/a.webp?download=1');
  await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(dialog.getAttribute('aria-label')).toBe('Изображение 1 из 2');
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

test('Escape and the close button close the viewer', async () => {
  const { onClose, dialog } = await open(0);
  await fireEvent.keyDown(dialog, { key: 'Escape' });
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
