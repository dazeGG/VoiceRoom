# Web guidance

`apps/web` is the Vue 3 client (Vite, Pinia, vue-router, Reka UI). Layers and import rules: `../../docs/ARCHITECTURE.md` section 5; the room client has its own notes in `src/features/room/client/ARCHITECTURE.md`.

## Rules (binding for every task)

1. `<script setup lang="ts">` only. Typed `defineProps<...>()`, `defineEmits<...>()`, `defineModel` for v-model. No Options API, no mixins.
   A callback prop (`onX`) is allowed instead of an emit when the component renders differently depending on whether a handler was given, or awaits the handler's return value; otherwise use `defineEmits`.
2. Where state lives:
   - a component's own state (open flags, input values, hover) is `ref`/`reactive`/`computed` in its `<script setup>`, never a store;
   - app-wide singleton state (session, lobby, inbox, preferences, theme, room runtime and room UI) is a Pinia setup store, `defineStore('x', () => { ... })`, in `*.store.ts`;
   - state owned by one component or subject (`useChatDraft`, `useDmThread`, `useProfileDraft`) is a composable `useX()` returning refs and functions, in `use-x.ts`;
   - context (`provideLobby`/`useLobby`) is `provide`/`inject` with a typed `InjectionKey` exported next to the store.
3. `watch`/`watchEffect` only for the outside world (DOM, listeners, timers); `flush: 'post'` when it touches the DOM, `onMounted`/`onBeforeUnmount` for listeners and timers. Derived values are `computed`; what happens after a user action belongs in the action function. A view that starts fresh for a new subject is remounted with `:key` or `v-if`, not reset in a watcher.
4. Never put a foreign object into reactive state unwrapped: LiveKit `Room`/`Participant`/`Track`, `MediaStream`, `MediaStreamTrack`, `AudioContext`, `AudioNode`, `WebSocket`, DOM nodes go through `markRaw()` or `shallowRef`. Vue `reactive` proxies class instances, which breaks identity checks and costs CPU.
5. Imperative code (room client, services) reads stores with `useXStore()` after `setActivePinia(pinia)` in `main.ts`. Tests call `setActivePinia(createPinia())` in `beforeEach` (`renderWithApp` and `freshImport` do it).
6. Styles: no `<style>` in `.vue` files. A component's block lives in `src/styles/<area>/_<block>.scss`, is forwarded from that area's `_index.scss`, and uses BEM names (`room-dock`, `room-dock__button`, `room-dock__button--active`). `<style scoped>` only with a one-line comment above it saying why and an entry in `STYLE_ALLOWLIST` in `scripts/check-web-styles.mts`. Colours come from the `--vr-*` tokens in `_tokens.scss`, never raw values (`scripts/check-web-palette.mts`). Breakpoints and repeated patterns are in `_mixins.scss`. Sass module system only (`@use`/`@forward`), never `@import`. The "Svelte class -> BEM class" maps at the top of older partials record the pre-Vue selectors; new partials do not need one.
7. State in markup: semantic state is `aria-*` (`aria-pressed`, `aria-expanded`, `aria-selected`, `aria-current`, `aria-busy`, `aria-disabled`) and the SCSS selects on it; visual-only state is a BEM modifier class via `:class`. No `data-*` for styling and no `[data-` in `.scss` (comments are not checked). `data-*` stays only where a third party sets it (Reka's `data-state`); we do not select on it.
8. Reka UI sits behind our primitives (`Dialog`, `Popover`, `ContextMenu`, `Select`, `Slider`, `Switch`, `SegmentControl`). Only `src/shared/ui/**` imports `reka-ui`.
9. Imports use the `@/` alias (`src/`). Layer rules are enforced by ESLint for these paths.
10. `shared` never imports `features`; reuse shared UI and model utilities before adding abstractions.
11. Browser, desktop, media and LiveKit fallbacks stay explicit and testable.
12. HTTP bodies, answers and WebSocket events are typed from `@voice-room/shared/contracts/*`; never redeclare a server payload in `src/api/*`. Show a failure with `ApiError.message` (the text for its error code), not the raw server string.
13. Browser code logs through `@/shared/log` (ESLint `no-console`); only the logger touches the console.

## Root and body classes

State on `<html>` and `<body>` is a class:

| State | Class |
| --- | --- |
| Theme (one at a time; `graphite-volt` is the default) | `html.theme--graphite-volt`, `html.theme--graphite-ice`, `html.theme--graphite-coral` |
| Screen (one at a time) | `body.screen--room`, `--checking`, `--start`, `--entry-error`, `--not-found`, `--moderation` |
| Screen view open | `body.screen-view--open` |
| Room chat open | `body.chat--open` |
| Lobby embedded in the desktop shell | `body.lobby--embedded` |
| Participant strip collapsed | `body.strip--collapsed` |
| Stage summary hidden | `body.stage-summary--hidden` |
| Platform class (also on `<body>`) | `html.platform--desktop`, `html.platform--mobile`, `html.platform--unknown` |
| Desktop boundary (also on `<body>`) | `html.desktop-boundary--allowed`, `html.desktop-boundary--blocked` |
| Desktop screen share in fullscreen (independent of `screen--<name>`) | `body.screen--desktop-fullscreen` |
| Desktop shell state | `html.is-desktop`, `.is-shell-fullscreen`, `.vr-game-mode` |

Remove the old theme or screen class before adding the new one. Page state (`screen`, `chatOpen`, `lobbyEmbedded`, `screenView`, `stripCollapsed`, `stageSummary`, `desktopScreenFullscreen`) lives in one Pinia store, `src/stores/page.store.ts`; one watcher, `installBodyClasses()`, sets the BEM classes on `<body>` from it. Nothing writes or reads `body.dataset`; the e2e specs assert the class. The room runtime `state` (`room-runtime.store.ts`) is one module-level reactive object that the room client imports directly; `useRoomRuntimeStore().state` is the same object for components. Assigning a class instance (LiveKit `Room`, publications) to it marks the value raw.

## Styles layout

`src/styles/main.scss` is imported once, by `src/main.ts`: `_tokens.scss` (every `--vr-*` token and theme), `_typography.scss`, `_base.scss`, `_desktop-shell.scss`, then `ui/ chat/ room/ home/ auth/ legal/ app/` (`_index.scss` forwards one partial per BEM block). Shared dialog chrome is `ui/_dialog.scss`; the account and room settings modal is `home/_settings.scss`.

## Tests

- Vitest with jsdom; `npm --workspace @voice-room/web run test` (a few seconds). Import modules directly (`await import('@/...')`); stub globals with `vi.stubGlobal` (undone after each test). `test/setup.ts` (registered in `vite.config.ts` `test.setupFiles`) runs `cleanup` after each test, since Vitest globals are off and Testing Library would not register it itself.
- Shared fakes: `test/fixtures/{answers,fake-websocket,fetch,users,participant}.ts` (HTTP, realtime, users), `test/helpers/{assert,fake-media,fake-canvas,match-media,mistyped}.ts`, `test/helpers/livekit-harness.ts` (LiveKit service with a fake Room and collaborators).
- `test/helpers/render.ts`: `renderWithApp(Component, { props, slots, route, extraRoutes, global })` renders with a new Pinia and a vue-router memory router installed as plugins and returns the Testing Library result plus `router` and `pinia`. Drive it with `@testing-library/user-event`.
- `test/helpers/fresh-module.ts`: `freshImport(() => import('@/...'))` gives a new instance of the app module (module-level state reset) while `vue`, `pinia` and `vue-router` stay shared, because Vitest does not reload node_modules on `vi.resetModules()`. It activates a new Pinia, since a store from `defineStore('x')` is cached per Pinia. `stubWindow` and `muteWarnings` are in the same file.
- Types in tests: no `any`, no `as` casts (only `as const`); prove a type with a guard. The root `CLAUDE.md` test rules apply (no source regex reads).
- Playwright scenarios for critical user flows are in `e2e/` (`npm --workspace @voice-room/web run e2e`, needs the dev stack on port 5180). The Svelte specs that only read source files were not ported, so these flows have no browser coverage yet: inbox, mentions, moderation center, roster, leave and rejoin, first unread, attachment compose and view, notification shadow, policy settings.

## Commands

- `npm --workspace @voice-room/web run check` (worklet syntax, `vue-tsc` for `src` and for tests), `run test`, `run build`.
- Style conventions: `node scripts/check-web-styles.mts` (`[data-` in `.scss`, `<style>` outside the allowlist, `reka-ui` outside `shared/ui`); palette: `node scripts/check-web-palette.mts`. Their tests are `scripts/test/check-web-styles.test.mts` and `scripts/test/check-web-palette.test.mts`.
- Compile the styles: `npx sass --no-source-map apps/web/src/styles/main.scss > /dev/null`.
- After editing run `npm run format`; the root `npm run check` fails on unformatted files.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
