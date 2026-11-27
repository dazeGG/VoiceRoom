import { isBuiltin } from 'node:module';
import { posix } from 'node:path';
import { isArray, isRecord } from '../../packages/shared/src/guards.ts';
import { moduleImports } from './g08-imports.mts';
import type { measuredInputs, RoutingWorkspace } from './routing-inputs.mts';

type Measured = ReturnType<typeof measuredInputs>;
const extensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.vue', '.cjs', '.cts'];
const alwaysCovered = (path: string) => path.startsWith('apps/api/') || path.startsWith('packages/shared/');
const sourceFile = (path: string) => extensions.includes(posix.extname(path));
export class UnresolvedG08Input extends Error {}

function candidates(path: string) {
  const js = /^(.*)\.(js|jsx|mjs|cjs)$/.exec(path);
  const remap: Record<string, string[]> = { js: ['.ts', '.tsx', '.d.ts'], jsx: ['.tsx'], mjs: ['.mts'], cjs: ['.cts'] };
  return [
    path,
    ...(remap[js?.[2] ?? ''] ?? []).map((ext) => (js?.[1] ?? '') + ext),
    ...extensions.map((ext) => path + ext),
    ...extensions.map((ext) => posix.join(path, 'index' + ext))
  ];
}

function packageTargets(local: RoutingWorkspace, spec: string) {
  const subpath = '.' + spec.slice(local.name.length);
  if (local.exports === undefined) {
    if (subpath !== '.') return [subpath];
    return [...new Set([local.module ?? local.main ?? 'index', local.main ?? local.module ?? 'index'])];
  }
  let entry: unknown = local.exports;
  let substitution = '';
  if (isRecord(entry) && Object.keys(entry).some((k) => k.startsWith('.'))) {
    if (Object.hasOwn(entry, subpath)) entry = entry[subpath];
    else {
      // An exact key wins; otherwise prefer the longest matching prefix, then suffix.
      const matches = Object.keys(entry)
        .map((key) => ({ key, parts: key.split('*') }))
        .filter(
          ({ parts: [a, b, extra] }) =>
            a !== undefined &&
            b !== undefined &&
            extra === undefined &&
            subpath.startsWith(a) &&
            subpath.endsWith(b) &&
            subpath.length >= a.length + b.length
        )
        .sort((a, b) => (b.parts[0]?.length ?? 0) - (a.parts[0]?.length ?? 0) || b.key.length - a.key.length);
      const [match] = matches;
      if (!match) throw new Error(spec);
      substitution = subpath.slice(match.parts[0]?.length, subpath.length - (match.parts[1]?.length ?? 0));
      entry = entry[match.key];
    }
  } else if (subpath !== '.') throw new Error(spec);
  // For conditional exports, keep every possible concrete target. Do not guess
  // which of the Node, typecheck or browser conditions wins.
  function targets(value: unknown): string[] {
    if (typeof value === 'string' && value.startsWith('./')) return [value.replaceAll('*', () => substitution)];
    if (isArray(value)) return value.flatMap(targets);
    if (isRecord(value)) return Object.values(value).flatMap(targets);
    throw new Error(spec);
  }
  return targets(entry);
}

// This is a summary of one immutable Git tree. The caller unions the summaries
// of both sides of the diff; no resolver consults node_modules or the checkout.
export function g08Closure(
  measured: Measured,
  files: readonly string[],
  workspaces: readonly RoutingWorkspace[],
  read: (path: string) => string
): Measured {
  const tracked = new Set(files);
  const exact = new Set(measured.exact);
  const prefixes = new Set(measured.prefixes);
  const scoped = new Map(workspaces.map((entry) => [entry.name, entry]));
  const queue = files.filter(
    (file) =>
      !alwaysCovered(file) &&
      sourceFile(file) &&
      (exact.has(file) ||
        measured.prefixes.some((p) => file.startsWith(p)) ||
        measured.fragments.some((p) => file.includes(p)))
  );
  const seen = new Set<string>();
  for (const root of [...measured.exact, ...measured.prefixes]) {
    if (!alwaysCovered(root) && sourceFile(root) && !tracked.has(root))
      throw new UnresolvedG08Input('missing measured G08 source: ' + root);
  }
  for (const file of queue) {
    if (seen.has(file)) continue;
    seen.add(file);
    exact.add(file);
    const owner = workspaces.find((w) => file.startsWith(w.dir + '/'));
    try {
      const source = read(file); // Includes JSON leaves: a symlink is not a tracked data blob.
      if (file.endsWith('.json')) continue;
      for (const spec of moduleImports(file, source)) {
        if (isBuiltin(spec)) continue;
        function visit(target: string, sharedBoundary = false) {
          const resolved = candidates(target).find((candidate) => tracked.has(candidate));
          if (!resolved || !sourceFile(resolved)) throw new Error(spec);
          if (resolved.startsWith(target + '/index.') && tracked.has(target + '/package.json'))
            throw new Error(spec + ' (directory package entry)');
          if (sharedBoundary && resolved.startsWith('packages/shared/')) read(resolved);
          else queue.push(resolved);
        }
        if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
          visit(posix.join(posix.dirname(file), spec));
          continue;
        }
        const name = (spec.match(/^(@[^/]+\/[^/]+|[^/@.#][^/:]*)($|\/)/) ?? [])[1];
        const local = name && scoped.get(name);
        if (local) {
          const src = local.dir + '/src/';
          if (!files.some((f) => f.startsWith(src))) throw new Error(spec);
          if (!alwaysCovered(src)) prefixes.add(src);
          const targets = packageTargets(local, spec);
          if (!targets.length) throw new Error(spec);
          for (const target of targets) visit(posix.join(local.dir, target), local.name === '@voiceroom/shared');
        } else if (!name || name.startsWith('@voiceroom/') || !owner?.dependencies.includes(name)) {
          throw new Error(spec);
        }
        // Other declared npm dependencies are covered by manifest and lockfile routes.
      }
    } catch (error) {
      throw new UnresolvedG08Input(
        'unresolved G08 import in ' + file + ': ' + (error instanceof Error ? error.message : 'unknown input')
      );
    }
  }
  return { exact: [...exact], prefixes: [...prefixes], fragments: measured.fragments };
}
