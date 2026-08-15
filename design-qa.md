# Design QA — reusable room and chat menus

## Visual truth

- Reference screenshot: compact message hover toolbar.
- Reference screenshot: failure state where the reaction picker expands the chat layout.
- Implementation comparison: message hover toolbar.
- Implementation comparison: reaction picker floating state.
- Participant profile state comparison.

## Environment and state

- Viewport: `1280 x 720` CSS pixels, device scale factor `1`.
- Local preview: `http://127.0.0.1:5180/r/9kgnyw6fb8`.
- Room owner with one room message; reactions enabled. Reply is capability-gated and therefore absent in this local overlay, while the same 36 px control is rendered when replies are enabled.
- Clean-tab console contains only the expected browser microphone denial (`NotAllowedError: Permission denied by system`); no menu, overlay, profile, or API errors.

## Comparison passes

### Message hover toolbar

- Layout and spacing: the implementation is one compact horizontal surface. All action buttons are `36 x 36` px with a shared radius and 4 px internal gaps.
- Content: three quick reactions, full reaction picker, divider, capability-gated reply, copy, and ellipsis. Pin, edit, and delete are absent from hover and remain in the full context menu.
- Icons and color: existing Lucide icons and product tokens are reused; no custom SVG or CSS-drawn replacement was introduced.
- Interaction: copy and ellipsis are direct actions; the full context menu restores working `E` and `Delete` shortcuts.

### Reaction picker

- Layout: the picker is portalled directly under `BODY` and uses `position: fixed`.
- Measured bounds: `x=862`, `y=8`, `width=410`, `height=525.5`; all edges remain inside the `1280 x 720` viewport.
- Chat stability: chat panel `clientWidth=359` and `scrollWidth=359` while the picker is open, so it does not expand or horizontally break the chat.
- Available height: `--popover-available-height: 507.5px`; the inner emoji body scrolls while header and footer remain stable.
- Typography, color, imagery, and copy: existing product typography, warm palette, native emoji corpus, and Russian labels are preserved.

### Room and profile menus

- Room-card, room-preview, and in-room menus use one reusable content component.
- Owner state exposes settings and never “remove from list”; member state exposes “remove from list” and never owner settings.
- Notification level is available from the reusable menu in every room surface.
- Tall menus use a viewport-bounded outer scroller; submenus are fixed portals and do not get clipped.
- Member rows are full-width click targets with a hover surface. Message avatar/name opens the same profile card in room and direct chat. A self profile shows identity only, without friend actions.
- The chat sidebar friend item is navigation-only and no longer owns a profile/context menu.

## Accessibility and resilience

- Context and popover surfaces keep dialog/menu semantics, keyboard focus movement, Escape closing, and focus restoration.
- `E` and `Delete` shortcuts execute the same edit/delete actions as menu selection.
- At `800 x 300`, the tall context menu remains vertically scrollable and the fixed submenu stays inside the viewport.
- Reduced-motion behavior is preserved; the 4 px entry movement is applied to the inner visual wrapper so it cannot shift measured placement.

## Verification

- API tests: `490/490` passed serially, including PostgreSQL auth/bookmark removal and fail-closed server-mute behavior.
- Web tests: `196/196` passed.
- UI contract tests: `72/72` passed.
- `npm run check`: passed with `0` Svelte errors and `0` warnings.
- `npm run build`: passed.
- Reference and implementation screenshots were inspected together for the toolbar and reaction-picker states.
- P0/P1/P2 visual findings after the final comparison: none.

Final result: passed
