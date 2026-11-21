import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const root = path.resolve(import.meta.dirname, '../..');
const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

const ServiceSchema = Type.Object({
  image: Type.Optional(Type.String()),
  command: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  volumes: Type.Optional(Type.Array(Type.Object({ target: Type.String() }))),
  ports: Type.Optional(
    Type.Array(Type.Object({ published: Type.String(), target: Type.Number(), protocol: Type.String() }))
  ),
  networks: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  environment: Type.Optional(Type.Record(Type.String(), Type.String())),
  mem_limit: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  oom_score_adj: Type.Optional(Type.Number()),
  cpu_shares: Type.Optional(Type.Number()),
  cgroup_parent: Type.Optional(Type.String()),
  healthcheck: Type.Optional(Type.Object({ test: Type.Optional(Type.Array(Type.String())) }))
});
const ConfigSchema = Type.Object({
  services: Type.Record(Type.String(), ServiceSchema),
  networks: Type.Record(Type.String(), Type.Object({ name: Type.String(), external: Type.Optional(Type.Boolean()) }))
});
type Service = Static<typeof ServiceSchema>;
type Config = Static<typeof ConfigSchema>;

const required = {
  POSTGRES_PASSWORD: 'x',
  VOICEROOM_API_IMAGE: 'api',
  VOICEROOM_WEB_IMAGE: 'web',
  LIVEKIT_GATE_SECRET: 'gate',
  VOICE_ROOM_CURSOR_HMAC_KEYS: 'hmac',
  LIVEKIT_API_KEY: 'key',
  LIVEKIT_API_SECRET: 'secret',
  DOMAIN: 'dev.example.test'
};

// What Docker itself needs from the environment, without the values asserted here.
const hostEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(COMPOSE_|LIVEKIT_|TURN_|POSTGRES_|VOICEROOM_|DOMAIN$|ADMIN_DOMAIN$|EDGE_NETWORK$)/.test(key)
  )
);

function resolve(files: string[], env: Record<string, string> = {}): Config {
  // Only these values: a developer's own .env or shell must not leak in.
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-compose-')), '.env');
  fs.writeFileSync(envFile, '');
  const run = spawnSync(
    'docker',
    ['compose', '--env-file', envFile, ...files.flatMap((file) => ['-f', file]), 'config', '--format', 'json'],
    {
      cwd: root,
      env: { ...hostEnv, ...required, ...env },
      encoding: 'utf8'
    }
  );
  fs.rmSync(path.dirname(envFile), { recursive: true, force: true });
  assert.equal(run.status, 0, run.stderr);
  const config: unknown = JSON.parse(run.stdout);
  assert.ok(Value.Check(ConfigSchema, config), JSON.stringify([...Value.Errors(ConfigSchema, config)]));
  return config;
}

const published = (service: Service) =>
  (service.ports ?? []).map((port) => `${port.published}->${port.target}/${port.protocol}`);
const advertised = (service: Service) =>
  Object.fromEntries(
    [
      ...(service.environment?.LIVEKIT_CONFIG ?? '').matchAll(
        /^\s+(tcp_port|udp_port|relay_range_start|relay_range_end): (\d+)$/gm
      )
    ].map((match, index) => [`${match[1]}${index}`, Number(match[2])])
  );

test('production keeps its LiveKit ports when none are set', { skip: !compose }, () => {
  const livekit = resolve(['docker-compose.yml']).services.livekit;
  assert.ok(livekit);
  const ports = published(livekit);
  for (const port of ['7881->7881/tcp', '7882->7882/udp', '3478->3478/udp', '30000->30000/udp', '30099->30099/udp'])
    assert.ok(ports.includes(port), port);
  assert.equal(ports.length, 1 + 3 + 100);
  assert.deepEqual(Object.values(advertised(livekit)), [7881, 7882, 3478, 30000, 30099]);
});

test('a stack behind the edge publishes no web ports, joins the edge network and is capped', { skip: !compose }, () => {
  const config = resolve(['docker-compose.yml', 'docker-compose.behind-edge.yml'], {
    LIVEKIT_RTC_TCP_PORT: '7891',
    LIVEKIT_RTC_UDP_PORT: '7892',
    LIVEKIT_TURN_UDP_PORT: '3488',
    LIVEKIT_RELAY_PORT_FIRST: '30100',
    LIVEKIT_RELAY_PORT_LAST: '30101',
    LIVEKIT_METRICS_PORT: '6790'
  });
  const { caddy, livekit, api } = config.services;
  assert.ok(caddy?.environment && livekit && api?.environment);
  assert.deepEqual(caddy.ports ?? [], []);
  assert.deepEqual(Object.keys(caddy.networks ?? {}).sort(), ['default', 'edge']);
  assert.deepEqual(config.networks.edge, { name: 'voiceroom-edge', external: true, ipam: {} });
  assert.equal(caddy.environment.SITE_SCHEME, 'http://');
  assert.equal(caddy.environment.DOMAIN, 'dev.example.test');
  assert.equal(caddy.environment.ADMIN_DOMAIN, 'admin.dev.example.test');
  assert.equal(caddy.environment.LIVEKIT_DOMAIN, 'livekit.dev.example.test');
  // Browsers still reach it over HTTPS, through the host's Caddy.
  assert.equal(caddy.environment.LIVEKIT_GATE_PUBLIC_URL, 'wss://livekit.dev.example.test');
  assert.equal(api.environment.SITE_ORIGIN, 'https://dev.example.test');
  assert.ok(!caddy.volumes?.some(({ target }) => target === '/etc/caddy/Caddyfile'));
  assert.ok(caddy.volumes?.some(({ target }) => target === '/srv/static'));

  // LiveKit advertises exactly the ports the host publishes, none of production's.
  assert.deepEqual(published(livekit).sort(), [
    '30100->30100/udp',
    '30101->30101/udp',
    '3488->3488/udp',
    '6790->6790/tcp',
    '7891->7891/tcp',
    '7892->7892/udp'
  ]);
  assert.deepEqual(Object.values(advertised(livekit)), [7891, 7892, 3488, 30100, 30101]);

  for (const [name, service] of Object.entries(config.services)) {
    assert.ok(Number(service.mem_limit) > 0, `${name} has a memory limit`);
    assert.ok((service.oom_score_adj ?? 0) > 0, `${name} goes before production under OOM`);
    // Docker's default weight is 1024: production keeps it.
    assert.ok((service.cpu_shares ?? 1024) < 1024, `${name} yields the CPU to production`);
    assert.equal(service.cgroup_parent, 'guests.slice', `${name} shares the guests' caps`);
  }
});

test('production keeps the default CPU weight and cgroup', { skip: !compose }, () => {
  for (const [name, service] of Object.entries(resolve(['docker-compose.yml']).services)) {
    assert.equal(service.cpu_shares, undefined, name);
    assert.equal(service.cgroup_parent, undefined, name);
  }
});

// Each `node` start costs the host most of a second of CPU; the check runs every 10 s.
test('health checks of the production stack do not start Node', { skip: !compose }, () => {
  for (const [name, service] of Object.entries(resolve(['docker-compose.yml']).services)) {
    assert.doesNotMatch(service.healthcheck?.test?.join(' ') ?? '', /\bnode\b/, name);
  }
});

test('the production API image also supplies migrations, the gate and worker processes', { skip: !compose }, () => {
  const { services } = resolve(['docker-compose.yml']);
  for (const name of ['api', 'migrate', 'media-init', 'livekit-gate']) {
    assert.equal(services[name]?.image, 'api', name);
  }
  for (const name of [
    'message-delivery',
    'notification-delivery',
    'media-processing',
    'media-maintenance',
    'media-reconciliation'
  ]) {
    assert.equal(services[name]?.image, 'api', name);
    assert.deepEqual(services[name]?.command, ['node', 'apps/api/src/workers/main.ts'], name);
  }
  assert.equal(services.caddy?.image, 'web');
});
