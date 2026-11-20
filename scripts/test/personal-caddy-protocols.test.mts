import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { connect, type IncomingHttpHeaders } from 'node:http2';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const image = process.env.CADDY_TEST_IMAGE;

test('personal Caddy serves HTTP/2 without advertising an unreachable HTTP/3 listener', { skip: !image }, async (t) => {
  assert.ok(image);
  const name = `vr-personal-protocols-${randomUUID()}`;
  const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();
  t.after(() => {
    spawnSync('docker', ['rm', '-fv', name], { timeout: 30_000 });
  });

  const config = fileURLToPath(new URL('../../config/personal/Caddyfile', import.meta.url));
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1::443',
    '-e',
    'PERSONAL_CADDY_SITE=localhost',
    '-e',
    'PERSONAL_SIGNAL_URL=wss://localhost',
    '-v',
    `${config}:/etc/caddy/Caddyfile:ro`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    'touch /etc/caddy/personal-csp.caddy && exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile'
  );
  const address = docker('port', name, '443/tcp');
  let ca = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync(
      'docker',
      [
        'exec',
        name,
        'sh',
        '-c',
        'test -s /data/caddy/certificates/local/localhost/localhost.crt && cat /data/caddy/pki/authorities/local/root.crt'
      ],
      { encoding: 'utf8', timeout: 30_000 }
    );
    if (result.status === 0) {
      ca = result.stdout;
      break;
    }
    await delay(100);
  }
  assert.ok(ca, 'Caddy must issue a certificate for localhost');

  const session = connect(`https://${address}`, { ca, servername: 'localhost' });
  t.after(() => session.destroy());
  session.setTimeout(5000, () => session.destroy(new Error('HTTPS request timed out')));
  const headers = await new Promise<IncomingHttpHeaders>((resolve, reject) => {
    session.once('error', reject);
    const request = session.request(
      { ':authority': 'localhost', ':path': '/runtime-config.json' },
      { endStream: true }
    );
    request.once('error', reject);
    request.once('response', resolve);
    request.resume();
  });
  assert.equal(headers[':status'], 200);
  assert.equal(headers['alt-svc'], undefined);
});
