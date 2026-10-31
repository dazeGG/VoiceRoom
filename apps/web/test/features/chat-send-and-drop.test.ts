// Dropping images on a chat hands them to the compose store, even while
// earlier messages are still on their way.

import { beforeEach, expect, test, vi } from 'vitest';
import { AttachmentDrop } from '@/shared/chat/attachment-drop';
import { AttachmentComposeStore } from '@/shared/chat/attachment-compose';

// jsdom has neither DataTransfer nor DragEvent: plain classes stand in for them.
beforeEach(() => {
  vi.stubGlobal('DataTransfer', class {});
  vi.stubGlobal('DragEvent', class extends Event {});
});

function imageDrag(type: string): DragEvent {
  const file = new File(['x'], 'a.png', { type: 'image/png' });
  const dataTransfer = Object.assign(new DataTransfer(), {
    types: ['Files'],
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    files: [file],
    dropEffect: 'none'
  });
  return Object.assign(new DragEvent(type, { cancelable: true }), { dataTransfer });
}

/** A real compose store whose uploads the test answers. */
function composeStore(addFiles: () => Promise<void>): AttachmentComposeStore {
  const store = new AttachmentComposeStore('room', 'room-a');
  vi.spyOn(store, 'addFiles').mockImplementation(addFiles);
  return store;
}

test('drag enters stack and a drop adds the images', async () => {
  const addFiles = vi.fn(async () => {});
  const media = composeStore(addFiles);
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
  const media = composeStore(async () => Promise.reject(new Error('Слишком большой файл')));
  const drop = new AttachmentDrop({ media: () => media, onError });
  await drop.drop(imageDrag('drop'));
  expect(onError).toHaveBeenCalledWith('Слишком большой файл');

  const noStore = new AttachmentDrop({ media: () => null, onError });
  noStore.enter(imageDrag('dragenter'));
  expect(noStore.active).toBe(false);
});
