# RNNoise worklet adapter

`worklet-source.js.txt` is JavaScript copied verbatim into the public `.js` asset.
Its text extension keeps browser-only AudioWorklet globals out of the Node/TS
ESLint project. It is the readable, repository-owned adaptation of the worklet
that was committed as a minified public asset in VoiceRoom commit `ca6ed846`
(June 2026), then moved to the Vue app in `98b7a30c`. Its structure and ABI
match the upstream [`simple-rnnoise-wasm` worklet](https://github.com/JSmith01/simple-rnnoise-wasm/blob/master/src/worklet.js),
whose authors and MIT license match the vendored `public/rnnoise/LICENSE`.
This adaptation does not rebuild the loader; the WASM has its own build below.

Run `node apps/web/scripts/build-rnnoise-worklet.ts` from the repository root
to copy the readable source deterministically to the fixed-path public asset.
Run the same command with `--check` to verify byte identity without writing.
There is no minifier, source map, npm install, or new dependency in this step.
The source keeps the existing MIT notice and the full vendored license remains
alongside the public assets.

## WASM

`public/rnnoise/rnnoise.wasm` is RNNoise 0.2 (xiph tag `v0.2`, commit
`904a876d`, model `rnnoise_data-0b50c45`) with a minimal-latency `pipe()`
wrapper, built by `wasm/build-wasm.sh` (Emscripten 6.0.13 in Docker, `-O3`,
`-msimd128 -mavx`, fixed 8 MiB memory, 1 MB stack). The script fetches the
pinned sources, checks the model tarball's sha256 and rebuilds the shipped
bytes exactly:

```sh
bash apps/web/scripts/rnnoise/wasm/build-wasm.sh   # rewrites public/rnnoise/rnnoise.wasm
```

`wasm/pipe.c` keeps the simple-rnnoise-wasm ABI (`newState`, `deleteState`,
`getInput`, `getVadProb`, `pipe`) but buffers 448 samples (`480 − gcd(480,
128)`) instead of 896 before the first output, so the adapter's total delay is
1408 samples (29.3 ms) instead of 1856 for RNNoise 0.2 with the original
wrapper. `wasm/os_support.h` lets the v0.2 scalar path compile; the SIMD build
does not use it.

Measured against the previous WASM (RNNoise 0.1, 1376 samples / 28.7 ms) with
the same adapter, in the offline bench (`denoise-bench`, not part of this repo):
PESQ +0.13 and DNSMOS OVRL +0.13 on keyboard noise, OVRL +0.19 on Russian
speech in noise, PESQ +0.12 on VCTK-DEMAND, 3.5–4.9 dB less noise in pauses;
53 µs mean / 252 µs p99 per 128-sample quantum on an idle desktop (previous:
44 / 206 µs). The file is 5.6 MB (4.9 MB gzip, served precompressed and cached
for a year) instead of 0.13 MB, and the module's memory is 8 MiB instead of
0.3 MiB.

Pinned SHA-256:

| Asset | SHA-256 |
| --- | --- |
| `rnnoise.mjs` | `ED30EA3F71C9E4C43498AFC8FE442E8165CA94DF3EAF3DDBF4E83D4581CE4256` |
| `rnnoise.wasm` | `351F743AFB945C14F74FF636E243CAD4EB0E9DA95A79A58883CF3F6DE8008090` |
| previous `rnnoise.wasm` (RNNoise 0.1) | `D35096E542660D140C5FCA130C3789EE48BAEF124D186E69F536EFCAF6C1CF94` |
| old `rnnoise.worklet.js` | `36208641D215D6B06A193A9E0351CA345EA78E20B76F828773A1EA26863B13CC` |

The WASM exports `memory`, `newState`, `deleteState`, `getInput`,
`getVadProb`, `pipe`, `__indirect_function_table`, `_initialize`, `setThrew`,
`_emscripten_stack_restore`, and `emscripten_stack_get_current`, and imports
nothing. The adapter uses the first six. The supported graph is one mono channel at 48 kHz with
128-frame render quanta. Missing/unsupported input is silent for that quantum
without destroying the processor. Runtime tests execute the shipped WASM; a
different WASM ABI or non-128 quantum requires a separately validated update.
The original valid-quantum code already formed a `Float32Array.subarray` view
when WASM produced output; this adapter retains that view behavior and adds no
per-quantum logging, heartbeat, or broad exception handling.
