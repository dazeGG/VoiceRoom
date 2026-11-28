// Images attached in a chat composer: which files are accepted, what happens
// when an upload fails, and how drafts survive a reload.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSessionStore } from '@/features/auth/session.store';
import { clearAttachmentComposeStores, getAttachmentComposeStore } from '@/shared/chat/attachment-compose-stores';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { authUser } from '../fixtures/users';

let nextId = 0;
const uploads = new Map<string, 'ready' | 'fail'>();
vi.mock('@/api/attachments', () => ({
  createAttachmentSlot: vi.fn(async ({ context }: { context: string }) => ({
    id: `att-${++nextId}`,
    context,
    state: 'pending'
  })),
  uploadAttachmentContent: vi.fn(async (id: string) => {
    if (uploads.get(id) === 'fail') throw new Error('Сеть недоступна');
    return { id, state: 'ready' };
  }),
  getAttachmentStatus: vi.fn(async (id: string) => ({ id, context: 'dm', state: 'ready' })),
  retryAttachment: vi.fn(async (id: string) => ({ id, state: 'ready' })),
  deleteAttachment: vi.fn(async () => {})
}));

const api = await import('@/api/attachments');
const { AttachmentComposeStore, dataTransferHasImages, imageFilesFromDataTransfer } =
  await import('@/shared/chat/attachment-compose');

const image = (name = 'a.png', type = 'image/png', size = 100) => new File([new Uint8Array(size)], name, { type });
const report = new File(['VoiceRoom diagnostics'], 'voiceroom-diagnostics-2026-11-28-1421.txt', {
  type: 'text/plain'
});

beforeEach(() => {
  setActivePinia(createPinia());
  clearAttachmentComposeStores();
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

  await expect(store.addFiles([image('c.gif', 'image/gif')])).rejects.toThrow(
    'Поддерживаются JPEG, PNG и WebP размером до 10 МБ'
  );
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
  expect(api.deleteAttachment).toHaveBeenCalledWith('att-1', expect.any(AbortSignal));
  expect(localStorage.getItem('voice-room:attachment-drafts:dm:peer-1')).toBeNull();
});

test('attached images survive a reload of the composer', async () => {
  const first = new AttachmentComposeStore('dm', 'peer-1');
  await first.addFiles([image('1.png'), image('2.png')]);
  first.move(1, 0);
  expect(JSON.parse(localStorage.getItem('voice-room:attachment-drafts:dm:peer-1') ?? '[]')).toEqual([
    'att-2',
    'att-1'
  ]);

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
  // jsdom has no DataTransfer: a plain class stands in for it.
  vi.stubGlobal('DataTransfer', class {});
  const data = Object.assign(new DataTransfer(), {
    files: [image('a.png'), image('b.txt', 'text/plain')],
    items: [{ kind: 'file', type: 'image/png' }],
    types: ['Files']
  });
  expect(imageFilesFromDataTransfer(data).map((file) => file.name)).toEqual(['a.png']);
  expect(dataTransferHasImages(data)).toBe(true);
  expect(
    dataTransferHasImages(
      Object.assign(new DataTransfer(), {
        files: [],
        items: [{ kind: 'string', type: 'text/plain' }],
        types: ['text/plain']
      })
    )
  ).toBe(false);
});

test('a generated report is reserved as diagnostics, stays out of the image preview and is ready to send', async () => {
  const store = new AttachmentComposeStore('dm', 'support');

  await expect(store.addFiles([report])).rejects.toThrow();
  const upload = store.addDiagnostics(async () => report);
  expect(store.busy).toBe(true);
  await store.addFiles([image()]);
  const duplicate = vi.fn(async () => report);
  await store.addDiagnostics(duplicate);
  await upload;
  expect(duplicate).not.toHaveBeenCalled();
  expect(api.createAttachmentSlot).toHaveBeenCalledWith(
    expect.objectContaining({ context: 'dm', kind: 'diagnostics' }),
    expect.any(AbortSignal)
  );
  expect(api.uploadAttachmentContent).toHaveBeenCalledWith(
    'att-1',
    report,
    expect.any(Function),
    expect.any(AbortSignal)
  );
  expect(store.drafts[0]).toMatchObject({ kind: 'diagnostics', state: 'ready', previewUrl: null });
  expect(store.readyIds).toEqual(['att-1']);
  expect(store.busy).toBe(false);
});

test('switching accounts during a deferred report build prevents all later requests and draft storage', async () => {
  const session = useSessionStore();
  session.setUser(authUser({ id: 'account-a' }));
  const first = getAttachmentComposeStore('dm', OFFICIAL_ACCOUNT_ID, 'account-a');
  const deferred = Promise.withResolvers<File>();
  const build = vi.fn((_signal: AbortSignal) => deferred.promise);
  const operation = first.addDiagnostics(build);
  expect(first.busy).toBe(true);
  session.clearSession();
  session.setUser(authUser({ id: 'account-b' }));
  const second = getAttachmentComposeStore('dm', OFFICIAL_ACCOUNT_ID, 'account-b');
  deferred.resolve(report);
  await operation;
  expect(build.mock.calls[0]?.[0].aborted).toBe(true);
  expect(api.createAttachmentSlot).not.toHaveBeenCalled();
  expect(api.uploadAttachmentContent).not.toHaveBeenCalled();
  expect(first.busy).toBe(false);
  expect(second.drafts).toEqual([]);
  expect(Object.keys(localStorage).filter((key) => key.startsWith('voice-room:attachment-drafts:'))).toEqual([]);
});

test.each(['reservation', 'upload'])('a direct account switch aborts the active diagnostics %s', async (phase) => {
  const session = useSessionStore();
  session.setUser(authUser({ id: 'account-a' }));
  const store = getAttachmentComposeStore('dm', OFFICIAL_ACCOUNT_ID, 'account-a');
  const started = Promise.withResolvers<AbortSignal | undefined>();
  const waitForAbort = (signal: AbortSignal | undefined) =>
    new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')), { once: true });
      started.resolve(signal);
    });
  if (phase === 'reservation') {
    vi.mocked(api.createAttachmentSlot).mockImplementationOnce((_input, signal) => waitForAbort(signal));
  } else {
    vi.mocked(api.uploadAttachmentContent).mockImplementationOnce((_id, _file, _progress, signal) =>
      waitForAbort(signal)
    );
  }
  const upload = store.addDiagnostics(async () => report);
  const signal = await started.promise;
  session.setUser(authUser({ id: 'account-b' }));
  await upload;
  expect(signal?.aborted).toBe(true);
  if (phase === 'reservation') expect(api.uploadAttachmentContent).not.toHaveBeenCalled();
  expect(api.deleteAttachment).not.toHaveBeenCalled();
  expect(store.drafts).toEqual([]);
  expect(Object.keys(localStorage).filter((key) => key.startsWith('voice-room:attachment-drafts:'))).toEqual([]);
});

test('opening the same chat as another account does not restore the first account’s draft', async () => {
  const first = getAttachmentComposeStore('dm', OFFICIAL_ACCOUNT_ID, 'account-a');
  await first.addDiagnostics(async () => report);
  expect(localStorage.getItem(`voice-room:attachment-drafts:account:account-a:dm:${OFFICIAL_ACCOUNT_ID}`)).toBe(
    '["att-1"]'
  );
  const second = getAttachmentComposeStore('dm', OFFICIAL_ACCOUNT_ID, 'account-b');
  expect(second.drafts).toEqual([]);
  expect(api.getAttachmentStatus).not.toHaveBeenCalled();
});

test('an empty, oversized or non-text report never reserves a slot', async () => {
  const store = new AttachmentComposeStore('dm', 'support');
  for (const report of [image(), image('empty.txt', 'text/plain', 0), image('large.txt', 'text/plain', 524289)]) {
    await expect(store.addDiagnostics(async () => report)).rejects.toThrow('Не удалось приложить диагностику');
    expect(store.busy).toBe(false);
  }
  expect(api.createAttachmentSlot).not.toHaveBeenCalled();
});
