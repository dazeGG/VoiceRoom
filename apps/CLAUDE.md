# apps

- `api/` owns server, persistence, migrations, realtime transport, and external service integration.
- `site/` owns the public Astro site at `/` and the scenario pages: static HTML for search engines, no app code. Every page takes its title, description and address from `src/site.ts`; `astro build` fails on a page without them or with an inline script (`src/build-contract.ts`). Claims on the pages must match what the app does.
- `web/` owns the Vue UI, client state, media/browser integration, and Playwright scenarios. Its rules are in `web/CLAUDE.md`.
- Cross-app payloads and validation belong in `../packages/shared`, not in duplicated API/Web definitions.
- Validate the changed app first, then run the root repository gates before review.
- Follow the mandatory branch, commit, PR, and release rules in `../docs/GIT_FLOW.md`.
