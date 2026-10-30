// Where people go on a phone: rows of the grid, its pages, who is big in focus,
// and which corner a dropped picture-in-picture snaps to.

import { expect, test } from 'vitest';
import {
  focusSpotlight,
  gridPages,
  gridRows,
  nearestCorner,
  nextActiveSpeaker
} from '@/features/room/mobile-call-layout';
import { defined } from '../helpers/assert';

const others = (count: number) => Array.from({ length: count }, (_, index) => `p${index + 1}`);

test('the grid fills rows from the top: a single tile leads odd counts, wider rows sit at the bottom', () => {
  expect([3, 4, 5, 6, 7, 8, 9].map(gridRows)).toEqual([
    [1, 2],
    [2, 2],
    [1, 2, 2],
    [2, 2, 2],
    [2, 2, 3],
    [2, 3, 3],
    [3, 3, 3]
  ]);
});

test('I am the last tile of the first page, and the tenth person on goes to the next page', () => {
  expect(gridPages('me', others(3))).toEqual([
    [
      ['p1', 'p2'],
      ['p3', 'me']
    ]
  ]);

  const pages = gridPages('me', others(11));
  expect(pages).toHaveLength(2);
  expect(defined(pages[0], 'pages[0]').flat()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'me']);
  expect(pages[0]).toHaveLength(3);
  expect(pages[1]).toEqual([['p9'], ['p10', 'p11']]);

  // A full room of 25 needs three pages.
  expect(gridPages('me', others(24))).toHaveLength(3);
});

test('the active speaker stays while talking and hands over only to someone who talks', () => {
  const people = (speaking: string[]) => ['a', 'b', 'c'].map((id) => ({ id, speaking: speaking.includes(id) }));
  expect(nextActiveSpeaker('', people([]))).toBe('a');
  expect(nextActiveSpeaker('a', people(['b']))).toBe('b');
  // Two at once: whoever already has the screen keeps it.
  expect(nextActiveSpeaker('b', people(['a', 'b']))).toBe('b');
  // Silence keeps the last one who talked.
  expect(nextActiveSpeaker('c', people([]))).toBe('c');
  // The last speaker left.
  expect(nextActiveSpeaker('z', people([]))).toBe('a');
});

test('focus shows whoever is pinned, me included, else the active speaker', () => {
  const room = { selfId: 'me', otherIds: ['a', 'b'] };
  expect(focusSpotlight({ ...room, pinnedId: '', activeSpeakerId: 'b' })).toBe('b');
  expect(focusSpotlight({ ...room, pinnedId: 'me', activeSpeakerId: 'b' })).toBe('me');
  expect(focusSpotlight({ ...room, pinnedId: 'a', activeSpeakerId: 'b' })).toBe('a');
  // Someone pinned who has left no longer counts.
  expect(focusSpotlight({ ...room, pinnedId: 'gone', activeSpeakerId: '' })).toBe('a');
});

test('a dropped picture-in-picture snaps to the quarter its centre is in', () => {
  const viewport = { width: 390, height: 600 };
  expect(nearestCorner({ x: 50, y: 50 }, viewport)).toBe('tl');
  expect(nearestCorner({ x: 300, y: 100 }, viewport)).toBe('tr');
  expect(nearestCorner({ x: 100, y: 500 }, viewport)).toBe('bl');
  expect(nearestCorner({ x: 300, y: 500 }, viewport)).toBe('br');
});
