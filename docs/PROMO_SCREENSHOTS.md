# Product screenshots

The site uses actual VoiceRoom UI, not illustrations of proposed features.
Assets live in `apps/site/public/promo/`; `ProductScreenshot.astro` supplies
descriptive alternative text, a visible caption and intrinsic dimensions.

## Capture set — 2026-11-10

### Refresh for the six-page site

| File | Pixels | Source / placement |
| --- | --- | --- |
| `screen-share-video.png` | 1600 × 1000 | Viewer receiving Big Buck Bunny from the desktop app's real «Плавное видео» picker; screen-sharing hero and mode card |
| `screen-share-text.png` | 1600 × 1000 | Viewer receiving an isolated VS Code window in «Чёткая картинка» mode; screen-sharing hero and mode card |
| `voice-ptt.png` | 1280 × 800 | Desktop Sound settings: RNNoise, gate at −40 dB, push-to-talk on F9; games page |
| `voice-mix.png` | 1280 × 800 | One participant's actual volume menu at 80%; home page |
| `chat-features.png` | 1280 × 800 | Real pin, reply, mention, reaction and public-link preview; home page |
| `desktop-app.png` | 1600 × 800 | Genuine Electron window, including its titlebar, in a three-person demo call; download page |
| `game-overlay.png` | 1919 × 1079 | User-supplied Counter-Strike 2 frame with the actual VoiceRoom overlay in the upper-left corner; games hero |

The existing UI exposes individual participant-volume menus, not a combined
three-person mixer. Noise suppression and gate settings are a separate surface;
the screenshots do not combine them into an invented panel.

### Earlier capture library

| File | Pixels | Source |
| --- | --- | --- |
| `voice-call.png` | 1280 × 800 | Connected room with three demonstration accounts |
| `lobby.png` | 1280 × 800 | Persistent rooms, friends and an active call |
| `room-chat.png` | 1280 × 800 | Room conversation alongside the call |
| `direct-message.png` | 1280 × 800 | Personal conversation between demonstration accounts |
| `screen-sharing.png` | 1600 × 900 | Viewer receiving a shared browser tab through LiveKit |
| `sound-settings.png` | 1280 × 800 | Actual sound settings, RNNoise and enabled microphone gate |
| `mobile-room.png` | 390 × 844 | Actual mobile room UI under Android browser emulation |
| `desktop-overlay.png` | 121 × 160 | Actual transparent Electron overlay renderer |

Web source: VoiceRoom commit `757742cfea0a37b66ed9b0a0dcd337c4ff4d5da8`.
Desktop source: VoiceRoomDesktop commit `fb4bd11b03b2157decab0b8d20f57c2606bfd3b2`,
version 1.4.13, Electron 44.7.1. The earlier overlay uses unchanged
`electron/ui/overlay.html`, CSS, JavaScript and preload. The refresh uses the real
desktop bootstrap, preload, native capture/hotkey controllers and titlebar view.
The displayed code is a local copy of `packages/shared/src/app-home.ts` from the
current working tree; it contains no credentials or private documents.

## Authenticity and limits

- Agent-produced room captures use staged local accounts and messages. No private
  conversations or user's desktop were captured. The exception is `game-overlay.png`,
  supplied by the user for this site: it retains the visible game aliases, avatars
  and overlay from their actual session, rather than relabelling them as demo data.
- The web sessions use the real API, database and LiveKit from `docker-compose.ci.yml`.
  There are no mocked capability responses, connection labels or application styles.
- The microphone source is Chromium's synthetic test input; these images are not
  evidence of sound quality, CPU usage, Internet latency or performance on other devices.
- The earlier `screen-sharing.png` captures an isolated browser tab displaying the
  locally built `/download` page. The two new mode images instead capture genuine
  desktop-selected windows and the viewer's decoded LiveKit frames, not composites.
  Video used the HD/30 FPS preset with a 1266 × 792 source and received frame.
  Text used the source/5 FPS preset with a 1202 × 800 source; the viewer received
  an adaptive 811 × 540 layer. Preset labels are not measured resolution, frame-rate
  or sharpness guarantees. These images do not prove maximum text quality.
- Desktop captures use a single unaltered frame from the exact task-owned window's
  capture ID, preserving the native titlebar. The isolated harness omits protocol
  registration, autostart migration and updater installation. The native PTT binding
  was saved, but no physical global hotkey was pressed during the user's game.
  Harness diagnostics-handler/listener warnings are retained in local evidence;
  successful connection and decoded stream frames were verified separately.
- Chat data and reactions were created through the actual UI/API. Public-link
  previews were enabled in the local Compose configuration and fetched by the real
  backend, not replaced with canned metadata.
- The mobile image is browser emulation on Windows, not a physical Android device test.
- The earlier `desktop-overlay.png` uses staged IPC participant state in an isolated hidden Electron window.
  It does not demonstrate actual game compositing, global hotkeys or detected speech.
  Keep it at its natural size and retain the demonstration-participants caption.
- No camera screenshot is included: synthetic camera test patterns should not be
  marketed as a real video conversation. No browser shot is labelled as the desktop app.
- During the refresh, task Chromium and Electron output was muted. The video source
  contains no audio. The user's installed VoiceRoom, live call and system volume
  were not modified.

## Video attribution

`screen-share-video.png` contains a frame from **Big Buck Bunny**, © 2008
Blender Foundation / [www.bigbuckbunny.org](https://www.bigbuckbunny.org/),
licensed under **CC BY 3.0**; see the [official license and attribution notice](https://peach.blender.org/about/).
The source was the official [1080p / 30 FPS download](https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4.zip).
For the isolated capture source, a 12-second excerpt starting at 00:45 was trimmed
without re-encoding and its audio removed. The source window displayed a credit;
both site placements also include attribution and a license link. The source movie
and local excerpt are ignored scratch files, not site assets.

## Refresh procedure

1. Start an isolated, task-named local Compose project from `docker-compose.ci.yml`.
   Resolve occupied ports with a task-local override, not by stopping unrelated services.
2. Use fresh demo accounts. Populate profiles, friendships, rooms and DMs through
   the real API; send room messages through the UI. Never reuse production cookies.
3. Use an isolated Playwright Chromium profile. Wait for fonts, loaded messages and
   actual voice connection before capture. Use the dimensions above and the default
   theme. Launch test Chromium with `--mute-audio`; mute all task Electron
   webContents, including newly created ones. Do not change the system's audio.
4. For a browser-tab share, use full Chromium (`channel: 'chromium'`) and
   `--auto-select-tab-capture-source-by-title=<unique demo tab title>` with
   `--auto-accept-camera-and-microphone-capture`. Do not combine the latter with
   `--use-fake-ui-for-media-stream`, which also affects display capture.
   Click the real share/watch controls and verify received frames and browser-only capture.
   For the desktop modes, launch the real desktop bootstrap in an isolated profile,
   select the exact demo source window in its native picker and verify the sender
   settings and decoded viewer frames. Keep native profile selection separate from
   browser sharing; the browser does not expose the desktop mode picker.
5. Save unaltered screenshots, inspect every image, then run the site build and check
   the rendered pages at desktop and phone widths. Preserve aspect ratios; do not crop
   away limitations or error states to make a failed session appear successful.
6. Close only task-owned browser/Electron sessions and stop the task's Compose project.
   Keep temporary profiles, credentials, raw captures and harnesses out of Git.

The initial run's local evidence and overlay harness are under `.omx/promo-capture/`.
Refresh evidence is under `.omx/promo-refresh/`, including `desktop-evidence.json`,
`desktop-text-stream-evidence.json`, `desktop-video-stream-evidence.json` and
`text-viewer-evidence.json`. These ignored files are not required to serve the site.
The public PNG assets are intentional source assets; a site build copies them
without importing the application runtime.

## User-supplied game capture

All seven requested refresh captures are now placed. The native Windows capture
helper was unavailable, so the user supplied two CS frames. The selected second
frame shows the half-time team scene: there is no mini-map behind the overlay.
It was copied byte-for-byte to `game-overlay.png`, without cropping, compositing,
moving avatars or redrawing the interface. The first frame, where the overlay
overlaps the mini-map, is not used.

The games page preserves the full 1919 × 1079 frame and provides a link to its
original size because the compact avatar-only overlay becomes small in the hero.
The source PNG is approximately 4.3 MB and is not re-encoded. The picture demonstrates
overlay visibility, not detected speech, hotkey operation or application performance;
the in-game FPS counter is simply part of the supplied frame. The user's installed
desktop-app version was not independently checked for this image.

`lobby.png`, `direct-message.png` and `mobile-room.png` are no longer placed by the
design. They remain in the capture library; no extra sections were added to the
six-page layout solely to reuse them.

## Refresh verification

- After adding the user-supplied game frame, site check, 25 site tests, build,
  targeted ESLint/Prettier and diff checks passed again. The games page was
  visually checked at 1440, 390 and 320 pixels; the original-size link is present,
  the frame keeps its aspect ratio, and there are no page errors or horizontal overflow.
- `npm run check` and `npm run build` passed after the refresh.
- Shared: 152 tests; site: 25 tests; web: 1185 tests passed. The Windows web run
  uses the installed Git `bin` and `usr/bin` on its process-local PATH because
  the three existing asset-archive tests invoke `sh`.
- All six pages were checked at 1440, 390 and 320 CSS pixels: no document-level
  horizontal overflow, missing promo images or JavaScript page errors.
- Mode switching by mouse/arrow keys, mobile navigation, OS selection and the
  404 room form were exercised. CSS mode switching, navigation and release-page
  download fallbacks also worked with JavaScript disabled.
- Existing web/admin bundle-size and dynamic-import build warnings remain.
  This refresh is not a CPU, audio-quality or network-performance benchmark.
- Task-owned browsers, Electron, VS Code and the Compose project were stopped.
  The existing site preview and the user's installed VoiceRoom/CS were preserved.
- No commit, push or deployment was performed.
