import assert from 'node:assert/strict';
import test from 'node:test';
import { callGateAllows } from '../../../src/domains/admission/call-gate.repository.ts';
import { kyselyOn } from '../../../src/platform/db/kysely.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { seedVoiceCall } from '../../fixtures/voice-call.ts';

// The gate is the last check before a call seat reaches LiveKit. Call
// transitions close a call the invitee no longer accepts, but a seat can
// connect before that happens, so the gate applies the contact policy itself.
test(
  'the call gate admits a seat only while the current attempt’s invitee accepts calls from its inviter',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, cleanup } = await createTestDatabase(t);
    t.after(cleanup);
    await pool.query(`
      INSERT INTO users (id, login, display_name, password_hash, calls_from)
      VALUES ('alice', 'alice', 'Alice', 'x', 'everyone'), ('bob', 'bob', 'Bob', 'x', 'everyone')
    `);
    const { callId, room } = await seedVoiceCall(pool, 'alice', 'bob');
    await pool.query(
      `INSERT INTO livekit_gate_principal_epochs (room_id, principal_type, principal_id) VALUES ($1, 'account', 'alice')`,
      [room.id]
    );
    await pool.query(
      `INSERT INTO livekit_gate_credentials (id, room_id, peer_id, principal_type, principal_id, principal_epoch,
         credential_hash, expires_at)
       VALUES ('alice-seat', $1, 'alice-peer', 'account', 'alice', 0, repeat('a', 64), now() + interval '1 hour')`,
      [room.id]
    );
    const db = kyselyOn(pool);
    const admits = (pId: string) => callGateAllows(db, { room: room.id, pId, pEpoch: 0, cid: `${pId}-seat` });
    const accept = (user: string, callsFrom: 'everyone' | 'friends') =>
      pool.query('UPDATE users SET calls_from = $2 WHERE id = $1', [user, callsFrom]);

    // Alice rang Bob: Bob's setting decides.
    assert.equal(await admits('alice'), true);
    await accept('bob', 'friends');
    assert.equal(await admits('alice'), false);
    await accept('bob', 'everyone');
    assert.equal(await admits('alice'), true);

    // After Bob re-rings, he is the inviter and Alice's setting decides.
    await pool.query(
      'UPDATE room_rings SET attempt = 2, call_revision = call_revision + 1, attempt_inviter_user_id = $2 WHERE id = $1',
      [callId, 'bob']
    );
    assert.equal(await admits('alice'), true);
    await accept('alice', 'friends');
    assert.equal(await admits('alice'), false);

    // Someone outside the call finds no call to be admitted to.
    assert.equal(await admits('mallory'), false);
  }
);
