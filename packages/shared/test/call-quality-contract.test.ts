// What a call says about its network: an answer to "how was the call?" from a
// client of the last release still validates, the worst moments and the guest
// browser id are checked when sent, and a peer may report its network level,
// one of three, in its own patch, judged by thresholds the room, the client's
// report and the admin panel share.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { CallFeedbackBody } from '../src/contracts/feedback.ts';
import { validateClientCommand } from '../src/realtime.ts';
import { NETWORK_THRESHOLDS, networkLevelOf, networkLevelOfValue, worseNetworkLevel } from '../src/network-quality.ts';

const averagesOnly = {
  rttAvgMs: 37.5,
  inboundLossAvgPct: 0.1,
  outboundLossAvgPct: 0,
  jitterAvgMs: 6.4,
  reconnects: 2,
  transport: 'udp'
};

const body = (quality: object | null, extra: object = {}) => ({
  rating: 'bad',
  tags: ['poor_sound'],
  call: { roomId: 'etsfecnsxf', durationS: 11060, peers: 1, platform: 'browser', quality, ...extra }
});

test('an answer from an older client, with averages only and no guest id, still validates', () => {
  assert.equal(Value.Check(CallFeedbackBody, body(averagesOnly)), true);
  assert.equal(Value.Check(CallFeedbackBody, body(null)), true);
});

test('the worst moments, the computer and microphone drops are checked when sent', () => {
  const full = {
    ...averagesOnly,
    rttMaxMs: 1109,
    inboundLossMaxPct: 13.3,
    outboundLossMaxPct: null,
    jitterMaxMs: 20,
    cpuPressureMax: 'critical',
    cpuRelieved: true,
    micDrops: 3
  };
  assert.equal(Value.Check(CallFeedbackBody, body(full, { guestId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' })), true);
  assert.equal(Value.Check(CallFeedbackBody, body({ ...full, cpuPressureMax: 'melting' })), false);
  assert.equal(Value.Check(CallFeedbackBody, body({ ...full, micDrops: -1 })), false);
  assert.equal(Value.Check(CallFeedbackBody, body({ ...full, rttMaxMs: 1e9 })), false);
  assert.equal(Value.Check(CallFeedbackBody, body(full, { guestId: 'x'.repeat(65) })), false);
});

test('a peer reports its network as good, unstable or bad in its own patch', () => {
  const target = { roomId: 'etsfecnsxf', peerId: 'peer-12345678', sessionToken: 's'.repeat(32) };
  for (const network of ['good', 'unstable', 'bad']) {
    assert.equal(
      validateClientCommand({ type: 'room.peer.update', payload: { ...target, patch: { network } } }).ok,
      true
    );
  }
  assert.equal(
    validateClientCommand({ type: 'room.peer.update', payload: { ...target, patch: { network: 'awful' } } }).ok,
    false
  );
});

test('one set of thresholds: a number past unstable is unstable, past bad is bad, the worst one decides', () => {
  const { unstable, bad } = NETWORK_THRESHOLDS;
  assert.equal(networkLevelOfValue('rttMs', unstable.rttMs - 1), 'good');
  assert.equal(networkLevelOfValue('rttMs', unstable.rttMs), 'unstable');
  assert.equal(networkLevelOfValue('lossPct', bad.lossPct), 'bad');
  assert.equal(networkLevelOfValue('jitterMs', null), null);
  assert.ok(unstable.rttMs < bad.rttMs && unstable.lossPct < bad.lossPct && unstable.jitterMs < bad.jitterMs);

  assert.equal(networkLevelOf({ rttMs: 40, inboundLossPct: 0, outboundLossPct: 0, jitterMs: 5 }), 'good');
  assert.equal(networkLevelOf({ rttMs: 40, inboundLossPct: 7, outboundLossPct: null, jitterMs: 5 }), 'unstable');
  assert.equal(networkLevelOf({ rttMs: 40, inboundLossPct: 7, outboundLossPct: 12, jitterMs: 45 }), 'bad');
  assert.equal(networkLevelOf({ rttMs: null, inboundLossPct: null, outboundLossPct: null, jitterMs: null }), null);
  assert.equal(worseNetworkLevel(null, 'good'), 'good');
  assert.equal(worseNetworkLevel('bad', 'unstable'), 'bad');
});
