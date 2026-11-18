import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { isRecord } from '../../packages/shared/src/guards.ts';

const SITE = 'apps/site';
type Workspace = 'app' | 'site';
type VersionChanges = { manifest?: 'app'; lock?: Workspace };

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
    const appPackages = normalize(['', 'apps/admin', 'apps/api', 'apps/web']);
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
    } else if (path === 'package.json' && versionChanges.manifest) {
      lanes[versionChanges.manifest] = true;
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
    } else if (
      path.startsWith('packages/') ||
      /^apps\/web\/src\/(?:styles\/(?:_tokens|_typography)\.scss$|assets\/fonts\/)/.test(path) ||
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

function git(args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function compareVersionMetadata<T>(
  base: string,
  head: string,
  path: string,
  compare: (before: string, after: string) => T
) {
  try {
    return compare(git(['show', `${base}:${path}`]), git(['show', `${head}:${path}`]));
  } catch {
    // A missing manifest or lockfile is a shared change. Let both builds report it.
  }
}

if (import.meta.main) {
  const [, , base, head] = process.argv;
  const sha = /^[a-f0-9]{40}$/;
  if (!base || !head || !sha.test(base) || !sha.test(head)) throw new Error('Expected base and head commit SHAs');
  const lanes = /^0+$/.test(base)
    ? { app: true, site: true, docs: true }
    : (() => {
        // Compare the exact trees CI sees. Treat renames as deletion plus addition so both lanes get coverage.
        const paths = git(['diff', '--name-only', '--no-renames', '-z', base, head, '--']).split('\0').filter(Boolean);
        const versions: VersionChanges = {};
        if (paths.includes('package.json') && compareVersionMetadata(base, head, 'package.json', manifestVersionOnly)) {
          versions.manifest = 'app';
        }
        if (paths.includes('package-lock.json')) {
          const component = compareVersionMetadata(base, head, 'package-lock.json', lockVersionComponent);
          if (component) versions.lock = component;
        }
        return changedComponents(paths, versions);
      })();
  for (const [name, changed] of Object.entries(lanes)) console.log(`${name}=${changed}`);
}
