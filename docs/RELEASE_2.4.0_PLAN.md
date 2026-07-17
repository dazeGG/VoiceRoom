# Release 2.4.0 verification plan

Status: **BLOCKED — manual audio smoke is not yet recorded**.
Last updated: 2026-07-17.

This document is the current release gate for `2.4.0`. It preserves the
unfinished verification requirements from the historical 2.4 plan and follows
[`GIT_FLOW.md`](./GIT_FLOW.md). A checked item is a statement backed by fresh
evidence; unchecked items block the merge to `main`.

## Audited boundary

- Production baseline in Git: annotated tag `v2.3.4` and `main` both resolve to
  `b2c8413663d0d6e5acbb0789487a73dfb26158b8`.
- Audited feature slice: `develop` and `release/2.4.0` started at
  `70b16b908df34747ee8e684ceb57a082bfa925f1`.
- Release PR: [#60](https://github.com/dazeGG/VoiceRoom/pull/60),
  `release/2.4.0 -> main`.
- Root, API, Web, Shared and lockfile versions are `2.4.0`.
- Release-only QA fixes after the audited feature slice must remain visible in
  PR #60 and pass the same gates on its final head SHA.

## Automated evidence

- [x] PR route and Conventional Commit title satisfy the Git Flow policy.
- [x] GitHub `policy`, `check` and PostgreSQL `test` jobs passed for the audited
  feature slice.
- [x] Local `npm run check` and `npm run build` passed.
- [x] Shared tests passed: 31/31.
- [x] Web tests passed: 117/117; `svelte-check` reported 0 errors and 0 warnings.
- [x] API tests passed against PostgreSQL 16.14: 244/244.
- [x] Production API and Web Docker targets built successfully; production
  `docker compose config --quiet` passed with synthetic required env values.
- [x] `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities.
- [x] `git diff --check origin/main...release/2.4.0` passed.
- [ ] Repeat all required GitHub and local gates on the final PR head after QA
  fixes; record the final SHA and check links in PR #60.

## Migration and rollback rehearsal

Rehearsal performed 2026-07-17 against disposable PostgreSQL 16.14:

1. Applied the six migrations from `v2.3.4` to an empty database.
2. Seeded two users, one static room, one room message and one direct message.
3. Created a custom-format `pg_dump` snapshot; SHA-256:
   `d7c58ff09af75c5fff858a45d6cc0ff34c447093d6411543b4775f96c98aa707`.
4. Applied all ten 2.4 migrations. The database contained 16 migration records,
   and every seeded row remained present.
5. Dropped only the disposable database, restored the snapshot and verified the
   exact six-migration v2.3.4 state and every seeded row.
6. Applied the ten 2.4 migrations again and reran the full API suite: 244/244
   passed; the seeded rows remained present.

Production rollback policy:

- take a coordinated pre-deploy snapshot of PostgreSQL and the `uploads` volume
  using the procedure in `README.md`;
- do not use blind `db:rollback` after 2.4 has accepted writes: several down
  migrations intentionally drop moderation, notification and message metadata;
- prefer a forward fix; if rollback is unavoidable, stop writers and restore the
  verified pre-deploy PostgreSQL + `uploads` snapshot as one consistency unit.

## Production baseline identity

Fresh read-only evidence collected 2026-07-17 establishes the current
production baseline:

- [x] The latest successful `main` push/deploy is
  [GitHub Actions run 29095868225](https://github.com/dazeGG/VoiceRoom/actions/runs/29095868225)
  for `b2c8413663d0d6e5acbb0789487a73dfb26158b8`; no newer `main` push run exists.
- [x] Its SSH log records `HEAD is now at b2c8413`, then recreates API, Caddy
  and LiveKit; PostgreSQL and API become healthy before Caddy starts.
- [x] The live `https://voiceroom.ru/` response has `Last-Modified` equal to the
  deploy build time and serves the same hashed assets recorded by that build,
  including `app.7EpXu7Hd.js`, `ezBmfOh0.js` and `B6-GDSgb.js`.
- [x] The live `https://voiceroom.ru/api/healthz` endpoint returned `200` with
  `ok: true` and enabled LiveKit on 2026-07-17.
- [x] `v2.3.4^{commit}` resolves to the same full SHA as the deployed `main`.

Conclusion: the observed pre-release production baseline is
`v2.3.4` / `b2c8413663d0d6e5acbb0789487a73dfb26158b8`.

Build version and Git SHA are not yet exposed by `/api/healthz`; that
observability improvement remains a prerequisite in
[`RELEASE_2.5.0_PLAN.md`](./RELEASE_2.5.0_PLAN.md).

## Required real-device audio matrix

Record browser versions, OS, input/output devices, tester and evidence link in
PR #60. Use two clients for the echo test and real speakers without headphones.

| Scenario | Chrome | Firefox | Safari |
| --- | --- | --- | --- |
| Autoplay unlock after a fresh page load and explicit user action | [ ] | [ ] | [ ] |
| Change output device while voice, stream audio and cues are active | [ ] | [ ] | [ ] |
| Global output mute silences voice, stream audio and cues | [ ] | [ ] | [ ] |
| Output gain remains stable through `100% -> 200% -> 50%` | [ ] | [ ] | [ ] |
| Microphone input gain `0% -> 200%` works without clipping regressions | [ ] | [ ] | [ ] |
| AEC prevents unacceptable echo with two clients and speakers | [ ] | [ ] | [ ] |

- [ ] Chrome matrix complete with evidence.
- [ ] Firefox matrix complete with evidence.
- [ ] Safari matrix complete with evidence.

## Final Git Flow gates

- [ ] Final diff reviewed and both independent review lanes report no blockers.
- [ ] PR #60 is marked ready only after every gate above is complete.
- [ ] Squash-merge the release PR into `main` after explicit approval.
- [ ] Verify the deployed 2.4.0 commit before tagging.
- [ ] Create and verify annotated tag `v2.4.0` on the release result.
- [ ] Merge the release result back into `develop`.
- [ ] Delete `release/2.4.0` only after the tag and back-merge are verified.
