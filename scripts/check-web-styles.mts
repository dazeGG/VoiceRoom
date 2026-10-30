#!/usr/bin/env node
// Style conventions of apps/web (apps/web/CLAUDE.md, rules 6-8), run by
// `npm run check`. Exits 1 and lists every violation as `file:line reason`:
//   - a .css or .sass file (styles are .scss partials only);
//   - `[data-` in a .scss file or a .vue <style> block, in any case (comments
//     are skipped);
//   - a `<style` block in a .vue file, unless the file is in STYLE_ALLOWLIST
//     and the line above the block is a one-line comment saying why;
//   - an import of `reka-ui` (any subpath, static or dynamic) in a .ts/.vue
//     file outside src/shared/ui/.

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { blank, blankComments } from './lib/blank-comments.mts';
import { walkFiles } from './lib/glob.mts';

interface StyleAllowance {
  /** Repo-relative path of the .vue file. */
  file: string;
  reason: string;
}

/** `<style>` blocks that may stay in a .vue file. Each file also carries a one-line comment above the block. */
export const STYLE_ALLOWLIST: readonly StyleAllowance[] = [];

const REKA_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])reka-ui(?:\/[^'"`]*)?\1/g;
const STYLE_BLOCK = /^[ \t]*<style\b/gm;
const SCRIPT_BLOCK = /<script\b[^>]*>(?<body>[\s\S]*?)<\/script>/g;
const STYLE_BODY = /<style\b[^>]*>(?<body>[\s\S]*?)<\/style>/g;
const ONE_LINE_COMMENT = /^\s*(?:<!--.*-->|\/\/.*|\/\*.*\*\/)\s*$/;

const lineAt = (source: string, index: number) => source.slice(0, index).split('\n').length;

/** The `body` of every block `pattern` finds in a .vue file, everything else blanked. */
function blocksOnly(source: string, pattern: RegExp): string {
  let out = blank(source);
  for (const match of source.matchAll(pattern)) {
    const body = match.groups?.body ?? '';
    const start = match.index + match[0].indexOf(body);
    out = out.slice(0, start) + body + out.slice(start + body.length);
  }
  return out;
}

/**
 * Violations under `srcRoot` (an app's src directory), each as `file:line reason`
 * with `file` relative to `repoRoot`. Allowlist files are repo-relative too.
 */
export function checkWebStyles(
  srcRoot: string,
  repoRoot: string,
  allowlist: readonly StyleAllowance[] = STYLE_ALLOWLIST
): string[] {
  const problems: string[] = [];
  const allowed = new Set(allowlist.map((entry) => entry.file));
  const styleFiles = new Set<string>();

  for (const absolute of walkFiles(srcRoot, () => true)) {
    const path = relative(repoRoot, absolute).split('\\').join('/');
    const inSharedUi = relative(resolve(srcRoot, 'shared/ui'), absolute).split(/[\\/]/)[0] !== '..';
    const isVue = absolute.endsWith('.vue');
    if (/\.(?:css|sass)$/.test(absolute)) {
      problems.push(`${path}:1 stylesheet must be a .scss partial under src/styles`);
      continue;
    }
    if (!isVue && !absolute.endsWith('.scss') && !absolute.endsWith('.ts')) continue;
    const source = readFileSync(absolute, 'utf8');

    // Rule 7 holds for every stylesheet of ours, allowlisted <style> blocks included.
    const styles = isVue ? blocksOnly(source, STYLE_BODY) : absolute.endsWith('.scss') ? source : '';
    for (const match of blankComments(styles).matchAll(/\[\s*data-/gi)) {
      problems.push(`${path}:${lineAt(source, match.index)} [data-*] selector; use aria-* or a BEM modifier class`);
    }

    if (isVue) {
      for (const match of source.matchAll(STYLE_BLOCK)) {
        const line = lineAt(source, match.index);
        styleFiles.add(path);
        if (!allowed.has(path)) {
          problems.push(`${path}:${line} <style> block; put the rules in src/styles/<area>/_<block>.scss`);
        } else if (!ONE_LINE_COMMENT.test(source.split('\n')[line - 2] ?? '')) {
          problems.push(`${path}:${line} allowlisted <style> block needs a one-line comment above it saying why`);
        }
      }
    }

    if (!isVue && !absolute.endsWith('.ts')) continue;
    if (inSharedUi) continue;
    const code = blankComments(isVue ? blocksOnly(source, SCRIPT_BLOCK) : source);
    for (const match of code.matchAll(REKA_IMPORT)) {
      problems.push(
        `${path}:${lineAt(source, match.index)} reka-ui import outside src/shared/ui; use the shared/ui wrapper`
      );
    }
  }

  for (const entry of allowlist) {
    if (!styleFiles.has(entry.file)) {
      problems.push(`${entry.file}:1 allowlist entry without a <style> block (${entry.reason})`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, '..');
  const problems = checkWebStyles(resolve(repoRoot, 'apps/web/src'), repoRoot);
  if (problems.length > 0) {
    process.stderr.write(`apps/web style conventions:\n${problems.sort().join('\n')}\n`);
    process.exit(1);
  }
}
