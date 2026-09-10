'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const metrics = require('../src/lib/metrics');
const { createMediaVisibilityService } = require('../src/domains/media/media-visibility-service');

test('release queue metrics exclude expected hidden 404s and count only invariant failures', async () => {
  metrics.resetMetricsForTest();
  metrics.recordNotificationOldestPending(901_000);
  metrics.recordMediaOldestPending(902_000);
  const service = createMediaVisibilityService({
    attachmentRepository: { async findById() { return { id: 'a', ownerId: 'owner', internalState: 'ready', deletedAt: null, boundAt: null }; } },
    storage: {}, onAuthorizationInvariantFailure: metrics.recordMediaAuthorizationInvariantFailure
  });
  await assert.rejects(service.requireVisible({ id: 'a', ownerId: 'owner', internalState: 'ready', deletedAt: null, boundAt: null }, 'intruder'));
  await assert.rejects(service.requireVisible({ id: 'a', ownerId: 'owner', internalState: 'ready', deletedAt: null, boundAt: new Date(), context: 'unknown' }, 'intruder'));
  metrics.recordCredentialRevokeCleanupFailure();
  const output = metrics.renderPrometheus();
  assert.match(output, /voice_room_notification_oldest_pending_seconds 901/);
  assert.match(output, /voice_room_media_oldest_pending_seconds 902/);
  assert.match(output, /voice_room_media_authorization_invariant_failures_total 1/);
  assert.match(output, /voice_room_credential_revoke_cleanup_failures_total 1/);
});
