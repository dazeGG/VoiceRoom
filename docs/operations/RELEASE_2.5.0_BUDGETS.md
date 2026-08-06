# Release 2.5.0 budgets

`scripts/perf/release-250-profile.v1.json` is the frozen RC dataset and threshold authority. Run `node scripts/perf/g91-release-budgets.mjs --profile rc --goal G91 --evidence <immutable-result.json>` against an isolated staging dataset. Evidence must bind the git SHA, API/Web/worker digests, hardware, database, concurrency, seed, timestamps, every measurement, low-cardinality labels, alert firing and automatic disable behavior.

Running without `--evidence` validates only the frozen source profile and reports `PENDING_EXTERNAL_PERFORMANCE_EVIDENCE`. It does not close G91. Threshold misses, absent measurements, high-cardinality identity/storage labels, missing alerts, RPO/RTO gaps, or absent immutable digests block G92; thresholds must not be weakened to make a run pass.
