#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type SourceConfig = {
  writeRules?: { ownerPathPrefixes?: string[]; allowedOwners?: Record<string, string[]>; crossDomainWriters?: Record<string, string[]> };
  timerRules?: { forbiddenSources?: string[] };
};
type Violation = Record<string, unknown> & { ruleId: string; filePath: string };

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function walkFiles(root: string, collected: string[] = []): string[] {
  if (!fs.existsSync(root)) return collected;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (/\.(?:js|mts|ts)$/.test(root) && !root.endsWith('.d.ts')) collected.push(normalizePath(root));
    return collected;
  }
  for (const entry of fs.readdirSync(root)) {
    if (entry === "node_modules" || entry === ".git") continue;
    walkFiles(path.join(root, entry), collected);
  }
  return collected;
}

function globToRegExp(glob: string): RegExp {
  const value = normalizePath(glob);
  let pattern = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string;
    if (char === "*" && value[index + 1] === "*") {
      pattern += ".*";
      index += 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  pattern = pattern.replace(/\.\*\/\[\^\/\]\*/g, ".*");
  return new RegExp(`(?:^|.*/)${pattern}$`);
}

function isOwner(filePath: string, owners: string[], prefixes: string[]): boolean {
  return owners.some((owner) => filePath === owner || filePath.endsWith(`/${owner}`))
    || prefixes.some((prefix) => filePath.startsWith(prefix) || filePath.includes(`/${prefix}`));
}

function findSqlWrites(source: string): string[] {
  const writes: string[] = [];
  const pattern = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(pattern)) writes.push((match[1] as string).toLowerCase());
  // Kysely writes name their table as the first string argument.
  const builder = /\.(?:insertInto|updateTable|deleteFrom|replaceInto|mergeInto)\(\s*['"`]([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(builder)) writes.push((match[1] as string).toLowerCase());
  return writes;
}

function findTimers(source: string): string[] {
  const timers: string[] = [];
  const pattern = /\b(setInterval|setTimeout)\s*\(/g;
  for (const match of source.matchAll(pattern)) timers.push(match[1] as string);
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

export function checkApiSources({ config, files }: { config: SourceConfig; files?: string[] }): Violation[] {
  const violations: Violation[] = [];
  const fileSet = files || walkFiles("apps/api/src");
  const ownerPrefixes = config.writeRules?.ownerPathPrefixes || [];
  const allowedOwners = config.writeRules?.allowedOwners || {};
  const crossDomainWriters = config.writeRules?.crossDomainWriters || {};

  for (const filePath of fileSet) {
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath, "utf8");
    const declaredCrossDomain = crossDomainTablesFor(filePath, crossDomainWriters);
    for (const table of findSqlWrites(source)) {
      const owners = allowedOwners[table];
      if (!owners || isOwner(filePath, owners, ownerPrefixes)) continue;
      if (declaredCrossDomain?.includes(table)) continue;
      violations.push({ ruleId: "direct-foreign-table-write", filePath, table, owners });
    }

    const timerForbidden = (config.timerRules?.forbiddenSources || []).some((glob) => globToRegExp(glob).test(filePath));
    if (timerForbidden) {
      for (const timer of findTimers(source)) violations.push({ ruleId: "api-listener-worker-timer", filePath, timer });
    }
  }
  return violations;
}

function parseArgs(argv: string[]): { config: string; files: string[] } {
  const args: { config: string; files: string[] } = { config: "config/import-boundaries.v1.json", files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") args.config = argv[++index] as string;
    else args.files.push(arg as string);
  }
  return args;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(fs.readFileSync(args.config, "utf8"));
  const violations = checkApiSources({ config, files: args.files.length ? args.files.map(normalizePath) : undefined });
  if (violations.length) {
    console.error(JSON.stringify({ ok: false, violations }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true }, null, 2));
  }
}
