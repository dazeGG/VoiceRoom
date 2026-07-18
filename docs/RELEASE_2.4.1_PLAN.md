# Release 2.4.1 verification plan

Status: **READY — local gates are green; final GitHub CI is the merge gate**.
Last updated: 2026-07-18.

This document is the release gate for `2.4.1` and follows
[`GIT_FLOW.md`](./GIT_FLOW.md). Only evidence collected for the exact release
candidate may close a gate.

## Audited boundary

- Production baseline: annotated tag `v2.4.0` and `main` at
  `e0eb12c1fcc0994c2796c71511a350d2f09fa944`.
- Release branch: `release/2.4.1`, created from green `develop` commit
  `8db2760a971f1f5ed740adc319f613289b50aeed`.
- Root, API, Web, Shared and lockfile versions are `2.4.1`.
- There are no PostgreSQL migrations between `v2.4.0` and this candidate.

## Release scope

- Resolve room peers and chat authors from their current account profiles, and
  propagate profile changes to active room and preview surfaces.
- Refine preview/settings layout and align the runtime with Node.js `24.18.0`
  and npm `11.16.0`.
- Repair the Playwright auth and room helpers for the current dialog-based
  flows, automatic room entry and room-heading settings menu.
- Keep context menus within the viewport edge gap throughout their entrance
  animation, with regression coverage for pointer, keyboard and narrow
  viewport behavior.

## Automated gates

- [x] `release/2.4.1` was created from the audited `develop` commit.
- [x] Every package manifest and the lockfile report version `2.4.1`.
- [x] No database migration was added or changed relative to `v2.4.0`.
- [x] `git diff --check` passes for the complete release candidate.
- [x] `npm run check` passes with 0 Svelte errors and 0 warnings.
- [x] `npm test` passes against PostgreSQL 16: Shared 31/31, API 245/245,
  Web 117/117.
- [x] `npm run build` passes.
- [x] Playwright E2E passes: 6/6 scenarios on Chromium.
- [x] `npm audit --omit=dev --audit-level=high` reports no high or critical
  vulnerabilities.
- [x] Production API and Web Docker targets build, and
  `docker compose config --quiet` passes with synthetic required values.
- [ ] The release PR into `main` passes Git Flow policy, check/build and
  PostgreSQL test jobs on its final head SHA.

## Deployment and rollback

The release contains no schema or storage-format change. The normal production
deployment rebuilds the application from the merged `main` commit and keeps the
existing PostgreSQL and uploads volumes.

If production verification fails, stop the rollout and redeploy annotated tag
`v2.4.0`. No database rollback is required for this patch. The standard
pre-deploy PostgreSQL and uploads backup policy remains in force.

After the release PR is merged, the exact `main` result must finish its deploy
job and pass `https://voiceroom.ru/api/healthz` before annotated tag `v2.4.1`
and the GitHub Release are created. The tagged release result must then be
merged back into `develop`; release branches may be deleted only after both
directions and the tag are verified.
