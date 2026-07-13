import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Ring UI is authenticated, online-first, expiring, actionable, and teardown-safe', () => {
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  const serviceWorker = read('src/service-worker.ts');

  assert.match(topbar, /roomClientState\.self\?\.accountUserId/);
  assert.match(topbar, /Number\(b\.online\) - Number\(a\.online\)/);
  assert.match(topbar, /inviteContent=/);
  assert.match(friends, /const remainingMs = event\.payload\.expiresAt - Date\.now\(\)/);
  assert.match(friends, /if \(remainingMs <= 0\) break/);
  assert.match(friends, /roomInvitations = \[/);
  assert.match(friends, /item\.id !== invitation\.id \|\| item\.status !== 'pending'/);
  assert.match(friends, /status: 'accepted'/);
  assert.match(friends, /status: 'declined'/);
  assert.match(friends, /RESOLVED_ROOM_INVITATIONS_KEY/);
  assert.match(friends, /persistResolvedRoomInvitations\(\)/);
  assert.match(friends, /invite\.status !== 'pending'/);
  assert.match(serviceWorker, /Number\(payload\.expiresAt\) <= Date\.now\(\)/);
});
