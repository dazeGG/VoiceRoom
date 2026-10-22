import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Me, SignedIn } from '@voice-room/shared/contracts/account';
import { Failure } from '@voice-room/shared/contracts/http';
import { Preferences } from '@voice-room/shared/contracts/notifications';
import { RoomCard, RoomCreated, RoomList, RoomUnbookmarked } from '@voice-room/shared/contracts/rooms';
import { cookieFrom, request, startApiServer } from './fakes/server-process.ts';

function startServer(t: TestContext) {
  return startApiServer(t, { prefix: 'voice-room-auth-', env: { AUTH_RATE_LIMIT: '0' } });
}

test('auth flow: register, session, owned rooms, logout', async (t) => {
  const { socketPath } = await startServer(t);

  // Register sets a session cookie and returns the public user.
  const registered = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login: 'Vovosh', displayName: 'Вова', password: 'password123', passwordConfirm: 'password123' }
    },
    SignedIn
  );
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.login, 'vovosh');
  assert.equal(registered.body.user.displayName, 'Вова');
  assert.equal('passwordHash' in registered.body.user, false);
  const cookie = cookieFrom(registered.setCookie);
  assert.match(cookie, /^vr_session=/);

  // /auth/me reflects the session.
  const me = await request(socketPath, { pathname: '/api/auth/me', cookie }, Me);
  assert.equal(me.status, 200);
  assert.equal(me.body.user?.login, 'vovosh');
  assert.ok(me.body.user?.avatarColorKey);
  assert.equal(me.body.user?.dnd, false);
  assert.equal(me.body.user?.doNotDisturb, false);
  assert.equal(me.body.user?.presenceStatus, 'online');

  const dnd = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/notifications/settings',
      body: { dnd: true },
      cookie
    },
    Preferences
  );
  assert.equal(dnd.status, 200);
  assert.equal(dnd.body.preferences.doNotDisturb, true);
  assert.equal(dnd.body.preferences.presenceStatus, 'dnd');
  const meWithDnd = await request(socketPath, { pathname: '/api/auth/me', cookie }, Me);
  assert.equal(meWithDnd.body.user?.dnd, true);
  assert.equal(meWithDnd.body.user?.doNotDisturb, true);
  assert.equal(meWithDnd.body.user?.presenceStatus, 'dnd');

  // Without the cookie there is no session.
  const anon = await request(socketPath, { pathname: '/api/auth/me' }, Me);
  assert.equal(anon.status, 200);
  assert.equal(anon.body.user, null);

  const malformedCookie = await request(socketPath, { pathname: '/api/auth/me', cookie: 'vr_session=%' }, Me);
  assert.equal(malformedCookie.status, 200);
  assert.equal(malformedCookie.body.user, null);

  // Static rooms cannot be created anonymously in v2.
  const anonStatic = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/rooms',
      body: { isStatic: true, name: 'анон' }
    },
    Failure
  );
  assert.equal(anonStatic.status, 401);

  // A static room created while authenticated is owned and listed back,
  // carrying the normalized name chosen at creation.
  const room = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/rooms',
      body: { isStatic: true, name: '  квартирник  ' },
      cookie
    },
    RoomCreated
  );
  assert.equal(room.status, 201);
  assert.equal(room.body.owned, true);
  assert.equal(room.body.name, 'квартирник');

  // Legacy visual fields from older clients are ignored while the name is kept.
  const fancyRoom = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/rooms',
      body: { isStatic: true, name: 'дейли', emoji: '🦄' },
      cookie
    },
    RoomCreated
  );
  assert.equal(fancyRoom.body.name, 'дейли');

  const thirdRoom = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/rooms',
      body: { isStatic: true, name: 'планёрка' },
      cookie
    },
    RoomCreated
  );
  assert.equal(thirdRoom.status, 201);
  assert.equal(thirdRoom.body.owned, true);

  const fourthRoom = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/rooms',
      body: { isStatic: true, name: 'лимит' },
      cookie
    },
    Failure
  );
  assert.equal(fourthRoom.status, 429);

  // A temporary room (no isStatic) stays ownerless even when authenticated.
  const tempRoom = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/rooms',
      body: { isStatic: false },
      cookie
    },
    RoomCreated
  );
  assert.equal(tempRoom.body.owned, false);

  const rooms = await request(socketPath, { pathname: '/api/auth/rooms', cookie }, RoomList);
  assert.equal(rooms.status, 200);
  // Both owned static rooms are listed; the temporary one is not.
  assert.deepEqual(
    new Set(rooms.body.rooms.map((entry) => entry.roomId)),
    new Set([room.body.roomId, fancyRoom.body.roomId, thirdRoom.body.roomId])
  );
  const listed = rooms.body.rooms.find((entry) => entry.roomId === room.body.roomId);
  assert.equal(listed?.name, 'квартирник');
  assert.equal(listed?.relationship, 'owner');

  // Adding an already owned room by code is idempotent and the lobby keeps the
  // stronger owner relationship instead of duplicating the row.
  const ownBookmark = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/rooms',
      body: { roomId: room.body.roomId },
      cookie
    },
    RoomCard
  );
  assert.equal(ownBookmark.status, 200);
  assert.equal(ownBookmark.body.room.relationship, 'owner');
  const afterOwnBookmark = await request(socketPath, { pathname: '/api/auth/rooms', cookie }, RoomList);
  assert.equal(afterOwnBookmark.body.rooms.filter((entry) => entry.roomId === room.body.roomId).length, 1);
  assert.equal(afterOwnBookmark.body.rooms.find((entry) => entry.roomId === room.body.roomId)?.relationship, 'owner');

  const secondUser = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login: 'listener', password: 'password123' }
    },
    SignedIn
  );
  assert.equal(secondUser.status, 201);
  const secondCookie = cookieFrom(secondUser.setCookie);

  const bookmarked = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/rooms',
      body: { code: room.body.roomId },
      cookie: secondCookie
    },
    RoomCard
  );
  assert.equal(bookmarked.status, 200);
  assert.equal(bookmarked.body.room.relationship, 'bookmarked');
  const bookmarkedAgain = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/rooms',
      body: { code: room.body.roomId },
      cookie: secondCookie
    },
    RoomCard
  );
  assert.equal(bookmarkedAgain.status, 200);
  assert.equal(bookmarkedAgain.body.room.roomId, room.body.roomId);

  const secondRooms = await request(socketPath, { pathname: '/api/auth/rooms', cookie: secondCookie }, RoomList);
  assert.deepEqual(
    secondRooms.body.rooms.map((entry) => [entry.roomId, entry.relationship]),
    [[room.body.roomId, 'bookmarked']]
  );

  // Room unread state is a durable server cursor: reading three messages must
  // make the next message start a fresh count at one, not resume at four.
  for (const text of ['один', 'два', 'три']) {
    const sent = await request(socketPath, {
      method: 'POST',
      pathname: `/api/rooms/${room.body.roomId}/chat`,
      body: { text },
      cookie
    });
    assert.equal(sent.status, 201);
  }
  const unreadBeforeRead = await request(socketPath, { pathname: '/api/auth/rooms', cookie: secondCookie }, RoomList);
  assert.equal(unreadBeforeRead.body.rooms[0]?.unreadCount, 3);

  const markedRead = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${room.body.roomId}/read`,
    cookie: secondCookie
  });
  assert.equal(markedRead.status, 200, JSON.stringify(markedRead.body));
  const unreadAfterRead = await request(socketPath, { pathname: '/api/auth/rooms', cookie: secondCookie }, RoomList);
  assert.equal(unreadAfterRead.body.rooms[0]?.unreadCount, 0);

  const nextMessage = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${room.body.roomId}/chat`,
    body: { text: 'четыре' },
    cookie
  });
  assert.equal(nextMessage.status, 201);
  const unreadAfterNextMessage = await request(
    socketPath,
    {
      pathname: '/api/auth/rooms',
      cookie: secondCookie
    },
    RoomList
  );
  assert.equal(unreadAfterNextMessage.body.rooms[0]?.unreadCount, 1);

  const tempBookmark = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/rooms',
      body: { roomId: tempRoom.body.roomId },
      cookie: secondCookie
    },
    Failure
  );
  assert.equal(tempBookmark.status, 400);

  const ownerRemoval = await request(
    socketPath,
    {
      method: 'DELETE',
      pathname: `/api/auth/rooms/${room.body.roomId}`,
      cookie
    },
    Failure
  );
  assert.equal(ownerRemoval.status, 403);
  assert.equal(ownerRemoval.body.code, 'room_owner');

  const bookmarkRemoval = await request(
    socketPath,
    {
      method: 'DELETE',
      pathname: `/api/auth/rooms/${room.body.roomId}`,
      cookie: secondCookie
    },
    RoomUnbookmarked
  );
  assert.equal(bookmarkRemoval.status, 200);
  assert.equal(bookmarkRemoval.body.removed, true);
  const afterBookmarkRemoval = await request(
    socketPath,
    {
      pathname: '/api/auth/rooms',
      cookie: secondCookie
    },
    RoomList
  );
  assert.deepEqual(afterBookmarkRemoval.body.rooms, []);

  // Listing rooms requires a session.
  const roomsAnon = await request(socketPath, { pathname: '/api/auth/rooms' }, Failure);
  assert.equal(roomsAnon.status, 401);

  // Logout clears the cookie and invalidates the session.
  const loggedOut = await request(socketPath, { method: 'POST', pathname: '/api/auth/logout', cookie });
  assert.equal(loggedOut.status, 200);
  assert.match(cookieFrom(loggedOut.setCookie), /^vr_session=/);
  const afterLogout = await request(socketPath, { pathname: '/api/auth/me', cookie }, Me);
  assert.equal(afterLogout.body.user, null);
});

test('auth flow: validation, duplicate login, and wrong password', async (t) => {
  const { socketPath } = await startServer(t);

  const shortPassword = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login: 'ada', password: 'short' }
    },
    Failure
  );
  assert.equal(shortPassword.status, 400);

  const mismatch = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login: 'ada', password: 'password123', passwordConfirm: 'password124' }
    },
    Failure
  );
  assert.equal(mismatch.status, 400);

  const created = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login: 'ada', password: 'password123' }
    },
    SignedIn
  );
  assert.equal(created.status, 201);

  const duplicate = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login: 'ada', password: 'password123' }
    },
    Failure
  );
  assert.equal(duplicate.status, 409);

  const wrongPassword = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'ada', password: 'nope-nope-nope' }
    },
    Failure
  );
  assert.equal(wrongPassword.status, 401);

  const ok = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'ada', password: 'password123' }
    },
    SignedIn
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.login, 'ada');
});

test('account settings: rename and change password', async (t) => {
  const { socketPath } = await startServer(t);

  const registered = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login: 'vovosh', displayName: 'Вова', password: 'password123' }
    },
    SignedIn
  );
  assert.equal(registered.status, 201);
  const cookie = cookieFrom(registered.setCookie);

  // Profile and password changes require a session.
  const anonRename = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/profile',
    body: { displayName: 'нельзя' }
  });
  assert.equal(anonRename.status, 401);

  // Renaming returns the updated public user and is reflected by /auth/me.
  const renamed = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/profile',
      body: { displayName: '  Вовощ  ' },
      cookie
    },
    SignedIn
  );
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.user.displayName, 'Вовощ');
  assert.equal('passwordHash' in renamed.body.user, false);
  const me = await request(socketPath, { pathname: '/api/auth/me', cookie }, Me);
  assert.equal(me.body.user?.displayName, 'Вовощ');

  // A too-short new password is rejected before touching the stored hash.
  const tooShort = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/password',
    body: { currentPassword: 'password123', newPassword: 'short' },
    cookie
  });
  assert.equal(tooShort.status, 400);

  // A wrong current password is rejected.
  const wrongCurrent = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/password',
    body: { currentPassword: 'not-it-at-all', newPassword: 'brand-new-password' },
    cookie
  });
  assert.equal(wrongCurrent.status, 400);

  // The correct current password rotates the credential.
  const changed = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/password',
    body: { currentPassword: 'password123', newPassword: 'brand-new-password' },
    cookie
  });
  assert.equal(changed.status, 200);
  assert.match(String(changed.setCookie[0] || ''), /Max-Age=0/);

  // Password rotation revokes existing sessions, including the current cookie.
  const staleMe = await request(socketPath, { pathname: '/api/auth/me', cookie }, Me);
  assert.equal(staleMe.status, 200);
  assert.equal(staleMe.body.user, null);

  // The old password no longer logs in; the new one does.
  const oldLogin = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'vovosh', password: 'password123' }
    },
    Failure
  );
  assert.equal(oldLogin.status, 401);

  const newLogin = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'vovosh', password: 'brand-new-password' }
    },
    SignedIn
  );
  assert.equal(newLogin.status, 200);
});
