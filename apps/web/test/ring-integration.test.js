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
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  const serviceWorker = read('src/service-worker.ts');

  assert.match(topbar, /roomClientState\.self\?\.accountUserId/);
  assert.match(topbar, /Number\(b\.online\) - Number\(a\.online\)/);
  assert.match(topbar, /inviteContent=/);
  // The ring event only plays the cue (and only while it is still fresh); the
  // invitation itself arrives as a DM message with an invite payload.
  assert.match(friends, /event\.payload\.expiresAt - Date\.now\(\) <= 0/);
  assert.match(friends, /playRingCue\(\)/);
  assert.match(friends, /respondRoomInvitation/);
  assert.match(friends, /clearLegacyResolvedRoomInvitations/);
  assert.doesNotMatch(friends, /readResolvedRoomInvitations/);
  // Invite cards gate their actions on pending status and expiry.
  assert.match(dmView, /inviteActionable/);
  assert.match(dmView, /invite\.status === 'pending' && \(!invite\.expiresAt \|\| invite\.expiresAt > Date\.now\(\)\)/);
  assert.match(serviceWorker, /Number\(payload\.expiresAt\) <= Date\.now\(\)/);
});
