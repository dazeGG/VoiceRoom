// The lobby takes the room's body flags off while another view hides the
// embedded room, and puts back every one the room still needs when it returns.

import { afterEach, expect, test } from 'vitest';
import { syncEmbeddedRoomDocument } from '../../src/lib/features/home/model/embedded-room-document.ts';

afterEach(() => {
  for (const name of document.body.getAttributeNames()) document.body.removeAttribute(name);
});

test('coming back to a room with a stream on its stage brings the stream layout back', () => {
  const room = { visible: true, chatOpen: false, streamOnStage: true };
  document.body.dataset.screenView = 'true';
  syncEmbeddedRoomDocument(document.body, { ...room, visible: false });
  expect(document.body.dataset.screenView).toBeUndefined();
  expect(document.body.dataset.screen).toBe('start');

  syncEmbeddedRoomDocument(document.body, room);
  expect(document.body.dataset).toMatchObject({ screen: 'room', lobbyEmbedded: 'true', screenView: 'true' });
});

test('a room without a stream comes back without the stream layout, its chat as it was', () => {
  syncEmbeddedRoomDocument(document.body, { visible: true, chatOpen: true, streamOnStage: false });
  expect(document.body.dataset.screenView).toBeUndefined();
  expect(document.body.dataset.chatOpen).toBe('true');
});
