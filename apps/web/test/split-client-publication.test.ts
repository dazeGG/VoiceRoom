import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { dockerAvailable } from './helpers/caddy-edge.ts';

test(
  'legacy migration and client publications preserve sibling releases and recover the previous selection on a failed reload',
  {
    skip: !dockerAvailable,
    timeout: 60_000
  },
  () => {
    const repository = resolve(import.meta.dirname, '../../..');
    // Real Linux tar, flock and symlink semantics with a fake Compose target.
    // The Caddy tests exercise the actual edge separately.
    const scenario = String.raw`
set -euo pipefail
export HOME=/tmp/test-home PATH="/tmp/bin:$PATH"
mkdir -p "$HOME" /tmp/bin /tmp/stack /tmp/widget/embed/v1 /tmp/widget/widget/v1 \
  /tmp/widget/_app/immutable/widget /tmp/widget/rnnoise /tmp/admin/assets
cat >/tmp/bin/docker <<'DOCKER'
#!/bin/bash
case "$*" in
  'compose ps --quiet caddy') echo edge ;;
  'exec edge test -f /etc/caddy/empty-client-csp.caddy') test -z "$LEGACY_EDGE" ;;
  'cp edge:'*) cp -a "/tmp/legacy$(printf '%s' "$2" | cut -d: -f2-)" "$3" ;;
  'exec edge voiceroom-prepare-web reload')
    if grep -qs broken static/widget/current/embed/v1/index.html; then exit 1; fi ;;
  *) echo "unexpected Docker command: $*" >&2; exit 1 ;;
esac
DOCKER
cat >/tmp/bin/git <<'GIT'
#!/bin/bash
case "$1" in
  cat-file) exit 0 ;;
  show) cat "/repo/$(printf '%s' "$2" | cut -d: -f2-)" ;;
  *) exit 1 ;;
esac
GIT
chmod +x /tmp/bin/docker /tmp/bin/git
for file in audio-gate.worklet.js desktop-audio-source.worklet.js rnnoise/rnnoise.mjs rnnoise/rnnoise.wasm rnnoise/rnnoise.worklet.js; do
  echo "$file" > "/tmp/widget/$file"
done
printf 'widget v1' >/tmp/widget/embed/v1/index.html
printf 'loader v1' >/tmp/widget/widget/v1/loader.js
printf 'widget policy' >/tmp/widget/csp.caddy
printf 'old frame' >/tmp/widget/_app/immutable/widget/old.js
printf 'admin v1' >/tmp/admin/index.html
printf 'admin policy' >/tmp/admin/csp.caddy
printf 'admin asset' >/tmp/admin/assets/old.js

publish() {
  tar -C "/tmp/$1" -cf - . |
    bash /repo/scripts/cd/publish-client.sh /tmp/stack "$1" "$2"
}
version1=1111111111111111111111111111111111111111
version2=2222222222222222222222222222222222222222
version3=3333333333333333333333333333333333333333
mkdir -p /tmp/legacy/srv/archive/_app /tmp/legacy/etc/caddy
cp -a /tmp/widget /tmp/legacy/srv/web
cp -a /tmp/admin /tmp/legacy/srv/admin
cp -a /tmp/widget/_app/immutable /tmp/legacy/srv/archive/_app/
printf 'frozen dependency' >/tmp/legacy/srv/archive/_app/immutable/legacy-dep.js
mv /tmp/legacy/srv/web/csp.caddy /tmp/legacy/etc/caddy/widget-csp.caddy
mv /tmp/legacy/srv/admin/csp.caddy /tmp/legacy/etc/caddy/admin-csp.caddy
for component in widget admin; do
  LEGACY_EDGE=1 bash /repo/scripts/cd/publish-client.sh /tmp/stack "$component" "$version1" --seed-legacy "$version2"
done
cd /tmp/stack
admin_selection=$(readlink static/admin/current)
test "$(cat static/widget/current/csp.caddy)" = 'widget policy'
test "$(cat static/admin/current/csp.caddy)" = 'admin policy'
test -f static/widget/archive/_app/immutable/legacy-dep.js
printf 'widget v2' >/tmp/widget/embed/v1/index.html
mv /tmp/widget/_app/immutable/widget/old.js /tmp/widget/_app/immutable/widget/new.js
# The API checkout SHA used during seeding can match the first Widget tag.
publish widget "$version1"
test "$(cat static/widget/current/embed/v1/index.html)" = 'widget v2'
test -f static/widget/archive/_app/immutable/widget/old.js
test -f static/widget/archive/_app/immutable/widget/new.js
test "$(readlink static/admin/current)" = "$admin_selection"
test "$(cat static/admin/current/index.html)" = 'admin v1'
printf 'broken' >/tmp/widget/embed/v1/index.html
if publish widget "$version3"; then exit 1; fi
test "$(readlink static/widget/current)" = "releases/$version1"
test "$(cat static/widget/current/embed/v1/index.html)" = 'widget v2'
`;
    const result = spawnSync(
      'docker',
      ['run', '--rm', '-v', `${repository}:/repo:ro`, 'ubuntu:24.04', 'bash', '-c', scenario],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
);
