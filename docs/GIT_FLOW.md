# Git Flow

This repository uses Git Flow for all development and releases. This file is the authoritative workflow for humans and agents; release plans may add gates but may not bypass it.

## Permanent branches

- `main` — production/stable release branch. Keep it deployable. Do not commit feature work directly here.
- `develop` — integration branch for accepted feature work. New feature branches start from `develop`.

## Working branches

- `feature/<short-name>` — all normal product work, UI/backend changes, documentation, chores, and planned fixes. Branch from `develop`; open PR back into `develop`.
- `release/<scope>` — release stabilization. Branch from `develop`; allow only versioning, QA fixes, and polish. Merge into `main` and back into `develop`.
- `hotfix/<short-name>` or `hotfix/<version>` — urgent production fixes. Branch from `main`; merge into `main` and back into `develop`.

## Pull request rules

- Default PR target for feature work is `develop`.
- Default PR target for release branches is `main`.
- Default PR target for hotfix branches is `main`; after merge, back-merge/cherry-pick to `develop`.
- Pull requests into `develop` and `main` must pass the repository policy, check, build, and test jobs before merge.
- PR titles must use the same Conventional Commit form as commit subjects because squash merge uses the PR title as the resulting commit subject.
- When the user explicitly asks an agent to merge a PR, default to squash merge and delete the source branch after merge unless the user says otherwise.
- Create normal ready-for-review PRs by default. Use draft PRs only when the user explicitly asks for a draft.

## Commit rules

- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `style:`, `build:`, `ci:`, or `revert:`.
- Optional scopes are encouraged when they improve clarity, for example `fix(api): preserve transaction rollback`.
- Keep commits small and reviewable.
- Do not commit local screenshots or debugging artifacts such as `img.png` / `img_*.png` unless explicitly requested.
- Do not commit generated output, dependency stores, local runtime state, or secrets.

## Agent workflow

1. Before coding, run `git status --short --branch` and confirm the active branch.
2. If starting new work, branch from `develop` unless the user explicitly says otherwise.
3. Verify changes before claiming completion: targeted tests first, then typecheck/build when relevant.
4. Push feature branches to origin and open PRs into `develop`.
5. Do not merge PRs unless the user explicitly asks.
6. Do not push, tag, publish a release, or deploy unless the user explicitly requests that external action.

## Component releases

| Component | Version source | Tag | Workflow | Release output |
| --- | --- | --- | --- | --- |
| API | `apps/api/package.json` | `api/vX.Y.Z` | `release-api.yml` | Production API image for the API, workers, LiveKit gate and migrations |
| Web | `apps/web/package.json` | `web/vX.Y.Z` | `release-web.yml` | Production edge image and Web build |
| Admin | `apps/admin/package.json` | `admin/vX.Y.Z` | `release-admin.yml` | Static build on the staff-only admin domain |
| Widget | `apps/widget/package.json` | `widget/vX.Y.Z` | `release-widget.yml` | Static embed and loader at the existing v1 URLs |
| Meet | `apps/meet/package.json` | `meet/vX.Y.Z` | `release-meet.yml` | Personal Compose, installer and manifest with images pinned by digest |
| Public website | `apps/site/package.json` | `site/vX.Y.Z` | `release-static.yml` | Website and build archive |
| Public documentation | `apps/docs/package.json` | `docs/vX.Y.Z` | `release-static.yml` | Documentation and build archive |

Tags match their component's package version and point to first-parent commits on `main`.
Each tag creates a GitHub Release with English notes for its own series. Only Meet
sets GitHub's **Latest** release, used by the installer and get.voiceroom.ru.
Meet builds its own API and personal edge from the tag and has no production rollout.
Historical `v2.x` tags stay available for reference and their trigger is retired.

The root and the internal shared, call and UI packages are private and stay at
`0.0.0`. The first API, Web, Admin, Widget and Meet releases are all `1.0.0`.
For later releases, change only the versions being shipped and commit the matching
lockfile. Run the appropriate example from the repository root.

```bash
npm version 1.0.1 --workspace @voice-room/web --no-git-tag-version --ignore-scripts
npm version 1.0.1 --workspace @voice-room/site --no-git-tag-version --ignore-scripts
npm --prefix apps/docs version 1.0.1 --no-git-tag-version --ignore-scripts
```

Before publishing the split tags, replace the GitHub `production` environment's
legacy `v*` rule with `api/v*`, `web/v*`, `admin/v*`, `widget/v*`, `site/v*`
and `docs/v*`. This also blocks production deploys if GitHub evaluates a recreated
historical tag against the workflow at that tag. App changes pushed to `develop` still
deploy the API, Web, Admin and Widget together to dev. Site and docs publish to dev
when their respective lanes run. Shared contracts and portable UI changes also
check their consumers before merge.

## Release workflow

1. Confirm `develop` is green. Create `release/<scope>` from the audited commit,
   for example `release/web-1.0.1` or `release/november-apps`. One branch may carry
   several component version bumps.
2. Keep the branch focused on version bumps, migrations, QA fixes and release
   polish. Document migrations, environment changes and rollback in the release PR.
3. Run the applicable gates, including any matching release-plan gates. Open the PR
   into `main`. Branch protection requires the checks on a branch up to date with
   `main`.
4. After approval and merge, create an annotated tag for each component being
   released on the first-parent commit of `main`. Push each tag individually.
   Verify each workflow and deployment before pushing dependent tags.
5. Back-merge the main release commit into `develop` so it inherits each version
   bump and stabilization fix. Delete the release branch after verification and the back-merge.

Ship API before any client that needs its changes. Keep the current and previous
released API and client versions interoperable in either direction. Evolve
`packages/shared` contracts backward-compatibly, including older open tabs and
native clients. Add database migrations to the API release and use additive schema
changes while previous readers and writers are still supported. Meet pins its own
matching API and includes its migration runner in the bundle.

Web owns the edge configuration because the same edge serves Web's routes, API
proxy and TLS. Admin and Widget publish their own build and CSP to that edge. Its
first split Web rollout takes the already served Admin and Widget files over from
the old image. Complete that rollout before the first Admin and Widget releases.
Subsequent Web releases preserve those selections, and Admin and Widget each
switch only their own files and policy.

## Hotfix workflow

1. Create `hotfix/<short-name>` or `hotfix/<version>` from `main`.
2. Keep the change limited to the urgent production correction and its regression coverage.
3. Open the PR into `main`; after explicit approval and successful gates, merge and tag when applicable.
4. Back-merge or cherry-pick the exact fix into `develop` immediately.
