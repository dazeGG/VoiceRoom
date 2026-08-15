# VoiceRoom

## Repository map
- `apps/api` is the Fastify/PostgreSQL/LiveKit backend.
- `apps/web` is the Svelte/Vite frontend.
- `packages/shared` owns contracts shared by API and Web. Update shared contracts before their consumers.
- `docs/GIT_FLOW.md` is the source of truth for branches, commits, pull requests, hotfixes, and releases.
- `docs/RELEASE_<version>_PLAN.md` files are release-specific target-state plans; do not describe an unmet gate as already implemented.

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
