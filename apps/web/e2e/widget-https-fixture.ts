import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultWidgetConfig } from '@voice-room/shared/contracts/widget';
import { widgetSnippet } from '../src/features/widget/snippet';

export const widgetOrigin = 'https://localhost:19443';
export const widgetParents = ['https://127.0.0.1:19444', 'https://127.0.0.1:19445'] as const;

/** Isolated local-only HTTPS fixture. Never mounts deployment data or sockets. */
export function startWidgetHttpsFixture(): () => void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'widget-https-'));
  const name = `widget-https-${process.pid}-${Date.now()}`;
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Widget host</title><body>${widgetSnippet({ ...defaultWidgetConfig, mode: 'floating', chat: true }, widgetOrigin)}</body></html>`;
  writeFileSync(path.join(directory, 'host.html'), html);
  writeFileSync(
    path.join(directory, 'Caddyfile'),
    `{
  admin off
  auto_https disable_redirects
  default_sni localhost
}
https://localhost:19443 {
  tls internal
  header Referrer-Policy no-referrer
  handle /api/* {
    reverse_proxy host.docker.internal:3000
  }
  handle /rtc* {
    reverse_proxy host.docker.internal:7899
  }
  handle /runtime-config.json {
    header Content-Type application/json
    respond \`{"contractVersion":"voice-room.runtime-config/v1","schemaVersion":1,"livekit":{"wsUrl":"wss://localhost:19443","connectFallbacks":[]}}\`
  }
  handle /embed/v1 {
    header Content-Security-Policy "frame-ancestors https:"
    header Permissions-Policy "microphone=(self), camera=(self), display-capture=()"
    header Cache-Control no-cache
    root * /srv/web
    rewrite * /embed/v1/index.html
    file_server
  }
  handle /widget/v1/loader.js {
    header Access-Control-Allow-Origin *
    header Cache-Control no-cache
    root * /srv/web
    file_server
  }
  handle /_app/immutable/* {
    header Access-Control-Allow-Origin *
    root * /srv/web
    file_server
  }
  handle {
    root * /srv/web
    file_server
  }
}
https://127.0.0.1:19444, https://127.0.0.1:19445 {
  tls internal
  header Referrer-Policy no-referrer
  root * /srv/fixture
  rewrite * /host.html
  file_server
}
`
  );
  const validation = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${directory}:/srv/fixture:ro`,
      'caddy:2.11.4-alpine',
      'caddy',
      'adapt',
      '--config',
      '/srv/fixture/Caddyfile'
    ],
    { encoding: 'utf8' }
  );
  if (validation.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`Invalid widget HTTPS fixture: ${validation.stderr}`);
  }
  const result = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      name,
      '-p',
      '127.0.0.1:19443:19443',
      '-p',
      '127.0.0.1:19444:19444',
      '-p',
      '127.0.0.1:19445:19445',
      '-v',
      `${directory}:/srv/fixture:ro`,
      '-v',
      `${path.resolve(import.meta.dirname, '../dist')}:/srv/web:ro`,
      'caddy:2.11.4-alpine',
      'caddy',
      'run',
      '--config',
      '/srv/fixture/Caddyfile'
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`Widget HTTPS fixture failed: ${result.stderr}`);
  }
  return () => {
    const status = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', name], { encoding: 'utf8' });
    if (status.stdout.trim() !== 'true') {
      const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
      console.error(logs.stderr || logs.stdout);
    }
    spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
    rmSync(directory, { recursive: true, force: true });
  };
}
