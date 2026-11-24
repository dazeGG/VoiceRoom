import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import { DirectMessage, DirectMessageMetadata } from '../src/contracts/messages.ts';
import {
  CallActionBody,
  CallAnswer,
  CallBootstrap,
  CallMissedSeenBody,
  CallStartBody,
  type CallSnapshot,
  type DirectMessageCall
} from '../src/contracts/rings.ts';
import { buildNativePushData, nativePushChannel, parseNativePushData } from '../src/native-push.ts';
import { localizeNotificationPayload } from '../src/notification-text.ts';
import { parsePushPayload, type CallPushPayload } from '../src/notifications.ts';
import { parseServerFrame, validateClientCommand } from '../src/realtime.ts';

const callId = 'a3f9bdb7-2264-499a-928d-75e26606a817';
const clientRequestId = 'a3f9bdb7-2264-499a-928d-75e26606a818';
const caller = { id: 'caller', displayName: 'Alice', avatarColorKey: 'blue', avatarUrl: null, avatarAccent: null };
const recipient = { ...caller, id: 'recipient', displayName: 'Bob' };
const call: CallSnapshot = {
  id: callId,
  caller,
  recipient,
  attempt: 2,
  attemptInviterUserId: recipient.id,
  phase: 'ringing',
  attemptResult: 'pending',
  revision: 5,
  ringingExpiresAt: 56_000,
  aloneDeadline: 311_000,
  startedAt: 1_000,
  firstConnectedAt: 3_000,
  endedAt: null,
  durationMs: 3_000,
  endReason: null,
  endedByUserId: null,
  allowedActions: ['accept', 'decline'],
  serverNow: 12_000,
  messageId: 'message'
};
const incoming = {
  callId,
  fromUser: recipient,
  attempt: call.attempt,
  revision: call.revision,
  ringingExpiresAt: call.ringingExpiresAt,
  serverNow: call.serverNow
};
const watermark = { missedAt: 7000, messageId: 'older-call' };
const missed = { peerUserId: recipient.id, count: 1, watermark };

test('call HTTP contracts validate actions, attempts, dispositions and a seen-through watermark', () => {
  assert.ok(Value.Check(CallStartBody, { peerUserId: recipient.id, clientRequestId }));
  assert.equal(Value.Check(CallStartBody, { peerUserId: recipient.id, clientRequestId: 'invalid' }), false);
  for (const action of ['accept', 'decline', 'leave', 'join', 're-ring']) {
    assert.ok(Value.Check(CallActionBody, { action, clientRequestId, expectedAttempt: 2 }));
  }
  for (const body of [
    { action: 'cancel', clientRequestId, expectedAttempt: 2 },
    { action: 'accept', clientRequestId },
    { action: 'accept', clientRequestId, expectedAttempt: 0 },
    { action: 'accept', clientRequestId, expectedAttempt: 1.5 }
  ]) {
    assert.equal(Value.Check(CallActionBody, body), false);
  }
  assert.ok(Value.Check(CallAnswer, { ok: true, call, disposition: 'stale' }));
  assert.equal(
    Value.Check(CallAnswer, { ok: true, call: { ...call, phase: 'provisioning' }, disposition: 'start' }),
    false
  );
  assert.ok(
    Value.Check(CallBootstrap, {
      ok: true,
      enabled: true,
      activeCalls: [call],
      incoming: [incoming],
      missed: [missed],
      serverNow: call.serverNow
    })
  );
  assert.ok(Value.Check(CallMissedSeenBody, { watermark }));
  assert.equal(Value.Check(CallMissedSeenBody, { watermark: { missedAt: 7000 } }), false);
});

test('call events validate without changing legacy or unknown event handling', () => {
  const frames = [
    { type: 'call.incoming', payload: incoming },
    { type: 'call.state', payload: { call } },
    { type: 'call.missed.updated', payload: { ...missed, revision: 6, serverNow: 13_000 } },
    {
      type: 'ring.incoming',
      payload: { fromUser: { id: 'caller' }, room: { id: 'team', name: 'Team', emoji: '' }, expiresAt: 50 }
    }
  ];
  for (const frame of frames) assert.deepEqual(parseServerFrame(frame), { ok: true, frame });
  assert.equal(parseServerFrame({ type: 'call.incoming', payload: { ...incoming, attempt: 0 } }).ok, false);
  assert.deepEqual(parseServerFrame({ type: 'call.future', payload: {} }), {
    ok: false,
    type: 'call.future',
    reason: 'unknown event type'
  });
});

test('voice handoffs accept a fenced leave and a call-only socket command', () => {
  assert.ok(
    Value.Check(CallAnswer, {
      ok: true,
      call,
      disposition: 'accept',
      voiceAdmission: { roomId: 'call-room', peerId: 'call-seat', seatToken: clientRequestId }
    })
  );
  assert.ok(Value.Check(CallActionBody, { action: 'leave', clientRequestId, expectedAttempt: 2, seatToken: callId }));
  assert.ok(Value.Check(CallActionBody, { action: 'join', clientRequestId, expectedAttempt: 2, expectedRevision: 5 }));
  const command = { type: 'call.voice.join', payload: { callId, seatToken: clientRequestId } };
  assert.equal(validateClientCommand(command).ok, true);
  assert.equal(validateClientCommand({ ...command, payload: { callId, seatToken: 'invalid' } }).ok, false);
});

test('a call is an optional validated projection without changing room invitations', () => {
  const invite = { roomId: 'team', roomName: 'Team', status: 'pending', expiresAt: 12_000 };
  const projection: DirectMessageCall = {
    callId,
    revision: 1,
    outcome: 'no_answer',
    startedAt: 1_000,
    firstConnectedAt: null,
    endedAt: 46_000,
    durationMs: 0,
    endReason: 'no_answer',
    endedByUserId: null,
    missedAt: 46_000,
    missedRevision: 1,
    missedSeenRevision: null
  };
  const message = {
    id: 'message',
    senderId: caller.id,
    recipientId: recipient.id,
    body: 'Call',
    createdAt: 1_000,
    editedAt: null,
    readAt: null
  };
  assert.ok(Value.Check(DirectMessage, { ...message, invite }));
  assert.ok(Value.Check(DirectMessage, { ...message, invite: null, call: projection }));
  assert.ok(Value.Check(DirectMessageMetadata, { kind: 'room-invite', ...invite }));
  assert.ok(Value.Check(DirectMessageMetadata, { kind: 'voice-call', call: projection }));
  assert.equal(
    Value.Check(DirectMessageMetadata, { kind: 'voice-call', call: { ...projection, outcome: 'pending' } }),
    false
  );
});

test('call pushes preserve the attempt and revision on web and native without changing legacy pushes', () => {
  const payload: Omit<CallPushPayload, 'type'> = {
    contractVersion: 1,
    callId,
    attempt: 2,
    revision: 5,
    expiresAt: 56_000,
    tag: `call:${callId}:2`,
    dedupeKey: `call:${callId}:2:5`,
    url: `/?call=${callId}`,
    title: 'Incoming call',
    body: 'Alice is calling you'
  };
  for (const type of ['call.incoming', 'call.state', 'call.missed'] as const) {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(parsePushPayload({ ...payload, type })).filter(([, value]) => value !== undefined)
      ),
      { ...payload, type }
    );
    assert.equal(nativePushChannel(type), null);
    const native = buildNativePushData({ ...payload, type }, { roomId: 'private-room', fromUserId: 'private-user' });
    assert.equal(native.callId, callId);
    assert.equal(native.attempt, '2');
    assert.equal(native.revision, '5');
    assert.equal(native.contractVersion, '1');
    assert.equal(native.roomId, undefined);
    assert.equal(native.fromUserId, undefined);
    assert.deepEqual(parseNativePushData(native), native);
  }
  assert.deepEqual(parsePushPayload({ ...payload, type: 'call.incoming', url: '//other.example' }), {});
  assert.deepEqual(parsePushPayload({ ...payload, type: 'call.missed', attempt: '2' }), {});
  assert.equal(parsePushPayload({ type: 'ring.state', route: '/?room=team', revision: 2 }).url, '/?room=team');
});

test('call notification copy supports every notification locale and an anonymous body', () => {
  const copy = {
    title: { key: 'callIncomingTitle' },
    body: { key: 'callIncomingBody', args: { actor: 'Alice' } },
    privateBody: { key: 'callPrivateBody', args: { actor: 'Alice' } }
  };
  for (const [locale, title, body, missedTitle] of [
    ['ru', 'Входящий звонок', 'Alice звонит вам', 'Пропущенный звонок'],
    ['en', 'Incoming call', 'Alice is calling you', 'Missed call'],
    ['fr', 'Appel entrant', 'Alice vous appelle', 'Appel manqué']
  ]) {
    assert.deepEqual(localizeNotificationPayload({ copy }, locale), { title, body });
    assert.deepEqual(
      localizeNotificationPayload(
        { copy: { title: { key: 'callMissedTitle' }, body: { key: 'callMissedBody', args: { actor: 'Alice' } } } },
        locale
      ),
      { title: missedTitle, body: 'Alice' }
    );
    const privatePush = parsePushPayload(localizeNotificationPayload({ copy, notificationPrivate: true }, locale));
    assert.ok(privatePush.body);
    assert.ok(!privatePush.body.includes('Alice'));
  }
});
