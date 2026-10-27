# Web (Vue) guidance

`apps/web-vue` is the Vue 3 port of `apps/web` (Svelte 5). It is renamed to `apps/web` at the cutover; until then `apps/web` takes bug fixes only and is the behavioural reference. Layers and import rules are the Svelte web's: `../../docs/ARCHITECTURE.md` section 5. Fixes made in `apps/web` that this app has not picked up yet are listed in `../../docs/web-vue-parity.md`; the task that ports that area removes the entry.

## Rules (binding for every task)

1. `<script setup lang="ts">` only. Typed `defineProps<...>()`, `defineEmits<...>()`, `defineModel` for v-model. No Options API, no mixins.
2. Where state lives:
   - a component's own state (open flags, input values, hover) is `ref`/`reactive`/`computed` in its `<script setup>`, never a store;
   - app-wide singleton state (session, lobby, inbox, preferences, theme, room runtime and room UI) is a Pinia setup store, `defineStore('x', () => { ... })`, in `*.store.ts`;
   - state owned by one component or subject (`ChatDraft`, `DmThread`, `ProfileDraft`) is a composable `useX()` returning refs and functions, in `use-x.ts`;
   - context (`provideLobby`/`useLobby`) is `provide`/`inject` with a typed `InjectionKey` exported next to the store.
3. Svelte to Vue: `$state` is `ref`/`reactive`; `$derived` is `computed`; `$effect` is `watch`/`watchEffect` (`flush: 'post'` when it touches the DOM) or `onMounted`/`onBeforeUnmount` for listeners and timers; `$effect.pre` is `flush: 'pre'`; `SvelteMap`/`SvelteSet` are `reactive(new Map())`/`reactive(new Set())`; `{#key x}` is `:key="x"`; snippets are slots; `use:portal` is `<Teleport to="body">`.
4. Never put a foreign object into reactive state unwrapped: LiveKit `Room`/`Participant`/`Track`, `MediaStream`, `MediaStreamTrack`, `AudioContext`, `AudioNode`, `WebSocket`, DOM nodes go through `markRaw()` or `shallowRef`. Vue `reactive` proxies class instances (Svelte `$state` does not), which breaks identity checks and costs CPU.
5. Imperative code (room client, services) reads stores with `useXStore()` after `setActivePinia(pinia)` in `main.ts`. Tests call `setActivePinia(createPinia())` in `beforeEach` (`renderWithApp` and `freshImport` do it).
6. Styles: no `<style>` in `.vue` files. A component's block lives in `src/styles/<area>/_<block>.scss`, is forwarded from that area's `_index.scss`, and uses BEM names (`room-dock`, `room-dock__button`, `room-dock__button--active`). `<style scoped>` only with a one-line comment above it saying why and an entry in `STYLE_ALLOWLIST` in `scripts/check-web-vue-styles.mts`. Colours come from the `--vr-*` tokens in `_tokens.scss`, never raw values (`scripts/check-web-palette.mts`). Breakpoints and repeated patterns are in `_mixins.scss`. Sass module system only (`@use`/`@forward`), never `@import`. Each partial starts with a "Svelte class -> BEM class" map; keep it current.
7. State in markup: semantic state is `aria-*` (`aria-pressed`, `aria-expanded`, `aria-selected`, `aria-current`, `aria-busy`, `aria-disabled`) and the SCSS selects on it; visual-only state is a BEM modifier class via `:class`. No `data-*` for styling and no `[data-` in `.scss` (comments may quote an old selector as `// Svelte: [data-active='true']`). `data-*` stays only where a third party sets it (Reka's `data-state`); we do not select on it.
8. Reka UI sits behind our primitives (`Dialog`, `Popover`, `ContextMenu`, `Select`, `Slider`, `Switch`, `SegmentControl`). Only `src/shared/ui/**` imports `reka-ui`.
9. Imports use the `@/` alias (`src/`). Layer rules are enforced by ESLint for these paths.
10. Copy, do not improve: same texts, aria labels, function names in framework-free code, same comments where still true. No refactors, no new features, no dependency upgrades beyond the Vue stack. Framework-free files are copied as is and checked with `node scripts/compare-web-port.mts <file>` (only import paths may differ).
11. Tests: port each Svelte test to `@testing-library/vue` and `@testing-library/user-event`. Only the render/harness code and selectors that pointed at `data-*` may change; behaviour and assertions on texts, roles and aria stay. Framework-free tests are copied with import paths fixed only. The root `CLAUDE.md` test rules apply (no source regex reads).

## Carried over from apps/web

- `watch`/`watchEffect` only for the outside world (DOM, listeners, timers). Derived values are `computed`; what happens after a user action belongs in the action function.
- `shared` never imports `features`; reuse shared UI and model utilities before adding abstractions.
- Browser, desktop, media and LiveKit fallbacks stay explicit and testable.
- HTTP bodies, answers and WebSocket events are typed from `@voice-room/shared/contracts/*`; never redeclare a server payload in `src/api/*`. Show a failure with `ApiError.message` (the text for its error code), not the raw server string.
- Browser code logs through `@/shared/log` (ESLint `no-console`); only the logger touches the console.

## Root and body classes

State on `<html>` and `<body>` is a class, set from the same places that set the Svelte `data-*`:

| Svelte | Vue |
| --- | --- |
| `<html data-theme='graphite-volt'>` (also `:root`, the default) | `html.theme--graphite-volt` |
| `<html data-theme='graphite-ice'>` | `html.theme--graphite-ice` |
| `<html data-theme='graphite-coral'>` | `html.theme--graphite-coral` |
| `<body data-screen='room'>` | `body.screen--room` |
| `<body data-screen='checking'>` | `body.screen--checking` |
| `<body data-screen='start'>` | `body.screen--start` |
| `<body data-screen='entry-error'>` | `body.screen--entry-error` |
| `<body data-screen='not-found'>` | `body.screen--not-found` |
| `<body data-screen-view='true'>` | `body.screen-view--open` |
| `<body data-chat-open='true'>` | `body.chat--open` |
| `<body data-lobby-embedded='true'>` | `body.lobby--embedded` |
| `<body data-strip-collapsed='true'>` | `body.strip--collapsed` |
| `<body data-stage-summary='hidden'>` | `body.stage-summary--hidden` |
| `<body data-desktop-screen-fullscreen='true'>` | `body.screen--desktop-fullscreen` (not a screen name; independent of `screen--<name>`) |
| `html.is-desktop`, `.is-shell-fullscreen`, `.vr-game-mode` | unchanged (already classes) |

A theme or screen is one class at a time: remove the old one before adding the new one. Page state that Svelte keeps in `document.body.dataset` (`screen`, `chatOpen`, `lobbyEmbedded`, `screenView`, `stripCollapsed`, `stageSummary`, `desktopScreenFullscreen`) lives in one Pinia store, `page.store.ts`; one watcher, `installBodyClasses()`, sets the BEM classes on `<body>` from it. Nothing in web-vue writes or reads `body.dataset`; the e2e specs assert the class. The room runtime `state` (`room-runtime.store.ts`) is one module-level reactive object that the room client imports directly, as it did in Svelte; `useRoomRuntimeStore().state` is the same object for components. Assigning a class instance (LiveKit `Room`, publications) to it marks the value raw.

## Styles layout

`src/styles/main.scss` is imported once, by `src/main.ts`: `_tokens.scss` (every `--vr-*` token and theme), `_typography.scss`, `_base.scss`, `_desktop-shell.scss`, then `ui/ chat/ room/ home/ auth/ legal/` (`_index.scss` forwards one partial per BEM block). Shared dialog chrome is `ui/_dialog.scss`; the account and room settings modal is `home/_settings.scss`.

## Tests

- Vitest with jsdom; `npm --workspace @voice-room/web-vue run test` (a few seconds). Import modules directly (`await import('@/...')`); stub globals with `vi.stubGlobal` (undone after each test). `test/setup.ts` (registered in `vite.config.ts` `test.setupFiles`) runs `cleanup` after each test, since Vitest globals are off and Testing Library would not register it itself.
- Fixtures copied from the Svelte web: `test/fixtures/{answers,fake-websocket,fetch}.ts` (HTTP and realtime fakes), `test/helpers/{assert,fake-media,match-media,mistyped}.ts`. `fixtures/users.ts`, `fixtures/participant.ts`, `helpers/fake-canvas.ts` and `helpers/livekit-harness.ts` arrive with the task that ports the source they import.
- `test/helpers/render.ts`: `renderWithApp(Component, { props, slots, route, extraRoutes, global })` renders with a new Pinia and a vue-router memory router installed as plugins and returns the Testing Library result plus `router` and `pinia`. Drive it with `@testing-library/user-event`.
- `test/helpers/fresh-module.ts`: `freshImport(() => import('@/...'))` gives a new instance of the app module (module-level state reset) while `vue`, `pinia` and `vue-router` stay shared, because Vitest does not reload node_modules on `vi.resetModules()`. It activates a new Pinia, since a store from `defineStore('x')` is cached per Pinia. `stubWindow` and `muteWarnings` are in the same file.
- Types in tests: no `any`, no `as` casts (only `as const`); prove a type with a guard.

## Commands

- `npm --workspace @voice-room/web-vue run check` (worklet syntax, `vue-tsc` for `src` and for tests), `run test`, `run build`.
- Style conventions: `node scripts/check-web-vue-styles.mts` (`[data-` in `.scss`, `<style>` outside the allowlist, `reka-ui` outside `shared/ui`); palette: `node scripts/check-web-palette.mts` (covers `apps/web` and `apps/web-vue`); copy check: `node scripts/compare-web-port.mts <file>`. Their tests are `scripts/test/check-web-vue-styles.test.mts` and `scripts/test/check-web-palette.test.mts`.
- Compile the styles: `npx sass --no-source-map apps/web-vue/src/styles/main.scss > /dev/null`.
- After editing run `npm run format`; the root `npm run check` fails on unformatted files.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
