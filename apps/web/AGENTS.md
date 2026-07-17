<!-- Parent: ../AGENTS.md -->
# Web guidance

- Preserve the existing Svelte feature/shared boundaries; reuse shared UI and model utilities before adding new abstractions.
- Keep browser, desktop, media, and LiveKit fallbacks explicit and testable.
- Add focused tests under `test/`; add Playwright coverage under `e2e/` for critical user flows.
- Verify with `npm --workspace @voice-room/web run check`, `npm --workspace @voice-room/web run test`, and `npm --workspace @voice-room/web run build` when UI or bundling changes.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
