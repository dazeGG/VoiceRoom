#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readActionsArchiveObject } from '../checkpoints/immutable-evidence.mjs';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const STAGES = new Set(['checkpoint', 'performance', 'develop-entry', 'rc']);
const BUNDLE_PATH = 'release-evidence-bundle.json';
const ARTIFACT_TYPE = 'application/vnd.voiceroom.release-evidence-bundle.v1+json';
const EMPTY_CONFIG_DIGEST = 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !SAFE_PATH.test(value) || value.includes('..') || value.includes('//')) throw new Error('Evidence bundle path is not canonical');
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('/')) throw new Error('Evidence bundle path is not canonical');
  return value;
}

function parseBundle(bytes, { codeSha, stage }) {
  let value;
  try { value = JSON.parse(bytes); } catch { throw new Error('Evidence bundle manifest is invalid JSON'); }
  if (value?.contract !== 'voice-room.release-evidence-bundle/v1' || value.release !== '2.5.0' || value.codeSha !== codeSha || value.stage !== stage || !SHA.test(value.codeSha || '') || !STAGES.has(value.stage)) throw new Error('Evidence bundle identity is invalid');
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 64) throw new Error('Evidence bundle file catalog is invalid');
  const names = new Set();
  for (const file of value.files) {
    canonicalPath(file?.path);
    if (file.path === BUNDLE_PATH || names.has(file.path) || !DIGEST.test(file.sha256 || '') || !/^application\/[a-z0-9.+-]+$/.test(file.mediaType || '')) throw new Error('Evidence bundle file catalog is invalid');
    names.add(file.path);
  }
  return value;
}

export function extractEvidenceBundle({ archiveBytes, bundleDigest, codeSha, outputDirectory, stage }) {
  if (!Buffer.isBuffer(archiveBytes) || !DIGEST.test(bundleDigest || '') || !SHA.test(codeSha || '') || !STAGES.has(stage)) throw new Error('Evidence bundle extraction inputs are invalid');
  const manifestBytes = readActionsArchiveObject(archiveBytes, BUNDLE_PATH);
  if (sha256(manifestBytes) !== bundleDigest) throw new Error('Evidence bundle manifest digest mismatch');
  const bundle = parseBundle(manifestBytes, { codeSha, stage });
  const output = path.resolve(outputDirectory);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, BUNDLE_PATH), manifestBytes);
  for (const file of bundle.files) {
    const bytes = readActionsArchiveObject(archiveBytes, file.path);
    if (sha256(bytes) !== file.sha256) throw new Error(`Evidence bundle digest mismatch for ${file.path}`);
    if (file.mediaType === 'application/json') {
      let value;
      try { value = JSON.parse(bytes); } catch { throw new Error(`Evidence bundle JSON is invalid for ${file.path}`); }
      if (value && typeof value === 'object' && Object.hasOwn(value, 'codeSha') && value.codeSha !== bundle.codeSha) throw new Error(`Evidence bundle object code SHA mismatch for ${file.path}`);
    }
    const target = path.join(output, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return bundle;
}

export function prepareOciBundle({ bundle, directory, runAttempt, runId }) {
  const root = path.resolve(directory);
  const manifestBytes = fs.readFileSync(path.join(root, BUNDLE_PATH));
  const entries = [{ path: BUNDLE_PATH, sha256: sha256(manifestBytes), mediaType: 'application/json' }, ...bundle.files];
  const layers = entries.map((entry) => {
    const bytes = fs.readFileSync(path.join(root, ...entry.path.split('/')));
    if (sha256(bytes) !== entry.sha256) throw new Error(`Prepared evidence digest mismatch for ${entry.path}`);
    return {
      mediaType: entry.mediaType,
      digest: entry.sha256,
      size: bytes.length,
      annotations: { 'org.opencontainers.image.title': entry.path }
    };
  });
  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: ARTIFACT_TYPE,
    config: { mediaType: 'application/vnd.oci.empty.v1+json', digest: EMPTY_CONFIG_DIGEST, size: 2 },
    layers,
    annotations: {
      'io.voiceroom.evidence.stage': bundle.stage,
      'io.voiceroom.github.run-attempt': String(runAttempt),
      'io.voiceroom.github.run-id': String(runId),
      'org.opencontainers.image.revision': bundle.codeSha,
      'org.opencontainers.image.source': 'https://github.com/dazeGG/VoiceRoom'
    }
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  return { configDigest: EMPTY_CONFIG_DIGEST, entries, manifest, manifestBytes: bytes, manifestDigest: sha256(bytes) };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function cli() {
  const archive = argument('--archive');
  const bundleDigest = argument('--bundle-sha256');
  const codeSha = argument('--code-sha');
  const output = argument('--output');
  const stage = argument('--stage');
  if (!archive || !output) throw new Error('Usage: --archive ZIP --bundle-sha256 SHA --code-sha SHA --stage STAGE --output DIR');
  const bundle = extractEvidenceBundle({ archiveBytes: fs.readFileSync(archive), bundleDigest, codeSha, outputDirectory: output, stage });
  const prepared = prepareOciBundle({ bundle, directory: output, runAttempt: process.env.GITHUB_RUN_ATTEMPT || 1, runId: process.env.GITHUB_RUN_ID || 1 });
  const preparedDirectory = path.join(output, '.oci');
  fs.mkdirSync(preparedDirectory, { recursive: true });
  fs.writeFileSync(path.join(preparedDirectory, 'config.json'), '{}');
  fs.writeFileSync(path.join(preparedDirectory, 'manifest.json'), prepared.manifestBytes);
  fs.writeFileSync(path.join(preparedDirectory, 'entries.json'), JSON.stringify(prepared.entries));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `manifest-digest=${prepared.manifestDigest}\nconfig-digest=${prepared.configDigest}\n`);
  else process.stdout.write(`${JSON.stringify({ manifestDigest: prepared.manifestDigest, files: prepared.entries.length })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
