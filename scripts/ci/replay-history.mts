import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isArray, isRecord } from '../../packages/shared/src/guards.ts';

const exec = promisify(execFile);
const options = { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' } as const;
const sha = /^[0-9a-f]{40}$/;

function records(value: unknown): Record<string, unknown>[] {
  assert.ok(isArray(value) && value.every(isRecord), 'Expected records from GitHub');
  return [...value];
}

function str(value: unknown): string {
  assert.equal(typeof value, 'string');
  return String(value);
}

function integer(value: unknown): number {
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
  return value;
}

async function gh(args: string[]) {
  const { stdout } = await exec('gh', args, options);
  return stdout;
}

async function pages(path: string, field: string) {
  const json: unknown = JSON.parse(await gh(['api', '--paginate', '--slurp', path]));
  return records(json).flatMap((page) => records(page[field]));
}

export async function lastMerged(repo: string, base: string, count: number) {
  const found: { number: number; branch: string; created: string; merged: string; updated: string }[] = [];
  const [owner, name] = repo.split('/');
  assert.ok(owner && name && /^[\w.-]+\/[\w.-]+$/.test(repo));
  const query = `query($owner:String!, $name:String!, $base:String!, $cursor:String) {
    repository(owner:$owner,name:$name) { pullRequests(first:50, after:$cursor, baseRefName:$base,
    states:MERGED, orderBy:{field:UPDATED_AT,direction:DESC}) {
    nodes { number headRefName createdAt updatedAt mergedAt } pageInfo { endCursor hasNextPage } } } }`;
  let cursor = '';
  do {
    const args = [
      'api',
      'graphql',
      '-f',
      'query=' + query,
      '-f',
      'owner=' + owner,
      '-f',
      'name=' + name,
      '-f',
      'base=' + base,
      '--jq',
      '.data.repository.pullRequests'
    ];
    if (cursor) args.push('-f', 'cursor=' + cursor);
    const page: unknown = JSON.parse(await gh(args));
    assert.ok(isRecord(page) && isRecord(page.pageInfo));
    const nodes = records(page.nodes).map((p) => ({
      number: integer(p.number),
      branch: str(p.headRefName),
      created: str(p.createdAt),
      merged: str(p.mergedAt),
      updated: str(p.updatedAt)
    }));
    found.push(...nodes);
    found.sort((a, b) => b.merged.localeCompare(a.merged));
    const cutoff = found[count - 1]?.merged;
    // No unseen PR can be merged later than its last update.
    if (!page.pageInfo.hasNextPage || (cutoff && cutoff > (nodes.at(-1)?.updated ?? ''))) break;
    cursor = str(page.pageInfo.endCursor);
  } while (cursor);
  return found.slice(0, count);
}

export async function workflowRuns(repo: string, pr: Awaited<ReturnType<typeof lastMerged>>[number]) {
  const params = new URLSearchParams({
    event: 'pull_request',
    branch: pr.branch,
    created: pr.created + '..' + pr.merged,
    per_page: '100'
  });
  return (await pages('repos/' + repo + '/actions/workflows/ci.yml/runs?' + params.toString(), 'workflow_runs'))
    .map((r) => ({
      id: integer(r.id),
      attempt: integer(r.run_attempt),
      head: str(r.head_sha),
      created: str(r.created_at),
      end: str(r.updated_at)
    }))
    .sort((a, b) => a.created.localeCompare(b.created));
}

export async function runJobs(repo: string, id: number) {
  return (await pages('repos/' + repo + '/actions/runs/' + String(id) + '/jobs?filter=all&per_page=100', 'jobs')).map(
    (j) => ({
      id: integer(j.id),
      attempt: integer(j.run_attempt),
      name: str(j.name),
      conclusion: str(j.conclusion),
      start: Date.parse(str(j.started_at)),
      end: Date.parse(str(j.completed_at)),
      steps: records(j.steps ?? [])
        .filter((s) => s.conclusion === 'failure')
        .map((s) => str(s.name))
    })
  );
}

async function git(...args: string[]) {
  return (await exec('git', args, options)).stdout.trim();
}

export function checkoutCommit(log: string, pr: number) {
  // Read checkout's actual fetch refspec, not the run head (which is a PR head, not a tested merge).
  const candidates = [...log.matchAll(/\+([0-9a-f]{40}):refs\/remotes\/pull\/(\d+)\/merge\b/g)];
  const commit = candidates.find((m) => Number(m[2]) === pr)?.[1];
  assert.ok(
    commit && candidates.every((m) => m[1] === commit && Number(m[2]) === pr),
    'No unambiguous PR checkout refspec'
  );
  const checked = /\[command\][^\n]*git log -1 --format=%H\r?\n\S+ ([0-9a-f]{40})\b/.exec(log)?.[1];
  assert.equal(checked, commit, 'Checkout HEAD differs from the PR merge refspec');
  return commit;
}

export async function testedTrees(repo: string, pr: number, job: number, head: string) {
  const log = await gh(['api', '--allow-escape-sequences', 'repos/' + repo + '/actions/jobs/' + String(job) + '/logs']);
  const tested = checkoutCommit(log, pr);
  const commit: unknown = JSON.parse(await gh(['api', 'repos/' + repo + '/git/commits/' + tested]));
  assert.ok(isRecord(commit) && commit.sha === tested && isRecord(commit.tree));
  const parents = records(commit.parents);
  const base = str(parents[0]?.sha);
  const tree = str(commit.tree.sha);
  assert.ok(
    sha.test(base) && sha.test(tree) && sha.test(head) && parents.length === 2 && parents[1]?.sha === head,
    'Tested merge parents differ from the run head'
  );
  try {
    await git('cat-file', '-e', tree + '^{tree}');
    await git('cat-file', '-e', base + '^{tree}');
  } catch {
    // Recover unreachable history without switching branches; never substitute the final merge or today's base.
    try {
      assert.equal(await git('merge-tree', '--write-tree', base, head), tree);
    } catch {
      await git('fetch', '--no-tags', '--no-write-fetch-head', 'origin', tested);
      assert.equal(await git('rev-parse', tested + '^{tree}'), tree);
    }
  }
  return { base, tree };
}
