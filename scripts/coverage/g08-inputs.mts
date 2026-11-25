import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const policy = 'config/coverage/release-250-thresholds.json';
const fullSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function git(...args: string[]) {
  return execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
}

function revision(ref: string) {
  return git('rev-parse', '--verify', '--end-of-options', ref).toString().trim();
}

function resolveOrFetch(sha: string, type: 'tree' | 'commit') {
  const ref = `${sha}^{${type}}`;
  try {
    return revision(ref);
  } catch {
    git('fetch', '--no-tags', 'origin', sha);
    return revision(ref);
  }
}

function protectedTree(base: string, checkout: string, prHead: string | undefined) {
  if (!fullSha.test(base)) throw new Error('Expected a full protected base commit SHA');
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return resolveOrFetch(base, 'tree');
  if (checkout !== process.env.GITHUB_SHA)
    throw new Error('Checked-out HEAD does not match the pull request GITHUB_SHA');
  if (!prHead || !fullSha.test(prHead)) throw new Error('Expected a full PR head commit SHA in --head');

  // A shallow checkout hides parents from revision walks, not from the commit header.
  const [header = ''] = git('cat-file', 'commit', checkout).toString().split('\n\n', 1);
  const [first, second, extra] = header
    .split('\n')
    .filter((line) => line.startsWith('parent '))
    .map((line) => line.slice(7));
  if (!first || !second || extra)
    throw new Error('The pull request checkout must be a merge commit with exactly two parents');
  if (second !== prHead) throw new Error(`Merge second parent ${second} does not match PR head ${prHead}`);

  const tree = resolveOrFetch(first, 'tree');
  if (base !== first) {
    if (resolveOrFetch(base, 'commit') !== base) throw new Error('The payload base must identify a commit');
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', base, first], { encoding: 'utf8' });
    if (ancestry.status === 1)
      throw new Error(`Payload base ${base} is not an ancestor of merge first parent ${first}`);
    if (ancestry.status !== 0)
      throw ancestry.error ?? new Error(`Unable to verify payload base ancestry: ${ancestry.stderr}`);
  }
  return tree;
}

const { values } = parseArgs({
  options: { base: { type: 'string' }, head: { type: 'string' }, tested: { type: 'string' }, out: { type: 'string' } }
});
const { base, tested, out } = values;
if (!base || !tested || !out)
  throw new Error('Usage: g08-inputs.mts --base <sha> [--head <PR head sha>] --tested HEAD --out <directory>');

const head = revision('HEAD^{commit}');
if (revision(`${tested}^{commit}`) !== head) throw new Error('The tested commit does not match checked-out HEAD');
const baseTree = protectedTree(base, head, values.head);
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
