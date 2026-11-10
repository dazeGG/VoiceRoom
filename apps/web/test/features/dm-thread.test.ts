// A thread keeps a link preview that arrived as an edit, and leaving it keeps a plain copy.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import { fetchThreadPage, type DirectMessage } from '@/api/dm';
import { mistyped } from '../helpers/mistyped';

vi.mock('@/api/dm', () => ({
  fetchThreadPage: vi.fn(async (peerId: string) => ({
    messages: [message(`${peerId}-1`, 1)],
    pageInfo: { before: undefined, hasMoreBefore: false }
  })),
  markThreadRead: vi.fn(async () => 0)
}));

const { useDmThread } = await import('@/features/home/model/use-dm-thread');

function message(id: string, createdAt: number, linkPreview?: DirectMessage['linkPreview']): DirectMessage {
  return mistyped<DirectMessage>({ id, createdAt, body: id, linkPreview });
}

beforeEach(() => setActivePinia(createPinia()));

test('a message that lost its preview to a later copy keeps it, and leaving the thread does not throw', async () => {
  const thread = useDmThread(() => true);
  await thread.open('a', null);
  const preview = { url: 'https://x.test', title: 't', description: 'd', siteName: 's', image: null };

  thread.append(message('a-1', 1, preview));
  thread.append(message('a-1', 1));
  expect(thread.messages.value.find((item) => item.id === 'a-1')?.linkPreview).toEqual(preview);

  await expect(thread.open('b', null)).resolves.toBeUndefined();
});

function pendingPage() {
  let resolve: (page: Awaited<ReturnType<typeof fetchThreadPage>>) => void = () => {};
  const promise = new Promise<Awaited<ReturnType<typeof fetchThreadPage>>>((done) => {
    resolve = done;
  });
  return {
    promise,
    answer: (...messages: DirectMessage[]) =>
      resolve({ contractVersion: 1, mode: 'latest', messages, pageInfo: { hasMoreBefore: false, hasMoreAfter: false } })
  };
}

test('opening DM history preserves realtime additions, edits and deletion tombstones', async () => {
  const response = pendingPage();
  vi.mocked(fetchThreadPage).mockImplementationOnce(() => response.promise);
  const thread = useDmThread(() => true);
  const opening = thread.open('initial-race', null);
  thread.append(message('new', 3));
  thread.replace({ ...message('new', 3), body: 'edited new' });
  thread.replace({ ...message('old', 1), body: 'edited old' });
  thread.remove('deleted');
  thread.replace(message('deleted', 2));
  response.answer(message('old', 1), message('deleted', 2));
  await opening;
  expect(thread.messages.value.map(({ id, body }) => ({ id, body }))).toEqual([
    { id: 'old', body: 'edited old' },
    { id: 'new', body: 'edited new' }
  ]);
});

test.each([false, true])(
  'overlapping DM resyncs converge to the newest request, newest finishes first=%s',
  async (newestFirst) => {
    const thread = useDmThread(() => true);
    await thread.open('resync-race', null);
    const old = pendingPage();
    const current = pendingPage();
    vi.mocked(fetchThreadPage)
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => current.promise);
    const first = thread.resync('resync-race');
    const second = thread.resync('resync-race');
    if (newestFirst) {
      current.answer({ ...message('same', 1), body: 'fresh' });
      await second;
      old.answer({ ...message('same', 1), body: 'stale' });
      await first;
    } else {
      old.answer({ ...message('same', 1), body: 'stale' });
      await first;
      current.answer({ ...message('same', 1), body: 'fresh' });
      await second;
    }
    expect(thread.messages.value.map(({ id, body }) => ({ id, body }))).toEqual([{ id: 'same', body: 'fresh' }]);
  }
);

test('a resync from a closed DM cannot affect reopening the same peer', async () => {
  const thread = useDmThread(() => true);
  await thread.open('same-peer', null);
  const response = pendingPage();
  vi.mocked(fetchThreadPage).mockImplementationOnce(() => response.promise);
  const resync = thread.resync('same-peer');
  thread.close();
  await thread.open('same-peer', null);
  response.answer(message('stale', 10));
  await resync;
  expect(thread.messages.value.map((item) => item.id)).toEqual(['same-peer-1']);
});

test('DM resync preserves concurrent live edits and deletions', async () => {
  const thread = useDmThread(() => true);
  await thread.open('live-resync', null);
  const response = pendingPage();
  vi.mocked(fetchThreadPage).mockImplementationOnce(() => response.promise);
  const resync = thread.resync('live-resync');
  thread.replace({ ...message('live-resync-1', 1), body: 'live edit' });
  thread.append(message('new', 3));
  thread.remove('deleted');
  response.answer(message('live-resync-1', 1), message('deleted', 2));
  await resync;
  expect(thread.messages.value.map(({ id, body }) => ({ id, body }))).toEqual([
    { id: 'live-resync-1', body: 'live edit' },
    { id: 'new', body: 'new' }
  ]);
});
