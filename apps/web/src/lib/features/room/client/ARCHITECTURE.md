# Room client architecture

The room client is a Svelte-mounted imperative island around browser-only APIs
(LiveKit, `getUserMedia`, `getDisplayMedia`, fullscreen, SSE and audio worklets).
Svelte owns the route shell and stable mount points; client modules own runtime
state and DOM updates after the lazy `client/main` import.

## Boundaries

- `core/` keeps shared runtime state, config, session and primitive utilities.
- `room/` owns room lifecycle, SSE messages and participant domain updates.
- `services/` owns external browser/media integrations. These files stay grouped
  by API lifecycle because capture, publication and teardown order is the bug-prone
  part of the feature.
- `ui/` owns DOM rendering for the imperative island. `dom.ts` is the only selector
  registry and is scoped to the Svelte room root via `setElementsRoot(root)`.
- `styles/` is split by surface and imported through `room.css`.

## Deliberate transitional modules

Some service modules are still larger than the preferred component size:

- `screen-capture-service.ts` — source selection, profile constraints, audio
  mixing and capture cleanup share one browser permission lifecycle.
- `screen-share-service.ts` — local share state, publication and UI controls must
  update atomically around the same local stream.
- `livekit-service.ts` — connection, publication and subscription handlers depend
  on LiveKit event ordering and should not be split until covered by integration
  tests/mocks.
- `microphone-service.ts` — noise suppression, gating and device fallback are kept
  together to avoid splitting one capture pipeline across files.
- `participants.ts` — participant domain state and participant DOM refs are still
  coupled because the current UI uses an imperative template, not Svelte components.
- `room.ts` — route/lifecycle coordinator; it should remain orchestration-only and
  delegate browser/media details to services.

The next safe split is to replace participant and stage template refs with Svelte
component props/context. Until then, new code should prefer existing seams above
instead of adding more selectors or cross-module state mutation.
