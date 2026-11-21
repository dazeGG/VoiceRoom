# Design

The VoiceRoom design system: product principles, foundations and the rules every UI follows. It applies to the web client (`apps/web`), the staff console (`apps/admin`), the personal meeting server (`apps/meet`), the embedded widget (`apps/widget`) and the call views (`packages/call`). All of them take tokens, styles and components from the UI kit in `packages/ui-kit`.

- Components, their variants, states and usage rules: Storybook (`npm run storybook`, port 6006). Each component's docs page is its specification.
- Tokens: `packages/ui-kit/src/styles/_tokens.scss`. Typography and fonts: `packages/ui-kit/src/styles/_typography.scss`, `packages/ui-kit/src/assets/fonts`.

## Kit only

This rule overrides everything else. Every UI in the apps and the call views is built only from `@voiceroom/ui-kit/components`. The kit is the single source of truth for how an element looks and behaves.

- No native controls (`<button>`, `<input>`, `<select>`, `<textarea>`, `<dialog>`, `<details>`), no hand-made ARIA widgets (`role="dialog"`, `"menu"`, `"tab"`, `"switch"`, `"tooltip"` and the like on a plain element), no hand-written `ui-*` classes. A clickable surface of its own shape (a tile, a row, a cell) is the kit `Pressable`.
- A component's look changes only in the kit. App styles lay components out (grid, flex, the gaps between blocks); they never change a component's colour, size, radius, type or states. App stylesheets contain no `.ui-*` selectors.
- A missing component, variant or prop is added to the kit (`packages/ui-kit`, with its story and a behaviour test) and then used. A local copy, a restyled wrapper or a "temporary" variant in an app is a second source of truth; do not create one.
- One component per job, in the kit too. When a component does not fit a case, extend it with a variant or a prop; never add a parallel component for the same job (a `NativeSelect` next to `Select`, a second dialog next to `Dialog`).
- Sizes are grid tokens only (`--size-*`, `--space-*`, `--radius-*`, `--icon-*`); colours are `--vr-*` only. No literal radii or grid-step heights, the kit included.
- `npm run check` enforces this through `scripts/check-kit-usage.mts`. An exception is an entry in its `KIT_EXCEPTIONS` with the reason; the list stays empty, and a stale entry is an error too.

## Product

### Brand
- Personality: dark, warm, direct, voice-first. Everything that does not speak recedes; one bright accent shows who is speaking and what to press.
- Trust signals: predictable controls, readable labels, consistent states, minimal setup friction.
- Avoid: one-off control heights, misaligned input/button rails, generic grey-on-dark controls.

### Goals
- Make room creation, joining, messaging and voice controls immediately understandable.
- Non-goals: an external design framework, a change of the visual brand.
- Success signals: create/join controls align across landing and lobby; every interactive control follows the size grid.

### People and jobs
- Small groups, friends and teams opening quick voice rooms and returning to persistent rooms.
- Jobs: create a room, join by code or link, manage voice and screen controls, chat in a room or a DM.
- Contexts: desktop or laptop, dark UI, fast switching between the lobby and a room; the room also opens in a mobile browser.

### Information architecture
- Primary navigation: landing → lobby → room; the lobby's side rail holds friends, settings and the active call.
- Core screens: the unauthenticated landing, the authenticated lobby, the room, DM / people / settings overlays.
- Hierarchy: the primary action row first, room and friend lists second, secondary metadata subdued.
- Widget builder: placement, appearance, dimensions and chat settings grouped beside a representative preview on desktop; code and the copy action below. On narrow screens settings, preview and code stack. Corner and offset show only for floating placement and keep their values while hidden.

### Principles
- Shared sizing beats local pixel fixes; reuse the kit before anything else.
- The primary action is visually decisive and aligned with the inputs next to it.
- Dense controls are allowed only where the surface is explicitly dense, such as the call dock.
- Settings group related input and output controls: microphone and speaker columns share one top rail on desktop. Paired settings use equal-width columns (password fields, microphone/speaker devices, noise suppression/gate on one 50/50 grid).
- A switch has positive meaning: on means the named capability is enabled or notifications are received.
- Audio processing stays attached to its source: noise suppression and the gate belong to the microphone column, interface sounds to the speaker column.
- Room settings opened from the lobby and from a live room expose the same avatar edit/remove behaviour and the same destructive-action hierarchy.

## Voice and copy

- The source language of UI copy is Russian. English and French are translations from the catalogue.
- Short, sentence case: «Создать комнату», «Войти в комнату», «Не беспокоить».
- Address the user formally ("вы"), without familiarity or exclamation marks: «Как вас будут видеть в комнате».
- A button is a verb in the infinitive: «Войти», «Восстановить доступ». A waiting state is the same verb in the present tense with an ellipsis: «Входим…», «Создаём…».
- An error starts with «Не удалось …» and names the action: «Не удалось войти». If the user can do something about it, add it after a comma: «Слишком много попыток, попробуйте позже».
- An empty state is calm and suggests the next step: «Пока никого нет».
- No emoji in the interface. Russian quotes «ёлочки», the em dash, a single-character ellipsis `…`, and the letter «ё».
- Terminology: «комната», «код», «ссылка», «Войти», «Создать комнату», used consistently. Notification switches say «Получать уведомления».
- The product name is VoiceRoom. In an eyebrow label it is lower case: `voice room`.
- Helper hints never change control geometry.

## Colour

Tokens are in `packages/ui-kit/src/styles/_tokens.scss`; no component carries a raw colour (`scripts/check-web-palette.mts`).

- The theme is a class on `<html>`: `theme--graphite-volt` (default), `theme--graphite-ice`, `theme--graphite-coral`. All three are dark and differ only in the accent (`--vr-accent*`), `--vr-online` and, in Coral, the `--vr-danger*` hue.
- Layers from bottom to top: `--vr-bg` → `--vr-surface` (dialogs) → `--vr-surface-2` (panels, fields) → `--vr-surface-3` (buttons, toasts, the dock). A higher layer is lighter. Only floating layers have shadows.
- Text: `--vr-text` primary, `--vr-text-2` secondary, `--vr-text-muted` hints and captions. `--vr-text-3` does not reach 4.5:1, so it is only for decorative marks and control borders.
- `--vr-accent` appears once per screen, where it means something: the primary button, the speaking outline, an enabled switch, focus. Text on an accent fill is `--vr-accent-ink`, never white. The soft variant is `--vr-accent-soft` with a `--vr-accent-line` border.
- Presence: `--vr-online`, `--vr-away`, `--vr-dnd`, `--vr-offline`. Feedback: `--vr-success`, `--vr-danger`, `--vr-warning`, `--vr-info`. Colour always comes with an icon and text.
- `--vr-danger` marks destructive actions and a muted microphone or sound (`--vr-danger-off` in the dock). As small text on `--vr-surface-2`/`--vr-surface-3` it gives 3.8–4.2:1, and white text on its fill 4.3:1. This is a known exception; do not add new such pairs.
- Avatars: 16 keys, each a `--avatar-<key>-bg` / `--avatar-<key>-ink` pair at the same lightness (74% / 25% OKLCH). A participant tile uses the avatar fill at 70% over `--vr-bg`.
- `brand-volt` (#c1f100) and `brand-ink` (#080800) are the logo colours. The interface uses `--vr-accent` instead.

## Typography

- One UI face: Onest (`--font-ui`; `--font-display`, `--font-sans` and `--font-serif` alias it). JetBrains Mono (`--font-mono`) only for hotkeys, room codes, handles, timestamps and technical counters. Both are self-hosted (CSP `font-src 'self'`) and cover Cyrillic and Latin; system fallbacks come only after them.
- Body text 16px / 1.45. The interface sits at 13–14px. The `hero` heading is 58px, 600, −0.035em, balanced wrapping.
- Weight: 400 text, 500 small labels, 600 buttons and headings, 700 only for the 404 and start screens.
- Control font sizes are integers only: 11, 12, 13, 14, 15.
- The `eyebrow` (12px, upper case, +0.18em) sits above a page heading, never inside cards.

## Size grid

Every size is a step of a 4px scale, and a token's name is its value in pixels.

| Family | Tokens |
| --- | --- |
| Control heights | `--size-20` `--size-24` `--size-28` `--size-32` `--size-36` `--size-40` `--size-44` `--size-48` `--size-56` (and `--size-16` for checkboxes and badges) |
| Spacing | `--space-4` `--space-8` `--space-12` `--space-16` `--space-20` `--space-24` `--space-32` `--space-40` `--space-48` `--space-64`; micro steps inside controls `--space-2`, `--space-6` |
| Radii | `--radius-4` `--radius-6` `--radius-8` `--radius-10` `--radius-12` `--radius-16` `--radius-20` `--radius-24` `--radius-pill` |
| Icons | `--icon-12` `--icon-16` `--icon-18` `--icon-20` `--icon-24` |

The height decides the rest:

| Height | Radius | Icon | Text | Horizontal padding |
| --- | --- | --- | --- | --- |
| 20–24 | 6 | 12–16 | 11–12 | 6–8 |
| 28–32 | 8 | 16 | 13 | 8–12 |
| 36–40 | 10 | 18 | 14 | 12–16 |
| 44–48 | 12 | 20 | 14–15 | 16–20 |

- The gap between an icon and its label is `--space-6` up to height 32 and `--space-8` from 36.
- A nested element takes its parent's radius minus the gap between them: a menu panel at `--radius-12` with `--space-4` padding → rows at `--radius-8`.
- Surfaces: popovers, menus, selects and toolbars `--radius-12`; cards, toasts, tiles and banners `--radius-16`; dialogs and the dock `--radius-20`; large cards `--radius-24`; badges, switches, tags and tracks `--radius-pill`.
- Controls in one row share a height: an `md` 40 field sits next to an `md` 40 button, an `lg` 44 field in a dialog next to an `lg` 44 button.
- The touch target on a phone is at least 44; smaller buttons get an invisible hit-area extension.
- When a value moves, the values paired with it move in the same step: a width of `100% + N` with a margin of `-N`, a negative `left`/`inset` reaching into a column.
- The one exception is `--vr-room-head-h` 69 (44 + 12 padding + 1 border), so the room header and side panel dividers meet.
- Breakpoints are Sass variables in `_mixins.scss` (max-width): `bp-narrow` 900, `bp-phone` 600, `bp-phone-sm` 560. The room stage also adapts with container queries.

## Depth, motion and states

- Shadows: `--vr-shadow-popover` (popovers, menus, select), `--vr-shadow-modal` (dialogs), `--vr-shadow-dock` (the dock), `--vr-shadow-toast` (toasts, the slider thumb). Everything else is separated by `--vr-line` / `--vr-line-strong` borders and a change of layer.
- A modal lies on `--vr-backdrop` with a 4px blur; the dock on `--vr-dock-bg` with a 14px blur.
- Motion is short: hovers 140–150ms `ease`, panels appear in 120ms (4px shift and opacity), toasts in 180ms with `--ease-out`. The speaking outline switches on instantly. `prefers-reduced-motion` turns animations off; the spinner and skeleton only slow down so waiting stays visible.
- Hover: transparent rows use `--vr-hover`, fills use their own `*-hover`. Disabled is 0.55 opacity with `cursor: not-allowed`.
- Keyboard focus has two kinds across the product: buttons, rows, tabs, switches and checkboxes get a 2px `--vr-accent` outline offset by 2px (−2px inside panels); fields, selects and comboboxes get a `--vr-accent-line` border and a 3px `--vr-accent-soft` ring. No other focus colours.
- State in markup is `aria-*` (`aria-pressed`, `aria-expanded`, `aria-selected`, `aria-checked`, `aria-current`, `aria-busy`, `aria-invalid`); visual variants are BEM modifiers. No `data-*` selectors (`scripts/check-web-styles.mts`).

### Interaction states
- Loading: the primary label changes inline («Создаём…») and the button is busy.
- Empty: a lobby empty state points to the primary create action.
- Error: toasts and inline status messages; a field error sits under the field.
- Disabled: visible opacity and cursor state. A dependent control (for example private notification text while browser notifications are off) stays visibly disabled without discarding the saved value.
- Sound preview: one action plays a short representative sequence and disables itself while it plays; no per-cue debug controls.
- Widget preview is inert and labelled as such: no runtime, iframe, network, microphone or camera. Join controls are disabled and the safety caption sits outside the card. Copying reports success; when the clipboard fails, the code is selected for manual copying.

## Icons and logo

- Icons are Lucide (`@lucide/vue`), 2px stroke, `currentColor`, sized by the `--icon-*` token for the control height. There is no other icon set.
- An icon always has a label or an `aria-label`. In the dock the label is visually hidden but read by screen readers.
- `voiceroom-icon.svg` (`apps/web/public/`) is the mark in `brand-volt` on a `brand-ink` tile with a 26/100 radius: favicon, app icon, product avatar.
- The mascot (`MascotIcon`) is the mark without the tile, only on a dark background, never recoloured.
- There is no wordmark: «VoiceRoom» is set in Onest 600 next to the mark.

## Accessibility and responsiveness

- Every control is keyboard-operable with visible focus (see "Depth, motion and states"). Labels and descriptions stay attached to their controls (`aria-describedby` for hints and errors).
- Text meets 4.5:1 on its surface (3:1 for 24px+ text, control borders, focus rings and icons); the known `--vr-danger` exception is documented under Colour.
- Desktop first, with responsive wrapping for action rows. A rail may wrap but keeps its internal height. The two-column sound device rail collapses to one column on narrow settings surfaces. On phones a dialog is full screen.

## Components

Run `npm run storybook` (port 6006) to read the Introduction and the component specifications. Each Docs page holds the component’s sizes, variants, states and usage rules.

- `Foundations` reads colours, avatars, typography, grid, spacing, radii and icons from the kit tokens.
- `Components/<Group>/<Name>` contains the kit and call component specifications.
- `Apps/Meet/*` and `Apps/Widget/*` show the entry and call screens on fake data.

Build Storybook with `npm --workspace @voiceroom/ui-kit run build-storybook`. The output is `packages/ui-kit/storybook-static`. The toolbar theme switch sets `theme--graphite-*` on `<html>`.

## Implementation constraints

- Vue 3 with one SCSS partial per BEM block in the app's `src/styles` or the package's `src/styles`; shared variables come from `pkg:@voiceroom/ui-kit/styles/tokens`.
- The widget runs inside an iframe on third-party sites: its kit styles are scoped to `#widget`, its CSS bundle is self-contained, and its public loader contract does not change with the kit.
- Microphone mode and configurable hotkeys are desktop-app controls; browser sessions always use the open-microphone mode and do not register voice hotkeys.
- Marketing screenshots use the real product UI with local demonstration accounts or gameplay supplied for the site, never redrawn controls or private conversations; keep the full frame and intrinsic aspect ratio (`docs/PROMO_SCREENSHOTS.md`).
- Visual review of a UI change compares the affected screens at 1440px and 390px: no page overflow or text collisions, and keyboard and copy states work. Functional checks do not replace visual review.

## Runtime constraints

- The API runtime is single-instance today: presence, the WebSocket registry, POW challenges, cleanup timers and in-memory rate limits are process-local. Horizontal scaling needs shared state and pub/sub before adding API replicas.
- User enumeration through the registration conflict and friend search is accepted for this social app; keep the auth and search rate limits on.
