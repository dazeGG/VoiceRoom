# Call engine architecture

`packages/call` is TypeScript source compiled by its consumers. Web and Meet install their own ports before routing.
Web loads the engine mount beside the room page and keeps the binding across room mounts for lobby controls and
settings. Meet uses the headless guest controller to check the room and collect a name before mounting the same
engine. Module imports are safe before installation.

## Engine and host

- `core/room-runtime.store.ts` owns the reactive room runtime. Imperative modules use `state` and Vue reads the same
  object through `useRoomRuntimeStore().state`. LiveKit objects and browser media objects are marked raw.
- `core/call-page.store.ts` owns `screen`, `screenView`, `stripCollapsed`, `stageSummary` and `desktopScreenFullscreen`.
  Web combines those refs with its shell state and derives the body classes.
- The host supplies route inputs and shell callbacks at mount. Identity resolves account/guest entry, reads or
  rotates peer credentials and keeps the existing session guard. Web's peer-session adapter retains tab storage for
  compatibility. Other hosts can supply credentials and settings storage with their own scope.
- `transport.ts` describes room status, token and grant requests, and the realtime room lifecycle. Web maps API
  failures and realtime errors to their semantic codes and localized messages. Grant responses stay with the
  request that initiated them. The web realtime adapter retains its existing socket and membership lifecycle.
- Platform capabilities cover capture, native audio, hotkeys, load and the window. Web supplies the current
  desktop bridges at action time. The engine retains listener ownership, capture and teardown order.
- The browser media policy controls both camera capture and remote camera subscription. Web enables cameras.
  Screen and microphone subscriptions keep their own demand and visibility rules.
- Host hooks handle room creation, persistent membership, account bookmarks and ownership, moderation UI,
  leave screens, diagnostics and playback policy. The bookmark and ownership reads remain independent of joining.

## Lifecycle

`room/room.ts` orchestrates entry and leave. `room/voice-events.ts` applies roster frames in delivery order.
`recovery/` coordinates socket and media replacement. `services/livekit-service.ts` owns connection and publication
lifecycle as one unit. Keep the ordering between capture, the roster join, credential admission, LiveKit
connection and publication. Keep disconnect, pending capture disposal and teardown in their existing service owners.

`services/screen-capture-service.ts` owns source selection, constraints and permission cleanup.
`services/desktop-screen-audio.ts` owns PCM worklet and native audio cleanup. `services/screen-share-service.ts`
updates local share state and publication together. `services/microphone-service.ts` keeps noise suppression,
gating and device fallback on one capture pipeline. `room/participants.ts` owns peer media attachments.

## Views and assets

`../views/` provides tiles, stage, dock and device settings as Vue views with typed state, events and slots. Web
composes those views with its account CTA, persistent chat, moderation and settings menus, and leave screens.
The widget retains its own runtime and uses only shared leaf utilities.

`../voice-assets.ts` declares the root-relative asset URLs. Web serves package bytes at those paths in dev and
emits the same paths in production. Its deploy contract hashes the emitted source bytes and publishes the
versioned URL manifest to the call host. Caddy applies the existing revalidation and versioned cache rules.
Cues are synthesized in the browser.

ESLint enforces the call package boundary for static imports, re-exports and literal dynamic imports.

## End-to-end encrypted 1:1 calls

A friend call room (`state.callId`) is always end-to-end encrypted. There is no setting and no cleartext fallback.

- **Encryption before connect.** `services/livekit/transport.ts` creates every call room candidate with LiveKit
  frame encryption and calls `setE2EEEnabled(true)` before `connect`. Until a key exists the SDK drops every
  outgoing frame, so a microphone published while the peer is still ringing leaks nothing.
- **Key agreement.** `e2ee/call-room-e2ee.ts` runs the per-call agreement from `e2ee/key-agreement.ts` over LiveKit
  participant attributes, with the peer the API roster seated (`state.serverPeerIds`). It installs each agreed key
  at its index and exposes `state.callE2ee`: `agreeing`, `secured` with the 4-emoji code, or `failed`.
- **What the call accepts from LiveKit.** It subscribes only to encrypted publications (`isCallPublicationAllowed`)
  and takes participant names from the roster, never from LiveKit.
- **RED.** The microphone sends RED only while the peer's agreement state says its receiver takes RED; a mismatch
  republishes the microphone (`republishCurrentMicrophone`). The web build patches the SDK so an explicit
  `red: true` is honoured under E2EE (`scripts/build/livekit-e2ee-red.ts`).
- **Native receive.** The desktop helper cannot decrypt yet, so `syncNativeVoiceReceive` leaves call rooms to the
  browser path.
