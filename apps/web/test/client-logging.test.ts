import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(webRoot, 'src');
const read = (path: string) => readFileSync(join(webRoot, path), 'utf8');

const LOGGER_MODULE = 'src/lib/shared/log.ts';
const SOURCE_EXTENSIONS = ['.ts', '.js', '.svelte'];

function sourceFiles(directory = srcRoot, found: string[] = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(path);
  }
  return found;
}

// A stray console call is invisible in production: it reaches no buffer, so it
// is missing from the report sent when a call fails. The logger module is the
// one place allowed to touch the console.
test('application code logs through the shared logger instead of the console', () => {
  const offenders = sourceFiles()
    .filter((path) => relative(srcRoot, path).split('\\').join('/') !== 'lib/shared/log.ts')
    .filter((path) => /\bconsole\.(log|info|warn|error|debug)\s*\(/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(webRoot, path).split('\\').join('/'));

  assert.deepEqual(offenders, [], `these files still log to the console directly: ${offenders.join(', ')}`);
});

test('the logger buffers every level but keeps the production console quiet', () => {
  const log = read(LOGGER_MODULE);

  assert.match(log, /const BUFFER_LIMIT = \d+/);
  assert.match(log, /while \(buffer\.length > BUFFER_LIMIT\) buffer\.shift\(\)/);
  // Debug and info records are buffered for the report but must not reach a
  // production console.
  assert.match(log, /if \(isDev \|\| level === 'warn' \|\| level === 'error'\) \{/);
});

test('log reports are throttled, stop after the intake is refused, and never throw', () => {
  const log = read(LOGGER_MODULE);

  assert.match(log, /FLUSH_INTERVAL_MS/);
  assert.match(log, /if \(at - lastFlushAt < FLUSH_INTERVAL_MS\) return false/);
  assert.match(log, /if \(response\.status === 404\) intakeAvailable = false/);
  assert.match(log, /if \(!browser \|\| !intakeAvailable \|\| buffer\.length === 0\) return false/);
  // A failed report must never surface to the user or break the failing flow.
  assert.match(log, /\} catch \{/);
});

test('the report carries a per-page session id and no account identifier', () => {
  const log = read(LOGGER_MODULE);

  assert.match(log, /const sessionId = browser \? `web-/);
  assert.match(log, /body: JSON\.stringify\(\{ sessionId, events \}\)/);
  // The API attaches the account from the session cookie; the page never
  // claims an identity of its own.
  assert.doesNotMatch(log, /userId/);
});

test('the room installs global error capture and reports a failed start', () => {
  const main = read('src/lib/features/room/client/main.ts');

  assert.match(main, /installGlobalErrorCapture\(\)/);
  assert.match(main, /reportClientLogs\('room client failed to start'\)/);
});

test('a terminal recovery failure is raised and reported, ordinary transitions are not', () => {
  const recovery = read('src/lib/features/room/client/recovery/room-recovery.ts');

  assert.match(recovery, /if \(event\.phase === 'failed'\) \{/);
  assert.match(recovery, /log\.warn\('room recovery failed', context\)/);
  assert.match(recovery, /reportClientLogs\(`room recovery failed: \$\{context\.code\}`\)/);
  assert.match(recovery, /log\.debug\('room recovery transition', context\)/);
});

test('a failed API response records the request id the server logged it under', () => {
  const http = read('src/lib/api/http.ts');

  assert.match(http, /response\.headers\.get\('x-request-id'\)/);
  // Every helper that surfaces an error to the caller records it first.
  const guards = http.match(/logFailedResponse\(url, response\)/g) || [];
  assert.ok(guards.length >= 6, `expected every failing helper to record the response, saw ${guards.length}`);
});

test('the logger stays importable outside SvelteKit', () => {
  const log = read(LOGGER_MODULE);

  // A $app/environment import would break the platform modules that their unit
  // tests load natively under Node.
  assert.doesNotMatch(log, /^import .*\$app\/environment/m);
  assert.match(log, /typeof window !== 'undefined'/);
});

test('global capture covers uncaught errors and rejected promises', () => {
  const log = read(LOGGER_MODULE);

  assert.match(log, /window\.addEventListener\('error'/);
  assert.match(log, /window\.addEventListener\('unhandledrejection'/);
});
