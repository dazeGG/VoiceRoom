import test from 'node:test';
import assert from 'node:assert/strict';

import type { Preferences } from '@voice-room/shared/contracts/notifications';
import type { FriendList } from '@voice-room/shared/contracts/social';
import type { PresenceStatus } from '@voice-room/shared/contracts/users';
import {
  acceptFirstFriendRequest,
  registerAccount,
  request,
  sendFriendRequest,
  startApiServer
} from './fakes/server-process.ts';
import { openWs, waitForWsType, type WsSession } from './ws-harness.ts';

function openRealtimeStream(socketPath: string, cookie: string) {
  return openWs(socketPath, { cookie });
}

test('realtime ready reports online friends and fans out presence', async (t) => {
  const { socketPath } = await startApiServer(t, { prefix: 'voice-room-realtime-', env: { AUTH_RATE_LIMIT: '0' } });

  const aliceCookie = await registerAccount(socketPath, 'alice');
  const bobCookie = await registerAccount(socketPath, 'bob');

  await sendFriendRequest(socketPath, aliceCookie, 'bob');
  await acceptFirstFriendRequest(socketPath, bobCookie);

  const bobFriends = await request<FriendList>(socketPath, { pathname: '/api/friends', cookie: bobCookie });
  const aliceFriends = await request<FriendList>(socketPath, { pathname: '/api/friends', cookie: aliceCookie });
  const aliceId = bobFriends.body.friends.find((entry) => entry.user.login === 'alice')?.user.id;
  const bobId = aliceFriends.body.friends.find((entry) => entry.user.login === 'bob')?.user.id;
  assert.ok(aliceId);
  assert.ok(bobId);

  const bobStream = openRealtimeStream(socketPath, bobCookie);
  const bobReady = await bobStream.ready;
  assert.ok(Array.isArray(bobReady.payload.onlineFriendIds));
  assert.equal(bobReady.payload.onlineFriendIds.length, 0);

  const aliceStream = openRealtimeStream(socketPath, aliceCookie);
  const aliceReady = await aliceStream.ready;
  assert.deepEqual(aliceReady.payload.onlineFriendIds, [bobId]);

  const bobPresence = await waitForWsType(
    bobStream.frames,
    'friend.presence',
    (frame) => frame.payload.userId === aliceId && frame.payload.online
  );
  assert.equal(bobPresence.payload.online, true);

  const friendsForBob = await request<FriendList>(socketPath, { pathname: '/api/friends', cookie: bobCookie });
  assert.equal(friendsForBob.status, 200);
  const aliceEntry = friendsForBob.body.friends.find((entry) => entry.user.login === 'alice');
  assert.ok(aliceEntry);
  assert.equal(aliceEntry.online, true);
});

test('manual presence status updates own tabs, friend profiles, and effective online state', async (t) => {
  const { socketPath } = await startApiServer(t, { prefix: 'voice-room-realtime-', env: { AUTH_RATE_LIMIT: '0' } });

  const aliceCookie = await registerAccount(socketPath, 'alice-status');
  const bobCookie = await registerAccount(socketPath, 'bob-status');
  await sendFriendRequest(socketPath, aliceCookie, 'bob-status');
  await acceptFirstFriendRequest(socketPath, bobCookie);

  const bobFriends = await request<FriendList>(socketPath, { pathname: '/api/friends', cookie: bobCookie });
  const aliceId = bobFriends.body.friends.find((entry) => entry.user.login === 'alice-status')?.user.id;
  assert.ok(aliceId);

  const bobStream = openRealtimeStream(socketPath, bobCookie);
  await bobStream.ready;
  const aliceFirstTab = openRealtimeStream(socketPath, aliceCookie);
  await aliceFirstTab.ready;
  await waitForWsType(
    bobStream.frames,
    'friend.presence',
    (frame) => frame.payload.userId === aliceId && frame.payload.online === true
  );
  const aliceSecondTab = openRealtimeStream(socketPath, aliceCookie);
  await aliceSecondTab.ready;

  async function setPresenceAndVerify({
    status,
    doNotDisturb,
    online,
    presenceChanged
  }: {
    status: PresenceStatus;
    doNotDisturb: boolean;
    online: boolean;
    presenceChanged: boolean;
  }) {
    const firstTabBefore = aliceFirstTab.frames.length;
    const secondTabBefore = aliceSecondTab.frames.length;
    const bobBefore = bobStream.frames.length;
    const response = await request<Preferences>(socketPath, {
      method: 'POST',
      pathname: '/api/presence/status',
      cookie: aliceCookie,
      body: { status }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.preferences.presenceStatus, status);
    assert.equal(response.body.preferences.doNotDisturb, doNotDisturb);

    const ownUpdate = (stream: WsSession, sinceIndex: number) =>
      waitForWsType(
        stream.frames,
        'notification.settings.updated',
        (frame) =>
          frame.payload.preferences.presenceStatus === status &&
          frame.payload.preferences.doNotDisturb === doNotDisturb,
        5000,
        sinceIndex
      );
    const [firstUpdate, secondUpdate] = await Promise.all([
      ownUpdate(aliceFirstTab, firstTabBefore),
      ownUpdate(aliceSecondTab, secondTabBefore)
    ]);
    assert.deepEqual(firstUpdate.payload.preferences, response.body.preferences);
    assert.deepEqual(secondUpdate.payload.preferences, response.body.preferences);

    if (presenceChanged) {
      await waitForWsType(
        bobStream.frames,
        'friend.presence',
        (frame) => frame.payload.userId === aliceId && frame.payload.online === online,
        5000,
        bobBefore
      );
    }
    const profile = await waitForWsType(
      bobStream.frames,
      'friend.updated',
      (frame) => frame.payload.user.id === aliceId && frame.payload.user.presenceStatus === status,
      5000,
      bobBefore
    );
    assert.equal(profile.payload.user.doNotDisturb, doNotDisturb);

    const friends = await request<FriendList>(socketPath, { pathname: '/api/friends', cookie: bobCookie });
    assert.equal(friends.status, 200);
    const alice = friends.body.friends.find((entry) => entry.user.id === aliceId);
    assert.equal(alice?.online, online);
    assert.equal(alice?.user.presenceStatus, status);
    assert.equal(alice?.user.doNotDisturb, doNotDisturb);
    assert.equal(aliceFirstTab.ws.readyState, 1);
    assert.equal(aliceSecondTab.ws.readyState, 1);
  }

  await setPresenceAndVerify({ status: 'dnd', doNotDisturb: true, online: true, presenceChanged: false });
  await setPresenceAndVerify({ status: 'offline', doNotDisturb: false, online: false, presenceChanged: true });
  await setPresenceAndVerify({ status: 'away', doNotDisturb: false, online: true, presenceChanged: true });

  aliceFirstTab.ws.close();
  aliceSecondTab.ws.close();
  bobStream.ws.close();
});
