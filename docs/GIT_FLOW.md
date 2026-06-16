# Git Flow

This repository uses a lightweight Git Flow so work can continue consistently across chats and agents.

## Permanent branches

- `main` — production/stable release branch. Keep it deployable. Do not commit feature work directly here.
- `develop` — integration branch for accepted feature work. New feature branches start from `develop`.

## Working branches

- `feature/<short-name>` — normal product work, UI changes, backend changes, and planned fixes. Branch from `develop`; open PR back into `develop`.
- `release/<version>` — release stabilization. Branch from `develop`; allow only release notes, versioning, QA fixes, and polish. Merge into `main` and back into `develop`.
- `hotfix/<short-name>` or `hotfix/<version>` — urgent production fixes. Branch from `main`; merge into `main` and back into `develop`.

## Pull request rules

- Default PR target for feature work is `develop`.
- Default PR target for release branches is `main`.
- Default PR target for hotfix branches is `main`; after merge, back-merge/cherry-pick to `develop`.
- When the user explicitly asks an agent to merge a PR, default to squash merge and delete the source branch after merge unless the user says otherwise.
- Create normal ready-for-review PRs by default. Use draft PRs only when the user explicitly asks for a draft.

## Commit rules

- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- Keep commits small and reviewable.
- Do not commit local screenshots or debugging artifacts such as `img.png` / `img_*.png` unless explicitly requested.

## Agent workflow

1. Before coding, run `git status --short --branch` and confirm the active branch.
2. If starting new work, branch from `develop` unless the user explicitly says otherwise.
3. Verify changes before claiming completion: targeted tests first, then typecheck/build when relevant.
4. Push feature branches to origin and open PRs into `develop`.
5. Do not merge PRs unless the user explicitly asks.
