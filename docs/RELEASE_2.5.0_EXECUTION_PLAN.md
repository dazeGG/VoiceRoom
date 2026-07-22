# VoiceRoom 2.5.0 — consolidated execution plan

**Status:** approved execution-shape amendment; planning only.
**Scope source:** `docs/RELEASE_2.5.0_PLAN.md`.
**Verification source:** `docs/RELEASE_2.5.0_TEST_SPEC.md`.
**Constraint:** preserve G01–G93 requirements while delivering them through no more than ten feature branches.
**Current branch:** `feature/2.5.0-foundation`, renamed from `feature/2.5.0-g03-durable-evidence-archive` without changing its commits.

## 1. Outcome

Deliver the already-approved VoiceRoom 2.5.0 scope without treating every G-number as a separate Git lifecycle. G-numbers remain stable requirement, test and evidence identifiers. The unit of implementation, review and merge becomes a subsystem branch.

This amendment changes execution granularity only. It does not add, remove or implement product requirements.

## 2. Delivery rules

1. Use nine delivery branches. Do not create per-G-number feature branches.
2. Every G-number keeps its objective, writable-path guidance, acceptance criteria, targeted test and rollback requirements.
3. Within a delivery branch, complete slices in dependency order and keep commits small and conventionally named. A slice is locally complete when its targeted verification passes; it does not require a PR or merge envelope of its own.
4. Run exact-head code review, architecture review, repository gates and branch evidence once after the whole delivery branch is internally green.
5. A failed review or test is repaired on the same open delivery branch while the change remains inside its declared G-range. A new authorization branch is required only for a material scope expansion, security architecture change or migration-contract change.
6. Merge completed branches into `develop`; do not stack long-lived branches on unmerged feature branches.
7. Preserve the four existing subsystem checkpoints: G42, G50, G71 and G90. Their hostile, rollback and observation requirements do not weaken.
8. G93 remains the release-entry gate. The release branch, final RC, `main` merge, tag, release and backmerge remain separate release operations.

## 3. Branch map

| Order | Branch | Goals | Result | Merge prerequisite |
| --- | --- | --- | --- | --- |
| B01 | `feature/2.5.0-foundation` | G03–G15 | durable evidence, LiveKit/dependency decisions, quality gates, runtime publication boundary, config/capability/migration foundation | G01–G02 already green |
| B02 | `feature/2.5.0-desktop-boundary` | G16–G19 | platform classification, persistence, desktop-only root boundary and physical RC matrix | B01 |
| B03 | `feature/2.5.0-messaging` | G20–G42 | cursor history, reads, replies, durable delivery, ban invariant and messaging checkpoint | B01; B02 result incorporated before G42 closes |
| B04 | `feature/2.5.0-membership` | G43–G50 | active-only membership, directory/roster, strict credentials, leave/rejoin and membership checkpoint | B03 and approved G05 result |
| B05 | `feature/2.5.0-engagement` | G51–G66 | structured content, mentions, inbox, notification policy/delivery and unread navigation | B04 plus messaging UoW/lease foundations |
| B06 | `feature/2.5.0-reactions` | G67–G71 | RGI reaction contracts, persistence, API/Web and engagement checkpoint | B04, G07 and B05 incorporated before G71 closes |
| B07 | `feature/2.5.0-media` | G72–G84 | attachment contracts, private storage, upload, quota, workers, cleanup, binding, authorization and UI | B04 plus messaging visibility/UoW foundations |
| B08 | `feature/2.5.0-moderation-restore` | G85–G90 | rescue digest, temporary bans, deletion revocation, moderation, coordinated restore and media checkpoint | B07 |
| B09 | `feature/2.5.0-release-readiness` | G91–G93 | budgets, activation matrix and develop release-entry authorization | B02–B08 merged and checkpoints green |

G01 and G02 are already completed and are not assigned new branches. Existing G03 work is preserved in B01.

## 4. Dependency and parallelism model

```text
B01 foundation
  ├─ B02 desktop boundary ───────────────────────┐
  └─ B03 messaging -> B04 membership             │
                       ├─ B05 engagement ─┐       │
                       ├─ B06 reactions  ─┴ G71  │
                       └─ B07 media -> B08 -> G90│
                                                  v
                                         B09 release readiness
```

- B02 and the early implementation of B03 may proceed independently after B01, but G42 closes only with B02 incorporated.
- B05 and B07 may proceed in parallel after B04.
- B06 may begin after B04 and G07, but closes G71 only after B05 is incorporated.
- B08 follows B07.
- B09 starts only after every subsystem branch is merged and all four checkpoints are green.

Parallel work uses separate files or explicitly assigned ownership. Shared contracts in `packages/shared`, shared CI workflows, migrations and capability manifests have one owner at a time.

## 5. Branch-level completion contract

A delivery branch is merge-ready only when:

1. every assigned G-slice acceptance criterion is accounted for;
2. every assigned targeted test passes at the final branch head;
3. `npm run check`, `npm test` and `npm run build` pass at that same head;
4. database changes have forward and rollback-path verification;
5. exact-head code review and architecture review have no blocking findings;
6. the verifier confirms scope coverage, tests and rollback behavior;
7. the PR targets `develop` and contains no unrelated work;
8. post-merge verification is recorded once for the branch.

Checkpoint branches additionally retain the existing P4 data, failure-profile and observation requirements. Consolidation must not turn a required hostile integration check into a mock-only check.

## 6. Commit and repair policy

- Prefer one or several reviewable commits per G-slice inside its delivery branch.
- Commit subjects retain the relevant goal when useful, for example `feat(api): implement G26 room pagination`.
- Ordinary defects discovered before merge are fixed on the same delivery branch.
- If a fix crosses the branch's assigned G-range or changes an approved security, persistence, public-contract or production boundary, stop that branch and amend this plan before expanding scope.
- Do not create the former two-PR authorization/fix sequence for ordinary implementation defects.
- Do not rewrite or relabel already published G01/G02 evidence.

## 7. Acceptance criteria for this amendment

- The execution plan defines nine and no more than ten feature branches.
- Every goal G03–G93 belongs to exactly one branch; G01–G02 are explicitly recorded as complete predecessors.
- The ranges are contiguous and cover all integers from 3 through 93 with no gap or overlap.
- G42, G50, G71 and G90 remain checkpoint closures.
- G91–G93 remain after every feature/checkpoint branch.
- Existing per-goal tests and acceptance criteria remain authoritative.
- No product implementation is introduced by this planning change.

## 8. Verification of the amendment

Before execution resumes:

1. mechanically verify the branch count and complete G03–G93 coverage;
2. verify that both canonical plan and test specification point to this amendment;
3. verify the renamed branch still contains exactly the former G03 branch commits and is based on current `origin/develop` history;
4. run the existing plan validator to ensure all 93 requirement cards and trace rows remain present;
5. review the Git diff to confirm only planning documents changed after the branch rename.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Larger PRs become hard to review | Keep G-numbered commits and a PR checklist mapping every slice to tests and files |
| Parallel branches conflict in shared contracts/config | Assign a single owner; refresh from `develop` before final verification |
| A late checkpoint finds an early regression | Run targeted tests per slice and subsystem integration tests continuously inside the branch |
| Consolidation weakens evidence | Produce evidence once per immutable branch head and retain P4 checkpoint/final evidence |
| Scope silently expands inside a large branch | Fixed G-ranges, literal goal checklist and amendment requirement for boundary changes |

## 10. ADR

### Decision

Use nine subsystem delivery branches while retaining G01–G93 as requirement and verification identifiers.

### Drivers

1. Reduce repeated GitHub, CI, review and evidence overhead.
2. Preserve coherent subsystem boundaries and rollback checkpoints.
3. Enable bounded parallel development without a single unreviewable release branch.

### Alternatives considered

- One branch for G03–G93: lowest Git overhead, but excessive conflict, review and recovery risk.
- Ninety-three branches: strongest isolation, but observed execution overhead dominates delivery.
- Nine subsystem branches: moderate PR size, natural ownership boundaries and limited parallelism.

### Why chosen

Nine branches are the smallest practical grouping that preserves separate messaging, membership, engagement, reactions, media and moderation boundaries while staying below the requested maximum of ten.

### Consequences

- Per-goal merge envelopes and remote-branch deletion proofs are removed.
- Branch PRs are larger and require explicit G-slice checklists.
- Subsystem checkpoints and final release evidence remain expensive by design.
- Existing G01/G02 history remains valid; B01 continues from the preserved G03 commits.

### Follow-ups

- Update the durable OMX goal ledger from 93 executable goals to nine branch-level delivery goals before implementation resumes.
- Do not execute product tasks until that ledger migration has been reviewed against this document.
