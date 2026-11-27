import { posix } from 'node:path';
import { isArray, isRecord } from '../../packages/shared/src/guards.ts';

export interface RoutingWorkspace {
  dir: string;
  name: string;
  dependencies: string[];
  localDirs: Record<string, string>;
  requiredLocal: string[];
  tests: boolean;
  exports?: unknown;
  main?: string;
  module?: string;
}

function strings(value: unknown): string[] {
  if (!isArray(value) || !value.every((item): item is string => typeof item === 'string' && !!item)) {
    throw new Error('Invalid routing metadata');
  }
  return [...value];
}

export function workspaceDirs(root: unknown, treePaths: string[]) {
  if (!isRecord(root)) throw new Error('Invalid root manifest');
  const dirs = new Set<string>();
  for (const pattern of strings(root.workspaces)) {
    if (!/^(apps|packages)\/(?:[\w-]+|\*)$/.test(pattern)) throw new Error('Unresolved workspace pattern');
    if (pattern.endsWith('/*')) {
      const matches = treePaths.filter(
        (path) => path.startsWith(pattern.slice(0, -1)) && /^[^/]+\/[^/]+\/package\.json$/.test(path)
      );
      if (!matches.length) throw new Error('Unresolved workspace glob');
      for (const match of matches) dirs.add(match.slice(0, -'/package.json'.length));
    } else {
      dirs.add(pattern);
    }
  }
  if (!dirs.size) throw new Error('Empty workspace inventory');
  return [...dirs];
}

export function workspace(dir: string, manifest: unknown): RoutingWorkspace {
  if (!isRecord(manifest) || typeof manifest.name !== 'string') throw new Error('Unresolved workspace name');
  const dependencies: string[] = [];
  const requiredLocal: string[] = [];
  const localDirs: Record<string, string> = {};
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[key];
    if (deps === undefined) continue;
    if (!isRecord(deps)) throw new Error('Invalid workspace dependencies');
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string') throw new Error('Invalid dependency spec');
      dependencies.push(name);
      if (/^npm:/.test(spec)) throw new Error('Unresolved workspace alias');
      if (name.startsWith('@voiceroom/') || /^(workspace:|file:|link:)/.test(spec)) requiredLocal.push(name);
      if (/^(?:file|link):/.test(spec))
        localDirs[name] = posix.normalize(posix.join(dir, spec.slice(spec.indexOf(':') + 1)));
    }
  }
  return {
    dir,
    name: manifest.name,
    dependencies,
    requiredLocal,
    localDirs,
    exports: manifest.exports,
    ...(typeof manifest.main === 'string' ? { main: manifest.main } : {}),
    ...(typeof manifest.module === 'string' ? { module: manifest.module } : {}),
    tests: isRecord(manifest.scripts) && !!manifest.scripts.test
  };
}

export function reverseConsumers(trees: RoutingWorkspace[][], owners: Set<string>) {
  const consumers = new Set(owners);
  for (const tree of trees) {
    const names = new Map(tree.map((w) => [w.name, w.dir]));
    if (
      names.size !== tree.length ||
      tree.some((w) =>
        w.requiredLocal.some(
          (name) => !names.has(name) || (name in w.localDirs && w.localDirs[name] !== names.get(name))
        )
      )
    ) {
      throw new Error('Unresolved workspace dependency');
    }
  }
  // Union both graphs: deletions and a move cannot lose either endpoint.
  const workspaces = trees.flat();
  let previous = -1;
  while (previous !== consumers.size) {
    previous = consumers.size;
    for (const w of workspaces) {
      if (w.dependencies.some((name) => consumers.has(name))) consumers.add(w.name);
    }
  }
  return workspaces.filter((w) => consumers.has(w.name));
}

// G08 compares repo-relative paths after normalizing ./ and repeated separators.
function policyPaths(value: unknown) {
  return strings(value).map((path) => path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/'));
}

export function measuredInputs(policy: unknown) {
  if (!isRecord(policy) || !isArray(policy.strictBranchGroups)) throw new Error('Invalid G08 policy');
  const prefixes = policyPaths(policy.businessPathPatterns);
  if (policy.schemaVersion === 2) {
    if (!isRecord(policy.pooledBusinessCode)) throw new Error('Invalid G08 pool');
    prefixes.push(...policyPaths(policy.pooledBusinessCode.pathPatterns));
  }
  const exact = policyPaths(policy.strictBranchPaths ?? []);
  if (!prefixes.length) throw new Error('Empty G08 measurement policy');
  const fragments: string[] = [];
  for (const group of policy.strictBranchGroups) {
    if (!isRecord(group)) throw new Error('Invalid G08 group');
    exact.push(...policyPaths(group.paths ?? []));
    fragments.push(...policyPaths(group.pathPatterns ?? []));
  }
  return { prefixes, exact, fragments };
}
