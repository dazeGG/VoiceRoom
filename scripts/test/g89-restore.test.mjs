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
  const catalog = path.join(root, 'media-catalog.json');
  fs.writeFileSync(catalog, JSON.stringify({
    attachments: [{ id: 'attachment', state: 'ready', access: 'room', width: 640, height: 480 }],
    leases: [{ id: 'job', state: 'leased', leaseOwner: 'dead-worker', leaseExpiresAt: '2026-08-06T09:00:00.000Z' }]
  }));
  const snapshot = path.join(root, 'snapshot');
  createCoordinatedSnapshot({ databaseDump: database, uploads, catalog, output: snapshot, namespace: 'test-run' });
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
  assert.equal(report.leasesRecovered, 1);
  const catalog = JSON.parse(fs.readFileSync(path.join(target, 'media-catalog.json'), 'utf8'));
  assert.deepEqual(catalog.attachments[0], { id: 'attachment', state: 'ready', access: 'room', width: 640, height: 480 });
  assert.deepEqual(catalog.leases[0], { id: 'job', state: 'pending', leaseOwner: null, leaseExpiresAt: null });
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
  const catalog = path.join(root, 'catalog.json'); fs.writeFileSync(catalog, JSON.stringify({ attachments: [], leases: [] }));
  const outside = path.join(root, 'outside'); fs.writeFileSync(outside, 'secret');
  try { fs.symlinkSync(outside, path.join(uploads, 'link')); }
  catch { t.skip('symlink creation is unavailable'); return; }
  assert.throws(() => createCoordinatedSnapshot({ databaseDump: database, uploads, catalog, output: path.join(root, 'snapshot'), namespace: 'test-run' }), /Symlinks/);
});

test('G89-A04 restore rejects manifest escapes and symlinks in every source component', (t) => {
  const { allowedRoot, root, snapshot } = fixture(t);
  const manifestFile = path.join(snapshot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.database.path = '../source.dump';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => restoreCoordinatedSnapshot({ snapshot, target: path.join(allowedRoot, 'escape'), allowedRoot, namespace: 'test-run' }), /Unsafe Database dump/);
  manifest.database.path = 'database.dump'; fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  try { fs.symlinkSync(path.join(snapshot, 'uploads', 'objects'), path.join(snapshot, 'uploads', 'linked-objects'), 'junction'); }
  catch { t.skip('symlink creation is unavailable'); return; }
  manifest.uploads[0].path = 'linked-objects/asset.bin'; fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => restoreCoordinatedSnapshot({ snapshot, target: path.join(allowedRoot, 'linked'), allowedRoot, namespace: 'test-run' }), /symlink/);
});

test('G89-A05 snapshot output cannot overlap or pollute uploads and a safe sibling succeeds', (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-room-g89-output-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const uploads=path.join(root,'uploads');fs.mkdirSync(path.join(uploads,'objects'),{recursive:true});fs.writeFileSync(path.join(uploads,'objects','asset.bin'),'media');
  const database=path.join(root,'db.dump');fs.writeFileSync(database,'db');const catalog=path.join(root,'catalog.json');fs.writeFileSync(catalog,JSON.stringify({attachments:[],leases:[]}));
  const input={databaseDump:database,uploads,catalog,namespace:'test-run'};const before=fs.readdirSync(uploads,{recursive:true}).sort();
  for(const output of [uploads,path.join(uploads,'nested','snapshot'),root]) assert.throws(()=>createCoordinatedSnapshot({...input,output}),/must not overlap/);
  assert.deepEqual(fs.readdirSync(uploads,{recursive:true}).sort(),before);assert.equal(fs.readdirSync(uploads).some((name)=>name.startsWith('.snapshot-')),false);assert.equal(fs.existsSync(path.join(uploads,'nested')),false);
  const linkedParent=path.join(root,'linked-uploads');let linked=false;try{fs.symlinkSync(uploads,linkedParent,'junction');linked=true;}catch{}
  if(linked){assert.throws(()=>createCoordinatedSnapshot({...input,output:path.join(linkedParent,'snapshot')}),/contains a symlink/);assert.equal(fs.existsSync(path.join(uploads,'snapshot')),false);}
  const safe=path.join(root,'snapshots','safe');const manifest=createCoordinatedSnapshot({...input,output:safe});assert.equal(manifest.namespace,'test-run');assert.equal(fs.readFileSync(path.join(safe,'uploads','objects','asset.bin'),'utf8'),'media');
});
