# Web guidance

- Layers and rules: `../../docs/ARCHITECTURE.md` section 5. Svelte 5 runes only; the Svelte MCP server (`.mcp.json`) has the docs and the `svelte-autofixer` — run it on components you write.
- `$effect` only for the outside world (DOM, listeners, timers). Derived values use `$derived`; what happens after a user action belongs in the action function.
- Preserve the feature/shared boundaries: `lib/shared` never imports `lib/features`; reuse shared UI and model utilities before adding new abstractions.
- Keep browser, desktop, media, and LiveKit fallbacks explicit and testable.
- HTTP response types in `src/lib/api/*` mirror the API by hand for now; change both sides in the same commit.
- Add behaviour tests under `test/` (see the root `CLAUDE.md` testing rules); add Playwright coverage under `e2e/` for critical user flows.
- Verify with `npm --workspace @voice-room/web run check`, `npm --workspace @voice-room/web run test`, and `npm --workspace @voice-room/web run build` when UI or bundling changes.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
