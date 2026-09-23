# Shared contracts guidance

- Treat exported validators, realtime envelopes, and declarations as public contracts between API and Web.
- The package is ES modules. Every module is one strict TypeScript source (`src/<name>.ts`, exported directly; see `tsconfig.json`: no Node types, the code also runs in the browser). API and Web import it through the package export; tests import it. Do not add CommonJS, ESM or declaration copies.
- `src/emoji.ts` is the frozen Unicode corpus; G07 asserts its content hash, so do not edit the list.
- Add compatibility-focused tests before changing existing payloads or validation rules.
- Verify with `npm --workspace @voice-room/shared run check` and `npm --workspace @voice-room/shared run test`.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
