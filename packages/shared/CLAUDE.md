# Shared contracts guidance

- Treat exported validators, realtime envelopes, and declarations as public contracts between API and Web.
- Modules are moving to one strict TypeScript source each (`src/<name>.mts`, exported directly; see `tsconfig.json`: no Node types, the code also runs in the browser). Until a module moves, keep its CommonJS, ESM and declaration variants behaviorally aligned. When converting, check the new file against the old CommonJS export for every export before deleting the twins.
- Add compatibility-focused tests before changing existing payloads or validation rules.
- Verify with `npm --workspace @voice-room/shared run check` and `npm --workspace @voice-room/shared run test`.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
