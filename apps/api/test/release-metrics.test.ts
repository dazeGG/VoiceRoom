import assert from 'node:assert/strict';
import test from 'node:test';
import * as metrics from '../src/lib/metrics.ts';
import { createMediaVisibilityService } from '../src/domains/media/media-visibility-service.ts';
import type { MediaStorage } from '../src/domains/media/storage.ts';
import { attachment, fake } from './fakes/index.ts';

test('release queue metrics exclude expected hidden 404s and count only invariant failures', async () => {
  metrics.resetMetricsForTest();
  metrics.recordNotificationOldestPending(901_000);
  metrics.recordMediaOldestPending(902_000);
  const service = createMediaVisibilityService({
    attachmentRepository: {
      async findById() {
        return attachment({ id: 'a' });
      }
    },
    storage: fake<MediaStorage>(),
    onAuthorizationInvariantFailure: metrics.recordMediaAuthorizationInvariantFailure
  });
  await assert.rejects(service.requireVisible(attachment({ id: 'a' }), 'intruder'));
  await assert.rejects(
    // A bound row with a context the schema forbids: an invariant failure.
    service.requireVisible(attachment({ id: 'a', boundAt: new Date(), context: 'unknown' as never }), 'intruder')
  );
  metrics.recordCredentialRevokeCleanupFailure();
  const output = metrics.renderPrometheus();
  assert.match(output, /voice_room_notification_oldest_pending_seconds 901/);
  assert.match(output, /voice_room_media_oldest_pending_seconds 902/);
  assert.match(output, /voice_room_media_authorization_invariant_failures_total 1/);
  assert.match(output, /voice_room_credential_revoke_cleanup_failures_total 1/);
});
