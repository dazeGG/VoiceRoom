#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

// Paths in the config are relative to the repository root, not the caller's cwd.
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function repoFiles(dir: string): string[] {
  return walkFiles(path.join(REPO_ROOT, dir)).map((file) => normalizePath(path.relative(REPO_ROOT, file)));
}

function readSource(filePath: string): string | null {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
  return fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : null;
}

const ImportRule = Type.Object({
  id: Type.String(),
  sources: Type.Array(Type.String()),
  forbidden: Type.Array(Type.String()),
  message: Type.String()
});
type ImportRule = Static<typeof ImportRule>;
const ImportConfig = Type.Object({ importRules: Type.Optional(Type.Array(ImportRule)) });
type Violation = { ruleId: string; filePath: string; imported: string; message: string };

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function walkFiles(root: string, collected: string[] = []): string[] {
  if (!fs.existsSync(root)) return collected;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (/\.(?:js|mjs|cjs|ts|mts|cts|svelte)$/.test(root)) collected.push(normalizePath(root));
    return collected;
  }
  for (const entry of fs.readdirSync(root)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    walkFiles(path.join(root, entry), collected);
  }
  return collected;
}

function globToRegExp(glob: string): RegExp {
  const value = normalizePath(glob);
  let pattern = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char === '*' && value[index + 1] === '*') {
      pattern += '.*';
      index += 1;
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '{') {
      const end = value.indexOf('}', index);
      if (end === -1) pattern += '\\{';
      else {
        pattern += `(?:${value
          .slice(index + 1, end)
          .split(',')
          .map((part: string) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
          .join('|')})`;
        index = end;
      }
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  pattern = pattern.replace(/\.\*\/\[\^\/\]\*/g, '.*');
  return new RegExp(`(?:^|.*/)${pattern}$`);
}

function extractImports(source: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/g
  ];
  for (const pattern of patterns) {
    for (const [, imported] of source.matchAll(pattern)) if (imported) imports.push(imported);
  }
  return imports;
}

export function checkImportBoundaries({
  config,
  files
}: {
  config: { importRules?: ImportRule[] };
  files?: string[];
}): Violation[] {
  const violations: Violation[] = [];
  const fileSet = files || repoFiles('.');
  for (const rule of config.importRules || []) {
    const sources = rule.sources.map(globToRegExp);
    for (const filePath of fileSet.filter((candidate) => sources.some((source) => source.test(candidate)))) {
      const source = readSource(filePath);
      if (source === null) continue;
      for (const imported of extractImports(source)) {
        if (rule.forbidden.some((forbidden) => imported === forbidden || imported.includes(forbidden))) {
          violations.push({ ruleId: rule.id, filePath, imported, message: rule.message });
        }
      }
    }
  }
  return violations;
}

function parseArgs(argv: string[]): { config: string; files: string[] } {
  const args: { config: string; files: string[] } = { config: 'config/import-boundaries.v1.json', files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      const value = argv[++index];
      if (value === undefined) throw new Error('--config needs a file path');
      args.config = value;
    } else if (arg !== undefined) args.files.push(arg);
  }
  return args;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const config: unknown = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  if (!Value.Check(ImportConfig, config)) throw new Error(`${args.config} does not hold valid import rules`);
  const violations = checkImportBoundaries({
    config,
    files: args.files.length ? args.files.map(normalizePath) : undefined
  });
  if (violations.length) {
    console.error(JSON.stringify({ ok: false, violations }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true }, null, 2));
  }
}
