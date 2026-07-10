# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-10
- Primary product surfaces: landing start flow, authenticated lobby, room voice/screen/chat UI, direct messages.
- Evidence reviewed: `img.png`, `img_1.png`, `apps/web/src/lib/shared/styles/app.css`, `apps/web/src/lib/shared/ui/Button/Button.svelte`, `apps/web/src/lib/features/home/styles/home.css`, `apps/web/src/lib/features/home/styles/lobby-v2.css`, `apps/web/src/lib/features/room/styles/controls.css`.

## Brand
- Personality: dark, warm, direct, voice-first.
- Trust signals: predictable controls, readable labels, consistent states, minimal setup friction.
- Avoid: arbitrary one-off control heights, misaligned input/button rails, generic gray-on-dark controls.

## Product goals
- Goals: make room creation, joining, messaging, and voice controls immediately understandable.
- Non-goals: introducing a full external design framework or changing the visual brand.
- Success signals: create/join controls align across landing and lobby; interactive controls follow one sizing scale.

## Personas and jobs
- Primary personas: small groups/friends/teams opening quick voice rooms and returning to persistent rooms.
- User jobs: create a room, join by code/link, manage voice/screen controls, chat in room/DM.
- Key contexts of use: desktop/laptop, dark UI, fast switching between lobby and room.

## Information architecture
- Primary navigation: landing → lobby → room; lobby side rail for friends/settings/active voice.
- Core routes/screens: unauthenticated landing, authenticated lobby, room screen, DM/people/settings overlays.
- Content hierarchy: primary action row first, room/friend lists second, secondary metadata subdued.

## Design principles
- Shared sizing beats local pixel fixes.
- Primary actions should be visually decisive and aligned with adjacent inputs.
- Compact controls are allowed only when the surface is explicitly dense, such as the voice dock.
- Reuse tokens/primitives before custom classes.

## Visual language
- Color: dark olive/warm neutral surfaces with electric-lime primary CTA.
- Typography: Archivo-like sans for UI; monospace only for codes/technical labels.
- Spacing/layout rhythm: 4pt scale; common gaps 8/10/12/16px; action rails use 52px large height.
- Shape/radius/elevation: 14px default interactive radius, pill only for deliberate pill affordances.
- Motion: quick hover/focus transitions, no decorative motion required.
- Imagery/iconography: simple line icons sized to the control scale.

## Components
- Existing components to reuse: shared `Button`, shared app tokens, room dock controls, Select/Popover primitives.
- New/changed components: interaction sizing tokens in `app.css`; shared Button now defaults to large action sizing.
- Variants and states: 36px small, 40px medium, 52px large; 46px reserved for dock; disabled/hover/focus must be visible.
- Token/component ownership: `apps/web/src/lib/shared/styles/app.css` owns sizing tokens; shared primitives consume them.

## Accessibility
- Target standard: keyboard-operable controls with visible focus.
- Keyboard/focus behavior: input groups highlight on focus-within; buttons use focus-visible borders.
- Contrast/readability: warm text on dark surfaces; lime primary with dark text.
- Screen-reader semantics: labels and aria descriptions preserved for join hints.
- Reduced motion and sensory considerations: no new motion dependency.

## Responsive behavior
- Supported breakpoints/devices: desktop-first with responsive wrapping for action rows.
- Layout adaptations: create/join rails may wrap, but each rail keeps its internal height/geometry.
- Touch/hover differences: large 52px primary controls are touch-friendly; dock controls remain compact but 46px.

## Interaction states
- Loading: primary labels can change inline (`Создаём...`).
- Empty: lobby empty states should point to the primary create action.
- Error: preserve existing toasts/status messaging.
- Success: immediate navigation/toasts where already implemented.
- Disabled: visible opacity/cursor state.
- Offline/slow network, if applicable: no new behavior in this pass.

## Content voice
- Tone: short, direct Russian labels.
- Terminology: use “комната”, “код”, “ссылка”, “Войти”, “Создать комнату” consistently.
- Microcopy rules: helper hints should not disrupt control geometry.

## Implementation constraints
- Framework/styling system: Svelte 5 with CSS modules/imported CSS files and shared CSS variables.
- Design-token constraints: use existing `--space-*`, `--radius-*`, `--interactive-*` tokens.
- Performance constraints: CSS-only standardization; no extra dependencies.
- Compatibility constraints: no new package/browser APIs.
- Test/screenshot expectations: run `npm --workspace @voice-room/web run check`; visual review should compare landing/lobby create/join rows.

## Open questions
- [ ] Should shared `Button` expose explicit `size` props instead of class-based compact override? Owner: frontend. Impact: broader design-system API clarity.
