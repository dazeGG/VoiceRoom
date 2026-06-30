# Room client architecture

The room client is a Svelte-owned UI shell around browser-only runtime APIs
(LiveKit, `getUserMedia`, `getDisplayMedia`, fullscreen, SSE and audio worklets).
Svelte owns route structure, room controls, participant tiles, overlays and screen
stage rendering. Client modules own media/session side effects after the lazy
`client/main` import.

## Boundaries

- `core/` keeps shared runtime state, config, session and primitive utilities.
  `core/state.svelte.ts` is the reactive room runtime state used by both Svelte
  components and imperative services.
- `room/` owns room lifecycle, SSE messages and participant domain updates.
- `services/` owns external browser/media integrations. These files stay grouped
  by API lifecycle because capture, publication and teardown order is the bug-prone
  part of the feature.
- `ui/` now contains browser/media UI helpers and pure view derivations rather
  than a selector registry. The old `dom.ts`/`elements` cache has been removed.
- `components/` owns the rendered Svelte surfaces: dock, topbar, participants,
  overlays, screen stage and stream tiles.
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
- `participants.ts` — participant domain state, remote audio element lifecycle and
  LiveKit track attachment remain imperative; visual rendering lives in Svelte.
- `room.ts` — route/lifecycle coordinator; it should remain orchestration-only and
  delegate browser/media details to services.

New UI work should prefer Svelte components plus reactive view derivations instead
of adding new global selectors or cross-module DOM mutation.
