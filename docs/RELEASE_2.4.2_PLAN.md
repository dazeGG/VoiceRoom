# Release 2.4.2 verification plan

Status: **READY FOR PR — local automated gates and audit/media evidence dispositions are complete; final GitHub CI is the merge gate**.
Last updated: 2026-07-18.

This document is the release gate for `2.4.2` and follows
[`GIT_FLOW.md`](./GIT_FLOW.md). A checked item is backed by fresh evidence for
this hotfix candidate or by an explicit release-owner evidence disposition.
An unchecked pre-merge item blocks unless a separate checked disposition below
explicitly accepts that exact evidence gap; post-merge items block the tag,
GitHub Release or branch deletion as stated.

## Audited boundary

- Production baseline: annotated tag `v2.4.1` targets
  `fef0e20ec48fdcefe53b1891b30594bbff002f6a`, which is also the audited
  `origin/main` commit used to create `hotfix/2.4.2`.
- Hotfix boundary: screen-share capture, publication/subscription lifecycle,
  receiver demand, audio fallback and the shared screen-profile allowlist,
  plus regression coverage, release documentation and version metadata.
- Root, API, Web, Shared and lockfile versions are `2.4.2`.
- There is no PostgreSQL migration or storage-format change relative to
  `v2.4.1`.

## Hotfix scope

- Preserve remote screen audio and screen presence while a video publication
  is temporarily unsubscribed, unpublished or republished.
- Drive remote screen subscriptions from explicit hidden/preview/stage demand,
  request LOW/HIGH LiveKit layers accordingly and bound transient subscription
  retries to a fresh three-attempt epoch per connection.
- Keep the capture profile selected at share start stable for the lifetime of
  that share. Pass its FPS/resolution constraints to browser/native capture and
  let libwebrtc/LiveKit handle congestion without application-level profile-ID
  hopping.
- Accept every screen profile already emitted by the current client, including
  `balanced-5`, `high-5` and `source` variants.
- Add native capture diagnostics for pixel format and relay backpressure.
- No API endpoint, database schema, stored-data format or user-visible quality
  selector is added.

## Automated pre-merge gates

- [x] `hotfix/2.4.2` was created from audited `origin/main` / `v2.4.1` target
  `fef0e20ec48fdcefe53b1891b30594bbff002f6a`.
- [x] Root, API, Web, Shared and lockfile versions report `2.4.2`; the version
  update was produced with Node.js `24.18.0` and npm `11.16.0`.
- [x] `git diff --name-status v2.4.1..HEAD` reports no migration change before
  release preparation.
- [x] `git diff --check v2.4.1...hotfix/2.4.2` passes for the final candidate
  worktree before the release-preparation commit.
- [x] Focused regression evidence is green: Shared 31/31, screen publication /
  receiver demand / retry / lifecycle / audio fallback / LiveKit resync 13/13,
  and Web v2 contract 62/62.
- [x] `npm run check` passes under Node.js `24.18.0` / npm `11.16.0`, including
  `svelte-check` with 0 errors and 0 warnings.
- [x] `npm test` passes under the required runtime against disposable
  PostgreSQL 16: Shared 31/31, API 245/245, Web 132/132.
- [x] `npm run build` passes under the required runtime.
- [x] Playwright Chromium E2E passes 6/6 against a freshly built, isolated full
  dev stack; the first sandboxed browser launch was discarded and the
  unsandboxed release-gate run passed without test retries.
- [ ] `npm audit --omit=dev --audit-level=high` reports no high or critical
  vulnerabilities. This online exact command was not run: execution policy
  blocked external disclosure of private-repository dependency metadata.
- [x] Dependency-vulnerability evidence disposition is accepted for this
  hotfix. A fresh `v2.4.1` versus candidate lock comparison found 285 package
  entries on both sides and exactly five changed workspace-version fields, with
  zero dependency, resolution, integrity or package-map drift. The authoritative
  `v2.4.1` audit was green on 2026-07-18, and the candidate production API
  install also reported 0 known vulnerabilities. This unchanged-graph evidence
  is accepted as inherited vulnerability evidence; it does **not** claim that
  the unchecked online audit command ran for `2.4.2`.
- [x] Production API and Web Docker targets build from the candidate.
- [x] `docker compose config --quiet` passes with synthetic required values.
- [x] Disposable test/E2E containers, networks, volumes and gate images were
  removed after evidence collection; the pre-existing local verification
  container was not modified.
- [x] Independent review verdict is **APPROVE** after the candidate fixed
  audio-only resync state loss in `6bfbce7` and a stale async quality-demand
  race in `aaf55f3`. The remaining non-blocking real-SDK integration evidence
  gap is carried explicitly into the required smoke below.
- [ ] Final PR head passes GitHub `Git Flow policy`, `Lint, typecheck & build`
  and PostgreSQL `Tests` jobs. Record the head SHA and Actions run URL before
  merge.

The focused suite now drives `syncLiveKitParticipant` through an existing-peer
audio-only resync and covers same-SID publication replacement during an async
quality request. It still stubs the LiveKit SDK boundary; no automated test
drives the real SDK event emitter, SFU and media tracks through the complete
subscribe/unsubscribe/unpublish sequence. The real-media smoke below therefore
is not implied by the green unit/contract suite and requires the explicit
release-owner disposition recorded below.

## Required screen-share smoke

Record browser/desktop-shell versions, OS, two-client topology and evidence in
the hotfix PR. A sender restart or reconnect must not be used to mask a failed
scenario.

- [ ] Web sender starts the default `720p 30 FPS` profile; sender stats do not
  cause an application-level profile-ID change during congestion/recovery.
- [ ] Desktop sender honours selected FPS/quality capture constraints and
  reports native pixel format/backpressure diagnostics when supported.
- [ ] A staged viewer receives HIGH demand; a preview-only viewer receives LOW
  demand; a hidden viewer is unsubscribed.
- [ ] Video unpublish/republish and transient subscription failure recover
  without losing continuous screen audio or leaving the stage stranded.
- [ ] Reconnect starts a fresh bounded retry epoch; unsupported codec errors do
  not loop.
- [ ] Global app mute and stream volume still control the audio-only fallback
  sink, and closing the stage releases it.
- [x] Release owner explicitly accepts the disclosed media evidence gap for
  `2.4.2`. Before requesting this release, the owner was shown that real
  two-client LiveKit/desktop smoke and validation of the external desktop bridge
  were missing, then explicitly instructed the agent to commit and release
  `2.4.2`. The individual scenarios above remain unchecked and were not
  performed; this is risk acceptance, not a claim that they passed.

## Docker, audit and E2E procedure

1. Use the repository runtime from `.nvmrc` / `package.json`: Node.js
   `24.18.0`, npm `11.16.0`.
2. Run `npm run check`, `npm test` with `TEST_DATABASE_URL`, and
   `npm run build` against the exact candidate.
3. Start the full stack described in `README.md`, wait for PostgreSQL, API, Web
   and LiveKit readiness, then run `npm run e2e` once on Chromium.
4. Build both production Docker targets and validate Compose with synthetic
   non-secret values. Do not store those values in Git or logs beyond obvious
   placeholders.
5. Run the production dependency audit when policy permits. A blocked or failed
   online command remains unchecked and is not equivalent to a clean audit; an
   accepted inherited-evidence disposition must remain separately identified.
6. Stop and remove disposable containers, networks and volumes after evidence
   is collected.

## Deployment and rollback

The hotfix contains no schema or storage-format change. The normal `main` push
workflow rebuilds the application while retaining PostgreSQL and uploads
volumes. No manual production deploy is part of local release preparation.

If production verification fails, stop the rollout and redeploy annotated tag
`v2.4.1`. No database rollback is required. Keep the standard coordinated
pre-deploy PostgreSQL/uploads backup policy in force.

## Final Git Flow gates

- [ ] Squash-merge the ready hotfix PR into `main` only after the final head
  passes required GitHub CI. The checked dependency and media dispositions above
  authorize proceeding without representing the unchecked command/scenarios as
  passed.
- [ ] The exact merged `main` SHA completes its non-cancelled production deploy
  job successfully.
- [ ] `https://voiceroom.ru/api/healthz` returns HTTP 200 with `ok: true` after
  that deploy.
- [ ] Create and verify annotated tag `v2.4.2` on the deployed `main` result.
- [ ] Create the GitHub Release from `v2.4.2`, following the `v2.4.1` release
  title/notes structure and linking the hotfix PR and CI evidence.
- [ ] Back-merge the exact tagged production result into `develop` and verify
  that `main` is an ancestor of `develop`.
- [ ] Delete `hotfix/2.4.2` remotely and locally only after the tag, GitHub
  Release and back-merge are verified.
