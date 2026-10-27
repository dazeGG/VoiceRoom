# apps

- `api/` owns server, persistence, migrations, realtime transport, and external service integration.
- `web/` owns Svelte UI, client state, media/browser integration, and Playwright scenarios.
- `web-vue/` is the Vue 3 port of `web/`; it replaces `web/` at the cutover. Its rules are in `web-vue/CLAUDE.md`.
- Cross-app payloads and validation belong in `../packages/shared`, not in duplicated API/Web definitions.
- Validate the changed app first, then run the root repository gates before review.
- Follow the mandatory branch, commit, PR, and release rules in `../docs/GIT_FLOW.md`.
