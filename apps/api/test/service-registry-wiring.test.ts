// What the registry wires between domains: each case builds the registry on
// fakes and follows one call across the seam it owns.

import test from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { createServiceRegistry, type ServiceRegistryDeps } from '../src/app/service-registry.ts';
import { fake, fakeDb } from './fakes/index.ts';

const CONFIG = {
  ROOM_IDLE_TTL_MS: 60_000,
  SESSION_TTL_MS: 60_000,
  GEOIP_DB_PATH: '',
  LIVEKIT_GATE_SECRET: 'gate-secret-for-tests-0123456789abcdef',
  LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS: 60,
  LIVEKIT_TOKEN_TTL_SECONDS: 60,
  MAX_ROOM_BANS: 10,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER: 5,
  LINK_PREVIEWS_ENABLED: false
};

function registryOnFakes(deps: Partial<ServiceRegistryDeps> = {}) {
  const registry = createServiceRegistry(CONFIG, fake<ServiceRegistryDeps>(deps));
  registry.applyOverrides({ pool: fakeDb() as unknown as pg.Pool });
  return registry;
}

// The account path maps only legacy account messages; a reaction event sent
// through it was dropped, so the other side of a DM never saw a reaction.
test('a DM reaction reaches both accounts as a reaction.updated event', async () => {
  const sent: [string, ServerEnvelope][] = [];
  const registry = registryOnFakes({
    sendToUser: (userId, envelope) => {
      sent.push([userId, envelope]);
      return userId === 'offline' ? 0 : 1;
    }
  });
  const summary = { emoji: '👍', count: 1, reactedByMe: true, revision: '1' };
  const published = await registry.getReactionServices()!.realtime.publish({
    actorUserId: 'ada',
    conversation: { type: 'dm', id: 'bob' },
    messageId: 'm1',
    summary
  });
  assert.equal(published, 2);
  assert.deepEqual(
    sent.map(([userId, envelope]) => [userId, envelope.type]),
    [
      ['ada', 'reaction.updated'],
      ['bob', 'reaction.updated']
    ]
  );
  assert.deepEqual((sent[1]?.[1] as { payload?: unknown } | undefined)?.payload, {
    conversation: { type: 'dm', id: 'bob' },
    messageId: 'm1',
    summary
  });

  const toOffline = await registry.getReactionServices()!.realtime.publish({
    actorUserId: 'ada',
    conversation: { type: 'dm', id: 'offline' },
    messageId: 'm1',
    summary
  });
  assert.equal(toOffline, 1, 'an account with no socket is not counted as reached');
});
