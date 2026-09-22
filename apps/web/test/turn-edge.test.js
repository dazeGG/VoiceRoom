import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8');

test('TURN/TLS shares :443 through Caddy layer4 and stays off unless enabled', () => {
  const caddyfile = read('Caddyfile');
  const options = read('config/caddy/turn.options');
  const site = read('config/caddy/turn.site');
  const entrypoint = read('config/caddy/entrypoint.sh');

  // Nothing TURN-related is active until the entrypoint copies the snippets.
  assert.match(caddyfile, /^\{\s*#[^\n]*\n[\s\S]*?import \/etc\/caddy\/turn\.d\/\*\.options\s*\}/);
  assert.match(caddyfile, /\nimport \/etc\/caddy\/turn\.d\/\*\.site\n/);
  assert.match(entrypoint, /if \[ "\$\{TURN_ENABLED:-false\}" = "true" \]/);
  assert.match(entrypoint, /TURN_ENABLED=true requires TURN_DOMAIN/);
  assert.match(entrypoint, /exec caddy run --config \/etc\/caddy\/Caddyfile --adapter caddyfile/);
  assert.doesNotMatch(entrypoint, /\r/, 'the entrypoint runs under /bin/sh and must keep LF line endings');

  // SNI for TURN_DOMAIN is terminated and proxied to LiveKit; the rest falls
  // through to the regular TLS wrapper and HTTP sites.
  assert.match(options, /layer4 \{\s*@turn tls sni \{\$TURN_DOMAIN\}\s*route @turn \{\s*tls\s*proxy livekit:5349\s*\}\s*\}\s*tls/);
  assert.match(site, /\{\$TURN_DOMAIN\} \{\s*respond 404\s*\}/);
});

test('the web image carries caddy-l4 and the TURN snippets', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /FROM caddy:2\.11\.4-builder-alpine AS caddy-build/);
  assert.match(dockerfile, /xcaddy build v2\.11\.4 --with github\.com\/mholt\/caddy-l4@v0\.1\.2/);
  assert.match(dockerfile, /COPY --from=caddy-build \/usr\/bin\/caddy \/usr\/bin\/caddy/);
  assert.match(dockerfile, /COPY config\/caddy\/turn\.options config\/caddy\/turn\.site \/etc\/caddy\/turn-available\//);
  assert.match(dockerfile, /CMD \["voiceroom-caddy"\]/);
});

test('LiveKit runs embedded TURN behind external TLS with published UDP and relay ports', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /turn:\n\s+enabled: \$\{TURN_ENABLED:-false\}\n\s+domain: "\$\{TURN_DOMAIN:-\}"\n\s+tls_port: 5349\n\s+udp_port: 3478\n\s+external_tls: true/);
  assert.match(compose, /relay_range_start: 30000\n\s+relay_range_end: 30099/);
  assert.match(compose, /- "3478:3478\/udp"/);
  assert.match(compose, /- "30000-30099:30000-30099\/udp"/);
  assert.match(compose, /max_participants: \$\{LIVEKIT_MAX_PARTICIPANTS:-24\}/);
  assert.match(compose, /TURN_ENABLED: \$\{TURN_ENABLED:-false\}\n\s+TURN_DOMAIN: \$\{TURN_DOMAIN:-\}/);
});

test('?forceRelay=1 forces relay-only ICE for verifying a TURN deployment', () => {
  const livekit = read('apps/web/src/lib/features/room/client/services/livekit-service.ts');
  assert.match(livekit, /get\('forceRelay'\) === '1'/);
  assert.match(livekit, /isForcedRelayDiagnostic\(\) \? \{ rtcConfig: \{ iceTransportPolicy: 'relay'/);
});
