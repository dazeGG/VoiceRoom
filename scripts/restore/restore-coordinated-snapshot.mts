import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// By path, not package name: the script runs from a checkout without node_modules.
import { isArray, isRecord } from '../../packages/shared/src/guards.ts';

function args(argv: string[]) {
  const values: Record<string, string | undefined> = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index]?.replace(/^--/, '') ?? ''] = argv[index + 1];
  return values;
}
function sha256(file: string) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}
function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
function assertRegular(file: string, label: string) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
}
// The manifest and the catalog are JSON from disk: every field is read as
// unknown and checked before use.
/** A field of a JSON object; undefined for anything that is not one. */
function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}
function isSafeRelativePath(relative: unknown): relative is string {
  return (
    typeof relative === 'string' &&
    relative !== '' &&
    !path.isAbsolute(relative) &&
    !relative.split(/[\\/]/).includes('..')
  );
}
function isLeased(lease: unknown): lease is Record<string, unknown> {
  return isRecord(lease) && lease.state === 'leased';
}
function resolveSnapshotFile(root: string, relative: unknown, label: string) {
  if (!isSafeRelativePath(relative)) throw new Error(`Unsafe ${label} path in manifest`);
  let current = root;
  for (const component of relative.split(/[\\/]/)) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} path contains a symlink`);
  }
  const resolved = fs.realpathSync(current);
  if (!inside(root, resolved)) throw new Error(`${label} escapes snapshot root`);
  assertRegular(resolved, label);
  return resolved;
}

type RestoreOptions = {
  snapshot?: string | undefined;
  target?: string | undefined;
  allowedRoot?: string | undefined;
  namespace?: string | undefined;
};

export function restoreCoordinatedSnapshot({ snapshot, target, allowedRoot, namespace }: RestoreOptions) {
  if (!snapshot || !target || !allowedRoot || !namespace)
    throw new Error('snapshot, target, allowedRoot and namespace are required');
  if (fs.lstatSync(path.resolve(snapshot)).isSymbolicLink()) throw new Error('Snapshot root must not be a symlink');
  const source = fs.realpathSync(snapshot);
  const root = fs.realpathSync(allowedRoot);
  const destination = path.resolve(target);
  if (!inside(root, destination)) throw new Error('Restore target escapes the allowed root');
  if (fs.existsSync(destination)) throw new Error('Restore target must not exist');
  assertRegular(path.join(source, 'manifest.json'), 'Snapshot manifest');
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (
    !isRecord(manifest) ||
    manifest.contract !== 'voice-room.coordinated-media-snapshot/v1' ||
    manifest.namespace !== namespace
  )
    throw new Error('Snapshot namespace or contract mismatch');
  const { database: databaseEntry, catalog: catalogEntry, uploads } = manifest;
  if (!databaseEntry || !catalogEntry || !isArray(uploads))
    throw new Error('Snapshot DB/uploads/catalog set is incomplete');
  const database = resolveSnapshotFile(source, field(databaseEntry, 'path'), 'Database dump');
  const catalog = resolveSnapshotFile(source, field(catalogEntry, 'path'), 'Media catalog');
  if (
    sha256(database) !== field(databaseEntry, 'sha256') ||
    fs.statSync(database).size !== field(databaseEntry, 'bytes')
  )
    throw new Error('Database dump hash or size mismatch');
  if (sha256(catalog) !== field(catalogEntry, 'sha256') || fs.statSync(catalog).size !== field(catalogEntry, 'bytes'))
    throw new Error('Media catalog hash or size mismatch');
  const catalogValue: unknown = JSON.parse(fs.readFileSync(catalog, 'utf8'));
  if (!isRecord(catalogValue)) throw new Error('Invalid media catalog');
  const { attachments, leases } = catalogValue;
  if (!isArray(attachments) || !isArray(leases)) throw new Error('Invalid media catalog');
  const states = new Set<unknown>(['draft', 'uploaded', 'processing', 'ready', 'failed', 'deleted']);
  const access = new Set<unknown>(['room', 'dm', 'denied']);
  for (const attachment of attachments) {
    const width = field(attachment, 'width');
    const height = field(attachment, 'height');
    if (
      !field(attachment, 'id') ||
      !states.has(field(attachment, 'state')) ||
      !access.has(field(attachment, 'access')) ||
      typeof width !== 'number' ||
      !Number.isInteger(width) ||
      width < 1 ||
      typeof height !== 'number' ||
      !Number.isInteger(height) ||
      height < 1
    )
      throw new Error('Invalid attachment dimensions, state or access in media catalog');
  }
  const uploadPaths: string[] = [];
  for (const item of uploads) {
    const uploadPath = field(item, 'path');
    if (!isSafeRelativePath(uploadPath)) throw new Error('Unsafe Upload path in manifest');
    const file = resolveSnapshotFile(source, path.posix.join('uploads', uploadPath), 'Upload');
    if (sha256(file) !== field(item, 'sha256') || fs.statSync(file).size !== field(item, 'bytes'))
      throw new Error(`Upload hash or size mismatch: ${uploadPath}`);
    uploadPaths.push(uploadPath);
  }
  const staging = fs.mkdtempSync(path.join(root, '.restore-'));
  try {
    fs.copyFileSync(database, path.join(staging, 'database.dump'), fs.constants.COPYFILE_EXCL);
    const restoredCatalog = {
      ...catalogValue,
      leases: leases.map((lease) =>
        isLeased(lease) ? { ...lease, state: 'pending', leaseOwner: null, leaseExpiresAt: null } : lease
      )
    };
    fs.writeFileSync(path.join(staging, 'media-catalog.json'), `${JSON.stringify(restoredCatalog, null, 2)}\n`, {
      flag: 'wx'
    });
    fs.mkdirSync(path.join(staging, 'uploads'));
    for (const uploadPath of uploadPaths) {
      const output = path.join(staging, 'uploads', ...uploadPath.split('/'));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(
        resolveSnapshotFile(source, path.posix.join('uploads', uploadPath), 'Upload'),
        output,
        fs.constants.COPYFILE_EXCL
      );
    }
    const report = {
      contract: 'voice-room.coordinated-media-restore/v1',
      namespace,
      leasesRecovered: leases.filter(isLeased).length,
      restoredAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(staging, 'restore-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    if (!inside(root, staging) || path.dirname(destination) !== root)
      throw new Error('Restore containment changed before commit');
    fs.renameSync(staging, destination);
    return report;
  } catch (error) {
    if (inside(root, staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = args(process.argv.slice(2));
    const report = restoreCoordinatedSnapshot({
      snapshot: input.snapshot,
      target: input.target,
      allowedRoot: input['allowed-root'],
      namespace: input.namespace
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
