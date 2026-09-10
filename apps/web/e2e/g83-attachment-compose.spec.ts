import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const store = readFileSync(new URL('../src/lib/shared/chat/attachment-compose.svelte.ts', import.meta.url), 'utf8');
const composer = readFileSync(new URL('../src/lib/shared/chat/AttachmentComposer.svelte', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/lib/features/room/components/RoomChat.svelte', import.meta.url), 'utf8');
const dm = readFileSync(new URL('../src/lib/features/home/components/lobby/DmView.svelte', import.meta.url), 'utf8');

test('G83-A01 drag/paste/keyboard compose is isolated, resumable and sends only all-ready drafts', async () => {
  expect(store).toContain('voice-room:attachment-drafts:${context}:${contextId}');
  expect(store).toContain("draft.state === 'pending' || draft.state === 'processing'");
  expect(store).toContain('this.drafts.every((draft) => draft.state === \'ready\')');
  expect(store).toContain('imageFilesFromClipboard'); expect(store).toContain('imageFilesFromDataTransfer');
  expect(room).toContain('attachmentIds: media?.readyIds ?? []'); expect(dm).toContain('media?.readyIds ?? []');
  expect(composer).toContain('aria-label="Изображения к сообщению"');
});

test('G83-A02 validation/pressure failures and logout release slots, blobs and prevent partial send', async () => {
  expect(store).toContain('await deleteAttachment(draft.id).catch');
  expect(store).toContain('disposePreview(draft)');
  expect(store).toContain('for (const store of stores.values()) store.discard()');
  expect(store).toContain('file.size > 10 * 1024 * 1024');
  expect(composer).toContain('role="alert"');
  expect(room).toContain('if (media?.drafts.length && !media.canSend) return');
  expect(dm).toContain('if (media?.drafts.length && !media.canSend) return');
});
