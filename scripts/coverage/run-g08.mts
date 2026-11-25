#!/usr/bin/env node
// Keep the reference run independent of fixture membership. CI collects the
// two producers' raw ranges first, then applies the protected policy once.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isArray, isRecord } from '../../packages/shared/src/guards.ts';
import { requireTestDatabase } from '../../apps/api/test/require-test-database-url.ts';
import { apiFiles, apiLanes, runTestFiles } from '../ci/api-tests.mts';

const FIXTURES = ['unit', 'integration'] as const;
type Fixture = (typeof FIXTURES)[number];
const GATE_TEST = 'scripts/test/coverage-gate.test.mts';
const SUMMARY = 'coverage/release-250-summary.json';

function sharedFiles(root: string) {
  const dir = 'packages/shared/test';
  return fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

function fullInventory(root: string) {
  return [GATE_TEST, ...sharedFiles(root), ...apiFiles(root)];
}

function laneInventory(fixture: Fixture, root: string) {
  return [...(fixture === 'unit' ? sharedFiles(root) : [GATE_TEST]), ...apiLanes(root)[fixture]];
}

function run(args: string[]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function tree() {
  return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
}

function checkoutUrl(root: string) {
  return pathToFileURL(path.resolve(root) + path.sep).href;
}

function rawFiles(dir: string) {
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  assert.ok(names.length, `Missing raw V8 coverage in ${dir}`);
  return names;
}

function resetDirectory(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function bundleDir(root: string, fixture: Fixture) {
  return path.join(root, 'coverage', `g08-${fixture}`);
}

async function produce(root: string, fixture: Fixture, instrument: boolean) {
  if (fixture === 'integration') await requireTestDatabase();
  const files = laneInventory(fixture, root);
  if (!instrument) {
    runTestFiles(files, fixture);
    return;
  }
  const dir = bundleDir(root, fixture);
  const raw = path.join(dir, 'raw');
  resetDirectory(dir);
  fs.mkdirSync(raw);
  runTestFiles(files, fixture, { ...process.env, COVERAGE_V8_DIR: raw, NODE_V8_COVERAGE: raw });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      fixture,
      tree: tree(),
      checkout: checkoutUrl(root),
      files,
      raw: rawFiles(raw)
    }) + '\n'
  );
}

// V8 reports ES modules as file: URLs but can use plain paths for require().
// Translate only files inside the producer's checkout, never absolute paths
// belonging to its host or dependencies installed elsewhere.
function relocateRaw(src: string, dest: string, from: string, to: string) {
  if (from === to) {
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
    return;
  }
  const payload: unknown = JSON.parse(fs.readFileSync(src, 'utf8'));
  assert.ok(isRecord(payload) && isArray(payload.result), `Invalid V8 coverage: ${src}`);
  payload.result = payload.result.filter((script) => {
    assert.ok(isRecord(script), `Invalid V8 script: ${src}`);
    if (typeof script.url !== 'string') return false;
    const name = script.url;
    const windows = /^[a-z]:[\\/]/i.test(name) || name.startsWith('\\\\');
    const url = name.startsWith('file://')
      ? new URL(name).href
      : windows || name.startsWith('/')
        ? pathToFileURL(name, { windows }).href
        : '';
    if (!url.startsWith(from)) return false;
    script.url = to + url.slice(from.length);
    return true;
  });
  fs.writeFileSync(dest, JSON.stringify(payload));
}

export function mergeG08Bundles(root: string, testedTree: string, expected: string[]) {
  const merged = path.join(root, 'coverage', 'g08-merged-raw');
  resetDirectory(merged);
  const assigned: string[] = [];
  for (const fixture of FIXTURES) {
    const dir = bundleDir(root, fixture);
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.ok(isRecord(manifest), `Missing ${fixture} manifest`);
    assert.equal(manifest.fixture, fixture, 'G08 bundle fixture mismatch');
    assert.equal(manifest.tree, testedTree, 'G08 bundle tree mismatch');
    assert.ok(
      typeof manifest.checkout === 'string' &&
        manifest.checkout.startsWith('file://') &&
        manifest.checkout.endsWith('/'),
      'Invalid G08 checkout URL'
    );
    assert.ok(
      isArray(manifest.files) && manifest.files.length && manifest.files.every((name) => typeof name === 'string'),
      'Empty or invalid G08 assignment'
    );
    assigned.push(...manifest.files);
    const raw = path.join(dir, 'raw');
    const names = rawFiles(raw);
    assert.deepEqual(names, manifest.raw, `Incomplete ${fixture} raw V8 bundle`);
    for (const name of names) {
      relocateRaw(path.join(raw, name), path.join(merged, `${fixture}-${name}`), manifest.checkout, checkoutUrl(root));
    }
  }
  assert.deepEqual(assigned.sort(), [...expected].sort(), 'Missing, unexpected or duplicate G08 assignment');
  console.log(`G08 union: ${assigned.length} assigned files exactly once; ${rawFiles(merged).length} raw V8 profiles`);
  return merged;
}

function collect(raw: string) {
  run(['scripts/coverage/check-release-250-coverage.mts', '--v8-dir', raw, '--out', SUMMARY, '--collect-only']);
}

async function main(args: string[]) {
  const root = process.cwd();
  if (!args.length || (args.length === 2 && args[0] === '--base' && args[1])) {
    await requireTestDatabase();
    const raw = path.join(root, 'coverage', '.gate-v8');
    resetDirectory(raw);
    runTestFiles(fullInventory(root), 'integration', { ...process.env, COVERAGE_V8_DIR: raw, NODE_V8_COVERAGE: raw });
    collect(raw);
    // Without an explicit base this is a local full-suite measurement, not PR evidence.
    const base = args[1] ?? 'HEAD';
    const sha = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'], {
      encoding: 'utf8'
    }).trim();
    const trust = execFileSync(
      process.execPath,
      ['scripts/coverage/g08-inputs.mts', '--base', sha, '--tested', 'HEAD', '--out', 'coverage'],
      { encoding: 'utf8' }
    ).trim();
    run([
      'scripts/coverage/check-release-250-coverage.mts',
      '--coverage',
      SUMMARY,
      '--report',
      'coverage/release-250-patch.json',
      '--changed-files',
      'coverage/release-250-changed-files.txt',
      '--changed-diff',
      'coverage/release-250-changed.diff',
      ...trust.split(' ')
    ]);
  } else if (args.length === 1 && args[0] === '--merge') {
    collect(mergeG08Bundles(root, tree(), fullInventory(root)));
  } else if (
    args[0] === '--fixture' &&
    (args[1] === 'unit' || args[1] === 'integration') &&
    (args.length === 2 || (args.length === 3 && args[2] === '--without-coverage'))
  ) {
    await produce(root, args[1], args.length === 2);
  } else {
    throw new Error(
      'Usage: run-g08.mts [--base <revision> | --fixture unit|integration [--without-coverage] | --merge]'
    );
  }
}

if (import.meta.main) await main(process.argv.slice(2));
