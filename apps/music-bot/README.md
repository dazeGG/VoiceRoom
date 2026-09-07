# `apps/music-bot`

Python service that resolves VK Video, Rutube and YouTube links with `yt-dlp`,
decodes the audio with ffmpeg, and publishes it into a LiveKit room as a bot
participant, so every member of a static room hears the same thing at the same
time.

It is deliberately **not** an npm workspace. The directory matches the
`workspaces: ["apps/*"]` glob in the root `package.json`, but npm skips it
because it has no `package.json` — that is intended; do not add one.

## What it does and does not hold

- It never mints a LiveKit token and never derives a LiveKit room name. The API
  mints a room-scoped `AccessToken` and passes it, together with the fully
  resolved room name (the server applies `LIVEKIT_ROOM_PREFIX`), in the play
  request. `LIVEKIT_API_SECRET` is not part of this service's configuration.
- It authenticates its control API with a shared secret, not with network
  placement. The port is not published to the host, but that is containment,
  not authorisation.
- It publishes as track source `SCREENSHARE_AUDIO`. `livekit-rtc` has no "music"
  source; the web client discriminates by bot identity before any source
  predicate.
- **Which sources are reachable is this service's fact, not the contract's.**
  `packages/shared/src/room-music.mjs` lists all three sources unconditionally,
  because a wire contract that varies per deployment is not a contract. Whether
  a given deployment can actually reach one is answered here, per link, with
  `source_unavailable`.

## Sources

| Source | Accepted link shapes | Notes |
| --- | --- | --- |
| `vk` | `/video<owner>_<id>`, `/clip<owner>_<id>`, `/playlist/<owner>_<id>`, `/video/playlist/<owner>_<id>`, `?z=video<owner>_<id>…` on `vk.com`, `vk.ru`, `m.vk.com`, `vkvideo.ru`, `vkvideo.com` | The fragile one. VK changes its player protocol periodically and public videos intermittently start demanding registration. Treat a VK failure as operational noise. |
| `rutube` | `/video/<32 hex>/`, `/shorts/<32 hex>/`, `/play/embed/<32 hex>`, `/plst/<digits>/` | Stable. Often publishes no audio-only format, so a muxed stream is pulled and ffmpeg discards the video. |
| `youtube` | `youtu.be/<11>`, `/watch?v=<11>`, `/shorts|/embed|/live|/v/<11>`, `/playlist?list=<id>` on `youtube.com`, `m.`, `music.`, `youtube-nocookie.com`, `youtu.be` | Blocked in Russia since 10 Feb 2026. Off by default; `MUSIC_BOT_PROXY` turns it back on. |

`watch?v=X&list=Y` normalizes to the **video**, ignoring `list`: on YouTube that
list is usually an auto-generated `RD…` mix from the address bar, not an intent
to queue a playlist. `src/music_bot/links.py` mirrors the shared normalizer's
rules deliberately and documents the one place the two can still differ (URL
parsing itself, WHATWG vs `urllib.parse`) — read its docstring before changing
either side.

### The yt-dlp pin goes stale by design

`pyproject.toml` pins exact versions, and `yt-dlp` is the one dependency where
that pin **expires on its own**. Its extractors track sites that change without
notice, so a pin that resolves every link today will fail on one or more sources
in a few months, with no code change here. When VK or YouTube stops resolving,
bump `yt-dlp` first and treat it as a bug in this service second.

## Environment

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `MUSIC_BOT_SECRET` | **yes** | — | Shared secret for both directions of the control plane. Missing or under 32 characters ⇒ the process exits 2. |
| `MUSIC_BOT_SOURCES` | no | `vk,rutube` (plus `youtube` when a proxy is set) | Comma-separated subset of `vk`, `rutube`, `youtube`. An unknown name is a **boot failure**, not a warning. Unset means the default; set-but-empty is an error. |
| `MUSIC_BOT_PROXY` | no | — | Egress proxy for resolution *and* for ffmpeg's fetch of the media URL. Bot egress only: never the control plane, never LiveKit. When set, `youtube` joins the default source list. |
| `HOST` | no | `0.0.0.0` | Bind address. |
| `PORT` | no | `8080` | Bind port. |
| `LOG_LEVEL` | no | `info` | Root log level. |
| `LIVEKIT_INTERNAL_URL` | no | `ws://livekit:7880` | Fallback when the play request omits `livekit.url`. |
| `MUSIC_BOT_API_URL` | no | `http://api:3000` | Base URL for the outbound callbacks. |
| `MUSIC_BOT_MAX_ROOMS` | no | `8` | Concurrent-room ceiling for this container. |
| `MUSIC_BOT_HEARTBEAT_INTERVAL_MS` | no | `2000` | Heartbeat period. Fixed by the contract; do not change casually. |
| `MUSIC_BOT_HEARTBEAT_FAILURE_LIMIT` | no | `5` | Consecutive unacknowledged heartbeats before the bot leaves the room. |
| `MUSIC_BOT_CALLBACK_TIMEOUT_MS` | no | `3000` | Timeout for outbound callbacks. |
| `MUSIC_BOT_RESOLVE_TIMEOUT_MS` | no | `10000` | Timeout for one yt-dlp extraction, and for resolving a stream URL. |
| `MUSIC_BOT_EXPAND_LIMIT` | no | `50` | Playlist expansion ceiling (AC-6). |
| `FFMPEG_BINARY` | no | `ffmpeg` | ffmpeg executable. |

Enabling `youtube` without a proxy is allowed on purpose: a deployment outside
Russia reaches it directly, and the proxy default must not become a requirement.

Healthcheck: `GET /healthz` on the bound port, unauthenticated.

## Track ids

`trackId` on the wire is the shared contract's `MusicTrackRef.id`:

```
<source>:video:<id>        vk:video:-1_2, rutube:video:<32 hex>, youtube:video:dQw4w9WgXcQ
<source>:playlist:<id>     vk:playlist:-1_9
```

The bot mints these in `/resolve` (as `items[].trackId`, alongside the `source`
and `videoId` the API rebuilds its `MusicTrackRef` from) and derives them again
in `/play` from the `sourceUrl` it is sent. They are safe as dedup keys and
identical to `MusicTrackRef.id` on the API side, so the two ends never have to
agree on a second identifier. Internally the resolver is only ever asked for one
of these ids; it rebuilds the canonical URL from it, and
`test_canonical_urls_are_stable_under_reparsing` pins that this round trip
addresses the same video the API sent.

## Control plane: API → bot

Every route except `/healthz` requires `x-vr-music-secret: $MUSIC_BOT_SECRET`.
Errors are `{"status", "error", "message"}`; `status` is `"unavailable"` for 503
and `"error"` otherwise.

### `GET /healthz` — 200, no auth

```json
{
  "status": "ok",
  "resolver": "ready" | "unavailable",
  "sources": ["vk", "rutube"],
  "proxy": false,
  "rooms": 0,
  "maxRooms": 8
}
```

`proxy` is a boolean on purpose: the URL can carry credentials and never leaves
the process.

### `POST /resolve` — link to queue metadata

```json
{ "link": "https://vk.com/playlist/-1_9", "limit": 50 }
```

200:

```json
{
  "status": "ok",
  "kind": "video" | "playlist",
  "source": "vk",
  "sourceId": "vk:playlist:-1_9",
  "title": "Playlist",
  "totalAvailable": 183,
  "truncated": true,
  "items": [
    {
      "trackId": "vk:video:-1_2",
      "title": "Track",
      "artists": ["Artist"],
      "durationMs": 180000,
      "source": "vk",
      "videoId": "-1_2",
      "coverUrl": "https://…"
    }
  ]
}
```

`limit` is clamped to `MUSIC_BOT_EXPAND_LIMIT`. `truncated` reports that the
source had more items than were returned, because `limit` capped the expansion.
It is **informational only**: the API still queues the returned items, subject to
the queue cap.

The all-or-nothing rule in AC-6 applies to whether the returned items fit the
100-item queue — not to whether the source fit inside the 50-item expansion
limit. `planMusicEnqueue` in `packages/shared/src/room-music.mjs` is the
authority and takes no `truncated` input: it slices the items to
`MUSIC_EXPANSION_MAX_ITEMS` (50), then rejects the whole batch with
`queue_capacity_exceeded` only when `queueLength + items.length` would exceed
`MUSIC_QUEUE_MAX_ITEMS` (100). So a playlist longer than 50 items is queueable
— its first 50 are enqueued — and `truncated` must not be treated as a rejection
signal.

`coverUrl` is https-only and may be `null`; `artists` falls back to the channel
or uploader, and may be empty. A playlist entry that does not belong to the
playlist's own source is dropped rather than queued under an id that would fail
at play time.

Expansion never processes formats (`yt-dlp` runs with `process=False`, and
playlists with `extract_flat`). That is what keeps a media URL from being minted
at enqueue time — see below.

### `POST /sessions/{roomId}/play` — start or replace the playing item

```json
{
  "sessionEpoch": 12,
  "item": {
    "itemId": "q_abc",
    "source": "vk",
    "videoId": "-1_2",
    "sourceUrl": "https://vkvideo.ru/video-1_2",
    "title": "Track",
    "durationMs": 180000
  },
  "livekit": {
    "url": "ws://livekit:7880",
    "roomName": "<fully resolved LiveKit room name>",
    "token": "<room-scoped AccessToken minted by the API>",
    "identity": "<bot identity the snapshot advertises>"
  }
}
```

202:

```json
{
  "status": "playing",
  "roomId": "room-1",
  "sessionEpoch": 12,
  "itemId": "q_abc",
  "identity": "...",
  "roomName": "...",
  "positionMs": 0,
  "playing": true
}
```

`livekit.url` and `livekit.identity` are optional; `roomName` and `token` are
not. `source`, `videoId` and `sourceUrl` all describe the same item, and the bot
checks that they agree instead of picking one: `sourceUrl` is what gets parsed
(it is canonical and the shared normalizer already validated it), and a
`source`/`videoId` that contradicts it is a `400 invalid_request`. A drift
between the two ends of the control plane is much cheaper to find here than as a
room playing the wrong track. `source` is also what the enablement check runs
against, so a link from a source outside `MUSIC_BOT_SOURCES` fails before
anything is published.

The stream URL is resolved inside this call, immediately before playback,
because media URLs from all three sources are signed and expire — **never cache
one at enqueue time.**

### `DELETE /sessions/{roomId}` — leave the room

Optional `?sessionEpoch=N` guards against a stale stop. 200:

```json
{ "status": "idle", "roomId": "room-1", "stopped": true }
```

`stopped: false` means there was no session — the call is idempotent.

### Status codes

| Code | `error` | When |
| --- | --- | --- |
| 202 | — | Playing. |
| 200 | — | `/healthz`, `/resolve`, `DELETE`. |
| 400 | `invalid_request` | Malformed body, bad JSON, non-integer `sessionEpoch`, or an item whose `source`/`videoId`/`sourceUrl` disagree. |
| 400 | `invalid_link` | `/resolve` was sent something that is not a supported VK/Rutube/YouTube link, or `/play` was sent a `sourceUrl` that is not one. |
| 401 | `unauthorized` | Missing or wrong secret. |
| 404 | — | Unknown route. |
| 409 | `stale_epoch` | `sessionEpoch` older than the room's current one. |
| 429 | `room_capacity_exceeded` | `MUSIC_BOT_MAX_ROOMS` reached. |
| 503 | `source_unavailable` | The source is not in `MUSIC_BOT_SOURCES`, or it refused this deployment: geo-block, bot wall, DNS/TLS failure, timeout. |
| 503 | `resolver_unavailable` | yt-dlp is missing from the image. The service still boots and still answers. |
| 503 | `not_found` | The link resolves to nothing playable: removed, private, empty playlist. |
| 503 | `resolve_failed` | Unclassified resolve failure, no playable audio format, or a non-https stream URL. |
| 503 | `stream_failed` | Stream resolve timed out, or ffmpeg would not start. |
| 503 | `publish_failed` | Could not join or publish into the LiveKit room. |
| 500 | `internal_error` | Unmodelled crash; the service stays up. |

`source_unavailable` is the one 503 the API does **not** flatten into
`unavailable`: it is also a client-facing code in `MUSIC_ERROR_CODES`, so the UI
can say "not reachable from here" instead of "bad link". Every other 503 becomes
`MusicSession.status === 'unavailable'` (AC-9).

The distinction that matters: `invalid_link` means the person pasted something
this bot cannot address at all, and they should fix the link.
`source_unavailable` means the link is fine and the *deployment* cannot reach it
— nothing the person can do to the link will help.

## Control plane: bot → API

Both carry `x-vr-music-secret` and the `(sessionEpoch, itemId)` pair.

`POST {MUSIC_BOT_API_URL}/internal/rooms/{roomId}/music/heartbeat`, every 2s:

```json
{ "sessionEpoch": 12, "itemId": "q_abc", "positionMs": 4321, "status": "playing" | "idle" }
```

`POST {MUSIC_BOT_API_URL}/internal/rooms/{roomId}/music/track-ended`, once per item:

```json
{
  "sessionEpoch": 12,
  "itemId": "q_abc",
  "reason": "completed" | "failed",
  "positionMs": 180000,
  "errorCode": null | "stream_failed" | "publish_failed"
}
```

How the bot reads the API's reply, in both cases:

- **2xx** — acknowledged; the failure streak resets.
- **409 / 410** — the server has moved past this session. The bot leaves the
  LiveKit room immediately.
- **anything else, or a transport failure** — unacknowledged. After
  `MUSIC_BOT_HEARTBEAT_FAILURE_LIMIT` consecutive unacknowledged heartbeats the
  bot leaves the room by itself, so an API restart cannot leave a room hearing
  music the server knows nothing about.

## Resolution, threads and timeouts

yt-dlp is synchronous and slow: one extraction is a handful of blocking HTTPS
round trips, and on a bad day a full TCP timeout. It therefore runs in a bounded
thread pool and every call is fenced by `MUSIC_BOT_RESOLVE_TIMEOUT_MS`. On the
event loop it would stall heartbeats, and the API's watchdog would tear down a
room that is playing fine. The pool is bounded because `asyncio.wait_for`
abandons a blocked extraction but cannot kill the thread running it.

yt-dlp's cache is disabled (`cachedir: False`): the container runs read-only as
uid 10001 and has nowhere to write one.

## Running the gate

```sh
pip install -e ".[dev]"
ruff check --no-cache .
pytest -q
```

`--no-cache` is not optional. Ruff caches by file mtime and content, and a stale
"All checks passed!" has masked real findings here more than once.

CI runs the same two checks in the `music-bot` job of
`.github/workflows/ci.yml` (`ruff check .` there, on a runner that always starts
from a cold cache — locally you do not, hence the flag). The test suite never touches a real site, LiveKit,
or a real ffmpeg binary — the resolver's `YoutubeDL`, the publisher, and the
subprocess spawn are all injected — so it passes with no credentials and no
network.

Two constraints on anything you add here. The service has **no Dockerfile of its
own**: the image is the `musicbot` target of the repository-root `Dockerfile`,
which copies only `pyproject.toml` and `src/`, so the package must stay
installable from those two alone — nothing in `pyproject.toml` may reference a
path outside `src/`. And the container runs as **non-root uid 10001**, so
nothing here may write to the filesystem.

Operator setup — the source/proxy decision and the feature flag — lives in the
root `README.md`.
