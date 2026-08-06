# Release 2.5.0 develop entry

G93 is a fail-closed audit of `develop`. It may authorize creation of `release/2.5.0` only after one external G01 terminal selection, the current G03 archive, immutable G42/G50/G71/G90 checkpoint chains, G91 performance evidence, G92 activation evidence, and the ordered repair ledger are all verified.

The tracked `bootstrap-lineage.json` is currently an explicit non-authoritative pending marker because the external selection does not exist in this checkout. It must be replaced only by a summary derived from that immutable selection and its ordered ancestor failures. Candidate registries are inputs and must not be rewritten to manufacture authority.

Run `node --test scripts/test/g93-entry-gate.test.mjs` for structural tests. The workflow additionally runs `node scripts/test/g93-entry-gate.test.mjs --gate`, which remains red while external evidence is pending. Passing G93 authorizes only creation of the release branch; it never authorizes an RC, main merge, tag, GitHub release, deployment, production credential access, or production contact.
