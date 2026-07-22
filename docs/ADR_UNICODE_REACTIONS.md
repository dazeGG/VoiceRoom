# ADR: Unicode authority for message reactions

Status: Accepted for G06 dependency authority only.

Date: 2026-07-20

## Context

Release 2.5.0 needs a deterministic reaction emoji authority before any package manifest, lockfile, generated corpus, shared adapter, API, or web code is allowed to change. The authority must be exact enough for G07 to generate a reproducible corpus and for later reaction goals to reject malformed, unsupported, or presentation-ambiguous input.

The reaction policy is intentionally narrower than the full Unicode RGI set:

- accept exactly one `fully-qualified` emoji sequence from the pinned Unicode data file;
- reject `minimally-qualified` and `unqualified` sequences;
- reject standalone `component` entries, including isolated skin tone and hair components;
- reject every sequence not present in the pinned authority file until a later approved amendment changes the authority.

No npm package is authorized by this ADR. G07 may add a generator, committed corpus, adapter, manifests, and lockfile after this authority is in place.

## Decision

The sole authority for reaction eligibility is the official Unicode `emoji-test.txt` file for Emoji Version 17.0, published inside the Unicode 17.0.0 release tree:

- Authority URL: `https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt`
- Unicode file version: `17.0`
- Unicode file date: `2025-08-04, 20:55:31 GMT`
- Accessed for this ADR: `2026-07-20`
- File size observed: `669326` bytes
- SHA-256: `1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda`
- License / terms: Unicode Terms of Use, linked by the file header at `https://www.unicode.org/terms_of_use.html`
- Attribution: keep Unicode copyright and terms reference in generated corpus metadata.

Observed coverage in this exact file:

| Status | Count | Reaction policy |
| --- | ---: | --- |
| `fully-qualified` | 3944 | accepted by G07 corpus |
| `minimally-qualified` | 1029 | rejected |
| `unqualified` | 243 | rejected |
| `component` | 9 | rejected as standalone reaction input |
| total parsed entries | 5225 | generator input universe |

This policy gives deterministic fidelity by storing the file URL, version, date, byte size, checksum, status counts, and generation rule. A future Unicode upgrade must fetch a new official file, recompute the checksum and counts, update attribution metadata, regenerate the corpus, and pass the same acceptance/rejection fixtures before package or adapter changes land.

## Candidate comparison

| Candidate | Version checked | License / attribution | Maintenance evidence as of 2026-07-20 | Runtime / bundle risk | Module / types shape | Unicode coverage and RGI fidelity | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Unicode `emoji-test.txt` | Emoji `17.0`, file date `2025-08-04`, accessed from Unicode `17.0.0` release tree | Unicode Terms of Use; generated artifacts must retain Unicode copyright/terms reference | Official Unicode release artifact; update cadence follows Unicode emoji data releases, not npm package cadence | No runtime dependency if G07 commits a generated corpus | Plain text data file; generator-owned parsing | Exact source of qualification statuses. G07 can accept only `fully-qualified` and reject `minimally-qualified`, `unqualified`, and standalone `component` entries deterministically. | Sole authority |
| `emojibase-data` | npm `17.0.0`; latest `17.0.0`; published `2025-11-17T16:32:38.457Z`; registry modified `2025-11-17T16:32:38.610Z` | MIT; package author Miles Johnson; Unicode attribution still required for derived Unicode data | 56 registry versions; recent releases include `16.0.0` on `2024-12-07`, patch releases through `2025-04-12`, then `17.0.0` on `2025-11-17` | Large data package: registry unpacked size `50042068` bytes, 324 files; unsuitable as a direct runtime dependency for reaction validation | Data package; no committed `main`, `module`, or `types` in registry metadata for `17.0.0` | Useful derived data, but not the canonical qualification authority and too broad for a narrow fully-qualified-only reaction corpus. | Candidate rejected as authority; may be used only in a separately approved tooling step |
| `emoji-regex` | npm `10.6.0`; latest `10.6.0`; published `2025-10-13T08:13:51.804Z`; registry modified `2026-04-24T23:31:06.993Z` | MIT; package author Mathias Bynens | 37 registry versions; recent major/minor updates track Unicode-era changes (`10.4.0` in 2024, `10.5.0` and `10.6.0` in 2025) | Small package: registry unpacked size `34544` bytes, 6 files; runtime regex can still be opaque and broader than release policy | CJS `index.js`, ESM `index.mjs`, types `index.d.ts` | Built from Unicode data and useful for matching, but it is a generated regex package rather than the authority file. It does not encode this release's “fully-qualified only, no standalone components” policy by itself. | Candidate rejected as authority |
| `emoji-regex-xs` | npm `2.0.1`; latest `2.0.1`; published `2025-04-22T12:47:49.444Z`; registry modified `2025-04-22T12:47:49.605Z` | MIT; package author Steven Levithan | 3 registry versions since 2024; `2.0.1` dev metadata references `@unicode/unicode-16.0.0`, not Unicode 17.0 | Small package: registry unpacked size `10410` bytes, 6 files; uses compact regex strategy and runtime Unicode support assumptions | CJS `index.js`, ESM `index.mjs`, types `index.d.ts` | Not pinned to Unicode 17.0 in checked metadata and not a deterministic qualification corpus. | Candidate rejected as authority |

## G07 handoff

G07 must:

1. download or vendor the exact authority file only from the pinned Unicode URL;
2. verify SHA-256 before generating anything;
3. parse the `status` column and emit accepted entries only for `fully-qualified`;
4. emit explicit rejection fixtures for `minimally-qualified`, `unqualified`, standalone `component`, malformed, and unsupported-version sequences;
5. commit generated corpus metadata with the URL, version, date, checksum, counts, policy, and Unicode attribution;
6. only then add any package manifests, lockfile entries, shared adapter, CJS/ESM/type surfaces, or CI wiring.

```json authority-decision
{
  "schemaVersion": 1,
  "goal": "G06",
  "release": "2.5.0",
  "status": "ACCEPTED",
  "decisionDate": "2026-07-20",
  "authority": {
    "name": "Unicode emoji-test.txt",
    "provider": "Unicode Consortium",
    "url": "https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt",
    "unicodeVersion": "17.0",
    "fileDate": "2025-08-04, 20:55:31 GMT",
    "accessedDate": "2026-07-20",
    "byteSize": 669326,
    "sha256": "1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda",
    "license": "Unicode Terms of Use",
    "licenseUrl": "https://www.unicode.org/terms_of_use.html",
    "attributionRequired": true,
    "counts": {
      "fully-qualified": 3944,
      "minimally-qualified": 1029,
      "unqualified": 243,
      "component": 9,
      "total": 5225
    }
  },
  "reactionPolicy": {
    "acceptedStatuses": ["fully-qualified"],
    "rejectedStatuses": ["minimally-qualified", "unqualified", "component"],
    "rejectStandaloneComponents": true,
    "rejectUnknownSequences": true
  },
  "manifestAuthorization": {
    "npmPackagesAuthorized": false,
    "packageManifestsMayChangeInG06": false,
    "nextGoal": "G07",
    "nextGoalMayAdd": ["generator", "committed corpus", "shared adapter", "package manifests", "lockfile", "CI wiring"]
  },
  "candidates": [
    {
      "name": "Unicode emoji-test.txt",
      "version": "17.0",
      "license": "Unicode Terms of Use",
      "runtimeRisk": "none when converted to a committed corpus",
      "moduleShape": "plain text data",
      "authority": true
    },
    {
      "name": "emojibase-data",
      "version": "17.0.0",
      "license": "MIT",
      "publishedAt": "2025-11-17T16:32:38.457Z",
      "unpackedSize": 50042068,
      "moduleShape": "data package",
      "authority": false
    },
    {
      "name": "emoji-regex",
      "version": "10.6.0",
      "license": "MIT",
      "publishedAt": "2025-10-13T08:13:51.804Z",
      "unpackedSize": 34544,
      "moduleShape": "CJS, ESM, types",
      "authority": false
    },
    {
      "name": "emoji-regex-xs",
      "version": "2.0.1",
      "license": "MIT",
      "publishedAt": "2025-04-22T12:47:49.444Z",
      "unpackedSize": 10410,
      "moduleShape": "CJS, ESM, types",
      "authority": false
    }
  ],
  "maintenanceSnapshots": [
    {
      "name": "emojibase-data",
      "latest": "17.0.0",
      "versionCount": 56,
      "created": "2017-08-05T07:48:02.399Z",
      "modified": "2025-11-17T16:32:38.610Z",
      "selectedVersionPublishedAt": "2025-11-17T16:32:38.457Z"
    },
    {
      "name": "emoji-regex",
      "latest": "10.6.0",
      "versionCount": 37,
      "created": "2014-09-28T11:10:47.034Z",
      "modified": "2026-04-24T23:31:06.993Z",
      "selectedVersionPublishedAt": "2025-10-13T08:13:51.804Z"
    },
    {
      "name": "emoji-regex-xs",
      "latest": "2.0.1",
      "versionCount": 3,
      "created": "2024-06-28T16:22:28.543Z",
      "modified": "2025-04-22T12:47:49.605Z",
      "selectedVersionPublishedAt": "2025-04-22T12:47:49.444Z"
    }
  ]
}
```
