# G08 v2: calibration evidence

**Decision:** enforce one 90% line / 85% V8 block verdict on the **pooled patch in newly measured API and shared code**. Keep independent per-file 90/85 patch checks on v1-eligible paths, plus 95% whole-file blocks for changed members of the auth-admission and media groups. The old 9.17% / 53.9% global floors are retired. The pool is a changed-code gate, not a global baseline.

## One current reference, two scopes

Reference: PR3b `37ee8e3f`, Node 24.18.0, PostgreSQL from the development compose stack. The successful unchanged-tree `npm run coverage:g08` ran 259 API files, 34 shared files and the gate test: 1,530 cases passed, zero failed, two opt-in real-LiveKit cases skipped. Both collectors read the **same 312 raw V8 profiles**; no per-lane sampling. An earlier local run exceeded the existing lock-timeout tolerance (6,562 ms for a 6,500 ms assertion); the test passed in isolation. That first run and its raw data are **not** the calibration sample.

| Scope / measurement | Eligible files | Unloaded | Lines covered / measurable | V8 blocks covered / observed | Interpretation |
|---|---:|---:|---:|---:|---|
| v1 collector and scope | 23 | 0 | 4,013 / 4,065 (98.72%) | 1,091 / 1,119 (97.50%) | v1 global floors pass |
| Same 23 under v2 | 23 | 0 | 3,415 / 3,467 (98.50%) | 1,091 / 1,119 (97.50%) | Same uncovered line count and block counts; erased types and comments no longer inflate the denominator |
| Newly measured API | 286 | 5 | 25,122 / 28,772 (87.31%) | 6,418 / 7,513 (85.43%) | Whole suite, not a patch verdict |
| Newly measured shared | 52 | 2 | 4,131 / 4,422 (93.42%) | 731 / 869 (84.12%) | Whole suite, not a patch verdict |
| All newly measured | 338 | 7 | 29,253 / 33,194 (88.13%) | 7,149 / 8,382 (85.29%) | Includes unexecuted files |
| Entire v2 inventory | 361 | 7 | 32,668 / 36,661 (89.11%) | 8,240 / 9,501 (86.73%) | No global verdict; the unchanged tree has no patch |

The three zero-line files and all 62 zero-block files are N/A, not perfect scores. Seven of the latter were not loaded: their branches are unknown. The other 55 were loaded and had no observed non-root V8 ranges. Strict whole-file counts on the same input, in policy order: **auth-admission** 49/50, 65/67, 166/170, 28/29; **media** 85/88, 32/33, 5/5. All seven exceed 95%; enforcement is on change, not on every run.

### Inventory and exclusions

Of 445 tracked files under the two source roots, **359 are eligible**: 307 API and 52 shared (356 `.ts`, 3 `.mts`). The other two measured files are the existing `apps/web/src/api/auth.ts` and `packages/call/src/engine/media/screen-receiver-demand.ts`. All 44 `.cjs` in these roots are migrations; there are no present `.js`, `.mjs` or `.cts` files here. They are supported for future executable sources. Files are inventoried from the checkout independently of V8 imports.

| Excluded path | Count | Why |
|---|---:|---|
| `apps/api/src/migrations/` | 83 (44 CJS, 39 TS) | Schema history; historical bytes have digest tests, and migration behavior has dedicated real-PostgreSQL up/down and reapply tests. Not every recent migration is byte-pinned. |
| `apps/api/src/lib/web-push.d.ts` | 1 | Ambient declaration, no runtime implementation |
| `packages/shared/src/emoji.ts` | 1 | Frozen Unicode corpus with its own digest check |
| `packages/shared/src/visual-identity.json` | 1 | Non-executable data; runtime consumer remains in scope |
| Existing `/test/`, `/e2e/` policy directories | 0 within these roots | Test code is a producer, not a production target |

The artifact's `meta.excludedFiles` records the **individual path and reason**, including every migration. `meta.unloadedFiles` and each file's `loaded` distinguish missing execution from a branchless module. No new exclusion is authorized.

| Unloaded eligible file on the reference tree | Lines | Disposition |
|---|---:|---|
| `apps/api/src/domains/staff/staff-check.ts` | 0/0 | Erased interface; inventoried, no runtime lines |
| `apps/api/src/platform/db/schema.ts` | 0/0 | Generated types; checked against the migrated DB; still inventoried |
| `apps/api/src/platform/types.ts` | 0/0 | Erased types |
| `apps/api/src/scripts/reconcile-media.ts` | 0/27 | Added disposable-DB CLI test for healthy media vs missing ready image, exit code and persisted state |
| `apps/api/src/server.personal.ts` | 0/22 | Added startup reconciliation refusal and connection cleanup test; an abruptly killed child need not flush V8 |
| `packages/shared/src/feedback-labels.ts` | 0/14 | Added assertions about the rating choices users see |
| `packages/shared/src/report-labels.ts` | 0/13 | Added room, temporary-room and direct-message notice tests |

The subsequent protected-base verification on the implementation is **not** a second calibration point. It measured 358/361 files loaded: only the three type-only modules remained unloaded. The new tests exercised 22/27 lines in the reconciliation CLI, 19/22 in the Personal entry point, 14/14 in feedback labels (0/0 blocks, N/A), and 13/13 in report labels (4/4 blocks). This implementation added no eligible production lines; its own patch has zero applicable production files, not 100% coverage.

To reproduce the paired measurement, run the original `npm run coverage:g08` on the unchanged base with PostgreSQL. Preserve its summary, raw directory and checkout. Recollect **without rerunning tests** using the PR4 evaluator, from the PR4 root:

```sh
node scripts/coverage/check-release-250-coverage.mts --root "$BASE_CHECKOUT" \
  --v8-dir "$BASE_CHECKOUT/coverage/.gate-v8" --out coverage/proposed-on-base.json --collect-only
```

## Historical patch calibration

[PR #342](https://github.com/dazeGG/VoiceRoom/pull/342) supplied two red attempts, not two independent PRs. Their protected base was `6a406737`. The actual tested merges were [`53d8396f`](https://github.com/dazeGG/VoiceRoom/actions/runs/45588276123) (A) and [`e0cb7cd3`](https://github.com/dazeGG/VoiceRoom/actions/runs/45589744552) (B). In each case the tested tree equaled that attempt's head tree, so the pre-PR1 coordinates agree with base → merge **for these two runs only**. The failed jobs did not upload the detailed summary. The original hosted logs identify the first rejected file; the rest of this table comes from collecting both policies on each historical tree's own full raw input, never from substituting today's coverage. PR4 retains the summary artifact on a coverage failure.

The original hosted v1 whole-scope totals were 3,991/4,065 lines and 1,068/1,106 blocks on A; 4,006/4,065 and 1,085/1,117 on B. The following **local counterfactual** is not the missing hosted artifact. It uses the complete historical file inventory with real PostgreSQL, plus separately instrumented successful retries on the same tree. A's full run had a server-readiness and a native-lease heartbeat timeout; B's had the heartbeat timeout. Two cases per tree required the opt-in LiveKit fixture and were skipped. Retrying the affected behavior on each tree supplied the missing execution, without relaxing a threshold or changing the tested source. V8 unions can also observe additional blocks. The resulting whole-scope v1 counts (3,993/4,065 and 1,070/1,106; 4,008/4,065 and 1,086/1,116) are not identical to hosted, but both original changed-line fractions and failing file verdicts reproduce. Per-file block counts below are local observations, not inferred from rounded hosted percentages. Additional Linux replays also hit historical fixture timeouts; their partial profiles are not used in the table.

| Attempt | New-scope changed files | Pool: changed lines | Pool: changed blocks | Pool verdict | Previously protected per-file patch verdicts (v2) | Strict groups (whole file) | PR verdict |
|---|---:|---:|---:|---|---|---|---|
| A | 56 | 2,166/2,248 (96.35%) | 744/818 (90.95%) | Pass | 5 pass, 2 fail | 4/4 pass | **Fail** |
| B | 56 | 2,165/2,248 (96.31%) | 745/820 (90.85%) | Pass | 6 pass, 1 fail | 4/4 pass | **Fail** |

To reproduce the split, take the 63 changed-file rows measured with the v2 collector for each attempt. Seven match both a protected v1 path and a v1-eligible extension; **do not add their counts to the pool**. Of the other 56, 54 have measurable changed lines and 40 have observed intersecting blocks. Two rows are N/A on both metrics. Add covered and eligible counts for each metric separately; do not average file percentages. A branchless file with measurable changes still contributes its lines.

The protected failures on A were `call-voice-admission.service.ts` (24/40 lines, 1/8 blocks) and `livekit-auth-gate.service.ts` (12/16, 13/14). On B the former passed (39/40, 17/18); the latter still failed on lines. The v1 collector reproduces the first failure recorded by each hosted job: **36/52 (69.23%)** on A and **13/17 (76.47%)** on B. Erasing type-only lines changes the denominators under v2, not the floors. All four changed strict members passed their separate whole-file branch check on both attempts: `credential-boundary.service.ts` 49/50, `gate-credential-signer.ts` 65/67, `livekit-auth-gate.service.ts` 164/169 and `livekit-credential-provider.ts` 28/29.

**Why pool at 90/85?** The earlier candidate rejected 15 of 63 files in each attempt when it applied those floors to *every* file. Small denominators made a single missed block decisive (for example, `app/api-runtime.ts` has 2/3 blocks on a 59/60-line patch). The owner chose to weight each changed line or block equally across newly measured code, not to relax either threshold. This trade-off allows a weak new-scope file to pass as part of a well-tested patch. The report still exposes every file, including gaps such as private-call feedback, and neither the pool nor unchanged code can rescue a protected file. Two iterations of one PR are a calibration example, not an estimate of a future failure rate.

### Per-file patch evidence

Each attempt lists all 63 changed eligible files, worst first by its lower non-N/A patch percentage, then by full path; N/A-only rows are last. API names are relative to `apps/api/src/`. Each fraction is covered/eligible. **Parentheses mark the seven protected per-file verdicts**; other rows contribute counts to the pool, not individual pass/fail decisions. The file order can differ between attempts.

| Attempt A: file | A lines | A blocks | Attempt B: file | B lines | B blocks |
|---|---:|---:|---|---:|---:|
| `app/domain-services.ts` | 4/7 | 0/2 | `app/domain-services.ts` | 4/7 | 0/2 |
| `app/livekit.ts` | 0/1 | N/A | `app/livekit.ts` | 0/1 | N/A |
| `app/service-registry.ts` | 4/6 | 0/2 | `app/service-registry.ts` | 4/6 | 0/2 |
| `domains/rooms/peer-moderation.service.ts` | 0/1 | 0/1 | `domains/rooms/peer-moderation.service.ts` | 0/1 | 0/1 |
| `domains/admission/call-voice-admission.service.ts` (fail) | 24/40 | 1/8 | `domains/feedback/call-feedback.service.ts` | 1/3 | N/A |
| `domains/feedback/call-feedback.service.ts` | 1/3 | N/A | `domains/feedback/call-feedback.repository.ts` | 5/11 | N/A |
| `domains/feedback/call-feedback.repository.ts` | 5/11 | N/A | `app/api-runtime.ts` | 59/60 | 2/3 |
| `app/api-runtime.ts` | 59/60 | 2/3 | `realtime/call-seat-cleanup.ts` | 65/72 | 11/16 |
| `realtime/call-seat-cleanup.ts` | 65/72 | 11/16 | `domains/admission/livekit-auth-gate.service.ts` (fail) | 12/16 | 13/14 |
| `domains/admission/livekit-auth-gate.service.ts` (fail) | 12/16 | 13/14 | `domains/messaging/direct-messages.service.ts` | 3/4 | 8/8 |
| `domains/messaging/direct-messages.service.ts` | 3/4 | 8/8 | `domains/rings/ring-delivery.ts` | 10/13 | 7/7 |
| `domains/rings/ring-delivery.ts` | 10/13 | 7/7 | `app/call-realtime.ts` | 44/46 | 4/5 |
| `app/call-realtime.ts` | 44/46 | 4/5 | `realtime/reconnect-leases.ts` | 4/5 | 4/5 |
| `realtime/reconnect-leases.ts` | 4/5 | 4/5 | `domains/rooms/room.repository.ts` | 22/22 | 5/6 |
| `domains/rooms/room.repository.ts` | 22/22 | 5/6 | `domains/rings/call-rings.service.ts` | 447/479 | 199/235 |
| `domains/rings/call-rings.service.ts` | 448/479 | 199/234 | `domains/rings/call-rings.routes.ts` | 98/98 | 6/7 |
| `domains/rings/call-push.repository.ts` | 127/130 | 24/28 | `domains/rings/call-push.repository.ts` | 127/130 | 26/30 |
| `domains/rings/call-rings.routes.ts` | 98/98 | 6/7 | `domains/messaging/call-history.repository.ts` | 103/103 | 7/8 |
| `domains/messaging/call-history.repository.ts` | 103/103 | 7/8 | `domains/rings/call-rings.repository.ts` | 402/415 | 115/129 |
| `domains/rings/call-rings.repository.ts` | 402/415 | 115/129 | `domains/admission/call-voice-admission.service.ts` (pass) | 39/40 | 17/18 |
| `realtime/room-runtime.ts` | 46/48 | 34/36 | `realtime/room-runtime.ts` | 46/48 | 34/36 |
| `realtime/voice-join.ts` | 47/48 | 27/28 | `realtime/voice-join.ts` | 47/48 | 27/28 |
| `domains/rings/call-push.service.ts` | 80/81 | 40/41 | `domains/rings/call-push.service.ts` | 80/81 | 40/41 |
| `domains/rings/call-lifecycle.policy.ts` | 88/89 | 72/73 | `domains/rings/call-lifecycle.policy.ts` | 88/89 | 72/73 |
| `app/api-routes.ts` | 2/2 | N/A | `app/api-routes.ts` | 2/2 | N/A |
| `app/config.ts` | 5/5 | 4/4 | `app/config.ts` | 5/5 | 4/4 |
| `app/full-room-realtime.ts` | 1/1 | 3/3 | `app/full-room-realtime.ts` | 1/1 | 3/3 |
| `app/realtime-hub.ts` | 11/11 | N/A | `app/realtime-hub.ts` | 11/11 | N/A |
| `domains/account/account.service.ts` | 1/1 | 2/2 | `domains/account/account.service.ts` | 1/1 | 2/2 |
| `domains/admin/admin-accounts.repository.ts` | 11/11 | N/A | `domains/admin/admin-accounts.repository.ts` | 11/11 | N/A |
| `domains/admin/admin-rooms.repository.ts` | 4/4 | N/A | `domains/admin/admin-rooms.repository.ts` | 4/4 | N/A |
| `domains/admin/admin-rooms.service.ts` | 12/12 | 10/10 | `domains/admin/admin-rooms.service.ts` | 12/12 | 10/10 |
| `domains/admission/call-gate.repository.ts` (pass) | 42/42 | 2/2 | `domains/admission/call-gate.repository.ts` (pass) | 42/42 | 2/2 |
| `domains/admission/credential-boundary.service.ts` (pass) | 5/5 | 4/4 | `domains/admission/credential-boundary.service.ts` (pass) | 5/5 | 4/4 |
| `domains/admission/gate-credential-signer.ts` (pass) | 8/8 | 7/7 | `domains/admission/gate-credential-signer.ts` (pass) | 8/8 | 7/7 |
| `domains/admission/livekit-admin.ts` (pass) | 7/7 | 9/9 | `domains/admission/livekit-admin.ts` (pass) | 7/7 | 9/9 |
| `domains/admission/livekit-credential-provider.ts` (pass) | 11/11 | 8/8 | `domains/admission/livekit-credential-provider.ts` (pass) | 11/11 | 8/8 |
| `domains/messaging/dm-history.service.ts` | 3/3 | 4/4 | `domains/messaging/dm-history.service.ts` | 3/3 | 4/4 |
| `domains/messaging/dm-thread.repository.ts` | 3/3 | 1/1 | `domains/messaging/dm-thread.repository.ts` | 3/3 | 1/1 |
| `domains/messaging/reaction.repository.ts` | 1/1 | N/A | `domains/messaging/reaction.repository.ts` | 1/1 | N/A |
| `domains/messaging/reply-projector.ts` | 6/6 | 5/5 | `domains/messaging/reply-projector.ts` | 6/6 | 5/5 |
| `domains/notifications/native-push.service.ts` | 10/10 | 15/15 | `domains/notifications/native-push.service.ts` | 10/10 | 15/15 |
| `domains/notifications/notification-preferences.repository.ts` | 2/2 | N/A | `domains/notifications/notification-preferences.repository.ts` | 2/2 | N/A |
| `domains/rings/ring.repository.ts` | 42/42 | 10/10 | `domains/rings/ring.repository.ts` | 42/42 | 10/10 |
| `domains/rooms/rooms.service.ts` | 2/2 | 4/4 | `domains/rooms/rooms.service.ts` | 2/2 | 4/4 |
| `domains/social/friends.service.ts` | 10/10 | 7/7 | `domains/social/friends.service.ts` | 10/10 | 7/7 |
| `domains/social/friendship.repository.ts` | 1/1 | N/A | `domains/social/friendship.repository.ts` | 1/1 | N/A |
| `domains/social/pair-eligibility.repository.ts` | 38/38 | 7/7 | `domains/social/pair-eligibility.repository.ts` | 38/38 | 7/7 |
| `domains/social/social-records.ts` | 3/3 | 2/2 | `domains/social/social-records.ts` | 3/3 | 2/2 |
| `realtime/account-events.ts` | 8/8 | 3/3 | `realtime/account-events.ts` | 8/8 | 3/3 |
| `realtime/room-presence.ts` | 1/1 | 4/4 | `realtime/room-presence.ts` | 1/1 | 3/3 |
| `realtime/room-summaries.ts` | 3/3 | 10/10 | `realtime/room-summaries.ts` | 3/3 | 10/10 |
| `realtime/voice-stays.ts` | 1/1 | 5/5 | `realtime/voice-stays.ts` | 1/1 | 5/5 |
| `realtime/ws-handler.ts` | 59/59 | 42/42 | `realtime/ws-handler.ts` | 59/59 | 42/42 |
| `packages/shared/src/contracts/errors.ts` | 3/3 | N/A | `packages/shared/src/contracts/errors.ts` | 3/3 | N/A |
| `packages/shared/src/contracts/messages.ts` | 13/13 | 2/2 | `packages/shared/src/contracts/messages.ts` | 13/13 | 2/2 |
| `packages/shared/src/contracts/realtime.ts` | 5/5 | N/A | `packages/shared/src/contracts/realtime.ts` | 5/5 | N/A |
| `packages/shared/src/contracts/rings.ts` | 141/141 | N/A | `packages/shared/src/contracts/rings.ts` | 141/141 | N/A |
| `packages/shared/src/native-push.ts` | 28/28 | 24/24 | `packages/shared/src/native-push.ts` | 28/28 | 24/24 |
| `packages/shared/src/notification-text.ts` | 20/20 | N/A | `packages/shared/src/notification-text.ts` | 20/20 | N/A |
| `packages/shared/src/notifications.ts` | 56/56 | 15/15 | `packages/shared/src/notifications.ts` | 56/56 | 15/15 |
| `domains/rooms/room-surface.policy.ts` | N/A | N/A | `domains/rooms/room-surface.policy.ts` | N/A | N/A |
| `platform/db/schema.ts` | N/A | N/A | `platform/db/schema.ts` | N/A | N/A |

## Routing and cost

Compared with PR3b on matched local Git trees, an ordinary Admin leaf still selects only check/check-lane and the Admin tests. An API leaf selects both API producers, the API verdict and G05; shared selects ALL. The existing measured Web dependency still reaches G08. Selector revision `pr4-2` prevents reuse of `pr3b-2` or `pr4-1` markers for the revised proof. Pooling does not schedule additional jobs.

The local full reference test process took 346.6 s. Collector-only replays of its raw input took 7.55 s (v1) and 6.65 s (v2), one observation each under varying local load. They do **not** establish a speedup. The actual PR3b graph already split Voice core and feature journeys into two jobs. PR4 changes no topology: at most **16**, not the earlier plan's 15 (4 check matrix + 2 API producers + 1 Web + 2 Voice + 1 UI audit + 1 G05 + 1 Widget + 1 Personal + 1 installer + 2 reusable static builds; aggregators replace their workers). [PR3b #350](https://github.com/dazeGG/VoiceRoom/actions/runs/45674723298) ran 18:23:52–18:31:48 UTC, 7:56 wall, 55.77 summed runner-minutes and observed peak 16 by the half-open job intervals. The [#345 baseline](https://github.com/dazeGG/VoiceRoom/actions/runs/45602093060) was 8:07 wall, peak 12. Neither wall time measures PR4. Admin-only changes do not pay for collection; API, broad, full main and develop misses pay for the complete check; a matching develop marker reuses its verified scope. No PR4 hosted runs were created: observed queue, peak, runner-minutes and whole-PR wall deltas against #345 or PR3b are unavailable.
