# Release 2.5.0 durable evidence archive

## Authority boundary

The only target is the private, user-owned package
`ghcr.io/dazegg/voiceroom-release-evidence`, linked only to the public
`dazeGG/VoiceRoom` repository. The frozen pre-publication authority is
`docs/releases/2.5.0/evidence/archive-authority.json`. Publication uses the
repository `GITHUB_TOKEN`; a PAT, registry secret, package deletion, subject or
referrer relationship, implicit `latest`, and a generic `oras push` are forbidden.

The tracked map and ledger are intentionally empty until an authorized workflow
run proves the real package. They must never claim publication based on a local
plan or a tag. Successful workflow proof artifacts are reviewed and appended in
a later, ordinary source change without rewriting previous entries.

## Imported lineage

The archive workflow imports the exact external terminal selection, its ordered
ancestor failure, and the selected G01/G02 F7, F9, and F11 compact JSON bytes.
Tracked candidate registries are context only. Before upload, GitHub artifact
metadata, the downloaded ZIP digest, the exact member name, producer run, and
terminal remote `develop` SHA are authenticated.

Each JSON object becomes one standalone OCI image manifest with artifact type
`application/vnd.voiceroom.release-evidence.v1+json`, an exact `{}` empty
config, and one `application/json` layer containing the original bytes. Source,
revision, run, attempt, and evidence ID are manifest annotations.

## Publication order

Publication is fail-closed and ordered:

1. validate the compact source bytes and compute descriptors;
2. upload the exact empty config blob;
3. authenticate owner, private visibility, actor, and sole repository linkage;
4. upload the evidence layer;
5. publish the prepared manifest using its digest reference;
6. fetch the manifest by digest and compare it byte-for-byte;
7. attest and verify that manifest digest;
8. create a never-reused discovery tag and resolve it once to the digest; and
9. emit the append-only map/ledger proof last.

The manifest digest is the only recovery authority. Tags are discovery aids and
must never select, authorize, or overwrite evidence.

## Recovery and sentinel

`scripts/evidence/recover-from-oci.mjs` accepts only `package + manifest digest`.
It fetches the manifest and layer, verifies media types, annotations, digests,
and attestation, then writes the original bytes. Recovery remains valid after the
90-day Actions copy is gone and never regenerates or relabels evidence.

The scheduled sentinel checks package owner, private visibility, sole repository
linkage, actor, every manifest/layer digest, attestation, availability, and tag
resolution. Missing or deleted content is fatal; GHCR is deletion-capable and is
not WORM or tamper-proof. Retention is at least 365 days and through the entire
v2.5 support window.

Before the earliest source expiry, a transient API failure, incomplete exact
upload, or missing attestation may enter bounded `R-G03-MM` only while identical
source bytes and unchanged authority remain available. Expiry, missing source,
authority/linkage drift, remote byte mismatch, mismatched attestation, deletion,
or sentinel drift freezes and abandons the complete G01-G03 lineage.

## Verification

```sh
node --test scripts/test/g03-evidence-archive.test.mjs \
  && scripts/ci/run-actionlint.sh .github/workflows/evidence-archive.yml .github/workflows/evidence-archive-sentinel.yml \
  && scripts/ci/run-oras.sh version
```

The live package/linkage/attestation/digest-recovery claim is not complete until
the explicitly authorized `workflow_dispatch` run succeeds. Local tests do not
publish packages and must not be reported as that external proof.
