import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ChatMessage } from '../../src/lib/api/rooms.ts';
import { buildChatDays, mentionsUser, restampAuthor } from '../../src/lib/features/room/room-chat-view.ts';
import { RoomChatDraft } from '../../src/lib/features/room/room-chat-draft.svelte.ts';
import { loadChatDraft, saveChatDraft } from '../../src/lib/shared/chat/chat-drafts.ts';

const MINUTE = 60_000;
const DAY_ONE = new Date(2026, 6, 1, 12, 0).getTime();
const DAY_THREE = new Date(2026, 6, 3, 9, 0).getTime();

function message(id: string, peerId: string, createdAt: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    authorUserId: null,
    avatarAccent: null,
    avatarColorKey: 'blue',
    avatarUrl: null,
    createdAt,
    editedAt: null,
    expiresAt: Number.MAX_SAFE_INTEGER,
    id,
    name: peerId.toUpperCase(),
    peerId,
    roomId: 'room',
    text: id,
    ...extra
  };
}

const notOwn = () => false;

test('a burst of one author shares a header until five quiet minutes or another author', () => {
  const days = buildChatDays(
    [
      message('a1', 'ada', DAY_ONE),
      message('a2', 'ada', DAY_ONE + 4 * MINUTE),
      message('b1', 'bob', DAY_ONE + 5 * MINUTE),
      message('a3', 'ada', DAY_ONE + 6 * MINUTE),
      message('a4', 'ada', DAY_ONE + 12 * MINUTE)
    ],
    notOwn
  );
  expect(days).toHaveLength(1);
  expect(days[0].groups.map((group) => group.messages.map((item) => item.id))).toEqual([
    ['a1', 'a2'],
    ['b1'],
    ['a3'],
    ['a4']
  ]);
});

test('a new calendar day opens its own section, even inside a burst', () => {
  const lateNight = new Date(2026, 6, 1, 23, 58).getTime();
  const days = buildChatDays(
    [message('a1', 'ada', lateNight), message('a2', 'ada', lateNight + 3 * MINUTE), message('a3', 'ada', DAY_THREE)],
    notOwn
  );
  expect(days.map((day) => day.groups.flatMap((group) => group.messages.map((item) => item.id)))).toEqual([
    ['a1'],
    ['a2'],
    ['a3']
  ]);
});

test('own messages are marked and a nameless guest is shown as «Гость»', () => {
  const [day] = buildChatDays(
    [message('mine', 'me', DAY_ONE), message('guest', 'g1', DAY_ONE + MINUTE, { name: '' })],
    (item) => item.peerId === 'me'
  );
  expect(day.groups.map((group) => [group.self, group.name])).toEqual([
    [true, 'ME'],
    [false, 'Гость']
  ]);
});

test('a peer update re-stamps what that peer, or the same account elsewhere, wrote', () => {
  const messages = [
    message('m1', 'p1', DAY_ONE, { name: 'Старое', authorUserId: 'ada' }),
    message('m2', 'p-old', DAY_ONE, { name: 'Старое', authorUserId: 'ada' }),
    message('m3', 'p2', DAY_ONE, { name: 'Боб', authorUserId: 'bob' })
  ];
  const peer = {
    id: 'p1',
    accountUserId: 'ada',
    name: 'Ада',
    avatarUrl: '/a.webp',
    avatarAccent: '#123456',
    avatarColorKey: 'green',
    serverMuted: false
  };
  const restamped = restampAuthor(messages, peer);
  expect(restamped?.map((item) => [item.id, item.name, item.avatarUrl, item.avatarColorKey])).toEqual([
    ['m1', 'Ада', '/a.webp', 'green'],
    ['m2', 'Ада', '/a.webp', 'green'],
    ['m3', 'Боб', null, 'blue']
  ]);
  expect(restampAuthor(restamped!, peer), 'nothing left to update').toBeNull();
});

test('a message mentions the reader only through a structured mention of their account', () => {
  const content = {
    version: 1 as const,
    segments: [
      { type: 'text' as const, text: 'привет ' },
      { type: 'mention' as const, userId: 'ada', label: '@ada' }
    ]
  };
  const mentioning = message('m', 'p', DAY_ONE, { content });
  expect(mentionsUser(mentioning, 'ada')).toBe(true);
  expect(mentionsUser(mentioning, 'bob')).toBe(false);
  expect(mentionsUser(mentioning, undefined)).toBe(false);
  expect(mentionsUser(message('plain', 'p', DAY_ONE, { text: '@ada' }), 'ada')).toBe(false);
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

test('a room draft comes back for its account, is saved after a pause and cleared once sent', () => {
  vi.useFakeTimers();
  saveChatDraft('ada', { type: 'room', id: 'room' }, { text: 'сохранённое' });

  const draft = new RoomChatDraft('room');
  draft.restore('ada');
  expect(draft.text).toBe('сохранённое');

  draft.text = 'новое';
  draft.schedule();
  expect(loadChatDraft('ada', { type: 'room', id: 'room' })?.text).toBe('сохранённое');
  vi.advanceTimersByTime(400);
  expect(loadChatDraft('ada', { type: 'room', id: 'room' })?.text).toBe('новое');

  draft.clear();
  expect(draft.text).toBe('');
  expect(loadChatDraft('ada', { type: 'room', id: 'room' })).toBeNull();
});

test('a guest draft is never stored, and a restore does not overwrite what is already typed', () => {
  const guest = new RoomChatDraft('room');
  guest.text = 'гость';
  guest.persist();
  expect(localStorage.length).toBe(0);

  saveChatDraft('ada', { type: 'room', id: 'room' }, { text: 'сохранённое' });
  guest.restore('ada');
  expect(guest.text).toBe('гость');
});
