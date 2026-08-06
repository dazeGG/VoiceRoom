import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(fs.readFileSync('scripts/evidence/g19-physical-matrix.schema.json', 'utf8'));
const index = JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/index.json', 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateShape = ajv.compile(schema);
const REQUIRED_PLATFORMS = new Set(index.g19PhysicalMatrix.requiredPlatforms);
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const ARTIFACT_FIELDS = ['platform', 'os', 'client', 'capturedAt', 'expected', 'observed', 'zeroSideEffects', 'accessibility', 'notification', 'identity', 'reviewer'];

function digest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function comparableArtifact(row) {
  return Object.fromEntries(ARTIFACT_FIELDS.map((field) => [field, row[field]]));
}

export function verifyPhysicalMatrix(matrix, { resolveArtifact, now = Date.now(), buildCapturedAt = 0 } = {}) {
  if (!validateShape(matrix)) throw new Error(`G19 schema validation failed: ${ajv.errorsText(validateShape.errors)}`);
  if (typeof resolveArtifact !== 'function') throw new Error('G19 artifact resolver is required');
  const platforms = new Set(matrix.rows.map(({ platform }) => platform));
  if (platforms.size !== REQUIRED_PLATFORMS.size || [...REQUIRED_PLATFORMS].some((platform) => !platforms.has(platform))) {
    throw new Error('G19 requires the exact seven-platform physical matrix');
  }

  const artifactIds = new Set();
  const artifactDigests = new Set();
  const identities = new Set();
  for (const row of matrix.rows) {
    const capturedAt = Date.parse(row.capturedAt);
    if (!Number.isFinite(capturedAt) || capturedAt > now || now - capturedAt > MAX_AGE_MS || capturedAt < buildCapturedAt) {
      throw new Error(`G19 stale or invalid capture: ${row.platform}`);
    }
    if (row.reviewer.id === matrix.implementer.id) throw new Error(`G19 self-attested row: ${row.platform}`);
    const expected = row.platform.startsWith('ios-') || row.platform.startsWith('android-') || row.platform.startsWith('ipados-') ? 'blocked' : 'allowed';
    if (row.expected !== expected || row.observed !== expected || row.zeroSideEffects !== true) throw new Error(`G19 failed observation: ${row.platform}`);
    if (expected === 'blocked' && row.notification.shown !== false) throw new Error(`G19 mobile notification was shown: ${row.platform}`);
    if (row.platform === 'voiceroom-desktop' && !row.identity.desktopInstallIdHash) throw new Error('G19 Desktop install identity is required');

    const identity = `${row.identity.deviceIdHash}\0${row.identity.clientProfileIdHash}\0${row.identity.desktopInstallIdHash || ''}`;
    if (identities.has(identity)) throw new Error(`G19 duplicate device/client identity: ${row.platform}`);
    if (artifactIds.has(row.artifact.id)) throw new Error(`G19 reused artifact ID: ${row.artifact.id}`);
    if (artifactDigests.has(row.artifact.sha256)) throw new Error(`G19 reused artifact digest: ${row.artifact.sha256}`);
    identities.add(identity);
    artifactIds.add(row.artifact.id);
    artifactDigests.add(row.artifact.sha256);

    const bytes = resolveArtifact(row.artifact);
    if (!Buffer.isBuffer(bytes)) throw new Error(`G19 unresolved artifact: ${row.artifact.id}`);
    if (digest(bytes) !== row.artifact.sha256) throw new Error(`G19 tampered artifact: ${row.artifact.id}`);
    let artifact;
    try { artifact = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`G19 artifact is not JSON: ${row.artifact.id}`); }
    assert.deepEqual(artifact, comparableArtifact(row), `G19 artifact metadata mismatch: ${row.artifact.id}`);
  }
  return { release: matrix.release, gitSha: matrix.capturedFor.gitSha, platforms: [...platforms].sort(), verifiedAt: new Date(now).toISOString() };
}

function hash(character) {
  return `sha256:${character.repeat(64)}`;
}

function fixture() {
  const platforms = [...REQUIRED_PLATFORMS];
  const artifacts = new Map();
  const rows = platforms.map((platform, index) => {
    const blocked = /^(ios|android|ipados)-/.test(platform);
    const row = {
      platform,
      os: { name: blocked ? 'Physical mobile OS' : 'Physical desktop OS', version: `17.${index}` },
      client: { name: platform, version: `126.${index}` },
      capturedAt: `2026-08-05T1${index}:00:00.000Z`,
      expected: blocked ? 'blocked' : 'allowed',
      observed: blocked ? 'blocked' : 'allowed',
      zeroSideEffects: true,
      accessibility: { focus: 'pass', name: 'pass', layout: 'pass' },
      notification: { permission: blocked ? 'granted' : 'not-applicable', serviceWorker: blocked ? 'registered' : 'not-applicable', visibility: blocked ? 'background' : 'not-applicable', shown: false },
      identity: { deviceIdHash: hash(String(index + 1)), clientProfileIdHash: hash(String(index + 2)), desktopInstallIdHash: platform === 'voiceroom-desktop' ? hash('f') : null },
      reviewer: { id: `reviewer-${index}`, displayName: `Reviewer ${index}` }
    };
    const bytes = Buffer.from(JSON.stringify(comparableArtifact(row)));
    const artifact = { id: `g19/artifact/${index}`, uri: `https://evidence.example/g19/${index}`, sha256: digest(bytes), independentlyStored: true };
    artifacts.set(artifact.id, bytes);
    return { ...row, artifact };
  });
  return {
    matrix: { schemaVersion: 1, release: '2.5.0', capturedFor: { gitSha: 'a'.repeat(40), buildVersion: '2.5.0-rc.1' }, implementer: { id: 'implementer-1', displayName: 'Implementer' }, rows },
    artifacts
  };
}

function verify(candidate, artifacts) {
  return verifyPhysicalMatrix(candidate, { resolveArtifact: ({ id }) => artifacts.get(id), now: Date.parse('2026-08-06T12:00:00.000Z'), buildCapturedAt: Date.parse('2026-08-05T09:00:00.000Z') });
}

function clone(value) {
  return structuredClone(value);
}

test('G19-A01 accepts only a complete independently resolved physical matrix', () => {
  const { matrix, artifacts } = fixture();
  const result = verify(matrix, artifacts);
  assert.equal(result.gitSha, 'a'.repeat(40));
  assert.deepEqual(result.platforms, [...REQUIRED_PLATFORMS].sort());
});

test('G19-A02 fails closed on missing, duplicate, reused, tampered, stale, and self-attested rows', () => {
  const cases = [
    ['missing', (matrix) => matrix.rows.pop()],
    ['duplicate platform', (matrix) => { matrix.rows[6].platform = matrix.rows[5].platform; }],
    ['reused artifact', (matrix) => { matrix.rows[1].artifact = clone(matrix.rows[0].artifact); }],
    ['duplicate identity', (matrix) => { matrix.rows[1].identity = clone(matrix.rows[0].identity); }],
    ['stale', (matrix) => { matrix.rows[0].capturedAt = '2026-07-01T00:00:00.000Z'; }],
    ['future', (matrix) => { matrix.rows[0].capturedAt = '2026-08-07T00:00:00.000Z'; }],
    ['self-attested', (matrix) => { matrix.rows[0].reviewer = clone(matrix.implementer); }],
    ['failed result', (matrix) => { matrix.rows[0].observed = 'allowed'; }]
  ];
  for (const [name, mutate] of cases) {
    const { matrix, artifacts } = fixture();
    mutate(matrix);
    assert.throws(() => verify(matrix, artifacts), undefined, name);
  }

  const { matrix, artifacts } = fixture();
  artifacts.set(matrix.rows[0].artifact.id, Buffer.from('{}'));
  assert.throws(() => verify(matrix, artifacts), /tampered artifact/);
  assert.throws(() => verify(matrix, new Map()), /unresolved artifact/);
});

test('G19 remains explicitly blocked until external physical captures are indexed', () => {
  assert.equal(index.g19PhysicalMatrix.status, 'PENDING_EXTERNAL_PHYSICAL_CAPTURE');
  assert.equal(index.g19PhysicalMatrix.matrixArtifactId, null);
  assert.equal(index.g19PhysicalMatrix.verifiedAt, null);
  assert.deepEqual(new Set(index.g19PhysicalMatrix.requiredPlatforms), REQUIRED_PLATFORMS);
});
