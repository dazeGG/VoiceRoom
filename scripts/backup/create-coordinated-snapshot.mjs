import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index]?.replace(/^--/, '')] = argv[index + 1];
  return values;
}

function sha256(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function filesBelow(root, current = root) {
  const result = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in uploads: ${absolute}`);
    if (stat.isDirectory()) result.push(...filesBelow(root, absolute));
    else if (stat.isFile()) result.push(path.relative(root, absolute).split(path.sep).join('/'));
    else throw new Error(`Unsupported upload entry: ${absolute}`);
  }
  return result.sort();
}

export function createCoordinatedSnapshot({ databaseDump, uploads, output, namespace }) {
  if (!databaseDump || !uploads || !output || !namespace) throw new Error('databaseDump, uploads, output and namespace are required');
  const db = fs.realpathSync(databaseDump);
  const media = fs.realpathSync(uploads);
  if (!fs.statSync(db).isFile() || !fs.statSync(media).isDirectory()) throw new Error('Snapshot sources must be a database dump file and uploads directory');
  const destination = path.resolve(output);
  if (fs.existsSync(destination)) throw new Error('Snapshot output already exists');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.snapshot-'));
  try {
    fs.copyFileSync(db, path.join(staging, 'database.dump'), fs.constants.COPYFILE_EXCL);
    const mediaOut = path.join(staging, 'uploads');
    fs.mkdirSync(mediaOut);
    const uploadsManifest = filesBelow(media);
    for (const relative of uploadsManifest) {
      const target = path.join(mediaOut, ...relative.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(media, ...relative.split('/')), target, fs.constants.COPYFILE_EXCL);
    }
    const manifest = {
      contract: 'voice-room.coordinated-media-snapshot/v1', namespace,
      createdAt: new Date().toISOString(),
      database: { path: 'database.dump', bytes: fs.statSync(path.join(staging, 'database.dump')).size, sha256: sha256(path.join(staging, 'database.dump')) },
      uploads: uploadsManifest.map((relative) => {
        const file = path.join(mediaOut, ...relative.split('/'));
        return { path: relative, bytes: fs.statSync(file).size, sha256: sha256(file) };
      }),
      leaseRecovery: 'reset-expired-leases-before-workers-start'
    };
    fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(staging, destination);
    return manifest;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = args(process.argv.slice(2));
    const manifest = createCoordinatedSnapshot({ databaseDump: input.database, uploads: input.uploads, output: input.output, namespace: input.namespace });
    process.stdout.write(`${JSON.stringify({ ok: true, namespace: manifest.namespace })}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
