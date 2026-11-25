import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createNativeVoiceRecovery } from '../src/domains/admission/native-voice-recovery.service.ts';
import type { NativeVoiceRepository } from '../src/domains/admission/native-voice.repository.ts';
import { fake } from './fakes/index.ts';

type RecoveryDeps = Parameters<typeof createNativeVoiceRecovery>[0];

test('stopping recovery discards a pending retirement sweep; restarting reconciles the outstanding lease', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const id = '00000000-0000-4000-8000-000000000001';
  const rows = [{ id, room_id: 'room', peer_id: 'peer', retired_at: new Date() }];
  const pending = Promise.withResolvers<typeof rows>();
  const sweeps: string[][] = [];
  const retirements: string[] = [];
  const recovery = createNativeVoiceRecovery({
    roomPrefix: 'vr-',
    report: (error) => assert.fail(String(error)),
    admin: fake<RecoveryDeps['admin']>({ listRooms: async () => [] }),
    repository: fake<NativeVoiceRepository>({
      async retired(_limit, watched) {
        sweeps.push(watched);
        if (sweeps.length === 1) return pending.promise;
        return rows.filter((row) => !watched.includes(row.id));
      }
    }),
    watchdog: fake<RecoveryDeps['watchdog']>({
      settlements: () => [],
      retirements: () => [...retirements],
      retire(_participant, lease) {
        retirements.push(lease);
        return true;
      }
    })
  });
  t.after(() => recovery.stop());

  recovery.start();
  t.mock.timers.tick(1_000);
  assert.deepEqual(sweeps, [[]], 'no overlapping lookup while the first is pending');
  recovery.stop();
  pending.resolve(rows);
  await setImmediate();
  assert.deepEqual(retirements, [], 'the late result must not create a watch after shutdown');

  recovery.start();
  await setImmediate();
  assert.deepEqual(retirements, [id], 'the next start recovers the outstanding lease');
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.deepEqual(sweeps, [[], [], [id]], 'the next sweep excludes the recovered watch');
  assert.deepEqual(retirements, [id]);
});
