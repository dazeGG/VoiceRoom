// Deploy backups hold the data of deleted accounts, and the privacy policy
// promises they live no longer than 30 days: the prune script removes older
// dumps and .env copies from both backup folders and leaves everything else.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.join(import.meta.dirname, '../../../scripts/cd/prune-backups.sh');
const skip = spawnSync('bash', ['-c', 'find --version'], { encoding: 'utf8' }).status !== 0;
const DAY_MS = 24 * 60 * 60 * 1000;

function deployFolder(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-backups-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const place = (relative: string, ageDays: number) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    const at = new Date(Date.now() - ageDays * DAY_MS);
    fs.utimesSync(file, at, at);
  };
  const left = () =>
    ['ci', 'manual'].flatMap((dir) =>
      fs.existsSync(path.join(root, 'deploy-backups', dir))
        ? fs
            .readdirSync(path.join(root, 'deploy-backups', dir))
            .map((name) => `${dir}/${name}`)
            .sort()
        : []
    );
  return { root, place, left };
}

const run = (...args: string[]) => spawnSync('bash', [script, ...args], { encoding: 'utf8' });

test('backups older than the retention period are deleted, newer ones and other files stay', { skip }, (t) => {
  const { root, place, left } = deployFolder(t);
  place('deploy-backups/ci/db-old.dump', 31);
  place('deploy-backups/ci/env-old-pre-abc', 45);
  place('deploy-backups/ci/db-recent.dump', 29);
  place('deploy-backups/ci/.lock', 400);
  place('deploy-backups/manual/db-20260912-pre-chat-restore.dump', 60);
  place('deploy-backups/manual/env-recent', 1);
  place('deploy-backups/manual/notes.txt', 90);

  const result = run(root, '30');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(left(), ['ci/.lock', 'ci/db-recent.dump', 'manual/env-recent', 'manual/notes.txt']);
});

test('the retention period must be a positive whole number of days', { skip }, (t) => {
  const { root, place, left } = deployFolder(t);
  place('deploy-backups/ci/db-old.dump', 31);
  for (const days of ['0', 'thirty', '-5']) {
    const result = run(root, days);
    assert.notEqual(result.status, 0, `${days} must be refused`);
  }
  assert.deepEqual(left(), ['ci/db-old.dump']);
  assert.equal(run(path.join(root, 'missing')).status, 0, 'a host without backup folders is fine');
});
