import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const REQUIRED_PROFILES = new Set(['all-off', 'all-on', 'n-1-api', 'provider-failure', 'worker-loss', 'rescue']);
const REQUIRED_CLIENTS = new Set(['v2.4.2-client', 'account-client', 'guest-room-client']);
const REQUIRED_FAILURES = new Set(['provider-failure', 'worker-loss', 'visibility-boundary', 'reordered-events', 'unicode-rgi']);

function isoMillis(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requirePassedSet(items, required, label, predicate = (item) => item?.passed === true) {
  const passed = new Set((items || []).filter(predicate).map((item) => item.id));
  for (const id of required) if (!passed.has(id)) throw new Error(`G71 ${label} ${id} is missing or failed`);
  return passed;
}

export function verifyEngagementCheckpoint(value) {
  if (!value || value.contract !== 'voice-room.engagement-checkpoint/v1' || value.release !== '2.5.0') throw new Error('Invalid G71 checkpoint contract');
  if (!GIT_SHA.test(value.gitSha || '')) throw new Error('G71 requires an immutable git SHA');
  for (const component of ['api', 'web', 'worker']) {
    if (!SHA256.test(value.digests?.[component] || '')) throw new Error(`G71 requires immutable ${component} digest`);
  }
  for (const checkpoint of ['messagingCheckpoint', 'membershipCheckpoint']) {
    if (!SHA256.test(value[checkpoint]?.sha256 || '') || value[checkpoint]?.verified !== true) throw new Error(`G71 requires a verified immutable ${checkpoint}`);
  }
  const predecessors = new Set((value.predecessors || []).filter((item) => item?.verified === true && SHA256.test(item.sha256 || '')).map((item) => item.goal));
  for (let goal = 1; goal <= 70; goal += 1) {
    const id = `G${String(goal).padStart(2, '0')}`;
    if (!predecessors.has(id)) throw new Error(`G71 predecessor ${id} is missing`);
  }
  const profiles = requirePassedSet(value.matrix?.profiles, REQUIRED_PROFILES, 'profile');
  if (!Array.isArray(value.matrix?.pairwise) || value.matrix.pairwise.length < 3 || value.matrix.pairwise.some((item) => item?.passed !== true)) throw new Error('G71 pairwise matrix is incomplete');
  requirePassedSet(value.compatibility, REQUIRED_CLIENTS, 'compatibility proof');
  requirePassedSet(value.failureProofs, REQUIRED_FAILURES, 'failure proof', (item) => item?.passed === true && item?.failClosed === true && item?.noLeak === true);

  const budgets = value.budgets || {};
  if (!(budgets.fiveMentionFanout?.p95Ms <= 500)) throw new Error('G71 five-mention fanout budget failed');
  if (!(budgets.inboxRead?.p95Ms <= 300 && budgets.inboxRead?.p99Ms <= 750)) throw new Error('G71 inbox budget failed');
  if (!(budgets.notificationWorker?.throughputPerSecond >= 100 && budgets.notificationWorker?.duplicateDeliveries === 0)) throw new Error('G71 notification worker budget failed');
  if (!(budgets.reactionMutation?.p95Ms <= 250)) throw new Error('G71 reaction mutation budget failed');

  const startedAt = isoMillis(value.observation?.startedAt);
  const endedAt = isoMillis(value.observation?.endedAt);
  if (startedAt === null || endedAt === null || endedAt - startedAt < 60 * 60 * 1000) throw new Error('G71 observation must be at least 60 minutes');
  if (!Array.isArray(value.stopDefects) || value.stopDefects.length !== 0) throw new Error('G71 contains stop defects');
  if (!SHA256.test(value.evidenceChainSha256 || '')) throw new Error('G71 evidence chain checksum is missing');
  return Object.freeze({ gitSha: value.gitSha, durationMs: endedAt - startedAt, profiles: [...profiles].sort() });
}

function cli() {
  const verifyIndex = process.argv.indexOf('--verify');
  if (verifyIndex < 0) throw new Error('Usage: node scripts/checkpoints/engagement.mjs --verify <checkpoint.json>');
  const file = process.argv[verifyIndex + 1] || process.env.G71_CHECKPOINT_FILE;
  if (!file) throw new Error('G71_CHECKPOINT_FILE or checkpoint path is required');
  const result = verifyEngagementCheckpoint(JSON.parse(fs.readFileSync(file, 'utf8')));
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
