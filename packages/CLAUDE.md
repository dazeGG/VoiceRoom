# packages

- `shared/` is the compatibility boundary between API and Web.
- Each exported contract is one strict TypeScript source in `shared/src/`; keep its tests aligned with it.
- Prefer backward-compatible contract evolution; coordinate breaking changes through a release plan.
- Verify with `npm --workspace @voice-room/shared run check` and `npm --workspace @voice-room/shared run test`.
- Follow the mandatory branch, commit, PR, and release rules in `../docs/GIT_FLOW.md`.
