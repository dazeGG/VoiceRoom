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

const Paths = Type.Array(Type.String());
const SourceConfig = Type.Object({
  writeRules: Type.Optional(
    Type.Object({
      ownerPathPrefixes: Type.Optional(Paths),
      allowedOwners: Type.Optional(Type.Record(Type.String(), Paths)),
      crossDomainWriters: Type.Optional(Type.Record(Type.String(), Paths))
    })
  ),
  timerRules: Type.Optional(Type.Object({ forbiddenSources: Type.Optional(Paths) }))
});
type SourceConfig = Static<typeof SourceConfig>;
type Violation = Record<string, unknown> & { ruleId: string; filePath: string };

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function walkFiles(root: string, collected: string[] = []): string[] {
  if (!fs.existsSync(root)) return collected;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (/\.(?:js|mts|ts)$/.test(root) && !root.endsWith('.d.ts')) collected.push(normalizePath(root));
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
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  pattern = pattern.replace(/\.\*\/\[\^\/\]\*/g, '.*');
  return new RegExp(`(?:^|.*/)${pattern}$`);
}

function isOwner(filePath: string, owners: string[], prefixes: string[]): boolean {
  return (
    owners.some((owner) => filePath === owner || filePath.endsWith(`/${owner}`)) ||
    prefixes.some((prefix) => filePath.startsWith(prefix) || filePath.includes(`/${prefix}`))
  );
}

function findSqlWrites(source: string): string[] {
  const writes: string[] = [];
  const pattern = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi;
  for (const [, table] of source.matchAll(pattern)) if (table) writes.push(table.toLowerCase());
  // Kysely writes name their table as the first string argument.
  const builder = /\.(?:insertInto|updateTable|deleteFrom|replaceInto|mergeInto)\(\s*['"`]([a-z_][a-z0-9_]*)/gi;
  for (const [, table] of source.matchAll(builder)) if (table) writes.push(table.toLowerCase());
  return writes;
}

function findTimers(source: string): string[] {
  const timers: string[] = [];
  const pattern = /\b(setInterval|setTimeout)\s*\(/g;
  for (const [, timer] of source.matchAll(pattern)) if (timer) timers.push(timer);
  return timers;
}

// A file listed here writes across domains on purpose, such as erasing an
// account from every table in one transaction. The exception is bounded: it
// may touch only the tables declared next to it.
function crossDomainTablesFor(filePath: string, crossDomainWriters: Record<string, string[]>): string[] | null {
  for (const [owner, tables] of Object.entries(crossDomainWriters)) {
    if (filePath === owner || filePath.endsWith(`/${owner}`)) return tables;
  }
  return null;
}

export function checkApiSources({
  config,
  files
}: {
  config: SourceConfig;
  files?: string[] | undefined;
}): Violation[] {
  const violations: Violation[] = [];
  const fileSet = files || repoFiles('apps/api/src');
  const ownerPrefixes = config.writeRules?.ownerPathPrefixes || [];
  const allowedOwners = config.writeRules?.allowedOwners || {};
  const crossDomainWriters = config.writeRules?.crossDomainWriters || {};

  for (const filePath of fileSet) {
    const source = readSource(filePath);
    if (source === null) continue;
    const declaredCrossDomain = crossDomainTablesFor(filePath, crossDomainWriters);
    for (const table of findSqlWrites(source)) {
      const owners = allowedOwners[table];
      if (!owners || isOwner(filePath, owners, ownerPrefixes)) continue;
      if (declaredCrossDomain?.includes(table)) continue;
      violations.push({ ruleId: 'direct-foreign-table-write', filePath, table, owners });
    }

    const timerForbidden = (config.timerRules?.forbiddenSources || []).some((glob) =>
      globToRegExp(glob).test(filePath)
    );
    if (timerForbidden) {
      for (const timer of findTimers(source)) violations.push({ ruleId: 'api-listener-worker-timer', filePath, timer });
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
  if (!Value.Check(SourceConfig, config)) throw new Error(`${args.config} does not hold valid write and timer rules`);
  const violations = checkApiSources({ config, files: args.files.length ? args.files.map(normalizePath) : undefined });
  if (violations.length) {
    console.error(JSON.stringify({ ok: false, violations }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true }, null, 2));
  }
}
