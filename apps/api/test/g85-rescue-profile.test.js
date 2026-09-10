'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../..');
const fromRepositoryRoot = (...parts) => path.join(repositoryRoot, ...parts);
const profile = JSON.parse(fs.readFileSync(fromRepositoryRoot('config', 'rescue', 'expiry-aware-v2.5.0.json'), 'utf8'));

test('G85-A01 rescue profile is expiry-aware, read-compatible and write inert', () => {
  assert.equal(profile.contract, 'voice-room.expiry-aware-rescue/v1');
  assert.equal(profile.readCompatibility, '2.4.2');
  assert.equal(profile.requiresFullyUpgradedSchema, true);
  assert.deepEqual(profile.admission, { activeMembershipsOnly: true, expiryAwareBans: true });
  assert.equal(profile.newWritesEnabled, false);
  assert.equal(profile.workersEnabled, false);
  assert.ok(Object.keys(profile.capabilityDesired).length > 0);
  assert.ok(Object.values(profile.capabilityDesired).every((enabled) => enabled === false));
});

test('G85-A02 rescue sources contain no fabricated immutable evidence', () => {
  const workflow = fs.readFileSync(fromRepositoryRoot('.github', 'workflows', 'build-rescue.yml'), 'utf8');
  const documentation = fs.readFileSync(fromRepositoryRoot('docs', 'operations', 'EXPIRY_AWARE_RESCUE.md'), 'utf8');
  assert.match(workflow, /steps\.build\.outputs\.digest/);
  assert.doesNotMatch(`${JSON.stringify(profile)}\n${documentation}`, /sha256:[a-f0-9]{64}/);
});
