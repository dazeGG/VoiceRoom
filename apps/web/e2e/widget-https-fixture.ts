import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultWidgetConfig, widgetEmbedMarkup } from '@voiceroom/shared/contracts/widget';
import { expect, type APIRequestContext } from '@playwright/test';

export const widgetOrigin = 'https://localhost:19443';
export const widgetParents = ['https://127.0.0.1:19444', 'https://127.0.0.1:19445'] as const;
export const widgetDist = path.resolve(import.meta.dirname, '../../widget/dist');
const ciCompose = path.resolve(import.meta.dirname, '../../../docker-compose.ci.yml');
const signalUrl = 'wss://localhost:19443';

export async function waitForWidgetHttps(request: APIRequestContext) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`${widgetOrigin}/widget/v1/loader.js`).catch(() => null);
        return response?.status();
      },
      { timeout: 15_000 }
    )
    .toBe(200);
}

function docker(args: string[]): string {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Docker fixture command failed');
  return result.stdout.trim();
}

function isolatedProject(): string {
  const project = process.env.PLAYWRIGHT_WIDGET_COMPOSE_PROJECT;
  if (!project || !/^[a-z0-9][a-z0-9_-]*$/.test(project) || project === 'voiceroom-g02-ci')
    throw new Error('Set PLAYWRIGHT_WIDGET_COMPOSE_PROJECT to an explicitly named, isolated CI Compose project');
  const compose = ['compose', '-p', project, '-f', ciCompose];
  for (const service of ['api', 'postgres']) {
    const container = docker([...compose, 'ps', '-q', service]);
    if (!container) throw new Error(`Missing ${service} in widget fixture Compose project`);
    const configs = docker([
      'inspect',
      '--format',
      '{{index .Config.Labels "com.docker.compose.project.config_files"}}',
      container
    ]);
    if (!configs.split(',').some((file) => path.basename(file) === 'docker-compose.ci.yml'))
      throw new Error('Widget fixture requires docker-compose.ci.yml');
  }
  const gate = docker([...compose, 'exec', '-T', 'api', 'printenv', 'LIVEKIT_GATE_PUBLIC_URL']);
  if (gate !== signalUrl) throw new Error(`Widget fixture requires LIVEKIT_GATE_PUBLIC_URL=${signalUrl}`);
  return project;
}

/** Loopback address that Compose published for a service port, such as `127.0.0.1:3000`. */
function publishedPort(compose: string[], service: string, port: number): string {
  const address = docker([...compose, 'port', service, String(port)]);
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error(`${service}:${port} must be published on 127.0.0.1`);
  return address;
}

/**
 * Local-only HTTPS parents and signaling proxy for the named CI Compose project.
 *
 * The proxy shares the host network and reaches the API and gate through their
 * loopback ports. A container on a bridge network adds a host interface, and
 * Chromium aborts in-flight loads with ERR_NETWORK_CHANGED when that interface
 * gets its address, which failed the first widget entry after each fixture start.
 */
export function startWidgetHttpsFixture() {
  const project = isolatedProject();
  const compose = ['compose', '-p', project, '-f', ciCompose];
  const api = publishedPort(compose, 'api', 3000);
  const gate = publishedPort(compose, 'livekit-gate', 3080);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'widget-https-'));
  const name = `widget-https-${process.pid}-${Date.now()}`;
  const host = (embed: string) =>
    `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Widget host</title><body>${embed}</body></html>`;
  writeFileSync(
    path.join(directory, 'host.html'),
    host(widgetEmbedMarkup({ ...defaultWidgetConfig, mode: 'floating', chat: true }, widgetOrigin))
  );
  writeFileSync(
    path.join(directory, 'multi.html'),
    host(
      widgetEmbedMarkup({ ...defaultWidgetConfig, mode: 'floating' }, widgetOrigin) +
        widgetEmbedMarkup({ ...defaultWidgetConfig, mode: 'inline', width: 440, camera: false }, widgetOrigin)
    )
  );
  writeFileSync(
    path.join(directory, 'Caddyfile'),
    `{
  admin off
  auto_https disable_redirects
  default_sni localhost
}
https://localhost:19443 {
  bind 127.0.0.1
  tls internal
  root * /srv/widget
  header X-Content-Type-Options nosniff
  handle /api/* {
    reverse_proxy ${api}
  }
  handle /rtc* {
    reverse_proxy ${gate}
  }
  handle /runtime-config.json {
    header Content-Type application/json
    header Cache-Control no-store
    respond \`{"contractVersion":"voice-room.runtime-config/v1","schemaVersion":1,"livekit":{"wsUrl":"${signalUrl}","connectFallbacks":[]}}\`
  }
  @embed path /embed/v1 /embed/v1/ /embed/v1/index.html
  handle @embed {
    header {
      Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'self' wss://localhost:19443 https://localhost:19443 stun: turn: turns:; frame-ancestors https:"
      Permissions-Policy "microphone=(self), camera=(self), display-capture=(), geolocation=(), payment=()"
      Cache-Control "no-cache"
      X-Robots-Tag "noindex"
    }
    rewrite * /embed/v1/index.html
    file_server
  }
  handle /widget/v1/loader.js {
    header Access-Control-Allow-Origin *
    header Cross-Origin-Resource-Policy cross-origin
    header Cache-Control no-cache
    file_server
  }
  handle {
    file_server
  }
}
https://127.0.0.1:19444, https://127.0.0.1:19445 {
  bind 127.0.0.1
  tls internal
  header Referrer-Policy no-referrer
  root * /srv/fixture
  rewrite / /host.html
  rewrite /multi /multi.html
  file_server
}
`
  );
  try {
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      'host',
      '-v',
      `${directory}:/srv/fixture:ro`,
      '-v',
      `${widgetDist}:/srv/widget:ro`,
      'caddy:2.11.4-alpine',
      'caddy',
      'run',
      '--config',
      '/srv/fixture/Caddyfile'
    ]);
  } catch (error) {
    spawnSync('docker', ['rm', '-fv', name], { encoding: 'utf8' });
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const sql = (query: string) =>
    docker([
      ...compose,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'voice_room',
      '-d',
      'voice_room_ci',
      '-c',
      query
    ]);
  return {
    stop() {
      const status = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', name], { encoding: 'utf8' });
      if (status.stdout.trim() !== 'true') {
        const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
        console.error(logs.stderr || logs.stdout);
      }
      try {
        docker(['rm', '-fv', name]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    /**
     * Every test leaves the isolated project without widget rooms. The API
     * allows one temporary room per IP, and a room whose creation failed
     * halfway has no code in the test to clean it up by.
     */
    cleanupWidgetRooms() {
      sql(`DELETE FROM rooms WHERE kind = 'widget'`);
    },
    restoreAdmission() {
      sql('UPDATE widget_boundary_activation SET widget_admission_enabled=true WHERE singleton');
    },
    recover(command: 'recover' | 'verify-disabled'): unknown {
      return JSON.parse(
        docker([...compose, 'exec', '-T', 'api', 'node', 'apps/api/src/scripts/widget-recovery.ts', command])
      );
    }
  };
}
