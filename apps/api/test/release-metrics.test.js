'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const metrics = require('../src/lib/metrics');
const { createMediaVisibilityService } = require('../src/domains/media/media-visibility-service');

test('release queue and authorization metrics match alert contracts', async () => {
  metrics.resetMetricsForTest();
  metrics.recordNotificationOldestPending(901_000);
  metrics.recordMediaOldestPending(902_000);
  const service = createMediaVisibilityService({
    attachmentRepository: { async findById() { return { id: 'a', ownerId: 'owner', internalState: 'ready', deletedAt: null, boundAt: null }; } },
    storage: {}, onAuthorizationDenial: metrics.recordMediaAuthorizationDenialFailure
  });
  await assert.rejects(service.requireVisible({ id: 'a', ownerId: 'owner', internalState: 'ready', deletedAt: null, boundAt: null }, 'intruder'));
  metrics.recordCredentialRevokeCleanupFailure();
  const output = metrics.renderPrometheus();
  assert.match(output, /voice_room_notification_oldest_pending_seconds 901/);
  assert.match(output, /voice_room_media_oldest_pending_seconds 902/);
  assert.match(output, /voice_room_media_authorization_denial_failures_total 1/);
  assert.match(output, /voice_room_credential_revoke_cleanup_failures_total 1/);
});
