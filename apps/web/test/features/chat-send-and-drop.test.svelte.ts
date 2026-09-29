// Chat send retries reuse one idempotency key per message; dropping images on
// a chat hands them to the compose store while nothing is being sent.

import { expect, test, vi } from 'vitest';
import { SendAttempt } from '../../src/lib/shared/chat/send-attempt';
import { AttachmentDrop } from '../../src/lib/shared/chat/attachment-drop.svelte';
import type { AttachmentComposeStore } from '../../src/lib/shared/chat/attachment-compose.svelte';

test('a retried message keeps its key, a changed or sent one gets a new key', () => {
  const attempt = new SendAttempt();
  const first = attempt.keyFor({ text: 'привет' });
  expect(attempt.keyFor({ text: 'привет' })).toBe(first);
  const changed = attempt.keyFor({ text: 'привет!' });
  expect(changed).not.toBe(first);
  attempt.reset();
  expect(attempt.keyFor({ text: 'привет!' })).not.toBe(changed);
});

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

test('drag enters stack, a drop adds the images, and a busy chat ignores drags', async () => {
  const addFiles = vi.fn(async () => {});
  const media = { addFiles } as unknown as AttachmentComposeStore;
  let busy = false;
  const drop = new AttachmentDrop({ media: () => media, busy: () => busy, onError: vi.fn() });

  drop.enter(imageDrag('dragenter'));
  drop.enter(imageDrag('dragenter'));
  drop.leave(imageDrag('dragleave'));
  expect(drop.active).toBe(true);

  await drop.drop(imageDrag('drop'));
  expect(drop.active).toBe(false);
  expect(addFiles).toHaveBeenCalledTimes(1);

  busy = true;
  drop.enter(imageDrag('dragenter'));
  expect(drop.active).toBe(false);
});

test('a failed upload is reported, and no store means no drop', async () => {
  const onError = vi.fn();
  const media = { addFiles: vi.fn(async () => Promise.reject(new Error('Слишком большой файл'))) };
  const drop = new AttachmentDrop({
    media: () => media as unknown as AttachmentComposeStore,
    busy: () => false,
    onError
  });
  await drop.drop(imageDrag('drop'));
  expect(onError).toHaveBeenCalledWith('Слишком большой файл');

  const noStore = new AttachmentDrop({ media: () => null, busy: () => false, onError });
  noStore.enter(imageDrag('dragenter'));
  expect(noStore.active).toBe(false);
});
