# Design QA — chat polish

## Reference sources

- `C:\Users\daze\AppData\Local\Temp\codex-clipboard-61ed4ffe-0ca9-4e44-91a6-89dd5da9349e.png` — notification trigger placement.
- `C:\Users\daze\AppData\Local\Temp\codex-clipboard-cd07ba25-765a-4d99-94b1-7feb41d8b7ab.png` — direct-message bubble layout.
- `C:\Users\daze\AppData\Local\Temp\codex-clipboard-df2b7c3d-359b-4718-b0c1-c78c28aa73bb.png` — oversized message action toolbar.
- `C:\Users\daze\AppData\Local\Temp\codex-clipboard-5963f7ea-634f-4f0a-8de1-df4c8c9ef66d.png` — reaction chip density and count alignment.
- `C:\Users\daze\AppData\Local\Temp\codex-clipboard-fb540acd-ce2f-477a-a3d8-c3f94933abd0.png` — room mention composer.

## Implementation verification

- Automated UI contracts: passed (`70/70` in `v2-ui-contract.test.js`).
- Full Web unit suite: passed (`194/194`).
- Svelte/TypeScript checks: passed with `0` errors and `0` warnings.
- Production Web build: passed.
- Implementation screenshot: unavailable because the Codex in-app browser runtime fails before startup with `failed to write kernel assets` (`os error 3`).

## Visual verdict

Blocked pending an implementation screenshot at the same viewport and state as the references. Source-level layout and interaction contracts are green, but pixel-level comparison has not been claimed.

## Checklist

- [x] Notification button moved between download and settings in the sidebar footer.
- [x] Direct messages use the shared room-message row and left-aligned presentation.
- [x] Reply action uses the reply-arrow icon.
- [x] Quick action controls use compact 32 px sizing.
- [x] Full reaction picker and reactor list flip into the viewport when needed.
- [x] Reaction chips and counts use compact aligned sizing.
- [x] Mentions insert canonical `@login` tokens and ignore stale directory responses.
- [ ] Compare reference and implementation screenshots in the same viewport after the in-app browser runtime is restored.
