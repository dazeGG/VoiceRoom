import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCoordinatedSnapshot } from '../backup/create-coordinated-snapshot.mjs';
import { restoreCoordinatedSnapshot } from '../restore/restore-coordinated-snapshot.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-g89-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const uploads = path.join(root, 'source-uploads');
  fs.mkdirSync(path.join(uploads, 'objects'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'objects', 'asset.bin'), 'media');
  const database = path.join(root, 'source.dump');
  fs.writeFileSync(database, 'database');
  const snapshot = path.join(root, 'snapshot');
  createCoordinatedSnapshot({ databaseDump: database, uploads, output: snapshot, namespace: 'test-run' });
  const allowedRoot = path.join(root, 'isolated-restores');
  fs.mkdirSync(allowedRoot);
  return { allowedRoot, root, snapshot };
}

test('G89-A01 restores a verified DB/uploads pair into one isolated target', (t) => {
  const { allowedRoot, snapshot } = fixture(t);
  const target = path.join(allowedRoot, 'restored');
  const report = restoreCoordinatedSnapshot({ snapshot, target, allowedRoot, namespace: 'test-run' });
  assert.equal(fs.readFileSync(path.join(target, 'database.dump'), 'utf8'), 'database');
  assert.equal(fs.readFileSync(path.join(target, 'uploads', 'objects', 'asset.bin'), 'utf8'), 'media');
  assert.equal(report.leaseRecoveryRequired, true);
});

test('G89-A02 fails closed on partial, tampered, foreign or escaping restore input', (t) => {
  const { allowedRoot, root, snapshot } = fixture(t);
  assert.throws(() => restoreCoordinatedSnapshot({ snapshot, target: path.join(root, 'escape'), allowedRoot, namespace: 'test-run' }), /escapes/);
  assert.throws(() => restoreCoordinatedSnapshot({ snapshot, target: path.join(allowedRoot, 'foreign'), allowedRoot, namespace: 'other-run' }), /namespace/);
  fs.writeFileSync(path.join(snapshot, 'uploads', 'objects', 'asset.bin'), 'tampered');
  assert.throws(() => restoreCoordinatedSnapshot({ snapshot, target: path.join(allowedRoot, 'tampered'), allowedRoot, namespace: 'test-run' }), /hash or size/);
  fs.rmSync(path.join(snapshot, 'database.dump'));
  assert.throws(() => restoreCoordinatedSnapshot({ snapshot, target: path.join(allowedRoot, 'partial'), allowedRoot, namespace: 'test-run' }));
  assert.deepEqual(fs.readdirSync(allowedRoot), []);
});

test('G89-A03 snapshot creation rejects symlinked uploads where supported', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-g89-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const uploads = path.join(root, 'uploads'); fs.mkdirSync(uploads);
  const database = path.join(root, 'db.dump'); fs.writeFileSync(database, 'db');
  const outside = path.join(root, 'outside'); fs.writeFileSync(outside, 'secret');
  try { fs.symlinkSync(outside, path.join(uploads, 'link')); }
  catch { t.skip('symlink creation is unavailable'); return; }
  assert.throws(() => createCoordinatedSnapshot({ databaseDump: database, uploads, output: path.join(root, 'snapshot'), namespace: 'test-run' }), /Symlinks/);
});
