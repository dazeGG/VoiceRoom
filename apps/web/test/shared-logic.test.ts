import { expect, test } from 'vitest';
import { frequentReactionKey, rankFrequentReactions } from '../src/lib/shared/chat/frequent-reactions.ts';
import { effectivePresenceStatus, presenceStatusLabel } from '../src/lib/shared/presence.ts';
import { parseChatLinks } from '../src/lib/shared/utils/linkify.ts';
import { clearScreenAttendance, setScreenAttendance } from '../src/lib/features/room/client/model/screen-attendance.ts';
import type { Participant } from '../src/lib/features/room/client/core/types.ts';

test('chat links keep hosts, paths and query strings, drop trailing punctuation, and never link scripts', () => {
  const url = 'https://spb.hh.ru/vacancy/134530018?nhtmFrom=chat';
  expect(parseChatLinks(url)).toEqual([{ kind: 'link', text: url, href: url }]);
  expect(parseChatLinks(`${url}.`)).toEqual([
    { kind: 'link', text: url, href: url },
    { kind: 'text', text: '.' }
  ]);
  expect(parseChatLinks('javascript:alert(1)')).toEqual([{ kind: 'text', text: 'javascript:alert(1)' }]);
});

test('being offline wins over any status; unknown statuses fall back by do-not-disturb', () => {
  expect(effectivePresenceStatus(false, 'dnd', true)).toBe('offline');
  expect(effectivePresenceStatus(true, 'online')).toBe('online');
  expect(effectivePresenceStatus(true, 'away')).toBe('away');
  expect(effectivePresenceStatus(true, 'dnd')).toBe('dnd');
  expect(effectivePresenceStatus(true, 'offline')).toBe('offline');
  expect(effectivePresenceStatus(true, undefined, true)).toBe('dnd');
  expect(effectivePresenceStatus(true, 'unexpected', false)).toBe('online');
  expect(presenceStatusLabel('away')).toBe('Отошёл');
});

test('frequent reactions are per user, ranked by count then recency, three at most', () => {
  expect(frequentReactionKey('chat', 'user-42')).toBe('chat:user-42');
  expect(
    rankFrequentReactions([
      { emoji: '👍', count: 2, lastUsedAt: 10 },
      { emoji: '😂', count: 4, lastUsedAt: 5 },
      { emoji: '🔥', count: 4, lastUsedAt: 12 },
      { emoji: '❤️', count: 1, lastUsedAt: 20 }
    ]).map((entry) => entry.emoji)
  ).toEqual(['🔥', '😂', '👍']);
});

test('watching a stream is one stream at a time and reports only real changes', () => {
  const self = { viewedScreenPeerId: '' } as Participant;
  expect(setScreenAttendance(self, 'screen-a')).toBe(true);
  expect(self.viewedScreenPeerId).toBe('screen-a');
  expect(setScreenAttendance(self, 'screen-a')).toBe(false);
  expect(setScreenAttendance(self, 'screen-b')).toBe(true);
  expect(clearScreenAttendance(self, 'screen-a')).toBe(false);
  expect(clearScreenAttendance(self, 'screen-b')).toBe(true);
  expect(self.viewedScreenPeerId).toBe('');
});
