// Product activity in memory: which day a moment belongs to, what kind of
// client a user agent is, the tracker that writes each account's day once,
// and the maintenance tick that raises the quarter hour's peaks.

import test from 'node:test';
import assert from 'node:assert/strict';

import { clientKind } from '@voice-room/shared/account-security';
import { activityDay, createActivityTracker } from '../src/domains/account/activity.service.ts';
import type { ActivityMark } from '../src/domains/account/activity.repository.ts';
import { createProductSampler, SNAPSHOT_BUCKET_MS } from '../src/domains/ops/product-snapshot.service.ts';
import type { ProductSnapshot } from '../src/domains/ops/product-snapshot.repository.ts';
import { recordingLogger } from './fakes/index.ts';

const DESKTOP_APP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 VoiceRoom/1.4.6 Chrome/138.0 Electron/37.0';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1';

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test('a day is the Moscow calendar day', () => {
  assert.equal(activityDay(Date.parse('2026-10-15T20:59:59Z')), '2026-10-15');
  assert.equal(activityDay(Date.parse('2026-10-15T21:00:00Z')), '2026-10-16', 'midnight in Moscow');
});

test('a user agent is the desktop app, a phone or a browser', () => {
  assert.equal(clientKind(DESKTOP_APP), 'desktop_app');
  assert.equal(clientKind(CHROME), 'browser');
  assert.equal(clientKind(ANDROID), 'mobile');
  assert.equal(clientKind(IPHONE), 'mobile');
  assert.equal(clientKind(''), null);
  assert.equal(clientKind(undefined), null);
});

function tracker({ fails = false, at = Date.parse('2026-10-15T12:00:00Z') } = {}) {
  const writes: ActivityMark[][] = [];
  const logger = recordingLogger();
  const clock = { at };
  const activity = createActivityTracker({
    repository: () => ({
      async recordActivity(marks: ActivityMark[]) {
        writes.push(marks);
        if (fails) throw new Error('db down');
      }
    }),
    logger: () => logger,
    now: () => clock.at
  });
  return { activity, writes, logger, clock };
}

test('an account is written once per day and client kind; an open socket adds nothing once it is marked', () => {
  const { activity, writes, clock } = tracker();
  activity.sawRequest('ada', CHROME);
  activity.sawRequest('ada', CHROME);
  activity.sawRequest('ada', DESKTOP_APP);
  activity.sawConnected(['ada', 'grace', 'grace', '']);
  activity.sawConnected(['grace']);
  activity.sawRequest('', CHROME);
  assert.deepEqual(writes, [
    [{ userId: 'ada', day: '2026-10-15', client: 'browser' }],
    [{ userId: 'ada', day: '2026-10-15', client: 'desktop_app' }],
    [{ userId: 'grace', day: '2026-10-15', client: null }]
  ]);

  clock.at = Date.parse('2026-10-15T21:30:00Z');
  activity.sawConnected(['ada']);
  activity.sawRequest('ada', CHROME);
  assert.deepEqual(writes.slice(3), [
    [{ userId: 'ada', day: '2026-10-16', client: null }],
    [{ userId: 'ada', day: '2026-10-16', client: 'browser' }]
  ]);
});

test('a failed write is logged and tried again on the next request', async () => {
  const { activity, writes, logger } = tracker({ fails: true });
  activity.sawRequest('ada', CHROME);
  await settle();
  activity.sawRequest('ada', CHROME);
  await settle();
  assert.equal(writes.length, 2);
  assert.equal(logger.records.filter((record) => record.evt === 'account.activity_record_failed').length, 2);
});

test('without a database the tracker writes nothing', () => {
  const activity = createActivityTracker({ repository: () => null, logger: () => recordingLogger() });
  assert.doesNotThrow(() => {
    activity.sawRequest('ada', CHROME);
    activity.sawConnected(['ada']);
  });
});

test('a sample counts each account once, marks it active and raises its quarter hour', async () => {
  const peaks: ProductSnapshot[] = [];
  const connected: string[][] = [];
  const at = Date.parse('2026-10-15T12:07:30Z');
  const sampler = createProductSampler({
    live: () => ({ accountIds: ['ada', 'ada', 'grace'], guestConnections: 2, voicePeers: 3, voiceRooms: 1 }),
    snapshots: () => ({
      async recordPeaks(snapshot: ProductSnapshot) {
        peaks.push(snapshot);
      }
    }),
    activity: { sawConnected: (userIds) => connected.push([...userIds]) },
    now: () => at
  });
  await sampler.sample();
  assert.deepEqual(connected, [['ada', 'grace']]);
  assert.deepEqual(peaks, [
    {
      at: new Date('2026-10-15T12:00:00Z'),
      onlineAccounts: 2,
      guestConnections: 2,
      voicePeers: 3,
      voiceRooms: 1
    }
  ]);
  assert.equal(SNAPSHOT_BUCKET_MS, 15 * 60 * 1000);

  const offline = createProductSampler({
    live: () => ({ accountIds: [], guestConnections: 0, voicePeers: 0, voiceRooms: 0 }),
    snapshots: () => null,
    activity: { sawConnected: () => {} }
  });
  await assert.doesNotReject(offline.sample());
});
