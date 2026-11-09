# Screen streaming quality and diagnostics

Run `node scripts/voice-bench/screen-startup-bench.mts` against a **disposable local LiveKit server** on `ws://127.0.0.1:17880` (development key `devkey`, secret `secret`). The script refuses non-loopback endpoints. It creates and deletes only its own uniquely named room, opens isolated headless Chromium pages, and uses a synthetic moving/text canvas: no real microphone, screen, account or production connection.

The temporary Vite server imports the application's current `getScreenPublishVideoOptions(getScreenProfileForMode('games'))`; encoding settings are not copied into the harness. A synthetic audio track is published first, exercising a pre-existing voice connection. The cases are a late viewer of a new share, resubscription after a seven-second pause, and a new share on the same connection.

Each case collects sender/receiver samples once per second for 15 seconds: encoded/decoded/rendered FPS, playback drops, dimensions, bitrate, bandwidth estimate, and encoder limitation. A fixed text/fine-line region is compared against the publisher's exact canvas pixels using RGB MAE and PSNR; the region does not move, so differing frame times do not masquerade as blur. Lower MAE/higher PSNR is better. A null PSNR together with zero MAE denotes an exact match. These visual measurements have no universal pass threshold: compare initial samples with that run's later steady samples.

Passing the **resolution/FPS gate** requires three consecutive observations of at least 1280×720 and 27 decoded FPS, with the first qualifying observation within five seconds. Missing measurements, a changed RTP stream, and gaps between samples break the sequence. An incomplete sequence is inconclusive, not a pass. The process exits nonzero if any case does not pass. Sanitized signaling summaries record timing, video-section directions, codec mappings, track IDs, startup-bitrate hints and sender encodings; raw SDP, ICE credentials and candidate addresses are not retained.

Options: `SCREEN_BENCH_URL`, `SCREEN_BENCH_KEY`, `SCREEN_BENCH_SECRET`, `SCREEN_BENCH_SECONDS` (5–600), `SCREEN_BENCH_BASELINE=1` (omit the startup repair for an A/B comparison), `SCREEN_BENCH_VARIANT` (below), and `RESULTS` (JSON output path, defaults to the OS temporary directory). Browser/room/server cleanup runs on failure too; the external SFU is not started or stopped by the script. Run baseline and repaired cases sequentially on an otherwise idle machine; concurrent builds/tests contaminate FPS measurements.

This is a repeatable local baseline, **not proof of Internet or desktop-game performance**. Inspect the recorded encoder implementation and compare received/rendered FPS; headless software encoding may itself be limited. Full resolution and FPS also do not prove visual fidelity: a blurry 720p frame still has 720 pixels of height. Do not claim that a real incident is fixed from this benchmark alone.

## Isolated encoding experiments

`SCREEN_BENCH_VARIANT` changes only the benchmark publication, never application settings or production defaults:

| Variant | Difference from the application's current games profile |
| --- | --- |
| `default` (also when unset) | None; currently H264 when supported, primary + low simulcast layer, `maintain-resolution` |
| `single-layer` | Disable simulcast and remove the extra layer; keep codec, bitrate ceiling, frame-rate ceiling, backup codec and degradation preference |
| `motion-framerate` | Change only degradation preference to `maintain-framerate`; preserve layers and bitrate ceilings |

Unknown values fail before creating a browser or room. Every run draws the same moving scene from frame zero. Do not combine a variant with `SCREEN_BENCH_BASELINE=1` when testing encoder layers: keep the startup repair constant. Run sequentially, repeat in reversed order, and keep the machine and background workload comparable. For example, with the disposable SFU already running, in PowerShell:

```powershell
$env:SCREEN_BENCH_SECONDS = '60'
$env:SCREEN_BENCH_BASELINE = '0'
$env:SCREEN_BENCH_LOW_VIEWER = '1'
foreach ($variant in @('default', 'single-layer', 'motion-framerate')) {
  $env:SCREEN_BENCH_VARIANT = $variant
  $env:RESULTS = Join-Path $env:TEMP "screen-encoding-$variant.json"
  node scripts/voice-bench/screen-startup-bench.mts
  # Nonzero is a measured gate failure; inspect its JSON before choosing a default.
}
Remove-Item Env:SCREEN_BENCH_VARIANT, Env:SCREEN_BENCH_SECONDS, Env:SCREEN_BENCH_BASELINE, Env:SCREEN_BENCH_LOW_VIEWER, Env:RESULTS
```

JSON records the requested variant and publication options, actual RTP layers (individual encoded/sent FPS, dimensions, codec and encoder), and actual sender encoding parameters in `signaling`. **Verify those observations before calling a result a one-versus-two H264 encoder comparison**: a requested layer can be inactive under dynacast, a browser may choose another codec, and headless Chromium does not reproduce the desktop GPU encoder. Do not sum layer FPS as if it were displayed FPS. `VOICE_ROOM_WEBRTC_HW_ENCODER=0` in the desktop application only removes its overrides; it is not a forced software-encoding mode and this harness does not change that desktop setting.

The separate `sustained` assessment examines all decoded-FPS/resolution samples after the first five seconds. It requires at least 30 observations spanning at least 29 seconds, each at 720p/≥27 FPS, with no missing stats, changed RTP stream or sampling gap. A later 24/7 FPS collapse is `degraded`, not hidden by three good startup samples. Short or incomplete windows are `inconclusive`. Runs of at least 35 seconds fail the process if either the startup gate or sustained gate fails; the default 15-second run remains a startup-only gate. A passing decoded-FPS gate still requires inspection of rendered FPS, playback drops and visual error; it is not an end-to-end smoothness guarantee.

Set `SCREEN_BENCH_LOW_VIEWER=1` to add a second viewer requesting the low layer, preventing the comparison from relying only on a high-quality viewer that lets dynacast deactivate the low encoder. Keep this option identical across variants. The JSON includes `lowViewerEnabled` and separate `lowReceiver` samples to verify its actual resolution/FPS. Unset remains the original one-viewer benchmark.

Use 120–600 seconds per case for multi-minute observations. The native desktop capture path, actual game/GPU contention, capture-to-render latency and Internet adaptation need a separate real-game measurement before changing production defaults.

## Startup repair and maintenance

With `livekit-client` 2.22.4 and LiveKit 1.13.2, the games profile puts `x-google-start-bitrate=5850` in the **local offer**. In Chromium 149 the hint was attached to H264 payload 103, whereas the SFU accepted H264 payload 109 without the hint. Starting video after audio then reproduced an approximately 0.4 Mbps bandwidth estimate, low FPS and a 960×540 layer even on loopback. The default profile is still 720p/30 FPS, with 5 Mbps primary and 1.5 Mbps low-layer maxima; raising those maxima does not repair the missing hint.

`screen-start-bitrate.ts` copies the SDK's own initial estimate to the **accepted remote answer** for the published screen's MID and codec family. The wrapper is local to that publisher transport, installed before screen publication, and removes itself after the first accepted patched answer. Bundled placeholders keep matching payload parameters. It does not change audio, codec profiles, min/max bitrate, congestion control, dynacast or degradation preference. Unsupported munging falls back to the original answer; reconnect creates a new transport/seed. A camera-first connection without a fresh screen hint is left alone.

This intentionally uses the typed internal `Room.engine.pcManager.publisher` boundary: LiveKit has no public SDP transform hook. Re-run the A/B harness and unit tests on SDK upgrades, and remove the shim when upstream applies the screen estimate to the accepted remote codec. No dependency files or browser prototypes are patched in the application. The benchmark's PeerConnection wrapper only records sanitized signaling.

### Local A/B evidence (2026-11-06)

Sequential Chromium 149 runs against LiveKit 1.13.2, with the same synthetic 720p/30 scene:

| Observation | Baseline | Repaired |
| --- | --- | --- |
| First share, three consecutive 720p / ≥27 FPS samples | Not reached in 15 s | Began at 2.038 s, confirmed at 4.068 s |
| Resume after a seven-second subscription pause | Began at 4.054 s | Began at 2.032 s |
| Republish on the same connection | Began at 9.142 s | Began at 2.020 s |
| First received frame's dimensions | 960×540 | 1280×720 |
| First static-region RGB MAE (lower is better) | 18.26 | 2.08 |
| First static-region PSNR | 18.01 dB | 37.16 dB |

Times are relative to opening/resuming the viewer, not the capture picker. The initial case deliberately waits three seconds after publication before subscribing. These are observations, not an SLA: an earlier repaired run's republish took 6.075 s to satisfy the strict three-sample FPS gate (already 720p, encoder limitation `none`). No WAN shaping, hardware game capture or camera-first startup was validated here. Raw JSON stays outside the repository in the OS temporary directory (`voiceroom-screen-startup-baseline-final.json` and `voiceroom-screen-startup-fixed-final.json`).

## Production diagnostics

Sender publication and visible remote-stage startup collect one sample per second for at most 30 seconds. Late viewers can start a new sender window; leaving viewers do not. Stop/unmount/hidden stage ends the observation, and pending reads cannot revive it. Samples include capture/encode/send/decode/render FPS, dimensions, actual bitrate, bandwidth estimate, encoder limitation, drops and freezes. Missing values remain null and measured zero remains zero. The selected RTP layer is the largest reported resolution, **not aggregate simulcast FPS**; an inactive high layer can therefore report zero while a lower layer is active, and `layerId` identifies the measured series.

The bounded records use the existing throttled client-log intake, not a new endpoint, and contain no SDP, credentials, addresses, room/account IDs or captured pixels. Log timestamps are the batch flush time; reconstruct samples from the `startedAt` and `elapsedMs` fields. Intake may be disabled or unavailable, so production confirmation still requires a fresh real game share with sender and receiver records.

The optional `relayPausedMs` sender field is cumulative relay-commanded native-helper pause time in milliseconds, not acknowledgment from the native process or a per-sample delta. The desktop refreshes this counter every two seconds, so repeated values are normal; older desktop versions report null. It distinguishes time paused by flow control from frame-drop counts but does not measure GPU readback or pipe latency.

### Capture pipeline records

A sender on a desktop that reports `relay.pipeline` also writes up to 16 `screen capture pipeline` records per startup window, one per new relay `seq` (the relay posts every two seconds while the sample is taken every second). They are separate from the sender sample, which already uses all 18 intake keys. Keys: `probeId`, `elapsedMs`, `seq`, `backend` (`wgc` or `dxgi`), the deltas `acquired`, `pacingSkips`, `pausedSkips`, `written`, `accumulated`, and `maxGapMs`, `maxMapMs`, `avgMapMs`, `maxWriteMs`, `avgWriteMs`.

The helper counters are cumulative since helper start; the record shows the delta since the previous record, so the first record has `null` deltas. A counter that went backwards (helper restart) also gives `null`, never a negative number. The `max*` values cover the interval since the previous relay post (about two seconds), so they are not deltas. Averages divide the summed time by the written frames of that delta. Times are milliseconds; the helper measures microseconds. `accumulated` exists only for DXGI; WGC reports `null`. An older desktop produces no pipeline records at all.

Reading them: `pacingSkips` and `pausedSkips` are frames dropped by the FPS cap and by flow-control pause; `written` reached the pipe. `acquired` counts successful helper acquisitions; a low count can mean no new source frames (for example a static scene), or an unmeasured capture-loop stall. A gap alone proves neither a DXGI bug nor an encoder cause. `maxGapMs` includes an ongoing gap. `Map` measures elapsed synchronous Map, not the whole GPU conversion; write timing includes payload preparation, Unmap and flush (including BGRX CPU scaling), not just pipe latency. Large values identify intervals to investigate, not a proven bottleneck.

### Sustained summaries

The 30-second window hides late drops. A separate observer samples every two seconds for the whole publication and writes one `screen sustained summary` record per minute (at most 18 keys): `probeId`, `trackId`, `direction`, `elapsedMs`, `samples`, `errors`, `minFps`, `medianFps`, `lowSamples` (samples below 15 FPS), `avgBitrate`, `minHeight`. A sender adds `minCaptureFps`, `minEncodedFps`, `maxGapMs` (from the pipeline, only on desktops that report it) and `backpressure`; a viewer adds `freezes`, `lost` and `minRenderedFps`. For a sender `minFps` is the sent FPS, for a viewer the rendered FPS. Missing data stays `null`. Minima and medians ignore missing values, `samples` includes them, and `lowSamples` means below 15 FPS, not below 27. A sender observer can run without viewers; dynacast yielding zero sent FPS then does not prove bad playback.

Unlike the startup window, a new viewer does not restart it; it ends with the publication or when the stage closes. Records are logged and reported (`screen sustained diagnostics`) every five summaries and once more on stop, and sampling ends after 120 summaries per publication. It never changes a track, an encoding or a subscription; exceptions are only counted in `errors`.

## Released state and compatibility (as of 2026-11-09)

Web 2.12.15 and desktop 1.4.12 were published on November 8. The released work includes phase-preserving native pacing (55% early window and 45% minimum gap), acquisition/Map/write/pause telemetry and sustained summaries. Simulcast, codec preference and `maintain-resolution` policy remain unchanged. Desktop and web are separate releases: a website update does not deliver a native helper, and older clients need not have updated. No shared-texture bridge has been implemented. Release state is not proof of a controlled real-game improvement.

The native path is WGC/DXGI texture → GPU conversion → staging/CPU readback → stdout pipe → utility relay → structured clone → renderer `VideoFrame` → track generator → WebRTC. Copies exist, but do not establish the bottleneck of any session. The queue is bounded to two in-flight frames; do not presume an unbounded backlog. Native `framesReceived` is measured after delivery to the renderer, not at WGC/DXGI input. `qualityLimitationReason=none` does not rule out CPU/GPU stalls; available bandwidth is a WebRTC estimate, not measured physical capacity.

## Dated production findings, not controlled experiments

- **November 7–8:** one MediaFoundation observation had capture around 19 FPS and sent around 6; other OpenH264 observations also showed low FPS, including native capture around 20–24 and later 3–7 FPS. A separate brief startup divergence was approximately 27 capture → 4 encoded FPS. These are different scenes/devices, not proof of a single encoder or capture cause. Scene motion was unknown; low FPS on static content alone is not a defect.
- **November 9:** a 20:29 UTC dump contained 2,076 unique events, 60 startup windows (23 sender, 37 receiver; 42 complete), 158 pipeline records in 11 sender windows, and 396 sustained summaries across 20 publications, not 20 people. All reported pipeline windows used DXGI; this is not a backend comparison.
- At 16:41 Moscow time, a 1080p30 sender and receiver ran over two minutes near 30 FPS, with zero reported freezes or lost packets; this was not controlled before/after evidence. At 18:04, an interval had average Map up to 27.49 ms, peak 77.86 ms, ten backpressure drops and about 549 ms commanded relay pause at startup; sent median was 27.8 FPS. This identifies a candidate for controlled measurement, not a universal readback bottleneck.
- At 21:22, an interval showed zero acquired/written/skipped frames and a 2.967 s acquisition gap, followed by a 4.532 s gap with max Map 6.21 ms and max write 4.1 ms; a paired ~53 s viewer reported median rendered 6 FPS and 24 freezes. Source inactivity versus an unmeasured capture-loop stall is unresolved. At 21:30, gaps of 2.44–4.23 s coincided with a roughly 32-minute viewer observer reporting 514 freezes and 63 lost packets, with minute medians varying from 0 to 30 FPS. Do not count overlapping observers as distinct people.

Log flush can lag by up to five minutes; `probeId` encodes the start in base 36. Client clocks are not synchronized: do not compute end-to-end latency from absolute sender/receiver timestamps. Missing samples are not zero, and a partial observer is not a full-duration measurement. The local encoding A/B and controlled real-game comparisons remain unproven; failed benchmark attempts with `cases: []` are not performance results.

## Next experiments and acceptance gates (proposed, not an SLA)

1. On the same hardware, load and continually moving game scene, compare DXGI with an alternative capture backend (including native versus Chromium where available). Test monitor and window separately, and first and late viewer, pause/resume and republish. Confirm the intended desktop helper version. For 720p30, require at least 27 **rendered** FPS within 3–5 seconds and sustained for at least two minutes; measure cadence, frame age/queue, freezes, loss and game FPS impact. Evaluate 1080p separately. A static scene is not an FPS gate. Record repetitions and failures, not just successful startup samples.
2. Where existing records cannot distinguish no new source frames from a capture-loop stall, add only bounded, privacy-safe timeout/result and wait/lock/conversion timing instrumentation. Preserve failure evidence and compare capture, write, send and render without assuming a gap identifies DXGI or encoder causation.
3. Run the isolated encoding variants above sequentially and in reverse order with the same low-viewer setting and startup repair. Verify actual layers, codec and encoder, and compare decoded/rendered FPS, bitrate, visual error and weak-receiver/network adaptation before any policy change. `single-layer` and `motion-framerate` are separate experiments; retain resolution priority for text. Do not globally disable hardware acceleration, frame dropping, adaptation or congestion control, or force a higher bitrate floor.
4. Only if controlled load repeatedly establishes material readback cost, benchmark an experimental Electron 44.7.1 native shared texture → `sharedTexture` → renderer `getVideoFrame()` → existing track bridge PoC. Verify process-local handles, synchronization, formats, fallback, lifetime through `allReferencesReleased`, `VideoFrame.close()`/release, and actual copy costs including downstream hidden readback. Do not promise end-to-end zero-copy or replace the WebRTC engine on assumption.

### Disposable local SFU for the isolated A/B

The following was proposed after fixing container addressing; successful container startup does not prove ICE connectivity. Use only a disposable loopback server and no production accounts, rooms, microphone or screen. Stop only the container created here. Run without concurrent builds/tests, inspect JSON even on nonzero exit, repeat in reverse order with separate output files, then test `motion-framerate` independently if useful.

```powershell
$container = 'voiceroom-screen-ab-' + (Get-Date -Format 'yyyyMMddHHmmss')
docker run -d --rm --name $container --label voiceroom.task=screen-encoding-ab `
  -p 127.0.0.1:17880:7880 -p 127.0.0.1:17881:17881 -p 127.0.0.1:17882:17882/udp `
  -e 'LIVEKIT_KEYS=devkey: secret' livekit/livekit-server:v1.13.2 `
  --dev --bind 0.0.0.0 --node-ip 127.0.0.1 --rtc.tcp_port 17881 `
  --udp-port 17882 --rtc.enable_loopback_candidate
try {
  $env:SCREEN_BENCH_SECONDS = '60'
  $env:SCREEN_BENCH_LOW_VIEWER = '1'
  $env:SCREEN_BENCH_BASELINE = '0'
  foreach ($variant in @('default', 'single-layer')) {
    $env:SCREEN_BENCH_VARIANT = $variant
    $env:RESULTS = Join-Path $env:TEMP "screen-encoding-$variant.json"
    node scripts/voice-bench/screen-startup-bench.mts
  }
} finally {
  docker stop $container
  Remove-Item Env:SCREEN_BENCH_SECONDS, Env:SCREEN_BENCH_LOW_VIEWER, Env:SCREEN_BENCH_BASELINE, Env:SCREEN_BENCH_VARIANT, Env:RESULTS -ErrorAction SilentlyContinue
}
```

## References and limits

- [Discord: How It All Goes Live (2024)](https://discord.com/blog/how-it-all-goes-live-an-overview-of-discords-streaming-technology) motivates examining the whole chain, adaptation and cadence rather than average FPS alone.
- [Discord: Improving Go Live on AMD GPUs (2024)](https://discord.com/blog/from-blocky-to-brilliant-improving-video-quality-on-discord-go-live-on-amd-gpus) describes rate-control, frame-drop and encoder interactions: a hypothesis, not the established cause here.
- [Electron sharedTexture v44.7.1](https://github.com/electron/electron/blob/v44.7.1/docs/api/shared-texture.md) documents the experimental API for the gated PoC.

These sources do not establish Discord's current private pipeline, its exact startup bitrate, or Windows zero-copy based on another platform's results.
