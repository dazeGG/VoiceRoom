#!/usr/bin/env node
// Copy check for the move of the web from Svelte (apps/web) to Vue
// (apps/web-vue): a framework-free file is copied as is, so it may differ from
// its Svelte original only in where it imports from. Import and re-export
// statements, the paths of dynamic imports and blank lines are left out of the
// comparison; any other difference fails and is listed. Import and re-export
// statements that still differ after normalising (`$lib/` to `@/`, `.svelte.ts`
// to `.ts`, spacing and line breaks) are printed as a non-failing "imports
// differ (review)" note. Reviewers skip the files that pass without a note.
//
// Usage: node scripts/compare-web-port.mts <apps/web-vue/{src,test}/... file>...
// The original is found by path: apps/web-vue/src/X is apps/web/src/lib/X, and
// apps/web-vue/test/X is apps/web/test/X.

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

const PORT_ROOTS: ReadonlyArray<readonly [port: string, original: string]> = [
  ['apps/web-vue/src/', 'apps/web/src/lib/'],
  ['apps/web-vue/test/', 'apps/web/test/']
];

/** The Svelte original of a ported file, both relative to the repository root. */
export function webOriginalOf(portPath: string): string {
  const path = portPath.split('\\').join('/');
  for (const [port, original] of PORT_ROOTS) {
    if (path.startsWith(port)) return `${original}${path.slice(port.length)}`;
  }
  throw new Error(`${portPath} is not under ${PORT_ROOTS.map(([port]) => port).join(' or ')}`);
}

const MODULE_STATEMENT_START = /^\s*(?:import(?!\s*\()|export\s+(?:type\s+)?(?:\*|\{))/;
const STATEMENT_FROM = /\bfrom\s*(['"])[^'"]+\1/;
const SIDE_EFFECT_IMPORT = /^\s*import\s*(['"])[^'"]+\1/;
const DYNAMIC_IMPORT_PATH = /\bimport\(\s*(['"`])[^'"`]+\1\s*\)/g;

interface Scan {
  kept: Array<{ line: number; text: string }>;
  /** Import and re-export statements with a module path, as written (a multi-line one keeps its line breaks). */
  statements: string[];
}

function scan(source: string): Scan {
  const lines = source.split(/\r?\n/);
  const kept: Scan['kept'] = [];
  const statements: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    if (MODULE_STATEMENT_START.test(text)) {
      // A statement may span lines (`import {\n  a,\n  b\n} from '...';`).
      let end = index;
      let statement = text;
      while (!/;\s*$|^\s*import\s*['"]|\bfrom\s*['"][^'"]+['"]\s*$/.test(lines[end] ?? '') && end + 1 < lines.length) {
        end += 1;
        statement += `\n${lines[end] ?? ''}`;
      }
      // `export { a, b };` names local values; only statements with a module path are skipped.
      if (STATEMENT_FROM.test(statement) || SIDE_EFFECT_IMPORT.test(statement)) {
        statements.push(statement);
        index = end;
        continue;
      }
    }
    if (!text.trim()) continue;
    kept.push({ line: index + 1, text: text.trimEnd().replace(DYNAMIC_IMPORT_PATH, 'import(<path>)') });
  }
  return { kept, statements };
}

/** The lines that must match the original: no module statements, no blank lines. */
export function codeLines(source: string): Array<{ line: number; text: string }> {
  return scan(source).kept;
}

/**
 * An import or re-export statement without the differences a port is expected
 * to have: `$lib/` is `@/`, `.svelte.ts` is `.ts`, tests reach `../src/`
 * instead of `../src/lib/`, and line breaks, spacing, a trailing comma in the
 * braces and the final `;` do not count.
 */
function normalizeStatement(statement: string, forTest: boolean): string {
  let text = statement.replaceAll('$lib/', '@/').replaceAll('.svelte.ts', '.ts');
  if (forTest) text = text.replaceAll('../src/lib/', '../src/');
  return text
    .replace(/\s+/g, ' ')
    .replace(/\{\s*/g, '{ ')
    .replace(/,?\s*\}/g, ' }')
    .replace(/;\s*$/, '')
    .trim();
}

/**
 * Import and re-export statements that differ between the original and the port
 * after normalising, as `- ` (only in the original) and `+ ` (only in the port).
 * They never fail the comparison; a reviewer reads them.
 */
export function importDifferences(original: string, port: string, forTest = false): string[] {
  const normalize = (source: string) =>
    scan(source).statements.map((statement) => normalizeStatement(statement, forTest));
  const remaining = normalize(port);
  const differences: string[] = [];
  for (const statement of normalize(original)) {
    const index = remaining.indexOf(statement);
    if (index === -1) differences.push(`- ${statement}`);
    else remaining.splice(index, 1);
  }
  return [...differences, ...remaining.map((statement) => `+ ${statement}`)];
}

/**
 * Lines that differ between the original and the port after codeLines(),
 * as `-` (only in the original) and `+` (only in the port) with their line numbers.
 */
export function compareWithOriginal(original: string, port: string): string[] {
  const before = codeLines(original);
  const after = codeLines(port);
  // Longest common subsequence, so one inserted line reports as one line.
  const width = after.length + 1;
  const common = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      common[i * width + j] =
        before[i]?.text === after[j]?.text
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0);
    }
  }
  const differences: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const left = before[i];
    const right = after[j];
    if (left && right && left.text === right.text) {
      i += 1;
      j += 1;
    } else if (left && (!right || (common[(i + 1) * width + j] ?? 0) >= (common[i * width + j + 1] ?? 0))) {
      differences.push(`- ${left.line}: ${left.text}`);
      i += 1;
    } else if (right) {
      differences.push(`+ ${right.line}: ${right.text}`);
      j += 1;
    }
  }
  return differences;
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.stderr.write('usage: compare-web-port.mts <apps/web-vue/{src,test}/... file>...\n');
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    const portPath = relative(repoRoot, resolve(file)).split('\\').join('/');
    let originalPath: string;
    try {
      originalPath = webOriginalOf(portPath);
    } catch (error) {
      failed = true;
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      continue;
    }
    if (!existsSync(resolve(repoRoot, originalPath))) {
      failed = true;
      process.stderr.write(`${portPath}: no Svelte original at ${originalPath}\n`);
      continue;
    }
    const originalSource = readFileSync(resolve(repoRoot, originalPath), 'utf8');
    const portSource = readFileSync(resolve(repoRoot, portPath), 'utf8');
    const imports = importDifferences(originalSource, portSource, portPath.startsWith('apps/web-vue/test/'));
    if (imports.length > 0) process.stdout.write(`${portPath}: imports differ (review):\n${imports.join('\n')}\n`);
    const differences = compareWithOriginal(originalSource, portSource);
    if (differences.length === 0) {
      process.stdout.write(`same as ${originalPath}: ${portPath}\n`);
      continue;
    }
    failed = true;
    process.stderr.write(`${portPath} differs from ${originalPath} beyond imports:\n${differences.join('\n')}\n`);
  }
  if (failed) process.exit(1);
}
