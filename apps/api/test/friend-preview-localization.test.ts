import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import { FriendList } from '@voice-room/shared/contracts/social';
import { createFriendshipRepository } from '../src/domains/social/friendship.repository.ts';
import { registerFriendsRoutes } from '../src/domains/social/friends.routes.ts';
import type { FriendsService } from '../src/domains/social/friends.service.ts';
import type { ApiContext } from '../src/app/context.ts';
import { AJV_OPTIONS } from '../src/platform/http/http-kit.ts';
import { createTestDatabase } from './db-harness.ts';
import { checked } from './helpers/checked.ts';
import { fake, storedUser } from './fakes/index.ts';

test(
  'stored invitation previews retain typed metadata through friend HTTP serialization without changing user text',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await pool.query(
      "INSERT INTO users (id,login,password_hash) VALUES ('alice','alice','x'),('bob','bob','x'),('other','other','x')"
    );
    await pool.query("INSERT INTO friendships (id,user_a_id,user_b_id) VALUES ('friendship','alice','bob')");
    const invite = { roomId: 'old-room', roomName: 'Cuisine 🐈', status: 'accepted', expiresAt: null };
    const storedBody = 'Приглашение в комнату «Cuisine 🐈»';
    await pool.query(
      `INSERT INTO direct_messages (id,sender_id,recipient_id,body,metadata,created_at)
      VALUES ('old-invite','alice','bob',$1,$2,'2026-01-01T00:00:00Z'),
        ('outsider','other','alice','not a friend','{}','2026-01-03T00:00:00Z')`,
      [storedBody, JSON.stringify({ kind: 'room-invite', ...invite })]
    );
    await pool.query(`INSERT INTO direct_messages (id,sender_id,recipient_id,body,created_at,deleted_at)
      VALUES ('deleted','alice','bob','deleted preview','2026-01-02T00:00:00Z',now())`);
    const repository = createFriendshipRepository({ pool });
    const [aliceView, ...otherFriends] = await repository.listFriends('alice');
    assert.deepEqual(otherFriends, [], 'a newer message from a nonfriend does not expose that person');
    assert.equal(aliceView?.lastMessage?.id, 'old-invite', 'deleted messages remain excluded');
    assert.equal(aliceView?.lastMessage?.body, storedBody, 'stored body is not translated or rewritten');
    assert.equal(aliceView?.lastMessage?.fromMe, true);
    assert.deepEqual(aliceView?.lastMessage?.invite, invite);
    assert.equal((await repository.listFriends('bob'))[0]?.lastMessage?.fromMe, false);
    const app = fastify({ ajv: AJV_OPTIONS });
    t.after(() => app.close());
    registerFriendsRoutes(
      app,
      {
        logger: fake<ApiContext['logger']>(),
        clientIp: () => 'test',
        hashIp: (value) => value,
        resolveSession: async () => ({ user: storedUser({ id: 'alice' }) })
      },
      {
        friends: fake<FriendsService>({
          async list(userId) {
            return {
              friends: (await repository.listFriends(userId)).map((friend) => ({ ...friend, online: false })),
              incomingRequestCount: 0
            };
          }
        }),
        requestLimiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) }
      }
    );
    const invitationResponse = await app.inject({ method: 'GET', url: '/api/friends' });
    assert.equal(invitationResponse.statusCode, 200);
    const invitationBody: unknown = invitationResponse.json();
    assert.deepEqual(checked(FriendList, invitationBody).friends[0]?.lastMessage?.invite, invite);
    const userText = 'Приглашение в комнату «This is literal user text»';
    await pool.query(
      `INSERT INTO direct_messages (id,sender_id,recipient_id,body,metadata,created_at)
      VALUES ('normal','bob','alice',$1,$2,'2026-01-04T00:00:00Z')`,
      [userText, JSON.stringify({ roomId: 'not-an-invitation', roomName: 'not-an-invitation' })]
    );
    const normalResponse = await app.inject({ method: 'GET', url: '/api/friends' });
    assert.equal(normalResponse.statusCode, 200);
    const normalBody: unknown = normalResponse.json();
    const preview = checked(FriendList, normalBody).friends[0]?.lastMessage;
    assert.ok(preview);
    assert.equal(preview.body, userText);
    assert.equal(preview.fromMe, false);
    assert.equal(Object.hasOwn(preview, 'invite'), false, 'normal and legacy previews keep their existing shape');
    assert.deepEqual(Object.keys(preview).sort(), ['body', 'createdAt', 'fromMe', 'id']);
  }
);
