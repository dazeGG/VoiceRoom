// The report body accepts a room or direct message target, one of the known
// reasons and a bounded comment, and nothing else.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { REPORT_COMMENT_MAX_LENGTH, REPORT_REASONS, ReportBody } from '../src/contracts/reports.ts';

test('a report names its target, a known reason and at most a short comment', () => {
  const room = { kind: 'room_message', roomId: 'kitchen', messageId: 'm1' };
  for (const reason of REPORT_REASONS) assert.equal(Value.Check(ReportBody, { target: room, reason }), true);
  assert.equal(
    Value.Check(ReportBody, { target: { kind: 'direct_message', messageId: 'dm1' }, reason: 'abuse', comment: 'x' }),
    true
  );

  assert.equal(Value.Check(ReportBody, { target: room, reason: 'boring' }), false);
  assert.equal(Value.Check(ReportBody, { target: { kind: 'room_message', messageId: 'm1' }, reason: 'spam' }), false);
  assert.equal(
    Value.Check(ReportBody, { target: room, reason: 'spam', comment: 'x'.repeat(REPORT_COMMENT_MAX_LENGTH + 1) }),
    false
  );
});
