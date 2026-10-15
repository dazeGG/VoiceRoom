// The coalesced lobby summary of a room (realtime/room-summaries.ts): nothing
// awaits it, so a failure must be logged instead of ending the process.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_COALESCE_MS } from '@voice-room/shared/realtime';

import { createRoomSummaries, type RoomSummaryDeps } from '../src/realtime/room-summaries.ts';
import { fake, recordingLogger } from './fakes/index.ts';

test('a summary whose room cannot be read is logged, not left as an unhandled rejection', async () => {
  const logger = recordingLogger();
  const summaries = createRoomSummaries({
    presenceRooms: new Map(),
    wsRegistry: { sendToUser: () => 0 },
    getRoomStore: () =>
      fake<ReturnType<RoomSummaryDeps['getRoomStore']>>({
        async getRoom() {
          throw new Error('Cannot use a pool after calling end on the pool');
        }
      }),
    publicPeer: () => fake(),
    publicLobbyRoom: () => fake(),
    avatarColorForPeerId: () => '',
    logger
  });

  summaries.schedule('r1');
  await new Promise((resolve) => setTimeout(resolve, SUMMARY_COALESCE_MS * 3));

  const failure = logger.records.find((record) => record.evt === 'room.summary_flush_failed');
  assert.ok(failure);
  assert.equal(failure.level, 'error');
  assert.equal(failure.roomId, 'r1');
});
