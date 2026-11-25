import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { isRecord } from '../../packages/shared/src/guards.ts';

import { g08Closure, UnresolvedG08Input } from './g08-closure.mts';
import { measuredInputs, workspace, workspaceDirs } from './routing-inputs.mts';
import { allTests, selectTests } from './test-lanes.mts';
import { FULL_SELECTION, selectionDigest } from './verification-policy.mts';

const SITE = 'apps/site';
const SHARED = 'packages/shared';
const CALL = 'packages/call';
const APP_VERSION_PACKAGES = [
  '',
  'apps/admin',
  'apps/api',
  'apps/meet',
  'apps/web',
  'apps/widget',
  SHARED,
  CALL,
  'packages/ui',
  'packages/ui-kit'
];
const APP_VERSION_MANIFESTS = APP_VERSION_PACKAGES.map((path) => `${path ? `${path}/` : ''}package.json`);
type Workspace = 'app' | 'site';
type VersionChanges = { appManifests?: readonly string[]; lock?: Workspace };

function versionedPackage(source: string) {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || typeof value.version !== 'string') return null;
  return value;
}

export function manifestVersionOnly(before: string, after: string): boolean {
  try {
    const previous = versionedPackage(before);
    const current = versionedPackage(after);
    return (
      !!previous &&
      !!current &&
      !isDeepStrictEqual(previous, current) &&
      isDeepStrictEqual(previous, { ...current, version: previous.version })
    );
  } catch {
    return false;
  }
}

export function lockVersionComponent(before: string, after: string): Workspace | undefined {
  try {
    const previous = versionedPackage(before);
    const current = versionedPackage(after);
    if (!previous || !current || previous.lockfileVersion !== 3 || current.lockfileVersion !== 3) return;
    const beforePackages = previous.packages;
    const afterPackages = current.packages;
    if (!isRecord(beforePackages) || !isRecord(afterPackages) || isDeepStrictEqual(previous, current)) return;

    const normalize = (paths: string[]) => {
      const packages = { ...afterPackages };
      for (const path of paths) {
        const earlier = beforePackages[path];
        const later = afterPackages[path];
        if (
          !isRecord(earlier) ||
          !isRecord(later) ||
          typeof earlier.version !== 'string' ||
          typeof later.version !== 'string'
        ) {
          return null;
        }
        packages[path] = { ...later, version: earlier.version };
      }
      return packages;
    };
    const sitePackages = normalize([SITE]);
    if (sitePackages && isDeepStrictEqual(previous, { ...current, packages: sitePackages })) return 'site';
    const appPackages = normalize(APP_VERSION_PACKAGES);
    if (appPackages && isDeepStrictEqual(previous, { ...current, version: previous.version, packages: appPackages })) {
      return 'app';
    }
  } catch {
    // Malformed lockfiles still route to every consumer.
  }
}

export function changedComponents(paths: string[], versionChanges: VersionChanges = {}) {
  const lanes = { app: false, site: false, docs: false };
  for (const path of paths) {
    if (path.startsWith(`${SITE}/`)) {
      lanes.site = true;
    } else if (path.startsWith('apps/docs/')) {
      lanes.docs = true;
    } else if (versionChanges.appManifests?.includes(path)) {
      lanes.app = true;
    } else if (path === 'package-lock.json' && versionChanges.lock) {
      lanes[versionChanges.lock] = true;
    } else if (
      path === '.github/workflows/ci.yml' ||
      path === 'scripts/ci/changed-components.mts' ||
      path === 'scripts/cd/publish-static.sh' ||
      path === 'scripts/test/static-publication.sh'
    ) {
      lanes.app = lanes.site = lanes.docs = true;
    } else if (/^\.github\/workflows\/(?:build|deploy|release)-static\.yml$/.test(path)) {
      lanes.site = lanes.docs = true;
    } else if (path.startsWith(`${CALL}/`)) {
      lanes.app = true;
    } else if (
      // Shared packages, including the UI kit and its Sass assets, feed both build lanes.
      path.startsWith('packages/') ||
      /^(?:package(?:-lock)?\.json|\.nvmrc|\.npmrc|\.prettier.*|eslint\..*|eslint-suppressions\.json)$/.test(path) ||
      /^scripts\/(?:check-(?:type-coverage|test-source-reads)|test\/web-text-contrast\.test)\.mts$/.test(path) ||
      path === 'config/test-source-reads.json'
    ) {
      lanes.app = lanes.site = true;
    } else if (!path.startsWith('docs/') && !/^[^/]+\.md$/i.test(path)) {
      // Unknown files can affect the app's build or deployment. Run its gates by default.
      lanes.app = true;
    }
  }
  return lanes;
}

function git(args: string[], cwd: string) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
}

function compareVersionMetadata<T>(
  base: string,
  head: string,
  path: string,
  cwd: string,
  compare: (before: string, after: string) => T
) {
  try {
    return compare(git(['show', `${base}:${path}`], cwd), git(['show', `${head}:${path}`], cwd));
  } catch {
    // A missing manifest or lockfile is a shared change. Let both builds report it.
  }
}

function readTree(ref: string, cwd: string, blobs: Map<string, string>) {
  const objects = new Map<string, string>();
  for (const record of git(['ls-tree', '-rz', ref], cwd).split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    // Do not parse a symlink's destination as if it were source code.
    objects.set(record.slice(tab + 1), type === 'blob' && mode?.startsWith('100') ? (oid ?? '') : '');
  }
  const read = (path: string) => {
    const oid = objects.get(path);
    if (!oid) throw new Error('not a tracked regular file: ' + path);
    const cached = blobs.get(oid);
    if (cached !== undefined) return cached;
    const source = git(['cat-file', 'blob', oid], cwd);
    blobs.set(oid, source);
    return source;
  };
  const json = (path: string): unknown => JSON.parse(read(path));
  const files = [...objects.keys()];
  const dirs = workspaceDirs(json('package.json'), files);
  const workspaces = dirs.map((dir) => workspace(dir, json(dir + '/package.json')));
  return {
    workspaces,
    inputs: () => ({
      workspaces,
      measured: g08Closure(measuredInputs(json('config/coverage/release-250-thresholds.json')), files, workspaces, read)
    })
  };
}

export function routeTrees(base: string, tested: string, cwd = process.cwd()) {
  const sha = /^[a-f0-9]{40}$/;
  if (!sha.test(tested)) throw new Error('Expected a tested Git SHA');
  // Missing tested tree is not a verifiable run. Missing base still verifies ALL.
  git(['cat-file', '-e', tested + '^{tree}'], cwd);
  let paths: string[] | undefined;
  if (sha.test(base) && !/^0+$/.test(base)) {
    try {
      paths = git(['diff', '--no-renames', '--name-only', '-z', base, tested, '--'], cwd).split('\0').filter(Boolean);
    } catch {
      // No diff means no publication intent can be proved.
    }
  }
  const versions: VersionChanges = {};
  if (paths) {
    versions.appManifests = APP_VERSION_MANIFESTS.filter(
      (path) => paths.includes(path) && compareVersionMetadata(base, tested, path, cwd, manifestVersionOnly)
    );
    if (paths.includes('package-lock.json')) {
      const component = compareVersionMetadata(base, tested, 'package-lock.json', cwd, lockVersionComponent);
      if (component) versions.lock = component;
    }
  }
  const initialPush = /^0{40}$/.test(base);
  const intent = paths
    ? { ...changedComponents(paths, versions), installer: paths.some((path) => path.startsWith('apps/get/')) }
    : { app: initialPush, site: initialPush, docs: initialPush, installer: initialPush };
  let route = allTests('missing base tree or unavailable diff');
  let target: ReturnType<typeof readTree> | undefined;
  try {
    const blobs = new Map<string, string>(); // Most measured source/manifest blobs are identical in both trees.
    target = readTree(tested, cwd, blobs);
    if (paths) route = selectTests(paths, [readTree(base, cwd, blobs).inputs(), target.inputs()], intent);
  } catch (error) {
    route = allTests(
      error instanceof UnresolvedG08Input ? error.message : 'unresolved workspace or G08 policy in base/tested trees'
    );
  }
  // A newly testable workspace needs an executable step in the fixed full policy.
  // Asking for ALL without that step would still silently omit the suite.
  for (const w of target?.workspaces ?? []) {
    if (!w.tests) continue;
    const runnable =
      w.dir === 'apps/api' ||
      w.dir === 'apps/site' ||
      w.dir === 'packages/shared' ||
      FULL_SELECTION.workspaces.some((name) => w.name === '@voiceroom/' + name && w.dir === 'apps/' + name);
    if (!runnable) throw new Error('ALL cannot execute unassigned test workspace: ' + w.dir);
  }
  return { ...intent, ...route, digest: selectionDigest(route.selection) };
}

/** For a PR the evidence belongs to the synthetic merge commit, not a stale event base. */
export function routingBase(payloadBase: string, tested: string, prHead?: string, cwd = process.cwd()) {
  const sha = /^[a-f0-9]{40}$/;
  if (prHead === undefined) return sha.test(payloadBase) ? payloadBase : '';
  if (!sha.test(tested) || !sha.test(prHead)) throw new Error('Invalid PR commit identity');
  if (git(['rev-parse', 'HEAD'], cwd).trim() !== tested) throw new Error('The PR checkout is not the tested commit');
  const [header = ''] = git(['cat-file', 'commit', tested], cwd).split('\n\n', 1);
  const parents = header
    .split('\n')
    .filter((line) => line.startsWith('parent '))
    .map((line) => line.slice(7));
  const [first, second] = parents;
  if (parents.length !== 2 || !first || second !== prHead) throw new Error('Unexpected PR merge parents');
  if (!sha.test(payloadBase)) return '';
  if (first !== payloadBase) {
    try {
      git(['cat-file', '-e', payloadBase + '^{commit}'], cwd);
    } catch {
      return ''; // Missing base: verify ALL, without a reusable parent identity.
    }
    git(['merge-base', '--is-ancestor', payloadBase, first], cwd);
  }
  return first;
}

if (import.meta.main) {
  const [, , payloadBase, tested, prHead] = process.argv;
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' && !prHead) throw new Error('Missing PR head');
  const base = routingBase(payloadBase ?? '', tested ?? '', prHead);
  const result = { base, ...routeTrees(base, tested ?? '') };
  for (const [name, value] of Object.entries(result)) {
    // Encode explanations as JSON too: Git paths can contain embedded newlines.
    console.log(name + '=' + (typeof value === 'object' || name === 'reason' ? JSON.stringify(value) : String(value)));
  }
}
