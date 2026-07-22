#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

export const REPLAY_COMPOSE_FILE = 'docker-compose.lkv.yml';

export function buildReplayTopologyCommand(options = {}) {
  const compose = options.composeFile ?? REPLAY_COMPOSE_FILE;
  const args = ['compose', '-f', compose, 'up'];
  if (options.detach !== false) args.push('-d');
  return {
    command: 'docker',
    args,
    env: {
      LIVEKIT_REPLAY_IMAGE: 'livekit/livekit-server:v1.13.2'
    }
  };
}

export function startReplayTopology(options = {}) {
  const command = buildReplayTopologyCommand(options);
  if (options.dryRun) return Promise.resolve(command);
  const child = spawn(command.command, command.args, {
    stdio: 'inherit',
    env: { ...process.env, ...command.env }
  });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(command) : reject(new Error(`docker compose exited ${code}`))));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      foreground: { type: 'boolean', default: false }
    }
  });
  const command = await startReplayTopology({ dryRun: values['dry-run'], detach: !values.foreground });
  process.stdout.write(JSON.stringify(command) + '\n');
}
