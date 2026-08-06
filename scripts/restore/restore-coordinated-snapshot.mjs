import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function args(argv) { const values = {}; for (let index = 0; index < argv.length; index += 2) values[argv[index]?.replace(/^--/, '')] = argv[index + 1]; return values; }
function sha256(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(root, target) { const relative = path.relative(root, target); return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); }
function assertRegular(file, label) { const stat = fs.lstatSync(file); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`); }

export function restoreCoordinatedSnapshot({ snapshot, target, allowedRoot, namespace }) {
  if (!snapshot || !target || !allowedRoot || !namespace) throw new Error('snapshot, target, allowedRoot and namespace are required');
  const source = fs.realpathSync(snapshot);
  const root = fs.realpathSync(allowedRoot);
  const destination = path.resolve(target);
  if (!inside(root, destination)) throw new Error('Restore target escapes the allowed root');
  if (fs.existsSync(destination)) throw new Error('Restore target must not exist');
  assertRegular(path.join(source, 'manifest.json'), 'Snapshot manifest');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.contract !== 'voice-room.coordinated-media-snapshot/v1' || manifest.namespace !== namespace) throw new Error('Snapshot namespace or contract mismatch');
  if (!manifest.database || !Array.isArray(manifest.uploads)) throw new Error('Snapshot DB/uploads pair is incomplete');
  const database = path.join(source, manifest.database.path || '');
  assertRegular(database, 'Database dump');
  if (sha256(database) !== manifest.database.sha256 || fs.statSync(database).size !== manifest.database.bytes) throw new Error('Database dump hash or size mismatch');
  for (const item of manifest.uploads) {
    if (!item?.path || path.isAbsolute(item.path) || item.path.split(/[\\/]/).includes('..')) throw new Error('Unsafe upload path in manifest');
    const file = path.join(source, 'uploads', ...item.path.split('/'));
    assertRegular(file, 'Upload');
    if (sha256(file) !== item.sha256 || fs.statSync(file).size !== item.bytes) throw new Error(`Upload hash or size mismatch: ${item.path}`);
  }
  const staging = fs.mkdtempSync(path.join(root, '.restore-'));
  try {
    fs.copyFileSync(database, path.join(staging, 'database.dump'), fs.constants.COPYFILE_EXCL);
    fs.mkdirSync(path.join(staging, 'uploads'));
    for (const item of manifest.uploads) {
      const output = path.join(staging, 'uploads', ...item.path.split('/'));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(path.join(source, 'uploads', ...item.path.split('/')), output, fs.constants.COPYFILE_EXCL);
    }
    const report = { contract: 'voice-room.coordinated-media-restore/v1', namespace, leaseRecoveryRequired: true, restoredAt: new Date().toISOString() };
    fs.writeFileSync(path.join(staging, 'restore-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    if (!inside(root, staging) || path.dirname(destination) !== root) throw new Error('Restore containment changed before commit');
    fs.renameSync(staging, destination);
    return report;
  } catch (error) {
    if (inside(root, staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const input = args(process.argv.slice(2)); const report = restoreCoordinatedSnapshot({ snapshot: input.snapshot, target: input.target, allowedRoot: input['allowed-root'], namespace: input.namespace }); process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
