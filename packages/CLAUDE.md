# packages

- `shared/` is the compatibility boundary between API and Web.
- Keep runtime JavaScript, declarations, and tests aligned for every exported contract.
- Prefer backward-compatible contract evolution; coordinate breaking changes through a release plan.
- Verify with `npm --workspace @voice-room/shared run check` and `npm --workspace @voice-room/shared run test`.
- Follow the mandatory branch, commit, PR, and release rules in `../docs/GIT_FLOW.md`.
