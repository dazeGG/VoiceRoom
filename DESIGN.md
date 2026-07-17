# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-14
- Primary product surfaces: landing start flow, authenticated lobby, room voice/screen/chat UI, direct messages, profile/sound/notification settings.
- Evidence reviewed: `img.png`, `img_1.png`, user-provided settings screenshots (2026-07-14), `apps/web/src/lib/shared/styles/app.css`, `apps/web/src/lib/shared/ui/Button/Button.svelte`, `apps/web/src/lib/features/home/styles/home.css`, `apps/web/src/lib/features/home/styles/lobby-v2.css`, `apps/web/src/lib/features/home/styles/settings.css`, `apps/web/src/lib/features/home/components/SettingsModal.svelte`, `apps/web/src/lib/features/room/styles/controls.css`.

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
- Settings should group related input/output controls spatially: microphone and speaker columns share one top rail on desktop.
- Paired settings use equal-width columns: password fields, microphone/speaker devices, and noise suppression/gate should align on the same 50/50 grid.
- Boolean switches use positive semantics: an active switch means the named capability is enabled or notifications are received.
- Audio processing must stay visually attached to its source: noise suppression and gate belong to the microphone column; interface sounds belong to the speaker/output column.
- Room settings opened from the lobby and from an active room must expose the same avatar edit/remove behavior and the same destructive-action hierarchy.

## Visual language
- Color: dark olive/warm neutral surfaces with electric-lime primary CTA.
- Typography: Comfortaa is reserved for intentional brand/display text at supported 400-700 weights. Nunito is the default functional UI face. JetBrains Mono is reserved for room codes, handles, timestamps, and technical text.
- Spacing/layout rhythm: 4pt scale; common gaps 8/10/12/16px; action rails use 52px large height.
- Shape/radius/elevation: 14px default interactive radius, pill only for deliberate pill affordances. Room avatars are squircle-shaped and use the neutral `--room-avatar-bg` fallback until an image is uploaded.
- Motion: quick hover/focus transitions, no decorative motion required.
- Imagery/iconography: simple line icons sized to the control scale.

## Components
- Existing components to reuse: shared `Button`, shared app tokens, room dock controls, Select/Popover primitives.
- New/changed components: interaction sizing tokens in `app.css`; shared Button now defaults to large action sizing; settings notification-target rows, a compact profile identity row, room-avatar editing in every room-settings entry point, and a single sequential sound-set preview action.
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
- Layout adaptations: create/join rails may wrap, but each rail keeps its internal height/geometry. The two-column sound device rail collapses to one column on narrow settings surfaces.
- Touch/hover differences: large 52px primary controls are touch-friendly; dock controls remain compact but 46px.

## Interaction states
- Loading: primary labels can change inline (`Создаём...`).
- Empty: lobby empty states should point to the primary create action.
- Error: preserve existing toasts/status messaging.
- Success: immediate navigation/toasts where already implemented.
- Disabled: visible opacity/cursor state.
- Dependent controls: private notification text can only be changed while browser notifications are enabled; otherwise the control stays visibly disabled without discarding the saved preference.
- Sound preview: one action plays a short representative sequence, disables itself for the duration, and does not expose per-cue debug controls.
- Offline/slow network, if applicable: no new behavior in this pass.

## Content voice
- Tone: short, direct Russian labels.
- Terminology: use “комната”, “код”, “ссылка”, “Войти”, “Создать комнату” consistently. Notification-target switches say “Получать уведомления”; active always means delivery is allowed.
- Microcopy rules: helper hints should not disrupt control geometry.

## Implementation constraints
- Framework/styling system: Svelte 5 with CSS modules/imported CSS files and shared CSS variables.
- Design-token constraints: use existing `--space-*`, `--radius-*`, `--interactive-*` tokens.
- Performance constraints: CSS-only standardization; no extra dependencies.
- Compatibility constraints: no new package/browser APIs. Microphone mode and configurable hotkeys are desktop-app controls; browser sessions always use the open-microphone mode and do not register voice hotkeys.
- Font/runtime constraints: typography assets are self-hosted under `apps/web/static/fonts` with Cyrillic and Latin coverage. CSS must keep `font-src 'self'` compatibility and avoid remote font hosts. System fallbacks remain only after the local role fonts.
- Test/screenshot expectations: run `npm --workspace @voice-room/web run check`; visual review should compare landing/lobby create/join rows.

## Open questions
- [ ] Should shared `Button` expose explicit `size` props instead of class-based compact override? Owner: frontend. Impact: broader design-system API clarity.

## Deployment/runtime constraints
- API runtime is intentionally single-instance today: presence, WebSocket registry, POW challenges, cleanup timers, and in-memory rate limits are process-local. Horizontal scaling requires shared state/pub-sub before adding more API replicas.
- User enumeration through registration conflict and friend search is accepted for this social app model; keep auth/search rate limits enabled.
