// A tab opened before a deploy keeps loading its own hashed chunks after it,
// so Caddy serves /_app/immutable/ from an archive that holds this release's
// chunks and those of earlier releases for a while.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const script = resolve(import.meta.dirname, '../../../config/caddy/archive-assets.sh');
const DAY = 24 * 60 * 60;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'web-archive-'));
  dirs.push(root);
  const build = join(root, 'build');
  const archive = join(root, 'archive');
  mkdirSync(join(build, 'chunks'), { recursive: true });
  return { build, archive };
}

function file(path: string, ageDays = 0) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'x');
  const time = Date.now() / 1000 - ageDays * DAY;
  utimesSync(path, time, time);
}

function archiveAssets(build: string, archive: string, days = 30) {
  const result = spawnSync('sh', [script, build, archive, String(days)], { encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
}

test("this release's chunks are copied next to the ones earlier releases left", () => {
  const { build, archive } = workspace();
  file(join(archive, 'chunks', 'old-release.js'), 3);
  file(join(build, 'chunks', 'this-release.js'));
  file(join(build, 'entry.css'));

  archiveAssets(build, archive);

  expect(existsSync(join(archive, 'chunks', 'this-release.js'))).toBe(true);
  expect(existsSync(join(archive, 'entry.css'))).toBe(true);
  expect(existsSync(join(archive, 'chunks', 'old-release.js'))).toBe(true);
});

test('chunks of releases older than the retention are dropped, with their empty folders', () => {
  const { build, archive } = workspace();
  file(join(archive, 'gone', 'ancient.js'), 45);
  file(join(build, 'chunks', 'this-release.js'));

  archiveAssets(build, archive, 30);

  expect(existsSync(join(archive, 'gone', 'ancient.js'))).toBe(false);
  expect(existsSync(join(archive, 'gone'))).toBe(false);
});

test('a release built longer ago than the retention still keeps its own chunks', () => {
  const { build, archive } = workspace();
  file(join(build, 'chunks', 'long-lived.js'), 60);

  archiveAssets(build, archive, 30);

  expect(existsSync(join(archive, 'chunks', 'long-lived.js'))).toBe(true);
});
