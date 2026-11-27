import assert from 'node:assert/strict';
import test from 'node:test';
import fastify from 'fastify';
import { ConversationList } from '@voiceroom/shared/contracts/messages';
import type { ApiContext } from '../../../src/app/context.ts';
import { registerDirectMessageRoutes } from '../../../src/domains/messaging/direct-messages.routes.ts';
import {
  createDirectMessagesService,
  type DirectMessagesDeps
} from '../../../src/domains/messaging/direct-messages.service.ts';
import { createDmThreadRepository } from '../../../src/domains/messaging/dm-thread.repository.ts';
import { registerHttpKit } from '../../../src/platform/http/http-kit.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { fake, storedUser } from '../../fakes/index.ts';
import { checked } from '../../helpers/checked.ts';

test(
  'conversation list requires login and returns the latest visible activity and unread counts by pair',
  {
    skip: !process.env.TEST_DATABASE_URL
  },
  async (t) => {
    const { pool, cleanup } = await createTestDatabase(t);
    t.after(cleanup);
    await pool.query(`
    INSERT INTO users (id, login, display_name, password_hash, badge)
    VALUES ('a', 'ada', 'Ada', 'x', NULL), ('b', 'ben', 'Ben', 'x', 'verified'), ('c', 'clea', 'Clea', 'x', NULL),
      ('d', 'dan', 'Dan', 'x', NULL), ('e', 'eve', 'Eve', 'x', NULL), ('f', 'fay', 'Fay', 'x', NULL);
    INSERT INTO friendships (id, user_a_id, user_b_id)
    VALUES ('ab', 'a', 'b'), ('ac', 'a', 'c'), ('ae', 'a', 'e'), ('af', 'a', 'f');
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('e', 'a');
    INSERT INTO notification_dm_mutes (id, user_id, peer_user_id) VALUES ('mute', 'a', 'b');
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, metadata, created_at, read_at, deleted_at)
    VALUES
      ('m01', 'b', 'a', 'One', '{}', '2026-11-25T14:00Z', '2026-11-25T15:00Z', NULL),
      ('m02', 'b', 'a', 'Two', '{}', '2026-11-25T15:00Z', NULL, NULL),
      ('m03', 'a', 'b', 'Three', '{}', '2026-11-25T16:00Z', NULL, NULL),
      ('m04', 'c', 'a', 'Voice call', '{"kind":"voice-call"}', '2026-11-25T17:00Z', NULL, NULL),
      ('m05', 'b', 'a', 'Deleted', '{}', '2026-11-25T18:00Z', NULL, '2026-11-25T19:00Z'),
      ('m06', 'd', 'a', 'Former friend', '{}', '2026-11-25T20:00Z', NULL, NULL),
      ('m07', 'a', 'e', 'Blocked account', '{}', '2026-11-25T21:00Z', NULL, NULL),
      ('m08', 'f', 'a', '', '{}', '2026-11-25T22:00Z', NULL, NULL);
    INSERT INTO message_attachments (id, owner_id, context, state, mime_type, original_bytes, processed_bytes,
      preview_bytes, width, height, original_storage_key, processed_storage_key, preview_storage_key, ready_at,
      bound_at, direct_message_id, attachment_order)
    VALUES ('7f1c2d3e-4b5a-4c6d-8e9f-a0b1c2d3e4f5', 'f', 'dm', 'ready', 'image/jpeg', 10, 8, 4, 2, 2, 'photo/original',
      'photo/processed', 'photo/preview', now(), now(), 'm08', 0);
  `);

    const direct = createDmThreadRepository({ pool });
    const service = createDirectMessagesService(fake<DirectMessagesDeps>({ messages: () => ({ direct }) }));
    const app = fastify({ logger: false });
    t.after(() => app.close());
    registerHttpKit(app, {
      securityHeaders: () => ({}),
      recordRequest() {},
      logRequest() {},
      logHandlerFailure(_request, _route, error) {
        t.diagnostic(String(error));
      }
    });
    registerDirectMessageRoutes(
      app,
      fake<ApiContext>({
        resolveSession: async (request) =>
          request.headers.cookie === 'session=a' ? { user: storedUser({ id: 'a' }) } : null
      }),
      service
    );

    const url = '/api/dm/conversations';
    const rejected = await app.inject({ url });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.json<{ code: string }>().code, 'authentication_required');

    const fetchList = async () => {
      const response = await app.inject({ url, headers: { cookie: 'session=a' } });
      assert.equal(response.statusCode, 200, response.body);
      return checked(ConversationList, response.json<unknown>(), 'conversation list').conversations;
    };
    const rows = await fetchList();
    assert.deepEqual(
      rows.map(({ peer, lastMessage, unreadCount, muted, isFriend }) => ({
        id: peer.id,
        badge: peer.badge,
        lastMessage,
        unreadCount,
        muted,
        isFriend
      })),
      [
        {
          id: 'f',
          badge: null,
          lastMessage: { at: Date.parse('2026-11-25T22:00Z'), fromMe: false, kind: 'attachment', preview: '' },
          unreadCount: 1,
          muted: false,
          isFriend: true
        },
        {
          id: 'd',
          badge: null,
          lastMessage: { at: Date.parse('2026-11-25T20:00Z'), fromMe: false, kind: 'text', preview: 'Former friend' },
          unreadCount: 1,
          muted: false,
          isFriend: false
        },
        {
          id: 'c',
          badge: null,
          lastMessage: { at: Date.parse('2026-11-25T17:00Z'), fromMe: false, kind: 'call', preview: 'Voice call' },
          unreadCount: 1,
          muted: false,
          isFriend: true
        },
        {
          id: 'b',
          badge: 'verified',
          lastMessage: { at: Date.parse('2026-11-25T16:00Z'), fromMe: true, kind: 'text', preview: 'Three' },
          unreadCount: 1,
          muted: true,
          isFriend: true
        }
      ]
    );
    assert.deepEqual(
      (await direct.listConversations('a', 1)).map(({ peer }) => peer.id),
      ['f']
    );
    await direct.markRead({ userId: 'a', peerId: 'b' });
    assert.deepEqual(
      (await fetchList()).map(({ unreadCount }) => unreadCount),
      [1, 1, 1, 0]
    );
  }
);
