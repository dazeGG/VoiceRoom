import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { onTestFinished, test } from 'vitest';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { dockerAvailable, startCaddyEdge } from './helpers/caddy-edge.ts';

// fetch forbids overriding Host, so ask over a raw socket.
function get(origin: string, host: string, pathname: string, headers: Record<string, string> = {}) {
  const url = new URL(origin);
  return new Promise<{ status: number; body: string; csp: string }>((resolve, reject) => {
    request({ host: url.hostname, port: url.port, path: pathname, headers: { ...headers, Host: host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body, csp: String(res.headers['content-security-policy'] ?? '') })
      );
    })
      .on('error', reject)
      .end();
  });
}

test(
  'a stack behind the host edge serves its own names over plain HTTP (docker-compose.behind-edge.yml)',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({
      env: {
        SITE_SCHEME: 'http://',
        DOMAIN: 'dev.example.test',
        ADMIN_DOMAIN: 'admin.dev.example.test',
        LIVEKIT_DOMAIN: 'livekit.dev.example.test',
        LIVEKIT_GATE_PUBLIC_URL: 'wss://livekit.dev.example.test'
      }
    });

    const app = await get(origin, 'dev.example.test', '/app');
    assert.equal(app.status, 200);
    assert.match(app.body, /web/);
    assert.match(app.csp, /wss:\/\/livekit\.dev\.example\.test/);
    assert.doesNotMatch(app.csp, /wss:\/\/http:/);
    const runtime = await get(origin, 'dev.example.test', '/runtime-config.json');
    const config: unknown = JSON.parse(runtime.body);
    assert.ok(Value.Check(Type.Object({ livekit: Type.Object({ wsUrl: Type.String() }) }), config));
    assert.equal(config.livekit.wsUrl, 'wss://livekit.dev.example.test');
    // Plain HTTP, not a redirect to HTTPS: the host's Caddy already terminated TLS.
    assert.equal((await get(origin, 'dev.example.test', '/')).status, 200);
    // The LiveKit name routes to the gate, absent in this test.
    assert.equal((await get(origin, 'livekit.dev.example.test', '/')).status, 502);
  }
);

test(
  'two edges preserve a single sanitized client IP for API rate limits',
  { skip: !dockerAvailable, timeout: 90_000 },
  async () => {
    const network = `voiceroom-two-edges-${randomUUID()}`;
    const api = `${network}-api`;
    const docker = (args: string[]) => {
      const result = spawnSync('docker', args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    docker(['network', 'create', network]);
    onTestFinished(() => {
      spawnSync('docker', ['rm', '-f', api]);
      spawnSync('docker', ['network', 'rm', network]);
    });
    docker([
      'run',
      '-d',
      '--name',
      api,
      '--network',
      network,
      '--network-alias',
      'api',
      'node:24.18.0-bookworm-slim',
      'node',
      '-e',
      'require("http").createServer((req,res)=>res.end(JSON.stringify(req.headers))).listen(3000,"0.0.0.0")'
    ]);
    await startCaddyEdge({ network, networkAlias: 'inner', behindEdge: true });
    const outer = await startCaddyEdge({
      network,
      sites: {
        'outer.caddy': `http://outer.example.test {
      reverse_proxy inner:80 {
        header_up Host inner.example.test
        header_up X-VoiceRoom-Client-IP {remote_host}
      }
    }`
      }
    });
    // Use the inner edge's catch-all HTTP site; inject both common spoof vectors.
    const result = await get(outer, 'outer.example.test', '/api/healthz', {
      'X-Forwarded-For': '198.51.100.77',
      'X-VoiceRoom-Client-IP': '198.51.100.88'
    });
    assert.equal(result.status, 200);
    const received: unknown = JSON.parse(result.body);
    assert.ok(Value.Check(Type.Record(Type.String(), Type.String()), received));
    const inspected: unknown = JSON.parse(docker(['network', 'inspect', network]));
    assert.ok(
      Value.Check(
        Type.Array(Type.Object({ IPAM: Type.Object({ Config: Type.Array(Type.Object({ Gateway: Type.String() })) }) })),
        inspected
      )
    );
    const gateway = inspected[0]?.IPAM.Config[0]?.Gateway;
    assert.ok(gateway);
    assert.equal(received['x-forwarded-for'], gateway);
    assert.equal(received['x-forwarded-proto'], 'https');
    assert.equal(received['x-voiceroom-client-ip'], undefined);
  }
);
