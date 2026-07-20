#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function walkFiles(root, collected = []) {
  if (!fs.existsSync(root)) return collected;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (root.endsWith(".js")) collected.push(normalizePath(root));
    return collected;
  }
  for (const entry of fs.readdirSync(root)) {
    if (entry === "node_modules" || entry === ".git") continue;
    walkFiles(path.join(root, entry), collected);
  }
  return collected;
}

function globToRegExp(glob) {
  const value = normalizePath(glob);
  let pattern = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
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

function isOwner(filePath, owners, prefixes) {
  return owners.some((owner) => filePath === owner || filePath.endsWith(`/${owner}`))
    || prefixes.some((prefix) => filePath.startsWith(prefix) || filePath.includes(`/${prefix}`));
}

function findSqlWrites(source) {
  const writes = [];
  const pattern = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(pattern)) writes.push(match[1].toLowerCase());
  return writes;
}

function findTimers(source) {
  const timers = [];
  const pattern = /\b(setInterval|setTimeout)\s*\(/g;
  for (const match of source.matchAll(pattern)) timers.push(match[1]);
  return timers;
}

export function checkApiSources({ config, files }) {
  const violations = [];
  const fileSet = files || walkFiles("apps/api/src");
  const ownerPrefixes = config.writeRules?.ownerPathPrefixes || [];
  const allowedOwners = config.writeRules?.allowedOwners || {};

  for (const filePath of fileSet) {
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath, "utf8");
    for (const table of findSqlWrites(source)) {
      const owners = allowedOwners[table];
      if (owners && !isOwner(filePath, owners, ownerPrefixes)) {
        violations.push({ ruleId: "direct-foreign-table-write", filePath, table, owners });
      }
    }

    const timerForbidden = (config.timerRules?.forbiddenSources || []).some((glob) => globToRegExp(glob).test(filePath));
    if (timerForbidden) {
      for (const timer of findTimers(source)) violations.push({ ruleId: "api-listener-worker-timer", filePath, timer });
    }
  }
  return violations;
}

function parseArgs(argv) {
  const args = { config: "config/import-boundaries.v1.json", files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") args.config = argv[++index];
    else args.files.push(arg);
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
