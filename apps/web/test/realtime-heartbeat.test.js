import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { RealtimeHeartbeatWatchdog } from '../src/lib/api/realtime-heartbeat.js';

test('heartbeat watchdog times out from the first unanswered ping', () => {
  let now = 1_000;
  const watchdog = new RealtimeHeartbeatWatchdog({
    timeoutMs: 30_000,
    now: () => now
  });

  assert.equal(watchdog.isTimedOut(), false);
  watchdog.recordPing();
  now += 15_000;
  watchdog.recordPing();
  assert.equal(watchdog.isTimedOut(), false);
  now += 15_000;
  assert.equal(watchdog.isTimedOut(), true);
});

test('pong clears the pending timeout and starts a fresh heartbeat epoch', () => {
  let now = 5_000;
  const watchdog = new RealtimeHeartbeatWatchdog({
    timeoutMs: 30_000,
    now: () => now
  });

  watchdog.recordPing();
  now += 29_999;
  watchdog.recordPong();
  assert.equal(watchdog.isTimedOut(), false);

  watchdog.recordPing();
  now += 30_000;
  assert.equal(watchdog.isTimedOut(), true);

  watchdog.reset();
  assert.equal(watchdog.isTimedOut(), false);
});

test('app realtime closes an unresponsive socket and ignores stale socket callbacks', () => {
  const source = fs.readFileSync(new URL('../src/lib/api/realtime.ts', import.meta.url), 'utf8');

  assert.match(source, /heartbeatWatchdog\.isTimedOut\(\)[\s\S]*socket\?\.close\(4000, 'heartbeat_timeout'\)/);
  assert.match(source, /parsed\?\.type === 'pong'\) this\.heartbeatWatchdog\.recordPong\(\)/);
  assert.match(source, /socket\.onclose = \((?:event\?: CloseEvent)?\) => \{\s*if \(this\.socket !== socket \|\| generation !== this\.openGeneration\) return;/);
});
