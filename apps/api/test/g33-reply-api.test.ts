import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireReplyTarget } from '../src/domains/messaging/reply-projector.ts';

test('G33-A01 unavailable and invisible reply targets share one non-disclosing 409', async () => {
  for (const input of [
    { message: null, visibility: true },
    { message: { id: 'm', text: 'secret' }, visibility: false },
    { message: { id: 'm', deletedAt: Date.now() }, visibility: true }
  ]) {
    await assert.rejects(
      requireReplyTarget(input),
      (error: { code?: string; statusCode?: number; message?: string }) =>
        error.code === 'reply_target_unavailable' &&
        error.statusCode === 409 &&
        error.message === 'Reply target is unavailable'
    );
  }
});
