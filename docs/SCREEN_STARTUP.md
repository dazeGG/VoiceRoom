# Screen startup measurement

Run `node scripts/voice-bench/screen-startup-bench.mts` against a **disposable local LiveKit server** on `ws://127.0.0.1:17880` (development key `devkey`, secret `secret`). The script refuses non-loopback endpoints. It creates and deletes only its own uniquely named room, opens isolated headless Chromium pages, and uses a synthetic moving/text canvas: no real microphone, screen, account or production connection.

The temporary Vite server imports the application's current `getScreenPublishVideoOptions(getScreenProfileForMode('games'))`; encoding settings are not copied into the harness. A synthetic audio track is published first, exercising a pre-existing voice connection. The cases are a late viewer of a new share, resubscription after a seven-second pause, and a new share on the same connection.

Each case collects sender/receiver samples once per second for 15 seconds: encoded/decoded/rendered FPS, playback drops, dimensions, bitrate, bandwidth estimate, and encoder limitation. A fixed text/fine-line region is compared against the publisher's exact canvas pixels using RGB MAE and PSNR; the region does not move, so differing frame times do not masquerade as blur. Lower MAE/higher PSNR is better. A null PSNR together with zero MAE denotes an exact match. These visual measurements have no universal pass threshold: compare initial samples with that run's later steady samples.

Passing the **resolution/FPS gate** requires three consecutive observations of at least 1280×720 and 27 decoded FPS, with the first qualifying observation within five seconds. Missing measurements, a changed RTP stream, and gaps between samples break the sequence. An incomplete sequence is inconclusive, not a pass. The process exits nonzero if any case does not pass. Sanitized signaling summaries record timing, video-section directions, codec mappings, track IDs, startup-bitrate hints and sender encodings; raw SDP, ICE credentials and candidate addresses are not retained.

Options: `SCREEN_BENCH_URL`, `SCREEN_BENCH_KEY`, `SCREEN_BENCH_SECRET`, `SCREEN_BENCH_SECONDS` (5–120), `SCREEN_BENCH_BASELINE=1` (omit the startup repair for an A/B comparison), and `RESULTS` (JSON output path, defaults to the OS temporary directory). Browser/room/server cleanup runs on failure too; the external SFU is not started or stopped by the script. Run baseline and repaired cases sequentially on an otherwise idle machine; concurrent builds/tests contaminate FPS measurements.

This is a repeatable local baseline, **not proof of Internet or desktop-game performance**. Inspect the recorded encoder implementation and compare received/rendered FPS; headless software encoding may itself be limited. Full resolution and FPS also do not prove visual fidelity: a blurry 720p frame still has 720 pixels of height. Do not claim that a real incident is fixed from this benchmark alone.

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
