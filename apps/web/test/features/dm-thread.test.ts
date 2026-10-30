// A thread keeps a link preview that arrived as an edit, and leaving it keeps a plain copy.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import type { DirectMessage } from '@/api/dm';
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
  return mistyped<DirectMessage>({ id, createdAt, text: id, linkPreview });
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
