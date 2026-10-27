# VoiceRoom

## Repository map
- `apps/api` is the Fastify/PostgreSQL/LiveKit backend.
- `apps/web` is the Svelte/Vite frontend.
- While `apps/web-vue` (the Vue port) exists, any fix in `apps/web` also lands in `apps/web-vue`, or is listed in `docs/web-vue-parity.md` when its area is not ported yet.
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
- Repository gates are `npm run check` (tsc, svelte-check and ESLint), `npm test`, and `npm run build`.
- Prettier owns code layout (ts, js, svelte, css): run `npm run format` after editing; `npm run check` fails on unformatted files.
- ESLint fails only on violations not recorded in `eslint-suppressions.json`. Never add to that file or disable a rule inline to get green; fix the code. After fixing suppressed code, run `npm run lint -- --prune-suppressions`.
- Web end-to-end coverage is `npm run e2e` and requires the full stack described in `README.md`.
- Database changes must be checked against both migration and rollback paths.

## Tests
- Tests check behaviour: import the module and call it, render the component, send the HTTP or WebSocket request. Never read a source file and match its text with a regex; a refactor that keeps behaviour must keep tests green without editing them.
- Allowed file reads in tests: deployment config (Caddyfile, compose files, Dockerfile, CSP), migrations and generated schema.
- Every bug fix comes with a test that fails without the fix.
- `docs/ARCHITECTURE.md` section 4 lists the old patterns still in the code; do not copy them into new code.
