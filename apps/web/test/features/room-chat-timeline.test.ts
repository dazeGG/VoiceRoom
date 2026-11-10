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

function pendingResponse() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return {
    promise,
    answer: (messages: RoomMessage[], paged = false) =>
      resolve(
        new Response(
          JSON.stringify(
            paged
              ? {
                  contractVersion: 1,
                  mode: 'latest',
                  messages: messages.map((message) => ({
                    id: message.id,
                    kind: 'room',
                    createdAt: message.createdAt,
                    content: { type: 'text', text: message.text },
                    cursor: message.id,
                    readCursor: message.id,
                    author: {
                      userId: null,
                      peerId: message.peerId,
                      name: message.name,
                      avatarColorKey: message.avatarColorKey,
                      avatarUrl: null,
                      avatarAccent: null
                    }
                  })),
                  pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
                }
              : { ok: true, roomId: 'room', messages }
          ),
          { headers: { 'content-type': 'application/json' } }
        )
      ),
    resolve
  };
}

test.each([false, true])('delayed room history preserves live add/edit/delete, paged=%s', async (paged) => {
  const response = pendingResponse();
  const { fetchMock } = stubFetch({});
  fetchMock.mockImplementationOnce(() => response.promise);
  const timeline = useRoomChatTimeline();
  const loading = paged ? timeline.open('race-room') : timeline.loadRecent('race-room');
  timeline.add(chatMessageFromRoomMessage(roomMessage('new', 3)));
  timeline.replace(chatMessageFromRoomMessage(roomMessage('new', 3, 'new edited')));
  timeline.replace(chatMessageFromRoomMessage(roomMessage('old', 1, 'edited before page')));
  timeline.remove('deleted');
  timeline.replace(chatMessageFromRoomMessage(roomMessage('deleted', 2, 'late deleted edit')));
  response.answer([roomMessage('old', 1), roomMessage('deleted', 2)], paged);
  await loading;
  expect(timeline.messages.value.map(({ id, text }) => ({ id, text }))).toEqual([
    { id: 'old', text: 'edited before page' },
    { id: 'new', text: 'new edited' }
  ]);
  timeline.add(chatMessageFromRoomMessage(roomMessage('deleted', 4, 'explicit new')));
  expect(timeline.messages.value.find((message) => message.id === 'deleted')?.text).toBe('explicit new');
});

test('closing and reopening a guest room rejects its previous response without an AbortSignal', async () => {
  const old = pendingResponse();
  const current = pendingResponse();
  const { fetchMock } = stubFetch({});
  fetchMock.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
  const timeline = useRoomChatTimeline();
  const first = timeline.loadRecent('a');
  timeline.close();
  const second = timeline.loadRecent('b');
  current.answer([roomMessage('current', 2)]);
  expect(await second).toBe(true);
  old.answer([roomMessage('old', 1)]);
  expect(await first).toBe(false);
  expect(ids(timeline)).toEqual(['current']);
});

test('an aborted guest response does not replace current live messages', async () => {
  const response = pendingResponse();
  const { fetchMock } = stubFetch({});
  fetchMock.mockImplementationOnce(() => response.promise);
  const timeline = useRoomChatTimeline();
  const controller = new AbortController();
  const loading = timeline.loadRecent('abort', controller.signal);
  timeline.add(chatMessageFromRoomMessage(roomMessage('live', 2)));
  controller.abort();
  response.answer([roomMessage('stale', 1)]);
  expect(await loading).toBe(false);
  expect(ids(timeline)).toEqual(['live']);
});

test('a forbidden response from an old room cannot switch the new room to guest history', async () => {
  const old = pendingResponse();
  const current = pendingResponse();
  const { fetchMock } = stubFetch({});
  fetchMock.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
  const timeline = useRoomChatTimeline();
  const first = timeline.open('old-room');
  const second = timeline.open('current-room');
  old.resolve(
    new Response(JSON.stringify({ ok: false, code: 'room_forbidden', error: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' }
    })
  );
  await first;
  current.answer([roomMessage('current', 2)], true);
  await second;
  expect(timeline.paged.value).toBe(true);
  expect(ids(timeline)).toEqual(['current']);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
