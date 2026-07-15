# Git Flow

This repository uses Git Flow for all development and releases. This file is the authoritative workflow for humans and agents; release plans may add gates but may not bypass it.

## Permanent branches

- `main` — production/stable release branch. Keep it deployable. Do not commit feature work directly here.
- `develop` — integration branch for accepted feature work. New feature branches start from `develop`.

## Working branches

- `feature/<short-name>` — all normal product work, UI/backend changes, documentation, chores, and planned fixes. Branch from `develop`; open PR back into `develop`.
- `release/<version>` — release stabilization. Branch from `develop`; allow only release notes, versioning, QA fixes, and polish. Merge into `main` and back into `develop`.
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

## Release workflow

1. Confirm `develop` is green and the preceding production tag exists.
2. Create `release/<version>` from the audited `develop` commit.
3. Allow only versioning, release notes, migrations/operations notes, QA fixes, and release polish on the release branch.
4. Run every gate required by the matching `docs/RELEASE_<version>_PLAN.md`; statements in a plan are requirements until fresh evidence proves them.
5. Open the release PR into `main`. Do not merge it while required jobs or release gates are failing.
6. After explicit approval, merge into `main`, verify the production version, and create the annotated tag `v<version>` on the release commit.
7. Merge the release result back into `develop` so versioning and stabilization fixes are not lost.
8. Delete the release branch only after both directions are complete and the tag is verified.

## Hotfix workflow

1. Create `hotfix/<short-name>` or `hotfix/<version>` from `main`.
2. Keep the change limited to the urgent production correction and its regression coverage.
3. Open the PR into `main`; after explicit approval and successful gates, merge and tag when applicable.
4. Back-merge or cherry-pick the exact fix into `develop` immediately.
