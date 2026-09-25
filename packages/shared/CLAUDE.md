# Shared contracts guidance

- Treat exported validators, realtime envelopes, and declarations as public contracts between API and Web.
- The package is ES modules. Every module is one strict TypeScript source (`src/<name>.ts`, exported directly; see `tsconfig.json`: no Node types, the code also runs in the browser). API and Web import it through the package export; tests import it. Do not add CommonJS, ESM or declaration copies.
- `src/contracts/<domain>.ts` holds the TypeBox schemas of HTTP bodies and answers (the API registers them, the web types its calls with them), `contracts/errors.ts` the error-code catalogue and `contracts/realtime.ts` the WebSocket command and event maps. Each contract module is its own package export (`@voice-room/shared/contracts/<domain>`). Change a contract before its API and web consumers, in the same branch.
- `src/emoji.ts` is the frozen Unicode corpus; G07 asserts its content hash, so do not edit the list.
- Add compatibility-focused tests before changing existing payloads or validation rules.
- Verify with `npm --workspace @voice-room/shared run check` and `npm --workspace @voice-room/shared run test`.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
