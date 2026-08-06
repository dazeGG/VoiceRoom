import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const model = readFileSync(new URL('../src/lib/features/home/model/room-membership.svelte.ts', import.meta.url), 'utf8');

test('G46-A01 roster retains offline members and dedupes voice presence by account', async () => {
  expect(model).toContain('cachedMembers');
  expect(model).toContain('localStorage.setItem');
  expect(model).toMatch(/new Set\([\s\S]*accountUserId/);
  expect(model).toMatch(/byUserId\.set\(member\.userId/);
});

test('G46-A02 stale revisions are ignored and gaps force a directory resync', async () => {
  expect(model).toContain('presenceRevision <= entry.presenceRevision');
  expect(model).toContain('presenceRevision > entry.presenceRevision + 1');
  expect(model).toContain('loadRoomMembership(roomId, { query: entry.query })');
});
