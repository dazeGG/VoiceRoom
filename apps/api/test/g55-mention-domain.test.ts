import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMentionUserIds } from '@voice-room/shared/mentions';
import { createMentionEligibilityService } from '../src/domains/notifications/mention-eligibility-service.ts';
import { fakeDb, result } from './fakes/index.ts';
test('G55-A01 mentions are unique, bounded and never self/everyone', () => {
  assert.deepEqual(normalizeMentionUserIds(['a', 'a', 'b'], { creatorUserId: 'c' }), { ok: true, userIds: ['a', 'b'] });
  assert.equal(normalizeMentionUserIds(['c'], { creatorUserId: 'c' }).ok, false);
  assert.deepEqual(normalizeMentionUserIds(['a', 'b', 'c', 'd', 'e', 'f']), { ok: false, code: 'too_many_mentions' });
});
test('G55-A02 creator and every target pass active membership and ban eligibility', async () => {
  const pool = fakeDb((text) => result(text.includes('rm.user_id FROM') ? [{ user_id: 'target' }] : [{}]));
  const queries = pool.calls;
  const service = createMentionEligibilityService({
    pool,
    activeBanService: {
      async filterEligibleUserIds({ userIds }) {
        return userIds;
      }
    }
  });
  assert.deepEqual(await service.validate({ roomId: 'r', creatorUserId: 'creator', targetUserIds: ['target'] }), [
    'target'
  ]);
  assert.equal(queries.length, 2);
});
