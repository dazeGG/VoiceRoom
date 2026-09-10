# VoiceRoom

## Repository map
- `apps/api` is the Fastify/PostgreSQL/LiveKit backend.
- `apps/web` is the Svelte/Vite frontend.
- `packages/shared` owns contracts shared by API and Web. Update shared contracts before their consumers.
- `docs/GIT_FLOW.md` is the source of truth for branches, commits, pull requests, hotfixes, and releases.
- A release may add a `docs/RELEASE_<version>_PLAN.md` target-state plan; none is active now. Do not describe an unmet gate as already implemented.

## Mandatory Git Flow
- Before changing files, run `git status --short --branch` and preserve unrelated user changes.
- Normal work starts from `develop` on `feature/<short-name>` and returns through a pull request to `develop`.
- Never put feature commits directly on `develop` or `main`.
- Release stabilization uses `release/<version>` from `develop`; merge it into `main`, tag `v<version>`, then merge the release result back into `develop`.
- Production-only urgent fixes use `hotfix/<short-name>` from `main`; merge them into `main`, tag when applicable, then back-merge or cherry-pick into `develop`.
- Use Conventional Commit subjects: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `style:`, `build:`, `ci:`, or `revert:`. Add a scope when useful, for example `fix(api): ...`.
- Keep commits small and reviewable. Do not commit generated output, local secrets, screenshots, or debugging artifacts.
- Do not push, merge, tag, publish a release, or deploy unless the user explicitly requests that external action.

## Verification
- Prefer a targeted workspace test first.
- Repository gates are `npm run check`, `npm test`, and `npm run build`.
- Web end-to-end coverage is `npm run e2e` and requires the full stack described in `README.md`.
- Database changes must be checked against both migration and rollback paths.

## graphify

This project has a graphify knowledge graph at .graphify/.

Rules:
- For codebase or architecture questions, when `.graphify/graph.json` exists, first run `graphify query "<question>"` (or `graphify path "<A>" "<B>"` / `graphify explain "<concept>"`); these return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output
- If .graphify/wiki/index.md exists, navigate it instead of reading raw files
- If .graphify/graph.json is missing but graphify-out/graph.json exists, run `graphify migrate-state --dry-run` first; if tracked legacy artifacts are reported, ask before using the recommended `git mv -f graphify-out .graphify` and commit message
- If .graphify/needs_update exists or .graphify/branch.json has stale=true, warn before relying on semantic results and run /graphify . --update when appropriate
- Before proposing or committing .graphify artifacts, run `graphify portable-check .graphify`; commit-safe graph artifacts must use repo-relative paths, and never commit .graphify/branch.json, .graphify/worktree.json, .graphify/needs_update, or .graphify/cache/. If a repo already tracks any of them, first add them to .gitignore, then propose `git rm --cached .graphify/branch.json .graphify/worktree.json .graphify/needs_update` and `git rm -r --cached .graphify/cache`; never mutate git state without asking
- Before deep graph traversal, prefer `graphify summary --graph .graphify/graph.json` for compact first-hop orientation
- For review impact on changed files, use `graphify review-delta --graph .graphify/graph.json` instead of generic traversal
- Read `.graphify/GRAPH_REPORT.md` only for broad architecture review or when `query` / `path` / `explain` do not surface enough context
- After modifying code files in this session, run `npx graphify hook-rebuild` to keep the graph current
