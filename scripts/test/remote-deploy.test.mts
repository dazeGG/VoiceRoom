import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const deployScript = path.resolve(import.meta.dirname, '../cd/remote-deploy.sh');
const linuxBash = process.platform === 'linux' && spawnSync('bash', ['-c', 'true']).status === 0;
const image = (target: string, tag: string) => `ghcr.io/dazegg/voiceroom-${target}:${tag}`;
const envOf = (tag: string) =>
  ['api', 'worker', 'web'].map((target) => `VOICEROOM_${target.toUpperCase()}_IMAGE=${image(target, tag)}`).join('\n') +
  '\n';

// A host with this stack and another VoiceRoom stack (prod and dev on one
// server). Docker and Git are fakes that record what the rollout asks of them.
function sharedHost(t: TestContext, inventoryFails = false, metadataFails = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-deploy-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const stack = path.join(root, 'dev');
  const other = path.join(root, 'prod');
  const removed = path.join(root, 'removed');
  const pruned = path.join(root, 'pruned');
  fs.mkdirSync(bin);
  fs.mkdirSync(stack);
  fs.writeFileSync(path.join(stack, '.env'), `POSTGRES_PASSWORD=x\n${envOf('dev-previous')}`);

  // The other stack runs `prod-current`; its newest backup holds the release
  // before it, an older backup one more.
  const otherBackups = path.join(other, 'deploy-backups/ci');
  fs.mkdirSync(otherBackups, { recursive: true });
  fs.writeFileSync(path.join(other, '.env'), envOf('prod-current'));
  fs.writeFileSync(path.join(otherBackups, 'env-older'), envOf('prod-older'));
  fs.writeFileSync(path.join(otherBackups, 'env-newest'), envOf('prod-previous'));
  fs.utimesSync(path.join(otherBackups, 'env-older'), new Date('2026-11-01'), new Date('2026-11-01'));
  fs.utimesSync(path.join(otherBackups, 'env-newest'), new Date('2026-11-10'), new Date('2026-11-10'));

  const images = ['dev-new', 'dev-previous', 'dev-older', 'prod-current', 'prod-previous', 'prod-older'].flatMap(
    (tag) => ['api', 'worker', 'web'].map((target) => image(target, tag))
  );
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/bash
case "$1 $2" in
  'compose exec')
    case "$*" in *psql*) echo legacy ;; *) echo 'database dump' ;; esac ;;
  'ps --all') ${inventoryFails ? 'exit 1' : `printf '%s\\n' ${JSON.stringify(stack)} ${JSON.stringify(other)} ${JSON.stringify(other)} ''`} ;;
  'image ls') printf '%s\\n' ${images.map((name) => JSON.stringify(name)).join(' ')} 'postgres:16-alpine' ;;
  'image inspect') echo '[{"Config":{"Labels":{}},"RepoDigests":[]}]' ;;
  'image rm') shift 2; printf '%s\\n' "$@" >> ${JSON.stringify(removed)} ;;
  'image prune') printf '%s\\n' "$*" >> ${JSON.stringify(pruned)} ;;
esac
exit 0
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(bin, 'git'),
    `#!/bin/bash
[ "$1" = rev-parse ] && echo previous-commit
if [ "$1" = show ]; then
case "$2" in
*widget-release-capabilities.py)
cat <<'MANIFEST_HELPER'
${fs.readFileSync(path.resolve(import.meta.dirname, '../cd/widget-release-capabilities.py'), 'utf8')}
MANIFEST_HELPER
;;
*)
cat <<'WIDGET_HELPER'
${fs.readFileSync(path.resolve(import.meta.dirname, '../cd/widget-boundary-preflight.py'), 'utf8')}
WIDGET_HELPER
;;
esac
fi
exit 0
`,
    {
      mode: 0o755
    }
  );
  if (metadataFails) {
    fs.writeFileSync(
      path.join(bin, 'grep'),
      `#!/bin/bash
for arg in "$@"; do
  [ "$arg" != ${JSON.stringify(path.join(other, '.env'))} ] || exit 2
done
exec /bin/grep "$@"
`,
      { mode: 0o755 }
    );
  }

  const run = () =>
    spawnSync(
      '/bin/bash',
      [deployScript, stack, 'new-commit', image('api', 'dev-new'), image('worker', 'dev-new'), image('web', 'dev-new')],
      { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }, encoding: 'utf8' }
    );
  const removedImages = () => (fs.existsSync(removed) ? fs.readFileSync(removed, 'utf8').trim().split('\n') : []);
  const pruneCommands = () => fs.readFileSync(pruned, 'utf8').trim().split('\n');
  return { run, removedImages, pruneCommands };
}

test(
  "a rollout keeps another stack's current and previous release images on a shared host",
  { skip: !linuxBash },
  (t) => {
    const host = sharedHost(t);
    const result = host.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^deployed new-commit$/m);
    assert.deepEqual(host.pruneCommands(), ['image prune -f --filter until=72h']);
    assert.deepEqual(
      host.removedImages().sort(),
      ['dev-older', 'prod-older'].flatMap((tag) => ['api', 'worker', 'web'].map((target) => image(target, tag))).sort()
    );
  }
);

test('a failed host inventory skips tagged-image cleanup', { skip: !linuxBash }, (t) => {
  const host = sharedHost(t, true);
  const result = host.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /skipping tagged-image cleanup/);
  assert.deepEqual(host.removedImages(), []);
  assert.deepEqual(host.pruneCommands(), ['image prune -f --filter until=72h']);
});

test('unreadable neighboring release metadata skips tagged-image cleanup', { skip: !linuxBash }, (t) => {
  const host = sharedHost(t, false, true);
  const result = host.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /skipping tagged-image cleanup/);
  assert.deepEqual(host.removedImages(), []);
});
