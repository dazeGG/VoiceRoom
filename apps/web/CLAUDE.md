# Web guidance

- Layers and rules: `../../docs/ARCHITECTURE.md` section 5. Svelte 5 runes only; the Svelte MCP server (`.mcp.json`) has the docs and the `svelte-autofixer` — run it on components you write.
- `$effect` only for the outside world (DOM, listeners, timers). Derived values use `$derived`; what happens after a user action belongs in the action function.
- Preserve the feature/shared boundaries: `lib/shared` never imports `lib/features`; reuse shared UI and model utilities before adding new abstractions.
- Keep browser, desktop, media, and LiveKit fallbacks explicit and testable.
- HTTP response types in `src/lib/api/*` mirror the API by hand for now; change both sides in the same commit.
- Unit and component tests run on Vitest with jsdom (`npm --workspace @voice-room/web test`, ~10 s). Import modules directly (`await import('../src/...')`); for a fresh module instance under a stubbed `window`, use `test/helpers/fresh-module.ts`; stub globals with `vi.stubGlobal` (undone after each test). Shared fakes: `test/fixtures/fetch.ts` (HTTP), `test/fixtures/fake-websocket.ts` (realtime), `test/helpers/livekit-harness.ts` (LiveKit service with fake Room and collaborators). Components are rendered with `@testing-library/svelte` and driven with `@testing-library/user-event`; a component that takes snippets gets a small harness under `test/components/harness/`. A test that checks reactivity between a module's `$state` and its own `$effect` must import the module statically (a fresh import reloads Svelte's runtime). Add behaviour tests under `test/` (see the root `CLAUDE.md` testing rules); add Playwright coverage under `e2e/` for critical user flows.
- Verify with `npm --workspace @voice-room/web run check`, `npm --workspace @voice-room/web run test`, and `npm --workspace @voice-room/web run build` when UI or bundling changes.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
