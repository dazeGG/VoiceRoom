# Self-hosting and operations

How to run VoiceRoom on your own server: environment and secrets, Docker, TURN, CI/CD and migrations. The product overview and a quick local start are in [`README.md`](../README.md).

For temporary video meetings, use the [VoiceRoom Meet installer](../apps/docs/src/content/docs/self-hosting/install.md). On a clean Linux server it configures the domain, creates `.env` and starts the ready-made images. For accounts, persistent rooms, chat history and the admin app, see [full-stack installation](#full-stack-installation).

`get.voiceroom.ru` redirects to `install.sh` from the Meet release marked Latest on GitHub. Installation needs that HTTPS host and a `meet/vX.Y.Z` release that contains `install.sh`, `manifest.json` and `docker-compose.personal.yml`. The manifest pins images by digest. [Caddy configuration](../apps/get/Caddyfile)

To move off `v2.15.0`, run the new installer once in upgrade mode. The old local CLI recognizes only tags of the form `vX.Y.Z`. The new CLI picks up the existing install directory and replaces the local command after a successful upgrade.

```sh
curl -fsSL https://get.voiceroom.ru | sudo sh -s -- upgrade
```

Later upgrades run with `sudo voiceroom upgrade`. A specific release can be named as `sudo voiceroom upgrade meet/v1.0.0`.

For DuckDNS and deSEC, the installer reads the A and AAAA records before it changes DNS. If the address differs from the server's public IPv4, installation, `voiceroom domain set` and setting a new TURN name during an upgrade require confirmation in the terminal. The default answer is «нет» (no). When running without a terminal, pass `--replace-dns` only if you intend to replace those records. After confirmation, the installer points the A records at the server and deletes existing AAAA records for the names it configures. Image downloads during installation and upgrade are retried up to three times. On a final failure the command prints the last lines of Compose diagnostics with secrets removed.

## Diagnosing an installed Meet

If Meet does not open, or participants cannot hear each other, run `sudo voiceroom doctor` on the server the installer configured. The command checks the installed version and the latest version, Docker and host resources, the clock, public IPv4 and DNS, local HTTPS and TURN/TLS, containers, ports and the firewall, each separately. For `WARN` and `FAIL` it says what to fix. Any `FAIL` makes the exit code non-zero. For containers that are restarting, and for containers that fail their health check, it prints up to five of the last log lines with secrets removed.

Outside requests are limited to the GitHub release check, public-IPv4 detection and DNS. The HTTPS and TURN/TLS checks talk to the server locally. Check the inbound ports from the last line of the report in the hosting panel, where separate firewall rules or security groups may apply.

## Manual Meet installation

`docker-compose.personal.yml` brings up a separate server for temporary Meet video meetings. A personal server needs its own Compose project and its own PostgreSQL database.

In a separate `.env.personal`, set `PERSONAL_DOMAIN` and `PERSONAL_LIVEKIT_API_KEY`, and separate random values for `PERSONAL_POSTGRES_PASSWORD`, `PERSONAL_LIVEKIT_API_SECRET` and `PERSONAL_GATE_SECRET` (for example, `openssl rand -hex 32` for each).

For `PERSONAL_DOMAIN=meet.example.com`, create A records for `meet.example.com` and `turn.meet.example.com` pointing at the server's public IPv4. Use the DNS provider's «только DNS» (DNS only) mode. On a server with a single IPv4, leave both names without AAAA records. Caddy obtains certificates for both names automatically and forwards signalling through the auth-gate on the Meet domain.

Open the inbound ports in the server firewall and in the hosting panel.

| Port | What it is for |
| --- | --- |
| `80/TCP` | HTTP and certificate issuance |
| `443/TCP` | HTTPS, LiveKit signalling and TURN/TLS through Caddy |
| `7881/TCP`, `7882/UDP` | Direct LiveKit media |
| `3478/UDP` | TURN over UDP |
| `30000–30099/UDP` | LiveKit media relay ports |

TURN is on by default. If a participant's network blocks the direct media ports, the browser can connect to `turn.<domain>` on `443/TCP`. Caddy chooses the route by TLS SNI and forwards the connection to LiveKit's built-in TURN server.

For HTTPS, the personal Caddy uses HTTP/1.1 and HTTP/2 over TCP. Opening `443/UDP` is not required.

```sh
docker compose --env-file .env.personal -f docker-compose.personal.yml up -d --build --wait
docker compose --env-file .env.personal -f docker-compose.personal.yml exec -T api node apps/api/src/scripts/owner-link.ts
# For rotation
docker compose --env-file .env.personal -f docker-compose.personal.yml exec -T api node apps/api/src/scripts/owner-link.ts --rotate
```

Open the link from the `owner-link.ts` command in a browser, press «Создать встречу» (Create meeting) and copy the meeting link. Open that link yourself if you want to take part, and send it to guests. Each participant enters a name, presses «Присоединиться к встрече» (Join meeting) and allows the browser to use the microphone. In the call they can turn the camera on and share the screen.

The meeting chat can send text. Only participants connected to that meeting at the moment of sending receive the messages. The server does not store messages. History is visible only in the tab that received the messages, and it is cleared on leaving the meeting. New participants do not see earlier messages. Messages missed after a reconnect are not delivered.

The owner secret is stored in the `owner` volume. The owner link is exchanged once for permission to create rooms, for five minutes. When a new owner link is needed, run the command with `--rotate`. Rotation revokes the old owner links and owner permissions. Guest media access is kept. Give guests only the room link.

The personal server does not record call-presence history, analytics or usage measurements, and it does not look up IP or geolocation. Display names live in memory. PostgreSQL stores the room's working rows, participant identifiers with token hashes, and LiveKit admission data until the room closes. After the last participant leaves and the reconnect grace period ends, a timer check deletes the empty room. On startup the server deletes working rows of Meet rooms that were left behind. Deletion is physical, at the table level. Stack logs contain no participant names, message text or tokens. Docker keeps up to three log files of 10 MB per container.

The server itself does not create backups. During `voiceroom upgrade` the CLI stops accepting calls and creates a closed temporary copy of PostgreSQL so migrations can be rolled back. The copy is deleted after a successful upgrade or rollback, and if restore is interrupted or fails it is kept for the next attempt. Copies of `.env` and of the release manifest remain in `/opt/voiceroom/backups`. If you copy PostgreSQL or its volume yourself, the copy is stored under your own policy. Database copies can contain the working rows that existed at the time of the copy.

## Full-stack installation

The full VoiceRoom runs through `docker-compose.yml`. You need an `x86_64` Linux server with a public IPv4, Docker Engine with the `docker compose` plugin, Git and OpenSSL. Ports `80/TCP`, `443/TCP`, `7881/TCP` and `7882/UDP` must be free on the server and reachable through the firewall. Caddy serves HTTPS and LiveKit signalling. Media goes to `7882/UDP` or `7881/TCP`.

Create A records for `voice.example.com`, `livekit.voice.example.com` and, if you want the admin app, `admin.voice.example.com`, pointing at the server's IP. Replace `voice.example.com` with your domain. At the DNS provider, choose «только DNS» (DNS only) mode if it offers to proxy traffic. Add AAAA records only if the server is reachable over IPv6.

Download Compose from the API tag and fetch the Web tag. The example uses `1.0.0` from each series.

```sh
git clone --depth 1 --branch api/v1.0.0 https://github.com/dazeGG/VoiceRoom.git
cd VoiceRoom
git fetch --depth 1 origin tag web/v1.0.0
```

In this block, replace only `voice.example.com`. If `.env` already exists, the block stops and keeps its contents.

```sh
(
  set -euC
  umask 077
  domain=voice.example.com
  api_sha=$(git rev-parse HEAD)
  web_sha=$(git rev-parse 'web/v1.0.0^{commit}')
  postgres_password=$(openssl rand -hex 32)
  livekit_key=$(openssl rand -hex 16)
  livekit_secret=$(openssl rand -hex 32)
  gate_secret=$(openssl rand -hex 32)
  cursor_key=$(openssl rand -hex 32)

  cat > .env <<EOF
DOMAIN=$domain
POSTGRES_PASSWORD=$postgres_password
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
LIVEKIT_GATE_SECRET=$gate_secret
VOICE_ROOM_CURSOR_HMAC_KEYS=$cursor_key
VOICEROOM_API_IMAGE=ghcr.io/dazegg/voiceroom-api:$api_sha
VOICEROOM_WEB_IMAGE=ghcr.io/dazegg/voiceroom-web:$web_sha
EOF
)
```

Save `.env` in a private backup. Compose derives `LIVEKIT_DOMAIN` and `ADMIN_DOMAIN` from `DOMAIN`. If you chose other names, add them to `.env` explicitly.

```sh
docker compose config --quiet &&
  docker compose pull &&
  docker compose up -d --wait
```

Open `https://voice.example.com/app`, create a room and check sound with another person in both directions. If the page opens but the call does not connect, check DNS for the LiveKit name and whether `7882/UDP` and `7881/TCP` are reachable from outside. For networks that allow only web traffic, see [TURN/TLS setup](#turntls-on-443).

```sh
docker compose ps -a
curl -fsS https://voice.example.com/api/healthz
docker compose logs --tail=100 caddy migrate api livekit livekit-gate
```

The admin app and the widget are published separately after Caddy has started. For each
component you need, download the archive from its release. Example for the widget, with the GitHub CLI:

```sh
git fetch --depth 1 origin tag widget/v1.0.0
gh release download widget/v1.0.0 --repo dazeGG/VoiceRoom --pattern voiceroom-widget-1.0.0.tar.gz
gzip -dc voiceroom-widget-1.0.0.tar.gz |
  bash scripts/cd/publish-client.sh "$PWD" widget "$(git rev-parse 'widget/v1.0.0^{commit}')"
```

For the admin app, replace `widget` with `admin` in the tag, the archive name and the publish command.

## Environment and secrets

`.env`, `.env.*` and any real environment values are not stored in Git. For a local run, create `.env` by hand from a protected source: a password manager, a server vault or a private note of the project owner. Use GitHub Secrets/Variables for CI/CD and protected deploy environments. After a secret is saved, GitHub does not show the secret value back, so this is not a convenient source for local copying.

### Where to store values

The GitHub equivalent of GitLab CI/CD variables is here:

1. Repository → **Settings** → **Secrets and variables** → **Actions**.
2. For production/staging, prefer **Environments**: `production`, `staging`.
3. Put secrets in **Secrets**, and ordinary settings in **Variables**.

**Secrets** are values that must not appear in logs or pull requests:

| Name | Where needed | Comment |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | docker compose / production | PostgreSQL password. |
| `DATABASE_URL` | API host-only / non-compose deploy | Full PostgreSQL URL. In compose it is usually built from `POSTGRES_*`. |
| `TEST_DATABASE_URL` | Local/external API tests | Admin-capable PostgreSQL URL for the test harness. **Not needed** in CI: the workflow starts an ephemeral Postgres service and sets the URL itself. |
| `LIVEKIT_API_KEY` | API / LiveKit | LiveKit key. |
| `LIVEKIT_API_SECRET` | API / LiveKit | LiveKit secret. Generate a random value. |
| `LIVEKIT_GATE_SECRET` | API / LiveKit gate | A separate random secret of at least 32 characters. It must not match `LIVEKIT_API_SECRET`. |
| `VOICE_ROOM_CURSOR_HMAC_KEYS` | API production | Stable cursor-signing key. A fresh install can use a separate `openssl rand -hex 32` value. |
| `VAPID_PRIVATE_KEY` | API / Web Push | Private half of a stable VAPID pair. Never publish it or store it in Git. |
| `RUSTORE_PUSH_SERVICE_TOKEN` | API and notification worker / RuStore Push | Service key of the push-notification project from the RuStore console. Never publish it or store it in Git. |
| `GITHUB_TOKEN` | API desktop release endpoint, optional | Needed only if you want to raise the GitHub API limit. |
| `POW_SECRET` | API production/staging, optional | Stable secret for the proof-of-work challenge. If it is unset, one is generated per process and challenges are invalidated on restart. |

**Variables** are not secrets, but they are environment-specific settings:

| Name | Default/example | Comment |
| --- | --- | --- |
| `DOMAIN` | `voice.example.com` | Public VoiceRoom domain. By default it also serves the web app. |
| `APP_DOMAIN` | optional | Separate web-app host. Set it after DNS is configured and links and clients have been checked. |
| `DOCS_DOMAIN` | optional | Separate host for the static documentation. Set it after DNS is configured. |
| `LIVEKIT_DOMAIN` | `livekit.${DOMAIN}` | LiveKit domain. |
| `LIVEKIT_GATE_PUBLIC_URL` | `wss://livekit.example.com` | Public browser-facing auth-gate URL. By default it is built from `LIVEKIT_DOMAIN`. |
| `LIVEKIT_INTERNAL_URL` | `ws://livekit:7880` | Internal LiveKit SFU address for the API when it is not started with the production compose. Production compose fixes the service URL itself. |
| `LIVEKIT_METRICS_URL` | `http://livekit:6789/metrics` | LiveKit Prometheus metrics, which the API records once a minute for the «Система» (System) page in the admin app: traffic, packet loss in both directions, retransmissions, and LiveKit CPU and memory. Production compose sets the address inside its own network itself; without it these charts are empty. |
| `LIVEKIT_URL` | optional | Legacy fallback for a host/dev run. In production do not use it as the public URL; set `LIVEKIT_GATE_PUBLIC_URL`. |
| `LIVEKIT_PUBLIC_URL` | optional | For dev compose, if the external LiveKit port differs. |
| `TRUST_PROXY` | `true` in compose/proxy | Turn on only behind a trusted reverse proxy. |
| `LOG_LEVEL` | `info` in production compose | API JSON log level (`debug`, `info`, `warn`, `error`; `silent`/`off` turn logging off). Health-check requests are not written to the request log. |
| `LIVEKIT_TOKEN_TTL_SECONDS` | `600` | LiveKit JWT TTL. It is needed only for the time it takes to join: LiveKit itself renews the token for a connected participant, so a short TTL limits the life of a leaked token. |
| `LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS` | `21600` | Auth-gate pass TTL. The pass is revoked on the server (kick/ban/mute/leave) and is needed for resume and for reconnects inside a call. |
| `LIVEKIT_ROSTER_WAIT_MS` | `5000` | How long `/api/livekit-token` waits for the participant's realtime join to reach the room roster. A token is issued only to a roster participant. |
| `TURN_ENABLED` | `false` | Turns on TURN/TLS on the shared `:443` and TURN/UDP on `3478` (see "TURN/TLS on 443"). |
| `TURN_DOMAIN` | empty | TURN DNS name, required when `TURN_ENABLED=true`. |
| `LIVEKIT_MAX_PARTICIPANTS` | `24` | Participant limit on the SFU side — a backstop on top of `MAX_ROOM_PEERS`, with room for reconnects. Keep it at least `2 × MAX_ROOM_PEERS`, or LiveKit refuses entry before the API does. |
| `LIVEKIT_ROOM_PREFIX` | `voice-room-` | Room id prefix in LiveKit. It must match between the API and the auth-gate: the gate checks the room in the JWT against the room in the pass. |
| `MAX_ROOM_PEERS` | `12` | Max peers per room. |
| `MAX_VOICE_PEERS` | `0` | How many people can be in voice on the whole server at once; `0` means no limit. Over the limit a new participant gets `server.full` («Сервер сейчас заполнен» (The server is now full)), while people already in a call, and reconnects, are unaffected. For a value for this host, see "Server capacity". |
| `MEDIA_BUDGET_MBPS` | `0` | Video budget for the whole server, Mbit/s; `0` means no limit. Each screen share and each camera costs its bitrate multiplied by the number of other people in the room (1080p60 is 10 Mbit/s per viewer, 720p30 is 5, a camera is 0.45). Before starting, the client asks the server (`room.media.request`): when the budget is taken, a share is offered a lower quality (720p at the same frame rate, then fewer frames), and if that still does not fit, the share or the camera is refused. Streams already running are left alone. The check happens at the moment of start, so a new stream is charged for a room of at least 9 people: the room can grow after it starts. Beyond this, `LIVEKIT_LIMIT_BYTES_PER_SEC` is the backstop, together with the fact that under overload LiveKit sacrifices video rather than voice. Cameras from clients older than this version are not counted in the budget. |
| `MEDIA_BUDGET_VOICE_PEERS` | `0` | At how many people in voice on the server the video budget runs out; `0` means voice does not reduce the budget. Voice and video share the LiveKit CPU, and when it is short LiveKit keeps voice, so a server busy with voice breaks streams well before its own limits. The budget shrinks linearly: at half this number of people, half of `MEDIA_BUDGET_MBPS` remains. |
| `MAX_ROOM_SCREENS` | `0` | How many screen shares can run in one room at the same time; `0` means no limit. |
| `MAX_ROOMS` | `100` | Limit of live temporary rooms. Persistent rooms are not included: they are limited by `MAX_STATIC_ROOMS_PER_USER`. |
| `LIVEKIT_MEMORY_LIMIT` | `0` | Memory limit of the LiveKit container (`2500m`); `0` means no limit. Without it, running out of memory on a host with no swap hangs the whole server. With it, the OOM killer restarts only LiveKit. |
| `LIVEKIT_LIMIT_BYTES_PER_SEC` | `0` | LiveKit backstop on top of `MAX_VOICE_PEERS`: when media traffic (in + out) exceeds this many bytes per second, new joins get 503 and calls already in progress stay. `0` turns it off. |
| `MAX_EMPTY_ROOMS_PER_IP` | `3` | Legacy limit of temporary empty rooms per IP. |
| `MAX_TEMP_ROOMS_PER_IP` | optional | New explicit limit of temporary rooms per IP. |
| `MAX_STATIC_ROOMS_PER_USER` | `3` | Limit of persistent rooms per account. |
| `ROOM_IDLE_TTL_MS` | `900000` | TTL of an empty dynamic room. |
| `ROOM_PRUNE_INTERVAL_MS` | `60000` | Interval of soft-cleanup for expired messages / idle dynamic rooms. |
| `RETENTION_PURGE_INTERVAL_MS` | `3600000` | Interval of physical deletion of old soft-deleted rows. `0` turns purge off. |
| `RETENTION_KEEP_DELETED_MS` | `2592000000` | How long to keep soft-deleted rows before hard-delete. |
| `LINK_PREVIEWS_ENABLED` | `false` (in `docker-compose.yml` — `true`) | Preview of the first link in a message. The API itself opens the page only on the public internet (http/https on ports 80 and 443, with no internal addresses on any redirect), takes the title, description and image, and stores the image in `uploads/link-previews`, so readers download nothing from the third-party site. |
| `ROOM_CHAT_RATE_LIMIT` | `60` | Room chat rate limit. |
| `ROOM_CHAT_RATE_WINDOW_MS` | `60000` | Room chat rate window. |
| `UPLOADS_DIR` | `apps/api/uploads` (host) / `/data/uploads` (compose) | Directory of normalized WebP avatars. In production it must sit on a persistent volume. |
| `ROOM_CREATE_POW_DIFFICULTY` | `14` | Proof-of-work difficulty. For dev/test, `0` is allowed. |
| `ROOM_CREATE_POW_TTL_MS` | `120000` | Proof-of-work TTL. |
| `ROOM_CREATE_RATE_LIMIT` | `20` | Room create rate limit. |
| `ROOM_CREATE_RATE_WINDOW_MS` | `60000` | Room create rate window. |
| `SESSION_TTL_MS` | `2592000000` | Session lifetime. |
| `SESSION_COOKIE_SECURE` | auto in production | Usually leave unset; true under HTTPS/prod. |
| `AUTH_RATE_LIMIT` | `30` | Auth rate limit. |
| `AUTH_RATE_WINDOW_MS` | `60000` | Auth rate window. |
| `LOGIN_FAILURE_LIMIT` | `10` | Sign-in attempts per login per window, from any address (an attempt counts before the password is checked, and a successful sign-in resets the counter). The trade-off: guessing can lock sign-in to someone else's account for the window; recovery by code still works. |
| `LOGIN_FAILURE_WINDOW_MS` | `900000` | Window of the failed-sign-in counter per login. |
| `DM_RATE_LIMIT` | `30` | DM send rate limit per user. |
| `DM_RATE_WINDOW_MS` | `10000` | DM rate window. |
| `FRIEND_REQUEST_RATE_LIMIT` | `20` | Friend request rate limit per user. |
| `FRIEND_REQUEST_RATE_WINDOW_MS` | `60000` | Friend request rate window. |
| `AVATAR_UPLOAD_RATE_LIMIT` | `10` | Maximum avatar uploads per account per window. |
| `AVATAR_UPLOAD_RATE_WINDOW_MS` | `60000` | Avatar-upload rate-limit window. |
| `MAX_REALTIME_STREAMS_PER_USER` | `8` | Max concurrent WebSocket streams per authenticated user. |
| `MAX_GUEST_STREAMS_PER_IP` | `8` | Max concurrent guest WebSocket streams per client IP. |
| `MAX_ROOM_BANS` | `100` | Maximum active bans on a persistent room. |
| `PLATFORM_ADMIN_USER_IDS` | empty | Comma-separated account ids that are always superadmins of the admin app. A superadmin gives everyone else their roles (moderator, administrator, superadmin) in the «Сотрудники» (Staff) section. Empty, and with no roles granted, nobody can open the admin app, and reports pile up unreviewed. See `docs/LEGAL.md`. |
| `ADMIN_DOMAIN` | `admin.${DOMAIN}` | Admin app domain (`apps/admin`). It needs an A/AAAA DNS record pointing at this server, as `DOMAIN` does; Caddy obtains the certificate itself. Without the record the main site works, and the admin app simply does not open. The API receives `SITE_ORIGIN` and `ADMIN_ORIGIN` from compose; you do not set them. |
| `REPORT_RATE_LIMIT` / `REPORT_RATE_WINDOW_MS` | `10` / `60000` | Limit of reports from one account per window. |
| `CALL_FEEDBACK_RATE_LIMIT` / `CALL_FEEDBACK_RATE_WINDOW_MS` | `5` / `600000` | Limit of «Как прошёл звонок?» (How was the call?) answers from one account (a guest, from one address) per window. |
| `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | empty | Public half and contact for Web Push. Together with the secret `VAPID_PRIVATE_KEY` they form the full VAPID config. If any value is missing, push turns off without stopping the API. |
| `RUSTORE_PUSH_PROJECT_ID` | empty | RuStore push-notification project id for the Android app. Together with `RUSTORE_PUSH_SERVICE_TOKEN` it turns on push delivery to the app. If either value is empty, delivery to the app is off and Web Push works as before. A debug build and a release build are different projects in the console. |
| `ANDROID_MIN_VERSION` | empty | Minimum supported Android app version (`x.y.z`). An older app receives 426 `client_outdated` on any API request, its WebSocket closes with code 4426, and calls (Ring) do not reach it. Other pushes still arrive, because the token's version is updated only when the app starts. The app shows the «Обновите приложение» (Update the app) screen. The threshold is read from `GET /api/client/policy`. Empty means no restriction. An invalid format means the API and the worker do not start. |
| `MAX_PUSH_SUBSCRIPTIONS_PER_USER` | `10` | Maximum retained Web Push subscriptions per account, and separately the Android app's push tokens; older entries are pruned transactionally. |
| `PUSH_SUBSCRIPTION_RATE_LIMIT` | `20` | Maximum Web Push subscription create/delete mutations per account per window. |
| `PUSH_SUBSCRIPTION_RATE_WINDOW_MS` | `60000` | Web Push subscription mutation rate-limit window. |
| `RING_RATE_LIMIT` / `RING_RATE_WINDOW_MS` | `1` / `30000` | Limit of Ring invitations from one user to another per window. |
| `RING_TTL_MS` | `30000` | Lifetime of a Ring invitation in realtime, in a toast and in Web Push. |
| `WS_MAX_PAYLOAD_BYTES` | `65536` | Max inbound WebSocket frame payload. |
| `HOST` | `127.0.0.1` | Host for host-only API. Compose sets `0.0.0.0`. |
| `PORT` | `3000` | API port. |
| `SOCKET_PATH` | empty | Unix socket instead of TCP, when one is needed. |
| `API_METRICS_ALLOWED_REMOTE` | `127.0.0.1` | Caddy allowlist for the public path `/api/metrics`. Set the address or range from which metrics are collected, or the endpoint is closed from outside. Several addresses are separated by a space. |
| `CANONICAL_HOST` | `voiceroom.ru` | The only host search engines may index. On any other host (a dev stand, your own copy) Caddy adds `X-Robots-Tag: noindex` to every response. The public site (`apps/site`) points canonical addresses at `https://voiceroom.ru`. For your own copy that should be indexed, set your domain here and change `SITE_ORIGIN` in `apps/site/src/site.ts`. |
| `ANDROID_RELEASE_CERT_SHA256` | empty | SHA-256 fingerprint of the Android app signing key (`AA:BB:…`, 32 bytes, uppercase, separated by colons; hexadecimal digits and colons only, or Caddy will not load the config). From it, Caddy serves `/.well-known/assetlinks.json` for the package `voiceroom.app`, and links `https://<DOMAIN>/r/<id>` open in the app. Empty or an invalid format means 404. On a dev stand, set the debug-key fingerprint: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`. |
| `DESKTOP_RELEASE_REPO` | `dazeGG/VoiceRoomDesktop` | Repo for the latest desktop release. |
| `DESKTOP_RELEASE_CACHE_MS` | `600000` | Cache TTL for desktop release metadata. |
| `GEOIP_DB_PATH` | empty (host) / `/data/geoip/dbip-city-lite.mmdb` (compose) | Local [DB-IP City Lite](https://db-ip.com) database (CC BY 4.0) for the city and country in the device list. Download it with `node scripts/geoip/fetch-dbip-city-lite.mjs geoip/dbip-city-lite.mmdb` into the deploy directory. Update it once a month. `api` picks up the new file on the next lookup, without a restart. Without the file, the device list is shown without a city. |

Integer API environment variables (limits, TTLs, intervals) must be integers: if a variable is set but is not an integer (or is below the allowed minimum), the API does not start, and it does not fall back to the default. An unset or empty variable still takes the default from the tables above.

### Overriding dev values (optional)

For dev compose, `.env` is **not required** — `docker-compose.dev.yml` sets every needed value with defaults (`devkey`/`devsecret` for LiveKit, local PostgreSQL, POW and the create rate limit off). The LiveKit service receives `LIVEKIT_KEYS` from the same variables as the API, so the keys always match and voice works out of the box.

`.env` is needed only to override something (for example, ports that are taken, or an external LiveKit). Create it locally and do not commit it:

```dotenv
# Any of these lines is optional — set only what you change.
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
VAPID_PUBLIC_KEY=<stable-public-key>
VAPID_PRIVATE_KEY=<stable-private-key>
VAPID_SUBJECT=mailto:admin@example.com
POSTGRES_PASSWORD=<local-random-password>
POSTGRES_PORT=5432
WEB_PORT=5180
API_PORT=3000
```

Web Push needs all three `VAPID_*` values. Create a stable pair once with
`npx web-push generate-vapid-keys --json`, store it in a protected source and use
the same pair across restarts and deploys. The private key must not be committed.

For a host-only API, add `DATABASE_URL`, because outside compose it is not assembled automatically:

```dotenv
DATABASE_URL=postgres://voice_room:<local-random-password>@127.0.0.1:5432/voice_room
```

### Minimum production set

The first production Compose start needs:

```text
DOMAIN
POSTGRES_PASSWORD
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
LIVEKIT_GATE_SECRET
VOICE_ROOM_CURSOR_HMAC_KEYS
VOICEROOM_API_IMAGE
VOICEROOM_WEB_IMAGE
```

`LIVEKIT_DOMAIN` defaults to `livekit.${DOMAIN}`. The API image is also used by
the workers, migrations and the LiveKit gate. `VOICEROOM_WORKER_IMAGE` stays an optional
override for stacks already deployed, and for rollback. Use Compose from
the API release and a compatible Web release.

`DATABASE_URL` in compose is assembled automatically from `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and the service name `postgres`. If the deploy is not through compose, set `DATABASE_URL` explicitly as a secret.
If Web Push is intentionally unused, `VAPID_*` can be omitted — the API keeps working,
but `/api/push/config` returns `enabled: false` and the client turns off the push-notification switch.

## CI/CD (GitHub Actions)

The pipeline is described in `.github/workflows/ci.yml`. Checks run for a pull request into `develop` and `main`. After a push to `develop`, a repeat application CI run is skipped if a successful pull request into `develop` already checked the same Git tree on the same base. A direct push, a changed base, or a missing confirmation runs the full set of application checks for the push. The site and the documentation are checked and built by the components they touch. Production tags and the publication order are described in [`GIT_FLOW.md`](./GIT_FLOW.md).

- **policy** checks that the pull request follows an allowed Git Flow route and that the pull request title is in Conventional Commit form.
- **check** runs `npm ci`, `npm run check` (tsc, vue-tsc, ESLint and Prettier for shared, api and web) and `npm run build` (Vite).
- **test** runs shared and API tests against an ephemeral PostgreSQL service container. On a pull request the same run collects G08 coverage and checks the thresholds for the changed code. CI runs the API tests at parallelism 4, and each integration test gets a copy of the template database. **test-web** runs the web tests (Vitest) as a separate job in parallel with the API. `TEST_DATABASE_URL` is set in the workflow itself to a one-time value — a secret is **not needed** for this (the test harness creates and deletes a temporary database for each test).
- **voice-join** checks joining a voice room through LiveKit.
- **G05** is the strict LiveKit profile.

After the checks of application changes on `develop`, API, Web, Admin
and Widget are rolled out to dev. In production, `api/v*` rolls out the API, the workers, the LiveKit gate and migrations,
and `web/v*` updates the Caddy image that contains Web. `admin/v*` and `widget/v*` switch
that component's artifact and reload the Caddy configuration. `meet/v*`
publishes only the personal kit for self-installation.

Caddy loads HTML and CSP from one release directory. Hashed Admin
and Widget files stay available after publication, including for widget
loaders that were already handed out. Web keeps the previous 30-day chunk archive.
Proxied WebSocket connections may reconnect when the Caddy
configuration is reloaded.

`scripts/cd/remote-deploy.sh` rolls images out over SSH. On an API rollout
it saves `.env` and a `pg_dump` into `deploy-backups/ci/` and updates Compose from
the API tag. For Web, the script saves `.env` and changes the Caddy image. If the rollout
fails, the script checks that rollback is compatible and restores the previous settings
and the affected services. Restore the database from the dump by hand if you need to.
CI keeps the five most recent copies. Dumps and `.env` copies older than 30 days are deleted
from `deploy-backups/ci/` and `deploy-backups/manual/`.

Roll the API out first if the client needs its changes. Keep
compatibility between the current and the previous version of the API and of each client.
Migrations are part of the API release. Change `packages/shared` contracts so they stay
compatible with old clients, including tabs that are already open.

Each environment keeps its own secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY` and variables `DEPLOY_PATH`, `SSH_FINGERPRINT` (the host's ED25519 fingerprint; if it does not match, the deploy does not start). The server `.env` (at least `DOMAIN`, `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_GATE_SECRET`, `VOICE_ROOM_CURSOR_HMAC_KEYS`) lives on the server, not in Actions.

Other recommendations:

- On protected branches, turn on required reviewers. Make `policy`, `check` and `test` required checks for pull requests into `develop` and `main`.
- Do not print secrets in workflow logs. Pass them through `with:`/`env:` only into the jobs and steps that need them.

### Static site and documentation

Caddy serves the public site from `static/site/current` and documentation from
`static/docs/current` in the deploy checkout. The static publication workflow uploads
the built files and atomically points `current` at `releases/<commit>`. Publishing static
files leaves the running containers and database in place. The first application
rollout copies the public site out of the legacy Caddy image when a site release has
yet to be published.

To add the public landing page to a self-hosted instance, build and publish the site files:

```bash
npm ci
npm --workspace @voice-room/site run build
tar -cf - -C apps/site/dist . | bash scripts/cd/publish-static.sh "$PWD" site "$(git rev-parse HEAD)"
```

To serve documentation, add its DNS record and set `DOCS_DOMAIN` in Compose. Supply
the build from `apps/docs/dist` using the same publisher with `docs` as the component.
For the hosted project, the static workflows use the existing `dev` and `production`
environments and their SSH settings. Set the environment's `DOCS_URL` or `SITE_URL` if
the public health check for that dev component should use a custom URL.

Set `APP_DOMAIN` after verifying the new host's TLS, sign-in, voice, admin handoff and
native clients. Existing sessions remain scoped to the old host and users sign in
again at the new host. The public widget loader and frame keep the public site's
origin. Leave both optional hosts unset for an installation using only the public
domain.
## Migrations

```bash
npm --workspace @voice-room/api run db:migrate
npm --workspace @voice-room/api run db:rollback
```

`DATABASE_URL` is the main store of rooms, messages and accounts. In production, migrations are applied by a one-shot `migrate` service before `api` starts, and the API only checks that the schema is ready. Outside production the API applies migrations itself on startup (`MIGRATE_ON_START`). For compose you do not have to set `DATABASE_URL` explicitly: it is assembled from `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and the service name `postgres`.

The `migrate` service takes the repository advisory lock with a timeout of 5 seconds, marks the run `running`, runs the migrations in order in one transaction, checks that it still holds the lock, and marks the run `clean`. An error or a lost lock leaves the mark `dirty`, and the production API will not start with it. A diagnosed mark can be cleared only by the explicit `--clear-dirty` command, which also needs the lock. In production, `--no-lock`, automatic migrations on API startup and down-migrations are forbidden: a rollback is the previous application image on the already-expanded schema.

## Docker

Production diagnostics must outlive containers. Install and verify the isolated,
bounded host journal profile in [`LOGGING.md`](./LOGGING.md#storage-across-deployments)
before activating the production retention policy. It survives deploys/rollbacks;
the portable JSON-log fallback below does not. First activation also recreates
LiveKit, so schedule it with no active calls. No Docker daemon restart is needed.

Production compose runs the `api`, `worker` and `web` images from one Dockerfile:

- `postgres` — PostgreSQL with the `postgres_data` volume and a healthcheck;
- `migrate` — a one-shot migration run before the other services start;
- `api` — the Node.js API on `:3000`. It stores avatars in the `uploads` volume, attachments in the `media` volume, and answers only `/api/*`;
- workers `message-delivery`, `notification-delivery`, `media-processing`, `media-maintenance` and `media-reconciliation` — message and notification delivery, and media processing;
- `caddy` — the frontend static build from `apps/web/dist`, a reverse proxy for `/api/*` and a separate reverse proxy for the LiveKit domain. It keeps JS chunks from previous releases in the `web_archive` volume for 30 days, so tabs that were open before the rollout keep working;
- `livekit` — the LiveKit SFU, and `livekit-gate` — the auth-gate in front of it (see [`LIVEKIT_GATE.md`](./LIVEKIT_GATE.md)).

Start after `.env` is prepared:

```bash
docker compose config --quiet
docker compose up -d --wait
```

Stop the stack:

```bash
docker compose stop
```

Dev compose through npm scripts:

```bash
npm run dev       # foreground
npm run dev:up    # background
npm run dev:logs
npm run dev:down
```

It publishes Vite on `127.0.0.1:${WEB_PORT:-5180}`, the API on `${API_PORT:-3000}`, PostgreSQL on `${POSTGRES_PORT:-5432}` and LiveKit on `7880/7881/7882`. Inside compose, Vite proxies `/api` to `http://api:3000`. Outside compose the defaults stay host-local. If you change `LIVEKIT_HTTP_PORT`, also set the browser-facing `LIVEKIT_PUBLIC_URL` (for example `ws://localhost:17880`), because that is the value the API gives the client.

For Docker/production, use a separate prod-like `.env`: browsers connect to `LIVEKIT_GATE_PUBLIC_URL` (by default `wss://$LIVEKIT_DOMAIN`), and the API talks to the SFU at the internal `ws://livekit:7880` fixed in compose. Do not set the public address through the legacy variable `LIVEKIT_URL`: an old value may remain in `.env`, but the production API no longer uses it instead of the internal service URL.

In production the application must sit behind HTTPS, the `postgres_data` and `uploads` volumes must be backed up as one consistent set, and LiveKit must have publicly reachable ICE/TCP and ICE/UDP ports. `postgres_data` contains the avatar keys, and `uploads` contains the matching WebP files. Losing either volume makes the backup incomplete. For a file copy of the volumes, stop both services that change them (`docker compose stop api postgres`), save `postgres_data` and `uploads`, then start Postgres, wait until it is healthy, and start the API. If Postgres cannot be stopped, stop the API, take a consistent `pg_dump`/`pg_basebackup`, archive `uploads` separately while it is not changing, and only then start the API again. The alternative is an atomic snapshot of both volumes at the storage level. Chat attachments live in the `media` volume.

A consistent media backup is a PostgreSQL dump together with the uploads tree. Half of the pair cannot be restored. Take the dump while media writes are stopped, and build the snapshot:

```sh
node scripts/backup/create-coordinated-snapshot.mts --database /safe/input/database.dump --uploads /safe/input/uploads --catalog /safe/input/media-catalog.json --output /safe/archive/snapshot-001 --namespace restore-drill-001
```

The script copies both parts into one directory and writes their sizes and SHA-256 into `manifest.json`. Restore only into a new directory inside an isolated root. The command checks paths, sizes and hashes, and it refuses a symlink, an existing target or an incomplete pair:

```sh
node scripts/restore/restore-coordinated-snapshot.mts --snapshot /safe/archive/snapshot-001 --allowed-root /tmp/voice-room-restore-drill --target /tmp/voice-room-restore-drill/restored --namespace restore-drill-001
```

The catalog (`--catalog`) contains `attachments` with `id`, `state`, `access`, `width`, `height` and a `leases` array. On restore, every captured `leased` task returns to `pending` with no owner, and `restore-report.json` records how many. After `pg_restore`, compare the catalog with the database rows before the first worker starts, and make sure cleanup and processing continued with no duplicate attachments. For users behind strict corporate networks, enable TURN (the section below).

### TURN/TLS on 443

Without TURN, media travels only over UDP `7882` and TCP `7881`. Networks where only 80/443 are open (offices, hotels, schools) will not connect voice at all. LiveKit's built-in TURN covers this case, and it does not need a separate IP: Caddy (built with `caddy-l4`) watches TLS SNI on the shared `:443`, decrypts connections to `TURN_DOMAIN` and forwards them to LiveKit on `5349`, and everything else goes to the sites as before.

1. Create a DNS record for `TURN_DOMAIN` (for example `turn.example.com`) pointing at this host.
2. In `.env`: `TURN_ENABLED=true` and `TURN_DOMAIN=turn.example.com`. Caddy obtains the certificate for that name itself.
3. Open `3478/udp` (TURN/UDP) and `30000-30099/udp` (relay ports: relayed media returns to the node's IP) on the host.
4. Check: open a room with `?forceRelay=1`. Media then goes only through TURN, the voice-status hint must say «через ретранслятор» (via repeater), and sound must pass.

If relay through the Docker bridge does not work (hairpin NAT to the node's public IP depends on the host), the next step is `network_mode: host` for the `livekit` service.

### Extra sites through Caddy

VoiceRoom's Caddy is the only process listening on 80/443, so other sites on the same host can be served through it without rebuilding the image. Put `<name>.caddy` in `config/caddy/sites.d` on the host (these files are not in git, and deploy does not touch them). The file is included at the top level of the Caddyfile. These are ordinary site blocks:

```caddy
app.example.com {
  reverse_proxy my-app:8080
}
```

The domain's DNS record must point at this host, and the upstream container must share a Docker network with Caddy, for example by joining the external network `voiceroom_default`. A syntax error stops Caddy, so validate first, then apply:

```bash
docker compose exec caddy voiceroom-prepare-web validate
docker compose exec caddy voiceroom-prepare-web reload
```

The directory is mounted read-only. While it contains no `*.caddy`, Caddy works as before.

### Dev stand on the production host

The permanent dev stack uses `/home/daze/VoiceRoom-dev` on the production host,
with Compose project `voiceroom-dev`. It has independent PostgreSQL, uploads,
media, web archives and secrets. Production data is never copied into dev.
The production Caddy terminates HTTPS for the dev site, app, docs, admin and
LiveKit hosts. Their A records point at the same host. The inner Caddy serves
HTTP without publishing host ports.

Use this non-secret part of the dev `.env`, plus fresh independent values for
`POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`LIVEKIT_GATE_SECRET`, `VOICE_ROOM_CURSOR_HMAC_KEYS` and `POW_SECRET`:

```dotenv
COMPOSE_PROJECT_NAME=voiceroom-dev
COMPOSE_FILE=docker-compose.yml:docker-compose.behind-edge.yml
DOMAIN=dev.voiceroom.ru
APP_DOMAIN=app.dev.voiceroom.ru
DOCS_DOMAIN=docs.dev.voiceroom.ru
ADMIN_DOMAIN=admin.dev.voiceroom.ru
LIVEKIT_DOMAIN=livekit.dev.voiceroom.ru
LIVEKIT_RTC_TCP_PORT=7891
LIVEKIT_RTC_UDP_PORT=7892
LIVEKIT_TURN_UDP_PORT=3488
LIVEKIT_RELAY_PORT_FIRST=30100
LIVEKIT_RELAY_PORT_LAST=30119
LIVEKIT_METRICS_PORT=6790
TURN_ENABLED=false
MAX_ROOMS=10
MAX_ROOM_PEERS=6
MAX_VOICE_PEERS=12
```

Set the API and Web image references to compatible builds. Dev CI builds both
from the tested commit.
The overlay caps each service's memory and CPU, gives it a lower CPU
weight than production (`cpu_shares: 256`, about a third of the default under
cgroup v2) and raises its OOM score. It places every service in the
`guests.slice` systemd slice, shared with the host's other guest stacks. The
host's `/etc/systemd/system/guests.slice` caps that slice as a whole:

```ini
[Unit]
Description=Guest stacks on the VoiceRoom host: VoiceRoom dev, bang, rw-max-bot

[Slice]
CPUWeight=30
CPUQuota=120%
MemoryHigh=1800M
MemoryMax=2G
```

Without the unit file systemd creates the slice with no caps. The overlay
uses the Caddyfile from the Web image and mounts `behind-edge.headers` for the
outer proxy's forwarded address contract.
The dev media ports must be allowed by the host/provider firewall. TURN/TLS on
443 remains production-only; dev uses direct ICE on 7891/TCP and 7892/UDP.

Create the external `voiceroom-edge` Docker network once. Attach only the two
Caddys to it; do not attach dev services to `voiceroom_default`, where service
names would collide. On the production host, keep this ignored file as
`docker-compose.edge.yml`:

```yaml
services:
  caddy:
    networks:
      default:
      edge:
networks:
  edge:
    name: voiceroom-edge
    external: true
```

Preserve production's logging overlay by setting its `.env` to
`COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.edge.yml`.
For first activation, `docker network connect voiceroom-edge <prod-caddy-id>`
attaches the running Caddy without restarting it. The overlay preserves that
membership when a future deployment recreates it.

Add `config/caddy/sites.d/voiceroom-dev.caddy` in the production checkout:

```caddy
dev.voiceroom.ru, app.dev.voiceroom.ru, docs.dev.voiceroom.ru, admin.dev.voiceroom.ru, livekit.dev.voiceroom.ru {
  reverse_proxy voiceroom-dev-edge:80 {
    header_up X-VoiceRoom-Client-IP {remote_host}
  }
}
```

Validate and reload Caddy using the commands above. The outer edge replaces
the dedicated client-IP header; the inner edge converts it to a single trusted
`X-Forwarded-For` value and removes the dedicated header before proxying.
This preserves per-client rate limits through both proxies, including when a
client supplies spoofed forwarding headers.

The GitHub `dev` environment needs its own `SSH_HOST`, `SSH_USER`, `SSH_KEY`,
`DEPLOY_PATH=/home/daze/VoiceRoom-dev` and the production host's verified
`SSH_FINGERPRINT`. Once the CI change reaches `develop`, successful pushes
publish images and call the existing deployment workflow. The first bootstrap
uses `docker compose up -d --wait`; later rollouts use `remote-deploy.sh`, which
first backs up this stack's database and environment. Its image cleanup keeps
both current and previous releases of every detected stack and only prunes
untagged images globally. Rollouts sharing the same deploy account also hold
`~/.cache/voiceroom/deploy.lock` to serialize pulls and cleanup. Both dev and production deployment workflows must
use this corrected cleanup before either is allowed to clean the shared host.

Check `https://dev.voiceroom.ru/api/healthz`, the admin host, LiveKit gate,
container health, resource limits and production health after activation.
Stop only dev with `cd /home/daze/VoiceRoom-dev && docker compose stop`;
`docker compose down` also removes its containers/network but preserves data
volumes unless explicitly passed `--volumes`.

### UDP buffers for LiveKit

All LiveKit media goes through one UDP socket (`7882`). The Ubuntu kernel gives a socket 212 KB by default (`net.core.rmem_max`), and LiveKit writes at startup `UDP receive buffer is too small for a production set-up`. Under load that buffer overflows, and incoming packets from publishers are dropped before they reach the SFU. Raise the limits on the host (the settings are not part of the network namespace, so they are set on the host, not in compose):

```bash
printf 'net.core.rmem_max=16777216\nnet.core.wmem_max=16777216\n' | sudo tee /etc/sysctl.d/90-livekit-udp.conf
sudo sysctl --system
docker compose restart livekit
```

After the restart, `docker compose logs livekit` must not contain the warning. On a load test this doubled the number of rooms with cameras and no loss (from 8 to 16 full rooms): without the buffers, dropped publisher packets caused a storm of retransmissions and keyframes.

### Server capacity

Load test on a copy of the host with 2 vCPU (AMD Ryzen 9 9950X) and 4 GB, no swap (`scripts/load/README.md`, October 2026):

| Load | Limit without loss | What runs out first |
| --- | --- | --- |
| Voice, rooms of 9 | ~1100 participants (125 rooms), CPU 92 % | CPU |
| Voice, rooms of 16–24 | ~800 participants | memory (~2 MB per participant in LiveKit) |
| 1080p60 screen share (~10 Mbit/s per viewer) | ~70 viewers | CPU on packet forwarding, ~1 Gbit/s outbound |
| 720p30 screen share (~6 Mbit/s per viewer) | ~130 viewers | the same |
| Cameras for everyone, a 3×3 grid | ~70 participants, ~140 with the UDP buffers raised | CPU (without the buffers, on retransmissions of lost packets), then memory |

Rooms of 25 (a repeat test with these limits; 3 people in each voice room talk without pauses):

| Load | Without loss | Breaks |
| --- | --- | --- |
| Voice | 600 participants, CPU 80 %, loss 0.4 % | 750: loss 6 % |
| 1080p60 stream to 24 viewers | 2 rooms, 580 Mbit/s | 3 rooms: loss 17 % |
| 720p30 stream to 24 viewers | 3 rooms, 520 Mbit/s | 4 rooms: loss 6 % |
| 9 cameras for 25 viewers | 6 rooms | 8 rooms: loss 0.8 % |
| 226 in voice + a 1080p60 stream to 24 | no loss | — |
| 376 in voice + a 720p30 stream to 24 | — | the stream loses 33 %, voice 0 % |
| 200 in voice + two 1080p60 streams to 24 | — | the streams lose 28 %, voice 0 % |

Under overload, LiveKit sacrifices video first: voice next to collapsing streams loses 0–0.5 % of packets. That is why voice and video cannot be limited separately: a server with 400 people in voice breaks even one stream to a full room. Running out of memory, by contrast, drops everything: past ~1300 participants the OOM killer takes LiveKit, and a host with no swap does not answer even over SSH for minutes. For a host like this:

- `MAX_VOICE_PEERS=600`: voice in rooms of 25 holds 600 with almost no loss;
- `MEDIA_BUDGET_MBPS=550`, `MEDIA_BUDGET_VOICE_PEERS=480` and `MAX_ROOM_SCREENS=3`: on an empty server two full rooms with a 1080p stream fit, at 226 in voice one fits, and from 480 in voice there is no video at all. The formula admits every lossless step from the table and admits none of the broken ones;
- `MAX_ROOM_PEERS=25` and `LIVEKIT_MAX_PARTICIPANTS=50`: large rooms hold on voice, and the budget limits their streams;
- `MAX_ROOMS=300`: a room itself costs almost nothing, and the limit is only against spam;
- `LIVEKIT_MEMORY_LIMIT=2500m`, `LIVEKIT_LIMIT_BYTES_PER_SEC=110000000` (~880 Mbit/s in + out) as a backstop.

Recalculate another host with the same scenarios.

## Product analytics

The API writes three things for the dashboards:

- `voice_sessions` — one row per voice join: room, account or guest, join and leave, client, OS and browser, address key. How the voice went is stored minute by minute in `voice_session_samples`: the server's estimate of what every participant heard (good, unstable or bad; the admin app paints the call bars with this). The thresholds and why they were chosen are in `packages/shared/src/voice-quality.ts`. The city is not stored: it is visible only for people who are in a call right now;
- `user_activity_days` — which days the account was active, and from which client (the desktop app, a phone, a browser). A day is counted in Moscow time;
- `product_snapshots` — peaks of each quarter-hour: accounts online, guest connections, people and rooms in voice.

Per-person data is kept for 90 days (`VOICE_HISTORY_KEEP_DAYS`). Once a day the API folds older days into `product_days` counters and freezes each registration week's retention in `retention_weeks`, then deletes the activity marks and, on old voice joins, erases the account, the device, the room, the address key and the network data: only the time remains. `product_snapshots` peaks are anonymized and kept indefinitely.

Logs of every container are capped: `json-file`, 3 files of 10 MB per service (`x-logging` in `docker-compose.yml`). The cap applies when the container is recreated. The first deploy that includes it changes the configuration of every service, and `docker compose up -d` recreates all of them, including `livekit`: calls in progress break for a minute, so roll that release out when there are few calls. Later deploys leave `livekit` alone again.

The admin app shows them (`https://ADMIN_DOMAIN`, a link next to the logo for staff): the «Обзор» (Overview) and «Продукт» (Product) sections, for the administrator role and above. No separate dashboard and no outside access to the database are needed for this.

## Admin app

The admin app is a separate application, `apps/admin`, on its own domain `ADMIN_DOMAIN`. It has no password: a staff member opens it already signed in on the main site, and the main site hands the sign-in over with a one-time code (`/api/staff/handoff`). The admin app has its own cookie, only for its domain. Signing out on the main site, or "sign out of all devices", closes the admin app too. For anyone who is not staff, the whole domain answers 404: Caddy asks the API (`forward_auth`, `/api/staff/check`) before it serves any file. The code lives for 60 seconds in the API's memory: if the API restarts in exactly that moment, the staff member sees 404 and simply opens the admin app again.

Roles: a moderator reviews reports, sees rooms and blocks for a time; an administrator also sees statistics and where people signed in from (the address key and the city), blocks permanently, deletes and sets marks; a superadmin assigns roles.

## Manual release smoke: static room + chat persist after API restart

The scenario checks the main persistence contract without joining voice:

1. Start prod or dev compose with PostgreSQL.
2. Open `http://127.0.0.1:5180` in dev compose, or the production domain.
3. Create a static room and open its link `/r/<room-id>`.
4. Without connecting to voice, send a message in the room chat.
5. Restart only the API:

   ```bash
   docker compose restart api
   # or, for dev compose, through the npm script:
   npm run dev:restart
   ```

6. Open `/r/<room-id>` again and check that the room exists, the static flag is still set, and the message that was sent is still in the chat history.

The automated counterpart is the test `manual static-room chat scenario survives API restart without voice join` in `apps/api/test/chat.test.ts`.
