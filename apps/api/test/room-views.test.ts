// What a room shows about a peer to everyone who previews or joins it: the
// screen share's metadata survives, the peer's secrets and address never leave.

import test from 'node:test';
import assert from 'node:assert/strict';

import { publicPeer, type PresencePeer } from '../src/domains/rooms/room-views.ts';

test('a sharing peer keeps its screen metadata; session token, IP and gate principal stay private', () => {
  const peer: PresencePeer = {
    id: 'peer-ada',
    accountUserId: 'ada',
    avatarAccent: '#4a7d5c',
    avatarColorKey: 'green',
    avatarUrl: null,
    name: 'Ада',
    screen: true,
    screenAudio: true,
    screenProfileId: 'motion-1080-60',
    screenStreamId: 'stream-1',
    viewedScreenPeerId: '',
    sessionToken: 'secret-token',
    ip: '203.0.113.7',
    gateGuestPrincipalId: 'guest-principal',
    transport: { id: 't1', send: () => true }
  };

  const shown = publicPeer(peer);

  assert.equal(shown.screen, true);
  assert.equal(shown.screenAudio, true);
  assert.equal(shown.screenProfileId, 'motion-1080-60');
  assert.equal(shown.screenStreamId, 'stream-1');
  for (const key of ['sessionToken', 'ip', 'gateGuestPrincipalId', 'transport']) {
    assert.equal(Object.hasOwn(shown, key), false, `${key} must not be shown`);
  }
});

test('a guest without an account is shown with an empty account id and a stable colour', () => {
  const first = publicPeer({ id: 'guest-1', name: 'Гость' });
  const again = publicPeer({ id: 'guest-1', name: 'Гость' });
  assert.equal(first.accountUserId, '');
  assert.equal(first.serverMuted, false);
  assert.ok(first.avatarColorKey);
  assert.equal(first.avatarColorKey, again.avatarColorKey);
});
