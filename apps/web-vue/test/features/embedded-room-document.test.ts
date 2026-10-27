// The lobby takes the room's body flags off while another view hides the
// embedded room, and puts back every one the room still needs when it returns.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test } from 'vitest';
import { syncEmbeddedRoomDocument } from '../../src/features/home/model/embedded-room-document.ts';
import { usePageStore } from '../../src/stores/page.store.ts';

beforeEach(() => setActivePinia(createPinia()));

test('coming back to a room with a stream on its stage brings the stream layout back', () => {
  const page = usePageStore();
  const room = { visible: true, chatOpen: false, streamOnStage: true };
  page.screenView = true;
  syncEmbeddedRoomDocument({ ...room, visible: false });
  expect(page.screenView).toBe(false);
  expect(page.screen).toBe('start');

  syncEmbeddedRoomDocument(room);
  expect(page).toMatchObject({ screen: 'room', lobbyEmbedded: true, screenView: true });
});

test('a room without a stream comes back without the stream layout, its chat as it was', () => {
  const page = usePageStore();
  syncEmbeddedRoomDocument({ visible: true, chatOpen: true, streamOnStage: false });
  expect(page.screenView).toBe(false);
  expect(page.chatOpen).toBe(true);
});
