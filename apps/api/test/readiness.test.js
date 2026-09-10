'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createReadinessReport } = require('../src/platform/readiness');

test('media capabilities become ready when every declared prerequisite is ready', () => {
  const report = createReadinessReport('config/capability-dag.v1.json', {
    desired: {
      historyCursor: true,
      mediaRead: true,
      mediaUploads: true
    },
    binaryReady: [
      'api.history.v1',
      'web.history.v1',
      'api.mediaRead.v1',
      'web.mediaRead.v1',
      'api.mediaUpload.v1',
      'web.mediaUpload.v1'
    ],
    schemaReady: ['G24', 'G73'],
    indexReady: ['G24', 'G73', 'G76'],
    configReady: ['cursor.hmac', 'privateStorage.G74', 'mediaLimits.G75'],
    apiReady: ['G26', 'G27', 'G75', 'G76', 'G81', 'G82'],
    webReady: ['G28', 'G29', 'G83', 'G84'],
    visibilityReady: ['G23'],
    workerReady: [
      'media-processing.G77',
      'media-maintenance.G78',
      'media-reconciliation.G79',
      'media-pressure.G80'
    ],
    internalReady: ['internal.attachmentBinding']
  });

  assert.equal(report.features.historyCursor, true);
  assert.equal(report.features.mediaRead, true);
  assert.equal(report.features.mediaUploads, true);
});
