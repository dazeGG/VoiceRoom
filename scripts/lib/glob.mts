// File walking and glob matching for the boundary checks (import-boundary.mts,
// check-api-sources.mts) and their config.
import fs from 'node:fs';
import path from 'node:path';

// Paths in the config are relative to the repository root, not the caller's cwd.
export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

export function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

/** The files under root that `include` accepts, skipping node_modules and .git. */
export function walkFiles(root: string, include: (file: string) => boolean, collected: string[] = []): string[] {
  if (!fs.existsSync(root)) return collected;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (include(root)) collected.push(normalizePath(root));
    return collected;
  }
  for (const entry of fs.readdirSync(root)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    walkFiles(path.join(root, entry), include, collected);
  }
  return collected;
}

/** walkFiles over a repository directory, as repository-relative paths. */
export function repoFiles(dir: string, include: (file: string) => boolean): string[] {
  return walkFiles(path.join(REPO_ROOT, dir), include).map((file) => normalizePath(path.relative(REPO_ROOT, file)));
}

export function readSource(filePath: string): string | null {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
  return fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : null;
}

const escapeRegExp = (value: string) => value.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/**
 * `**` crosses directories, `*` stays inside one, `{a,b}` is either part. The
 * glob matches at the end of a path, so an absolute fixture path matches the
 * repository-relative glob it ends with.
 */
export function globToRegExp(glob: string): RegExp {
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
          .map(escapeRegExp)
          .join('|')})`;
        index = end;
      }
    } else {
      pattern += escapeRegExp(char);
    }
  }
  pattern = pattern.replace(/\.\*\/\[\^\/\]\*/g, '.*');
  return new RegExp(`(?:^|.*/)${pattern}$`);
}
