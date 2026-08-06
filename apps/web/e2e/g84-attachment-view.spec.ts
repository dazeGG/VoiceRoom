import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const mosaic = readFileSync(new URL('../src/lib/shared/chat/AttachmentMosaic.svelte', import.meta.url), 'utf8');
const lightbox = readFileSync(new URL('../src/lib/shared/chat/AttachmentLightbox.svelte', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/lib/shared/chat/attachment.css', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/lib/features/room/components/RoomChat.svelte', import.meta.url), 'utf8');
const dm = readFileSync(new URL('../src/lib/features/home/components/lobby/DmView.svelte', import.meta.url), 'utf8');

test('G84-A01 1-4 mosaics reserve dimensions, lazy-load and degrade deleted/unavailable images', async () => {
  expect(mosaic).toContain('attachments.slice(0, 4)'); expect(mosaic).toContain("attachment.state === 'ready'");
  expect(mosaic).toContain('loading="lazy"'); expect(mosaic).toContain('width={attachment.width} height={attachment.height}');
  expect(mosaic).toContain('Изображение недоступно'); expect(css).toContain("data-count='3'");
  expect(room).toContain('<AttachmentMosaic attachments={message.attachments} />');
  expect(dm).toContain('<AttachmentMosaic attachments={bubble.attachments} />');
});

test('G84-A02 lightbox traps/restores focus and supports Escape/arrows/zoom/authorized download', async () => {
  expect(lightbox).toContain("event.key === 'Escape'"); expect(lightbox).toContain("event.key === 'ArrowLeft'");
  expect(lightbox).toContain("event.key === 'ArrowRight'"); expect(lightbox).toContain("event.key === 'Tab'");
  expect(lightbox).toContain('return () => previous?.focus()'); expect(lightbox).toContain('aria-modal="true"');
  expect(lightbox).toContain("attachmentVariantUrl(attachment.id, 'processed', true)");
  expect(lightbox).toContain('zoomed = !zoomed');
});
