import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { nativeVoiceIdentity } from '@voiceroom/shared/validation';
import { ParticipantInfo, Room, ServerError } from 'livekit-server-sdk';
import { createNativeVoiceRecovery } from '../src/domains/admission/native-voice-recovery.service.ts';
import type { NativeVoiceRepository } from '../src/domains/admission/native-voice.repository.ts';
import { fake } from './fakes/index.ts';

type RecoveryDeps = Parameters<typeof createNativeVoiceRecovery>[0];
type Watchdog = RecoveryDeps['watchdog'];

test('discovery retries a transient SFU failure and resumes a full room after the last admitted watch', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const unavailable = new Error('SFU unavailable');
  const reports: unknown[] = [];
  const listed: string[] = [];
  const tracked: string[] = [];
  let listAttempts = 0;
  const recovery = createNativeVoiceRecovery({
    roomPrefix: 'vr-',
    repository: null,
    report: (error) => reports.push(error),
    admin: fake<RecoveryDeps['admin']>({
      async listRooms() {
        if (++listAttempts === 1) throw unavailable;
        return ['other-room', 'vr-', 'vr-?', 'vr-gone', 'vr-empty', 'vr-room'].map((name) => new Room({ name }));
      },
      async listParticipants(name: string) {
        listed.push(name);
        if (name === 'vr-gone') throw new ServerError('twirp', 'requested room does not exist', 404, 'not_found');
        if (name === 'vr-empty') return [new ParticipantInfo({ identity: 'peer' })];
        if (listed.filter((room) => room === name).length === 1) throw unavailable;
        return ['peer#voice.b', 'peer#voice.a', 'peer'].map((identity) => new ParticipantInfo({ identity }));
      }
    }),
    watchdog: fake<Watchdog>({
      recover({ room, identity }: Parameters<Watchdog['recover']>[0], window: undefined) {
        assert.equal(room, 'room');
        assert.equal(window, undefined);
        tracked.push(identity);
        return tracked.length !== 2;
      }
    })
  });
  t.after(() => recovery.stop());
  recovery.start();
  recovery.start();
  await setImmediate();
  assert.equal(listAttempts, 1);
  assert.deepEqual(reports, [unavailable]);

  for (const delay of [1_000, 2_000, 4_000]) {
    t.mock.timers.tick(delay);
    await setImmediate();
  }
  assert.equal(listAttempts, 2);
  assert.deepEqual(listed, ['vr-gone', 'vr-empty', 'vr-room', 'vr-room', 'vr-room']);
  assert.deepEqual(tracked, ['peer#voice.a', 'peer#voice.b', 'peer#voice.b']);
  assert.deepEqual(reports, [unavailable, unavailable]);
});

test(
  'a timed-out lease lookup fails closed across the sweep and a recovered watch can refresh its deadline',
  { timeout: 5_000 },
  async (t) => {
    const companion = 'peer#voice.lease';
    const deadline = Date.now() + 30_000;
    const queries: string[] = [];
    const reports: unknown[] = [];
    const refreshers: Array<Parameters<Watchdog['recover']>[2]> = [];
    const tracked: Array<[string, number | undefined]> = [];
    const discovered = Promise.withResolvers<void>();
    // The lookup deadline is unref'ed by Node. Bound the wait even if discovery stalls.
    const timeout = setTimeout(() => discovered.reject(new Error('Discovery did not finish')), 4_000);
    t.after(() => clearTimeout(timeout));
    const recovery = createNativeVoiceRecovery({
      roomPrefix: 'vr-',
      report: (error) => reports.push(error),
      admin: fake<RecoveryDeps['admin']>({
        async listRooms() {
          return ['verified', 'stalled', 'unverified'].map((room) => new Room({ name: `vr-${room}` }));
        },
        async listParticipants() {
          return [new ParticipantInfo({ identity: companion })];
        }
      }),
      repository: fake<NativeVoiceRepository>({
        async retired() {
          return [];
        },
        async recover(room: string, identities: string[]) {
          assert.deepEqual(identities, [companion]);
          queries.push(room);
          if (room === 'stalled') return new Promise(() => {});
          return queries.length === 1 ? [{ identity: companion, deadline, expiresAt: deadline }] : [];
        }
      }),
      watchdog: fake<Watchdog>({
        settlements: () => [],
        retirements: () => [],
        recover(
          { room }: Parameters<Watchdog['recover']>[0],
          window: Parameters<Watchdog['recover']>[1],
          refresh: Parameters<Watchdog['recover']>[2]
        ) {
          tracked.push([room, window?.deadline]);
          refreshers.push(refresh);
          if (room === 'unverified') discovered.resolve();
          return true;
        }
      })
    });
    t.after(() => recovery.stop());
    recovery.start();
    await setImmediate();
    assert.deepEqual(queries, ['verified', 'stalled']);
    assert.deepEqual(tracked, [['verified', deadline]]);
    const [refresh] = refreshers;
    assert.ok(refresh);
    assert.equal(await refresh(), null);
    await discovered.promise;
    assert.deepEqual(queries, ['verified', 'stalled', 'verified']);
    assert.deepEqual(tracked, [
      ['verified', deadline],
      ['stalled', undefined],
      ['unverified', undefined]
    ]);
    assert.equal(reports.length, 1);
    assert.match(String(reports[0]), /database lookup timed out/);
  }
);

test('retirement retries an unpersisted settlement and keeps only one database sweep in flight', async (t) => {
  const startedAt = new Date('2026-11-24T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: startedAt });
  const firstWrite = Promise.withResolvers<void>();
  const writes: Array<[string, boolean]> = [];
  const retirements: Array<Parameters<Watchdog['retire']>> = [];
  const id = '00000000-0000-4000-8000-000000000001';
  const retiredAt = new Date(startedAt.getTime() - 10_000);
  let acknowledged = false;
  const recovery = createNativeVoiceRecovery({
    roomPrefix: 'vr-',
    report: (error) => assert.fail(String(error)),
    admin: fake<RecoveryDeps['admin']>({ listRooms: async () => [] }),
    repository: fake<NativeVoiceRepository>({
      async finishCleanup(settlementId, absent) {
        writes.push([settlementId, absent]);
        if (writes.length === 1) await firstWrite.promise;
      },
      async retired(_limit, watched, gateStartedAt) {
        assert.equal(acknowledged, true);
        assert.deepEqual(watched, ['already-watched']);
        assert.deepEqual(gateStartedAt, startedAt);
        return [{ id, room_id: 'room', peer_id: 'peer', retired_at: retiredAt }];
      }
    }),
    watchdog: fake<Watchdog>({
      settlements: () => [
        {
          id: 'previous',
          absent: true,
          acknowledge() {
            acknowledged = true;
          }
        }
      ],
      retirements: () => ['already-watched'],
      retire(...args) {
        retirements.push(args);
        return true;
      }
    })
  });
  t.after(() => recovery.stop());
  recovery.start();
  t.mock.timers.tick(1_000);
  assert.deepEqual(writes, [['previous', true]]);
  firstWrite.reject(new Error('PostgreSQL unavailable'));
  await setImmediate();
  assert.equal(acknowledged, false);
  assert.deepEqual(retirements, []);

  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.deepEqual(writes, [
    ['previous', true],
    ['previous', true]
  ]);
  assert.deepEqual(retirements, [
    [{ room: 'room', identity: nativeVoiceIdentity('peer', id) }, id, retiredAt.getTime()]
  ]);
});
