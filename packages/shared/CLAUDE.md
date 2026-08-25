# Shared contracts guidance

- Treat exported validators, realtime envelopes, and declarations as public contracts between API and Web.
- Keep CommonJS, ESM, JSON, and declaration variants behaviorally aligned where an export provides multiple representations.
- Add compatibility-focused tests before changing existing payloads or validation rules.
- Verify with `npm --workspace @voice-room/shared run check` and `npm --workspace @voice-room/shared run test`.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
