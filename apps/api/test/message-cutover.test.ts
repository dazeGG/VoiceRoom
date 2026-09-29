import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readMessageDeliveryMode } from '../src/lib/config.ts';

test('G40-A01 delivery cutover is reversible and rejects duplicate-producing overlap', () => {
  assert.deepEqual(readMessageDeliveryMode({}), { claimEnabled: false, directEmitEnabled: true });
  assert.deepEqual(
    readMessageDeliveryMode({
      MESSAGE_DIRECT_EMIT_ENABLED: 'false',
      MESSAGE_DELIVERY_CLAIM_ENABLED: 'true'
    }),
    { claimEnabled: true, directEmitEnabled: false }
  );
  assert.deepEqual(
    readMessageDeliveryMode({
      MESSAGE_DIRECT_EMIT_ENABLED: 'false',
      MESSAGE_DELIVERY_CLAIM_ENABLED: 'false'
    }),
    { claimEnabled: false, directEmitEnabled: false }
  );
  assert.throws(
    () =>
      readMessageDeliveryMode({
        MESSAGE_DIRECT_EMIT_ENABLED: 'true',
        MESSAGE_DELIVERY_CLAIM_ENABLED: 'true'
      }),
    /cannot both be enabled/
  );
});

test('G40-A01 API and worker compose services receive the same cutover vector', () => {
  const compose = fs.readFileSync(path.resolve(import.meta.dirname, '../../../docker-compose.yml'), 'utf8');
  const apiBlock = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  message-delivery:'));
  const workerBlock = compose.slice(
    compose.indexOf('\n  message-delivery:'),
    compose.indexOf('\n  notification-delivery:')
  );
  for (const block of [apiBlock, workerBlock]) {
    assert.match(block, /MESSAGE_DIRECT_EMIT_ENABLED/);
    assert.match(block, /MESSAGE_DELIVERY_CLAIM_ENABLED/);
  }
});
