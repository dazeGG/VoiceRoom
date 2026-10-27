// The room chat's message list: a guest's recent window and an account's paged
// history take the same additions, edits and removals.

import { expect, test } from 'vitest';
import type { RoomMessage } from '@voice-room/shared/contracts/messages';
import { chatMessageFromRoomMessage } from '../../src/api/rooms';
import { useRoomChatTimeline, type RoomChatTimeline } from '../../src/features/room/use-room-chat-timeline.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { defined } from '../helpers/assert.ts';

function roomMessage(id: string, createdAt: number, text = id): RoomMessage {
  return {
    authorUserId: null,
    avatarAccent: null,
    avatarColorKey: 'blue',
    avatarUrl: null,
    createdAt,
    editedAt: null,
    id,
    name: 'Ада',
    peerId: 'ada',
    roomId: 'room',
    text,
    attachments: []
  };
}

const ids = (timeline: RoomChatTimeline) => timeline.messages.value.map((message) => message.id);

test('a guest window adds new messages once, applies edits and removals', async () => {
  stubFetch({
    'GET /api/rooms/room/chat': { body: { ok: true, roomId: 'room', messages: [roomMessage('m1', 1)] } }
  });
  const timeline = useRoomChatTimeline();

  expect(await timeline.loadRecent('room')).toBe(true);
  expect(timeline.loading.value).toBe(false);
  expect(timeline.paged.value).toBe(false);
  expect(ids(timeline)).toEqual(['m1']);

  const m2 = chatMessageFromRoomMessage(roomMessage('m2', 2));
  expect(timeline.add(m2)).toBe(true);
  expect(timeline.add(m2)).toBe(false);
  expect(ids(timeline)).toEqual(['m1', 'm2']);

  timeline.replace(chatMessageFromRoomMessage(roomMessage('m2', 2, 'правка')));
  expect(defined(timeline.messages.value[1], 'timeline.messages[1]').text).toBe('правка');

  timeline.remove('m1');
  expect(ids(timeline)).toEqual(['m2']);
  expect(timeline.has('m1')).toBe(false);
});

test('reconciling the latest messages keeps local ones and replaces known ones', async () => {
  stubFetch({
    'GET /api/rooms/room/chat': { body: { ok: true, roomId: 'room', messages: [roomMessage('m1', 1)] } }
  });
  const timeline = useRoomChatTimeline();
  await timeline.loadRecent('room');
  timeline.add(chatMessageFromRoomMessage(roomMessage('local', 5)));

  timeline.reconcileLatest([roomMessage('m1', 1, 'изменено'), roomMessage('m3', 3)].map(chatMessageFromRoomMessage));

  expect(ids(timeline)).toEqual(['m1', 'm3', 'local']);
  expect(defined(timeline.messages.value[0], 'timeline.messages[0]').text).toBe('изменено');
});

test('a failed recent-window load reports the error and stops loading', async () => {
  stubFetch({ 'GET /api/rooms/room/chat': { status: 500, body: { ok: false, error: 'boom', code: 'internal' } } });
  const timeline = useRoomChatTimeline();

  expect(await timeline.loadRecent('room')).toBe(false);
  expect(timeline.loading.value).toBe(false);
  expect(timeline.error.value).not.toBe('');
});
