#!/usr/bin/env node

import net from 'node:net';
import { parseArgs } from 'node:util';

export function createPartitionProxy(options = {}) {
  const listenPort = Number(options.listenPort ?? 17880);
  const listenHost = options.listenHost ?? '0.0.0.0';
  const targetHost = options.targetHost ?? '127.0.0.1';
  const targetPort = Number(options.targetPort ?? 7880);
  const state = {
    mode: options.mode ?? 'open',
    connections: 0,
    drops: 0
  };

  const server = net.createServer((client) => {
    state.connections += 1;
    if (state.mode === 'partitioned') {
      state.drops += 1;
      client.destroy();
      return;
    }

    const upstream = net.createConnection({ host: targetHost, port: targetPort });
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });

  return {
    state,
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, listenHost, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    setMode(mode) {
      if (!['open', 'partitioned'].includes(mode)) throw new Error(`Unsupported partition mode: ${mode}`);
      state.mode = mode;
    }
  };
}

function readCliOptions() {
  const { values } = parseArgs({
    options: {
      listen: { type: 'string', default: '17880' },
      'listen-host': { type: 'string', default: '0.0.0.0' },
      'target-host': { type: 'string', default: '127.0.0.1' },
      'target-port': { type: 'string', default: '7880' },
      mode: { type: 'string', default: 'open' }
    }
  });
  return {
    listenPort: values.listen,
    listenHost: values['listen-host'],
    targetHost: values['target-host'],
    targetPort: values['target-port'],
    mode: values.mode
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const proxy = createPartitionProxy(readCliOptions());
  await proxy.listen();
  process.stdout.write(JSON.stringify({ ready: true, state: proxy.state }) + '\n');
}
