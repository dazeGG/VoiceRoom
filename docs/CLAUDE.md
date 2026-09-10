# docs

- `GIT_FLOW.md` is the authoritative development and release workflow.
- A release plan, when one exists, describes required target state. Mark gates as planned until repository configuration and fresh evidence prove they exist.
- Keep current-state facts, target-state requirements, and historical notes visibly separated.
- Past release plans and gate evidence were removed once shipped; their history lives in Git and the release tags, not in `docs/`.
- Do not claim a release is complete without the tag, version, merge/back-merge, and verification evidence required by `GIT_FLOW.md`.
