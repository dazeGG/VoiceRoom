import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const policy = 'config/coverage/release-250-thresholds.json';

function git(...args: string[]) {
  return execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
}

function revision(ref: string) {
  return git('rev-parse', '--verify', '--end-of-options', ref).toString().trim();
}

function protectedTree(base: string) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(base)) throw new Error('Expected a full protected base commit SHA');
  try {
    return revision(`${base}^{tree}`);
  } catch {
    git('fetch', '--no-tags', 'origin', base);
    return revision(`${base}^{tree}`);
  }
}

const { values } = parseArgs({
  options: { base: { type: 'string' }, tested: { type: 'string' }, out: { type: 'string' } }
});
const { base, tested, out } = values;
if (!base || !tested || !out) throw new Error('Usage: g08-inputs.mts --base <sha> --tested HEAD --out <directory>');

const head = revision('HEAD^{commit}');
if (revision(`${tested}^{commit}`) !== head) throw new Error('The tested commit does not match checked-out HEAD');
if (process.env.GITHUB_EVENT_NAME === 'pull_request' && head !== process.env.GITHUB_SHA) {
  throw new Error('Checked-out HEAD does not match the pull request GITHUB_SHA');
}

const baseTree = protectedTree(base);
const testedTree = revision(`${head}^{tree}`);
const diff = [
  '-c',
  'core.quotePath=false',
  'diff',
  '--find-renames',
  '--no-ext-diff',
  '--no-textconv',
  '--diff-filter=d',
  baseTree,
  testedTree
];
// Name-only keeps the destination even for a 100% rename (no patch hunks):
// the evaluator then checks the entire file if its new name is eligible.
const names = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  .decode(git(...diff, '--name-only', '-z', '--'))
  .split('\0')
  .filter(Boolean);
for (const name of names) {
  // The existing evaluator consumes one unquoted, trimmed destination per line.
  if (name !== name.trim() || /["\\\p{Cc}]/u.test(name)) {
    throw new Error(`Destination cannot be represented in G08 inputs: ${JSON.stringify(name)}`);
  }
}
const patch = git(
  ...diff,
  '--unified=0',
  '--inter-hunk-context=0',
  '--no-color',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--'
)
  .toString()
  // Git appends a tab to the destination header of paths containing spaces.
  .replace(/^(\+\+\+ b\/[^\n\t]+)\t$/gm, '$1');

// An empty, successful listing means first adoption. A missing tree/blob or
// other Git error must not masquerade as an absent protected policy.
const hasPolicy = git('ls-tree', baseTree, '--', policy).length !== 0;
const thresholds = hasPolicy ? git('cat-file', 'blob', `${baseTree}:${policy}`) : null;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'release-250-changed-files.txt'), names.map((name) => `${name}\n`).join(''));
writeFileSync(join(out, 'release-250-changed.diff'), patch);
const thresholdsPath = join(out, 'release-250-base-thresholds.json');
if (thresholds) {
  writeFileSync(thresholdsPath, thresholds);
  console.log(`--base-thresholds ${thresholdsPath}`);
} else {
  rmSync(thresholdsPath, { force: true });
  console.log('--base-thresholds-absent');
}
