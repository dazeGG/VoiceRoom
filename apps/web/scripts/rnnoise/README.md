# RNNoise worklet adapter

`worklet-source.js.txt` is JavaScript copied verbatim into the public `.js` asset.
Its text extension keeps browser-only AudioWorklet globals out of the Node/TS
ESLint project. It is the readable, repository-owned adaptation of the worklet
that was committed as a minified public asset in VoiceRoom commit `ca6ed846`
(June 2026), then moved to the Vue app in `98b7a30c`. Its structure and ABI
match the upstream [`simple-rnnoise-wasm` worklet](https://github.com/JSmith01/simple-rnnoise-wasm/blob/master/src/worklet.js),
whose authors and MIT license match the vendored `public/rnnoise/LICENSE`.
The **exact upstream revision, build invocation, and compiler version used for
the original vendored bytes are not recorded** in the VoiceRoom history and
are not asserted here. This adaptation does not rebuild the WASM or loader.

Run `node apps/web/scripts/build-rnnoise-worklet.ts` from the repository root
to copy the readable source deterministically to the fixed-path public asset.
Run the same command with `--check` to verify byte identity without writing.
There is no minifier, source map, npm install, or new dependency in this step.
The source keeps the existing MIT notice and the full vendored license remains
alongside the public assets.

Pinned pre-change SHA-256:

| Asset | SHA-256 |
| --- | --- |
| `rnnoise.mjs` | `ED30EA3F71C9E4C43498AFC8FE442E8165CA94DF3EAF3DDBF4E83D4581CE4256` |
| `rnnoise.wasm` | `D35096E542660D140C5FCA130C3789EE48BAEF124D186E69F536EFCAF6C1CF94` |
| old `rnnoise.worklet.js` | `36208641D215D6B06A193A9E0351CA345EA78E20B76F828773A1EA26863B13CC` |

The pinned WASM exports `memory`, `newState`, `deleteState`, `getInput`,
`getVadProb`, `pipe`, `__indirect_function_table`, `_initialize`,
`_emscripten_stack_restore`, and `emscripten_stack_get_current`. The adapter
uses the first six. The supported graph is one mono channel at 48 kHz with
128-frame render quanta. Missing/unsupported input is silent for that quantum
without destroying the processor. Runtime tests execute the shipped WASM; a
different WASM ABI or non-128 quantum requires a separately validated update.
The original valid-quantum code already formed a `Float32Array.subarray` view
when WASM produced output; this adapter retains that view behavior and adds no
per-quantum logging, heartbeat, or broad exception handling.
