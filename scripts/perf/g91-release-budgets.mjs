import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256 = /^sha256:[a-f0-9]{64}$/; const GIT_SHA = /^[a-f0-9]{40}$/;
export function verifyBudgetProfile(profile) {
  if (profile?.contract !== 'voice-room.release-performance/v1' || profile.release !== '2.5.0' || profile.profile !== 'rc') throw new Error('Invalid G91 profile');
  const expected = { roomMessages: 500, dmMessages: 100000, members: 10000, inboxRows: 100000, reactors: 10000, mentionsPerSend: 5, workerJobsPerSecond: 100, acceptedImageBytes: 10485760, acceptedImagePixels: 40000000 };
  for (const [key, value] of Object.entries(expected)) if (profile.dataset?.[key] !== value) throw new Error(`G91 dataset ${key} changed`);
  const exact = [['roomHistory','p95Ms',300],['roomHistory','p99Ms',750],['dmHistory','p95Ms',300],['dmHistory','p99Ms',750],['memberAutocomplete','p95Ms',200],['inbox','p95Ms',300],['inbox','p99Ms',750],['fiveMentionSend','p95Ms',500],['notificationWorker','minimumJobsPerSecond',100],['reactionMutation','p95Ms',250],['migration','maximumLockSeconds',5],['mediaSlot','p95Ms',300],['mediaProcessing','readyWithinSeconds',15],['mediaRead','ttfbMs',500],['moderationMutation','p95Ms',300],['cleanup','minimumRowsPerRun',500],['cleanup','eventLoopP95Ms',100],['http','maximum5xxRate',0.02],['restore','rpoSeconds',3600],['restore','rtoSeconds',14400]];
  for (const [surface, key, value] of exact) if (profile.budgets?.[surface]?.[key] !== value) throw new Error(`G91 budget ${surface}.${key} changed`);
  return true;
}
export function verifyBudgetEvidence(profile, evidence) {
  verifyBudgetProfile(profile);
  for (const key of profile.requiredEvidence) if (evidence?.[key] == null || evidence[key] === '') throw new Error(`G91 evidence ${key} is missing`);
  if (!GIT_SHA.test(evidence.gitSha) || !['apiDigest','webDigest','workerDigest'].every((key) => SHA256.test(evidence[key]))) throw new Error('G91 immutable source evidence is invalid');
  for (const [surface, limits] of Object.entries(profile.budgets)) for (const [metric, limit] of Object.entries(limits)) {
    const actual = evidence.measurements?.[surface]?.[metric]; if (!Number.isFinite(actual)) throw new Error(`G91 measurement ${surface}.${metric} is missing`);
    if (metric.startsWith('minimum') ? actual < limit : actual > limit) throw new Error(`G91 budget ${surface}.${metric} failed`);
  }
  const labels = new Set((evidence.metricLabels || []).map((item) => String(item).toLowerCase()));
  for (const forbidden of profile.forbiddenMetricLabels) if (labels.has(forbidden)) throw new Error(`G91 forbidden metric label ${forbidden}`);
  if (evidence.alertsVerified !== true || evidence.autoDisableVerified !== true) throw new Error('G91 alerts and auto-disable proof are required');
  return { status: 'VERIFIED', gitSha: evidence.gitSha };
}
function cli() {
  const profileName = process.argv[process.argv.indexOf('--profile') + 1]; const goal = process.argv[process.argv.indexOf('--goal') + 1];
  if (profileName !== 'rc' || goal !== 'G91') throw new Error('Usage: --profile rc --goal G91 [--evidence file]');
  const profile = JSON.parse(fs.readFileSync(path.resolve('scripts/perf/release-250-profile.v1.json'), 'utf8')); verifyBudgetProfile(profile);
  const evidenceIndex = process.argv.indexOf('--evidence');
  const result = evidenceIndex > -1 ? verifyBudgetEvidence(profile, JSON.parse(fs.readFileSync(process.argv[evidenceIndex + 1], 'utf8'))) : { status: 'PENDING_EXTERNAL_PERFORMANCE_EVIDENCE' };
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
