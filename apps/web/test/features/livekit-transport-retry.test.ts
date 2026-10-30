// Which LiveKit token failures a fresh replacement tries again, and what the log shows for them.

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ApiError } from '@/api/client.ts';
import { isRetryableLiveKitApiFailure, safeLiveKitCode } from '@/features/room/client/services/livekit/transport.ts';

test('a token request that got no answer is retried and logged as unavailable', () => {
  const unanswered = new ApiError('Сервер недоступен', 0, { code: 'unavailable' });
  assert.equal(isRetryableLiveKitApiFailure(unanswered), true);
  assert.equal(safeLiveKitCode(unanswered.code), 'unavailable');
});

test('a refused join stays final and an unknown 4xx is not retried', () => {
  assert.equal(isRetryableLiveKitApiFailure(new ApiError('', 403, { code: 'invalid_session' })), false);
  assert.equal(isRetryableLiveKitApiFailure(new ApiError('', 418, {})), false);
  assert.equal(isRetryableLiveKitApiFailure(new ApiError('', 503, {})), true);
});
