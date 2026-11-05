// How long a join took, as its client measured it, is kept with the stay. With
// the round trip of the stay's minutes it says how joins go for someone far from
// the server, and the column rolls back and forth cleanly.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Type } from 'typebox';
import type { JoinTiming } from '@voice-room/shared/contracts/realtime';
import {
  createVoiceSessionRepository,
  type FinishedVoiceSession
} from '../src/domains/rooms/voice-session.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { noteVoiceReport, type VoicePeer } from '../src/realtime/voice-track.ts';
import { createTestDatabase } from './db-harness.ts';
import { queryRow } from './helpers/checked.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const TIMING: JoinTiming = { microphoneMs: 90, tokenMs: 260, connectMs: 1020, publishMs: 1230, totalMs: 1240 };

const stay = (joinTiming?: JoinTiming): FinishedVoiceSession => ({
  roomId: 'kitchen',
  userId: null,
  guestName: 'Гость',
  guestId: null,
  client: null,
  os: '',
  browser: '',
  ip: '',
  joinedAt: Date.UTC(2026, 10, 5, 12, 0),
  leftAt: Date.UTC(2026, 10, 5, 12, 5),
  ...(joinTiming ? { joinTiming } : {})
});

const POLL = {
  rttMs: 115,
  jitterBufferMs: 20,
  uplink: { packets: 100, lost: 0 },
  transport: null,
  heard: []
};

test('a poll that says how the join went is remembered; the next ones do not erase it', () => {
  const peer: VoicePeer = { id: 'a' };
  const peers = new Map([['a', peer]]);

  noteVoiceReport(peers, peer, { ...POLL, joinTiming: TIMING }, 1_000);
  noteVoiceReport(peers, peer, POLL, 4_000);

  assert.deepEqual(peer.voice?.joinTiming, TIMING);
});

test('a stay keeps how its join went, and one whose client did not say keeps nothing', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });

  await createVoiceSessionRepository({ pool }).recordSessions([stay(TIMING), stay()]);

  const row = await queryRow(
    pool,
    Type.Object({ measured: Type.Integer(), total: Type.Integer(), kept: Type.Integer() }),
    `SELECT count(*)::int AS total,
            count(join_timing)::int AS measured,
            coalesce(max((join_timing->>'totalMs')::int), 0)::int AS kept
       FROM voice_sessions`
  );
  assert.deepEqual(row, { total: 2, measured: 1, kept: TIMING.totalMs });
});

test('the column rolls back and comes back', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const hasColumn = async () =>
    (
      await queryRow(
        pool,
        Type.Object({ present: Type.Boolean() }),
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_name = 'voice_sessions' AND column_name = 'join_timing'
         ) AS present`
      )
    ).present;
  assert.equal(await hasColumn(), true);

  await rollBackThrough(databaseUrl, '20261105120000_keep_voice_join_timing');
  assert.equal(await hasColumn(), false);

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await hasColumn(), true);
});
