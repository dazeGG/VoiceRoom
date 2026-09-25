import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileAvatarStorage } from '../src/lib/avatar-reconciliation.ts';

test('avatar reconciliation removes files that have no live database reference', async () => {
  const userKey = 'av_123e4567-e89b-12d3-a456-426614174000_deadbeef.webp';
  const roomKey = 'room_abcdefghij_0123abcd.webp';
  const orphanKey = 'room_bcdefghijk_deadbeef.webp';
  const removed: string[] = [];

  const result = await reconcileAvatarStorage({
    storage: {
      async listKeys() {
        return [userKey, roomKey, orphanKey];
      },
      async remove(key) {
        removed.push(key);
      }
    },
    userStore: {
      async listAvatarKeys() {
        return [userKey];
      }
    },
    roomStore: {
      async listAvatarKeys() {
        return [roomKey];
      }
    }
  });

  assert.deepEqual(result, { orphaned: [orphanKey], removed: 1 });
  assert.deepEqual(removed, [orphanKey]);
});
