#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { runReplayScenario } from './run-replay-scenario.mts';

export function collectReplayEvidence(options: { scenario?: ReturnType<typeof runReplayScenario>; producedAt?: string } = {}) {
  const scenario = options.scenario ?? runReplayScenario();
  const payload = JSON.stringify(scenario);
  return {
    schemaVersion: 1,
    goal: 'G04',
    producedAt: options.producedAt ?? new Date().toISOString(),
    scenarioDigest: `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`,
    scenario
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      json: { type: 'boolean', default: false }
    }
  });
  const evidence = collectReplayEvidence();
  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  if (values.out) fs.writeFileSync(values.out, serialized);
  process.stdout.write(values.json || !values.out ? serialized : evidence.scenarioDigest + '\n');
}
