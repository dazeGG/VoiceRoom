// Dropping images on a chat hands them to the compose store, even while
// earlier messages are still on their way.

import { expect, test, vi } from 'vitest';
import { AttachmentDrop } from '../../src/lib/shared/chat/attachment-drop.svelte';
import type { AttachmentComposeStore } from '../../src/lib/shared/chat/attachment-compose.svelte';

function imageDrag(type: string): DragEvent {
  const file = new File(['x'], 'a.png', { type: 'image/png' });
  const dataTransfer = {
    types: ['Files'],
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    files: [file],
    dropEffect: 'none'
  } as unknown as DataTransfer;
  const event = new Event(type, { cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

test('drag enters stack and a drop adds the images', async () => {
  const addFiles = vi.fn(async () => {});
  const media = { addFiles } as unknown as AttachmentComposeStore;
  const drop = new AttachmentDrop({ media: () => media, onError: vi.fn() });

  drop.enter(imageDrag('dragenter'));
  drop.enter(imageDrag('dragenter'));
  drop.leave(imageDrag('dragleave'));
  expect(drop.active).toBe(true);

  await drop.drop(imageDrag('drop'));
  expect(drop.active).toBe(false);
  expect(addFiles).toHaveBeenCalledTimes(1);
});

test('a failed upload is reported, and no store means no drop', async () => {
  const onError = vi.fn();
  const media = { addFiles: vi.fn(async () => Promise.reject(new Error('Слишком большой файл'))) };
  const drop = new AttachmentDrop({ media: () => media as unknown as AttachmentComposeStore, onError });
  await drop.drop(imageDrag('drop'));
  expect(onError).toHaveBeenCalledWith('Слишком большой файл');

  const noStore = new AttachmentDrop({ media: () => null, onError });
  noStore.enter(imageDrag('dragenter'));
  expect(noStore.active).toBe(false);
});
