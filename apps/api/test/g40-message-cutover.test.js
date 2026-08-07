'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { readMessageDeliveryMode } = require('../src/lib/config');
const { createReadinessReport } = require('../src/platform/readiness');

test('G40-A01 delivery cutover is reversible and rejects duplicate-producing overlap', () => {
  assert.deepEqual(readMessageDeliveryMode({}), { claimEnabled: false, directEmitEnabled: true });
  assert.deepEqual(readMessageDeliveryMode({
    MESSAGE_DIRECT_EMIT_ENABLED: 'false',
    MESSAGE_DELIVERY_CLAIM_ENABLED: 'true'
  }), { claimEnabled: true, directEmitEnabled: false });
  assert.deepEqual(readMessageDeliveryMode({
    MESSAGE_DIRECT_EMIT_ENABLED: 'false',
    MESSAGE_DELIVERY_CLAIM_ENABLED: 'false'
  }), { claimEnabled: false, directEmitEnabled: false });
  assert.throws(() => readMessageDeliveryMode({
    MESSAGE_DIRECT_EMIT_ENABLED: 'true',
    MESSAGE_DELIVERY_CLAIM_ENABLED: 'true'
  }), /cannot both be enabled/);
});

test('G40-A01 API and worker compose services receive the same cutover vector', () => {
  const compose = fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8');
  const apiBlock = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  message-delivery:'));
  const workerBlock = compose.slice(compose.indexOf('\n  message-delivery:'), compose.indexOf('\n  notification-delivery:'));
  for (const block of [apiBlock, workerBlock]) {
    assert.match(block, /MESSAGE_DIRECT_EMIT_ENABLED/);
    assert.match(block, /MESSAGE_DELIVERY_CLAIM_ENABLED/);
  }
});

test('G40-A02 missing worker readiness keeps worker-dependent capability false', () => {
  const report = createReadinessReport(undefined, {
    desired: { engagement: true },
    binaryReady: ['shared.engagement.v1', 'api.engagement.v1', 'web.engagement.v1'],
    schemaReady: ['G52', 'G55', 'G56'],
    indexReady: ['G52', 'G56', 'G59'],
    configReady: ['notification.policy'],
    apiReady: ['G53', 'G57', 'G59', 'G61', 'G65'],
    webReady: ['G54', 'G58', 'G60', 'G62', 'G64', 'G66'],
    visibilityReady: ['G23'],
    workerReady: [],
    internalReady: [
      'internal.idempotentSend', 'internal.messageDelivery', 'internal.structuredContent',
      'internal.mentions', 'internal.notificationInbox', 'internal.notificationPolicies',
      'internal.unreadNavigation'
    ]
  });
  assert.equal(report.features.engagement, false);
});
