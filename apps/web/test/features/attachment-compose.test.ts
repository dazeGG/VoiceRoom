// Images attached in a chat composer: which files are accepted, what happens
// when an upload fails, and how drafts survive a reload.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

let nextId = 0;
const uploads = new Map<string, 'ready' | 'fail'>();
vi.mock('../../src/lib/api/attachments', () => ({
  createAttachmentSlot: vi.fn(async ({ context }: { context: string }) => ({ id: `att-${++nextId}`, context, state: 'pending' })),
  uploadAttachmentContent: vi.fn(async (id: string) => {
    if (uploads.get(id) === 'fail') throw new Error('Сеть недоступна');
    return { id, state: 'ready' };
  }),
  getAttachmentStatus: vi.fn(async (id: string) => ({ id, context: 'dm', state: 'ready' })),
  retryAttachment: vi.fn(async (id: string) => ({ id, state: 'ready' })),
  deleteAttachment: vi.fn(async () => {})
}));

const api = await import('../../src/lib/api/attachments');
const { AttachmentComposeStore, dataTransferHasImages, imageFilesFromDataTransfer } = await import('../../src/lib/shared/chat/attachment-compose.svelte.ts');

const image = (name = 'a.png', type = 'image/png', size = 100) => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  localStorage.clear();
  nextId = 0;
  uploads.clear();
  vi.clearAllMocks();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

test('JPEG, PNG and WebP up to 10 MB are accepted; anything else is refused', async () => {
  const store = new AttachmentComposeStore('dm', 'peer-1');
  await store.addFiles([image('a.png'), image('b.webp', 'image/webp')]);
  expect(store.drafts.map((draft) => draft.state)).toEqual(['ready', 'ready']);
  expect(store.canSend).toBe(true);

  await expect(store.addFiles([image('c.gif', 'image/gif')])).rejects.toThrow('Поддерживаются JPEG, PNG и WebP размером до 10 МБ');
  await expect(store.addFiles([image('d.png', 'image/png', 11 * 1024 * 1024)])).rejects.toThrow();
});

test('at most four images are attached', async () => {
  const store = new AttachmentComposeStore('dm', 'peer-1');
  await store.addFiles([image('1.png'), image('2.png'), image('3.png'), image('4.png'), image('5.png')]);
  expect(store.drafts).toHaveLength(4);
});

test('a failed upload removes its draft, deletes the slot and reports the error', async () => {
  uploads.set('att-1', 'fail');
  const store = new AttachmentComposeStore('dm', 'peer-1');
  await store.addFiles([image()]);
  expect(store.drafts).toEqual([]);
  expect(store.lastError).toBe('Сеть недоступна');
  expect(api.deleteAttachment).toHaveBeenCalledWith('att-1');
  expect(localStorage.getItem('voice-room:attachment-drafts:dm:peer-1')).toBeNull();
});

test('attached images survive a reload of the composer', async () => {
  const first = new AttachmentComposeStore('dm', 'peer-1');
  await first.addFiles([image('1.png'), image('2.png')]);
  first.move(1, 0);
  expect(JSON.parse(localStorage.getItem('voice-room:attachment-drafts:dm:peer-1') ?? '[]')).toEqual(['att-2', 'att-1']);

  const reloaded = new AttachmentComposeStore('dm', 'peer-1');
  await vi.waitFor(() => expect(reloaded.drafts.map((draft) => draft.id)).toEqual(['att-2', 'att-1']));
  expect(reloaded.readyIds).toEqual(['att-2', 'att-1']);
});

test('discarding the composer deletes every uploaded image', async () => {
  const store = new AttachmentComposeStore('room', 'room-a');
  await store.addFiles([image('1.png'), image('2.png')]);
  store.discard();
  expect(store.drafts).toEqual([]);
  expect(vi.mocked(api.deleteAttachment).mock.calls.map(([id]) => id)).toEqual(['att-1', 'att-2']);
});

test('drag and drop recognises image files only', () => {
  const data = { files: [image('a.png'), image('b.txt', 'text/plain')], items: [{ kind: 'file', type: 'image/png' }], types: ['Files'] } as unknown as DataTransfer;
  expect(imageFilesFromDataTransfer(data).map((file) => file.name)).toEqual(['a.png']);
  expect(dataTransferHasImages(data)).toBe(true);
  expect(dataTransferHasImages({ files: [], items: [{ kind: 'string', type: 'text/plain' }], types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
});
