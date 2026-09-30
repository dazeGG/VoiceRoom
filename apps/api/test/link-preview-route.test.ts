import { socketPathForDirectory } from './ipc-harness.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './db-harness.ts';
import { waitForHealthz } from './fakes/server-process.ts';

const KEY = `lp_${'ef'.repeat(16)}.webp`;
const ORPHAN_KEY = `lp_${'12'.repeat(16)}.webp`;

function get(
  socketPath: string,
  pathname: string
): Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get({ path: pathname, socketPath }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) })
        );
      })
      .on('error', reject);
  });
}

test('startup sweeps unused preview images, and stored ones are served by key and nothing else is', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-link-preview-route-'));
  const uploadsDir = path.join(dir, 'uploads');
  const previewsDir = path.join(uploadsDir, 'link-previews');
  fs.mkdirSync(previewsDir, { recursive: true });
  fs.writeFileSync(path.join(previewsDir, ORPHAN_KEY), Buffer.from('nobody uses this'));
  fs.writeFileSync(path.join(uploadsDir, 'secret.txt'), 'not for you');
  const socketPath = socketPathForDirectory(dir);
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const child = spawn(process.execPath, ['src/server.ts'], {
    cwd: path.join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      SOCKET_PATH: socketPath,
      UPLOADS_DIR: uploadsDir
    },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  t.after(async () => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  });
  await waitForHealthz(socketPath);

  // No message or cached preview refers to the orphan, so startup removed it.
  assert.equal(fs.existsSync(path.join(previewsDir, ORPHAN_KEY)), false);
  assert.equal(fs.existsSync(path.join(uploadsDir, 'secret.txt')), true, 'only preview images are swept');

  fs.writeFileSync(path.join(previewsDir, KEY), Buffer.from('webp-bytes'));
  const image = await get(socketPath, `/api/link-previews/${KEY}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/webp');
  assert.match(image.headers['cache-control'] ?? '', /immutable/);

  assert.equal(image.body.toString(), 'webp-bytes');

  for (const pathname of [
    `/api/link-previews/lp_${'00'.repeat(16)}.webp`,
    '/api/link-previews/secret.txt',
    '/api/link-previews/..%2Fsecret.txt'
  ]) {
    assert.equal((await get(socketPath, pathname)).status, 404, pathname);
  }
});
