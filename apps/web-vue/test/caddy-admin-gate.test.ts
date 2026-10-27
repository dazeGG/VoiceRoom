// The admin app's edge, run on the pinned Caddy image with the real Caddyfile:
// every file on ADMIN_DOMAIN is served only after the API's staff check says
// yes, the check sees the address as it was asked (so a deep link survives the
// handoff), a missing bundle is a 404 and not the page, and the staff and admin
// endpoints answer only on the host they belong to. A second Caddy stands in
// for the API: it lets through the cookie "vr_staff=ok" and sends any other
// page load to the main site, naming the address it was asked about.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';
import { buildHeaderPolicy, renderCaddySnippet } from '../scripts/emit-caddy-csp.ts';

const repositoryRoot = `${import.meta.dirname}/../../../`;
const caddyImage = 'caddy:2.11.4-alpine';
const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;

const FAKE_API = `
:3000 {
  # Like the real API, every answer carries the main site's own policy.
  header Content-Security-Policy "default-src 'self'; style-src 'self'"
  route /api/staff/check {
    @staff header Cookie *vr_staff=ok*
    respond @staff 204
    @page header Sec-Fetch-Mode navigate
    redir @page https://site.test/api/staff/handoff?back={header.X-Forwarded-Uri} 302
    respond "not found" 404
  }
  respond "api {path}" 200
}
`;

function docker(args: string[]): string {
  const run = spawnSync('docker', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr || `docker ${args.join(' ')} failed`);
  return run.stdout.trim();
}

function publishedPort(container: string, port: string): string {
  const found = /:(\d+)$/.exec(docker(['port', container, `${port}/tcp`]).split('\n')[0] ?? '')?.[1];
  if (!found) throw new Error(`no published port ${port}`);
  return `http://127.0.0.1:${found}`;
}

async function startEdge() {
  const id = randomUUID();
  const network = `voiceroom-admin-gate-${id}`;
  const api = `voiceroom-admin-api-${id}`;
  const edge = `voiceroom-admin-edge-${id}`;
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'voiceroom-admin-gate-'));
  const fakeApi = path.join(scratch, 'Caddyfile');
  writeFileSync(fakeApi, FAKE_API);
  const csp = path.join(scratch, 'csp.caddy');
  writeFileSync(csp, renderCaddySnippet(buildHeaderPolicy("default-src 'self'; script-src 'self' 'sha256-test='")));
  const admin = path.join(scratch, 'admin');
  mkdirSync(path.join(admin, 'assets'), { recursive: true });
  writeFileSync(path.join(admin, 'index.html'), '<!doctype html><html><body>admin app</body></html>');
  writeFileSync(path.join(admin, 'assets', 'app-1.js'), 'console.log("admin");');

  const close = () => {
    spawnSync('docker', ['rm', '-f', edge, api], { encoding: 'utf8' });
    spawnSync('docker', ['network', 'rm', network], { encoding: 'utf8' });
  };
  try {
    docker(['network', 'create', network]);
    docker([
      'run',
      '-d',
      '--name',
      api,
      '--network',
      network,
      '--network-alias',
      'api',
      '-v',
      `${fakeApi}:/etc/caddy/Caddyfile:ro`,
      caddyImage
    ]);
    docker([
      'run',
      '-d',
      '--name',
      edge,
      '--network',
      network,
      '-e',
      'DOMAIN=:80',
      '-e',
      'LIVEKIT_DOMAIN=:81',
      '-e',
      'ADMIN_DOMAIN=:82',
      '-e',
      'LIVEKIT_GATE_PUBLIC_URL=wss://livekit.example.test',
      '-p',
      '127.0.0.1::80',
      '-p',
      '127.0.0.1::82',
      '-v',
      `${path.join(repositoryRoot, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      '-v',
      `${csp}:/etc/caddy/csp.caddy:ro`,
      '-v',
      `${path.join(repositoryRoot, 'config/caddy/admin-csp.caddy')}:/etc/caddy/admin-csp.caddy:ro`,
      '-v',
      `${admin}:/srv/admin:ro`,
      caddyImage
    ]);
    const site = publishedPort(edge, '80');
    const adminSite = publishedPort(edge, '82');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await fetch(`${site}/api/ping`).then(
        (response) => response.ok,
        () => false
      );
      if (ready) return { site, admin: adminSite, close };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('the Caddy edge did not come up');
  } catch (error) {
    close();
    throw error;
  }
}

const asStaff = { Cookie: 'vr_staff=ok' };

/** A browser's page load; fetch() always says Sec-Fetch-Mode: cors, so plain http it is. */
function pageVisit(url: string): Promise<{ status: number; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } }, (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0, location: response.headers.location });
      })
      .on('error', reject);
  });
}

test('the admin app is served only through the staff check', { skip: !dockerAvailable, timeout: 60_000 }, async () => {
  const edge = await startEdge();
  onTestFinished(edge.close);

  // Staff: the page for any address, asked for every time; the bundle kept.
  const page = await fetch(`${edge.admin}/accounts/u-1`, { headers: asStaff });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /admin app/);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  const bundle = await fetch(`${edge.admin}/assets/app-1.js`, { headers: asStaff });
  assert.equal(bundle.status, 200);
  assert.equal(bundle.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  // A bundle a newer build no longer has is a 404, never the page cached as a script.
  const gone = await fetch(`${edge.admin}/assets/app-0.js`, { headers: asStaff });
  assert.equal(gone.status, 404);
  assert.doesNotMatch(await gone.text(), /admin app/);
  assert.notEqual(gone.headers.get('cache-control'), 'private, max-age=31536000, immutable');

  // Not staff: a page load goes through the handoff and keeps the address it asked for.
  const visit = await pageVisit(`${edge.admin}/accounts/u-1`);
  assert.equal(visit.status, 302);
  assert.equal(visit.location, 'https://site.test/api/staff/handoff?back=/accounts/u-1');
  // Anything else gets the API's 404, and nothing of the app.
  for (const pathname of ['/', '/assets/app-1.js']) {
    const refused = await fetch(`${edge.admin}${pathname}`);
    assert.equal(refused.status, 404, pathname);
    const body = await refused.text();
    assert.doesNotMatch(body, /admin app|console\.log/, pathname);
    assert.equal(refused.headers.get('cache-control'), null, pathname);
  }

  // Whatever the API answers on the admin host carries the admin policy alone, so
  // its own 404 page keeps its inline style.
  for (const pathname of ['/', '/api/staff/me']) {
    const policy = (await fetch(`${edge.admin}${pathname}`)).headers.get('content-security-policy') ?? '';
    assert.equal(policy.match(/default-src/g)?.length, 1, `${pathname}: ${policy}`);
    assert.match(policy, /style-src 'self' 'unsafe-inline'/, pathname);
  }

  // Each host answers only its own part of the API.
  for (const pathname of ['/api/admin/overview', '/api/staff/check', '/api/staff/callback', '/api/staff/me']) {
    assert.equal((await fetch(`${edge.site}${pathname}`)).status, 404, `main site ${pathname}`);
  }
  assert.equal(await (await fetch(`${edge.site}/api/staff/handoff`)).text(), 'api /api/staff/handoff');
  for (const pathname of ['/api/staff/handoff', '/api/staff/access', '/api/rooms']) {
    assert.equal((await fetch(`${edge.admin}${pathname}`)).status, 404, `admin app ${pathname}`);
  }
  assert.equal(await (await fetch(`${edge.admin}/api/staff/me`)).text(), 'api /api/staff/me');
  assert.equal(await (await fetch(`${edge.admin}/api/admin/overview`)).text(), 'api /api/admin/overview');
});
