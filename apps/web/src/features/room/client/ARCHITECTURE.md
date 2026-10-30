# Room client architecture

The room client is a Vue-owned UI shell around browser-only runtime APIs
(LiveKit, `getUserMedia`, `getDisplayMedia`, fullscreen, the app WebSocket and audio worklets).
Vue owns route structure, room controls, participant tiles, overlays and screen
stage rendering. Client modules own media/session side effects after the lazy
`client/main` import.

## Boundaries

- `core/` keeps shared runtime state, config, session and primitive utilities.
  `core/room-runtime.store.ts` is the reactive room runtime state: one
  module-level reactive object that imperative services import directly and
  components read through `useRoomRuntimeStore().state`. Class instances
  assigned to it (LiveKit `Room`, publications) are marked raw.
- `room/` owns room lifecycle, WebSocket messages and participant domain updates.
- `services/` owns external browser/media integrations. These files stay grouped
  by API lifecycle because capture, publication and teardown order is the bug-prone
  part of the feature.
- `ui/` contains browser/media UI helpers and pure view derivations rather
  than a selector registry.
- `features/room/components/` owns the rendered Vue surfaces: dock, topbar,
  participants, overlays, screen stage and stream tiles. Their styles are the
  partials in `src/styles/room/`.

## Deliberate transitional modules

Some service modules are still larger than the preferred component size:

- `screen-capture-service.ts` — source selection, profile constraints and capture
  cleanup share one browser permission lifecycle. The desktop app's native system
  audio (PCM through an AudioWorklet) lives in `desktop-screen-audio.ts`.
- `screen-share-service.ts` — local share state, publication and UI controls must
  update atomically around the same local stream.
- `livekit-service.ts` — connection, publication and subscription handlers depend
  on LiveKit event ordering and should not be split until covered by integration
  tests/mocks.
- `microphone-service.ts` — noise suppression, gating and device fallback are kept
  together to avoid splitting one capture pipeline across files.
- `participants.ts` — participant domain state, remote audio element lifecycle and
  LiveKit track attachment remain imperative; visual rendering lives in Vue.
- `room.ts` — route/lifecycle coordinator; it should remain orchestration-only and
  delegate browser/media details to services. Start-screen actions are in
  `room-start.ts`, the entry check (account or guest name) in `room-entry.ts`, and
  the joined room's voice events in `voice-events.ts`.

New UI work should prefer Vue components plus reactive view derivations instead
of adding new global selectors or cross-module DOM mutation.
