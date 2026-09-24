#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type ImportRule = { id: string; sources: string[]; forbidden: string[]; message: string };
type Violation = { ruleId: string; filePath: string; imported: string; message: string };

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function walkFiles(root: string, collected: string[] = []): string[] {
  if (!fs.existsSync(root)) return collected;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (/\.(?:js|mjs|cjs|ts|mts|cts|svelte)$/.test(root)) collected.push(normalizePath(root));
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
    } else if (char === "{") {
      const end = value.indexOf("}", index);
      if (end === -1) pattern += "\\{";
      else {
        pattern += `(?:${value.slice(index + 1, end).split(",").map((part: string) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("|")})`;
        index = end;
      }
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  pattern = pattern.replace(/\.\*\/\[\^\/\]\*/g, ".*");
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
    for (const match of source.matchAll(pattern)) imports.push(match[1] as string);
  }
  return imports;
}

export function checkImportBoundaries({ config, files }: { config: { importRules?: ImportRule[] }; files?: string[] }): Violation[] {
  const violations: Violation[] = [];
  const fileSet = files || walkFiles(".");
  for (const rule of config.importRules || []) {
    const sources = rule.sources.map(globToRegExp);
    for (const filePath of fileSet.filter((candidate) => sources.some((source) => source.test(candidate)))) {
      if (!fs.existsSync(filePath)) continue;
      const source = fs.readFileSync(filePath, "utf8");
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
  const violations = checkImportBoundaries({ config, files: args.files.length ? args.files.map(normalizePath) : undefined });
  if (violations.length) {
    console.error(JSON.stringify({ ok: false, violations }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true }, null, 2));
  }
}
