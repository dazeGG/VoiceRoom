# VoiceRoom logging

Logs answer one question that metrics cannot: *what happened to this user, in this
room, at this moment*. `/api/metrics` already reports how many requests failed;
this document covers how to find out why.

## Shape

Application records are single JSON lines written by pino, from the API, the
workers and the LiveKit auth gate alike. Caddy, LiveKit and PostgreSQL keep their
native formats in the same production journal.

```json
{
  "level": 40,
  "time": 1790066001808,
  "service": "api",
  "version": "2.6.1",
  "env": "production",
  "evt": "ws.closed",
  "connId": "u-91c:1790065…:3f1a",
  "userId": "…",
  "code": 1006,
  "durationMs": 812,
  "msg": "ws closed"
}
```

| Field | Meaning |
| --- | --- |
| `service` | `api`, `worker.<name>`, or `livekit-auth-gate` |
| `version` | the API package version that emitted the record |
| `evt` | the stable event code — the field you grep, alert and dashboard on |
| `reqId` | the request id, shared with the `x-request-id` response header |
| `connId` | the realtime connection id, stable for the life of one socket |
| `userId` | the signed-in account, absent for guests |
| `ipHash` | a salted, per-process hash — correlates within an incident, reverses to nothing |
| `err` | a serialized error with `type`, `message` and `stack` |

`evt` codes are declared in `apps/api/src/lib/log-events.ts` and nowhere else.
**Codes are never renamed once shipped** — a rename silently breaks every alert
and dashboard built on it. Add a new code instead.

## Correlation

One id spans the whole path:

1. The edge may send `x-request-id`. It is reused when it matches
   `^[A-Za-z0-9._-]{1,64}$`, and replaced with a fresh UUID otherwise — an
   untrusted value must not be able to forge a line in the log stream.
2. Every response carries `x-request-id` back, including error responses.
3. The browser records that id against any failed API call (`api request failed`).
4. A user's report of "it failed at 14:20" becomes one `grep` on the id.

Realtime work is correlated by `connId` instead, and background work by the
`eventId` of the outbox row it is processing.

## Levels

| Level | Use |
| --- | --- |
| `fatal` | the process cannot continue (bootstrap, worker crash) |
| `error` | user-visible failure, or a durable invariant broken |
| `warn` | degraded but handled: a retry, a rejected request, a fallback taken |
| `info` | lifecycle and the steady-state request line |
| `debug` | detail worth keeping only while chasing a specific problem |

`LOG_LEVEL` defaults to `info` in production and `silent` everywhere else, so
tests and local runs stay quiet without guards at the call sites. `silent`,
`off`, `none` and `false` all disable logging.

Health checks (`/api/healthz`) are deliberately absent from the request log.

## Redaction

Pino removes configured sensitive fields and known request-header paths at
serialization time. This is **not arbitrary-depth redaction**: review new nested
objects and error messages before logging them. The public client intake drops
sensitive context keys and masks URL queries, JWTs and gate credentials. HTTP
request logs use route templates (or `unknown`), never an unmatched raw URL.
Caddy's runtime formatter removes request URI, headers and client-address fields
from proxy errors. Free-form error text and third-party logs still require review;
these protections are not a universal secret detector.

Application HTTP request logs represent client addresses as `ipHash`, salted per
process. It correlates records inside one incident window and nothing beyond it.
Native third-party diagnostics, including LiveKit, can contain address information;
the host journal must therefore remain private and expire automatically.

Message bodies, room chat content and attachment contents are never logged.

## Storage across deployments

The portable `docker-compose.yml` fallback uses container-owned JSON logs capped
at 3 × 10 MB. **Deleting/replacing a container deletes that history.** Size limits
alone do not provide time-based expiry.

Production uses the opt-in host profile in `config/logging`: Docker's native
syslog driver sends all service streams to the isolated `voiceroom` systemd journal
namespace. There is no collector, public log endpoint or new application dependency.
The persistent store is `/var/log/journal/<machine-id>.voiceroom/`, independent of
application containers and Git checkouts. The ordinary host journal is untouched.

- Target retention: **14 days**, with hourly rotation and an hourly namespace-only
  vacuum timer; the public policy allows **15 days** for file-granular cleanup.
- Journal storage budget: **512 MiB**, 16 MiB files, 2 GiB free-space reserve.
  Active files/metadata make this a journal budget, not a byte-perfect directory cap.
  Size pressure can shorten the retained history. Do not promise 14 days under
  arbitrary traffic.
- Per-container delivery buffer: **4 MiB, non-blocking**. A full buffer, receiver
  outage or rate limiting can lose records; diagnostics must not stall calls.
  The journal sync interval is 30 seconds, not a synchronous durable commit per line.
- Docker's separate log cache is disabled to avoid an independently retained copy.
  **`docker compose logs`, `docker logs` and `npm run logs` do not read this profile.**
  Use the journal reader below, including after the original container is removed.
- The syslog tag is `voiceroom/<container-name>/<container-id>`. Pino records also
  retain `service` and `version`; deployment markers name old/new Git commits.
- Access is restricted to host administrators/journal readers. Do not expose logs
  through Caddy, commit exports, or put raw log contents into public issues.

### Install and activate

Requires a Linux systemd host with journal namespaces (production uses systemd
249), Python 3, Docker and Compose **2.24.4+**. The `!override` replaces the complete
logging block; simply merging `driver` would leave incompatible JSON-driver options.

```bash
# Read the installer first. It requires root and never recreates application containers.
sudo bash scripts/logging/install.sh /home/daze/VoiceRoom --reader daze
```

`--reader` is explicit: it grants that operator membership in `systemd-journal`,
which can read other host journals too. Reconnect SSH to pick up membership. Omit
the option to keep journal reads root-only. The installer refuses an unrelated
existing override. It installs a marked, ignored `docker-compose.override.yml`
on the host so normal deployment, manual Compose operations and rollback to an
older commit all retain the same logging sink. Explicit `-f` configurations do
not automatically load this override.

```bash
bash /etc/voiceroom/logging/preflight.sh /home/daze/VoiceRoom
# Use an already-present trusted image, with /bin/sh and printf:
python3 /etc/voiceroom/logging/smoke.py --image alpine:3.23
```

Check the smoke test's actual evidence: records from two removed containers,
their different IDs, and a >4 KiB JSON record must remain readable only in the
VoiceRoom namespace. The optional journal-restart check requires root and should
run before switching application containers. Also verify boot-unit ordering and
that the expiry timer is active. A successful config parse is not this test.

**First activation recreates every service whose logging configuration changes,
including LiveKit and PostgreSQL. Wait for zero active voice participants.**
Back up the deployment as usual; preserve any still-needed current-container logs
privately before recreation:

```bash
# Run before the first recreation, after setup and a fresh journal-reader login.
python3 /etc/voiceroom/logging/archive-current.py /home/daze/VoiceRoom
```

This one-time transition capture reads only existing containers and the preceding
14 days. It writes private gzip JSONL files to `/var/lib/voiceroom/log-transition`,
bounded to 30 MiB of source output per container and 64 MiB total archive storage.
It retains original timestamps and container/service identity; known sensitive
Caddy request fields are removed. Each file's age starts at its **oldest original
record**, not the date it was copied. The hourly retention service expires these
archives too. A capture failure or limit breach must stop first activation; it is
not permission to discard history. Future deployments use the continuous journal,
not this capture. Already-deleted logs cannot be recovered by this setup.
The deploy script checks the installed profile before touching containers and
rechecks the resolved services before rollout. On the first JSON-to-syslog LiveKit
transition it requires a readable zero voice-peer count before backup, repeats the
archive capture, then checks for zero peers again immediately before recreation.
A failed preflight, pull, archive or idle check does not run a container rollback
when no rollout has started. Rollback keeps the host override;
do not remove it as an application rollback step.

### Read a previous session

```bash
# Includes prior container generations and prior boots; not restricted to current boot.
bash /etc/voiceroom/logging/read.sh \
  --since '2026-11-09 16:45:00 UTC' --until '2026-11-09 17:00:00 UTC'

# Journal JSON wraps the original log line in MESSAGE.
bash /etc/voiceroom/logging/read.sh --since '24 hours ago' \
  | jq -r '.MESSAGE' | jq -R 'fromjson? | select(.evt == "client.report" and .msg == "voice join outcome")'

# Namespace size / cleanup health (requires journal/system-service access):
journalctl --namespace=voiceroom --disk-usage
systemctl status voiceroom-log-retention.timer
```

The reader uses `--all` so long JSON fields are not rendered as `null`. Its default
is the last 24 hours, at most 5,000 records: narrow the interval or raise `--lines`
when investigating a busy period. Preserve journal timestamps, original client
`at`, `clientSessionId`, container tag and application version in private incident
notes. Client clocks can differ from server clocks; `at` is not proof of ordering.

Guest voice outcomes include `ctx.reportedGuestId` and `ctx.roomId`, captured at
attempt start. The guest ID is the **existing** browser guest ID also used in voice
history, not a new identifier. Use it with room/time to locate the DB stay; use
`clientSessionId` to find the page's other delivered reports. These client-supplied
fields are **untrusted correlation hints, never authentication**. Signed-in account
identity remains server-resolved. No attempt reaches history merely because it was
started: offline/crashed clients can still fail to deliver their diagnostic batch.

Transition files use `{at, service, containerId, line}` rather than journal fields:
read them with `gzip -cd /var/lib/voiceroom/log-transition/<file>.jsonl.gz` and filter
locally. They are not copied into the journal with a fresh timestamp.

Implementation references: [Docker syslog](https://docs.docker.com/engine/logging/drivers/syslog/),
[delivery modes](https://docs.docker.com/engine/logging/configure/),
[systemd 249 namespaces](https://www.freedesktop.org/software/systemd/man/249/systemd-journald.service.html),
[retention semantics](https://www.freedesktop.org/software/systemd/man/249/journald.conf.html).

## What is instrumented

| Area | Codes |
| --- | --- |
| Process | `boot.*`, `worker.*` |
| HTTP | `http.request`, `http.handler_failed`, `http.client_outdated` |
| Realtime | `ws.connected`, `ws.connect_failed` (the socket is closed with 1011), `ws.closed` (with close code and duration), `ws.rejected_over_limit`, `ws.message_failed`, `ws.message_rejected` |
| Voice rooms | `room.joined`, `room.join_rejected`, `room.left`, `room.occupancy_*`, `room.mic_stall_recovery` (a client's microphone stopped reaching its encoder and it rebuilt the capture or the media connection) |
| LiveKit | `livekit.admission_denied`, `livekit.admission_revoked`, `livekit.mute_failed`, `livekit.gate_*` |
| Messaging | `msg.delivery_failed`, `msg.event_dispatch_failed`, `msg.listener_failed` |
| Notifications | `notify.delivery_failed`, `notify.backlog_aged`, `push.*` (Web Push), `push.native_*` (the Android app through RuStore) |
| Media | `media.job_failed`, `media.link_preview_*` |
| Storage | `db.pool_error`, `migration.*`, `maintenance.*` |
| Browser | `client.report`, `client.report_rejected` |

## Chasing common problems

```bash
# Sockets dropping abnormally rather than closing cleanly.
… | jq 'select(.evt == "ws.closed" and .code == 1006)'

# Users who cannot get into a call, with the reason the client was given.
… | jq 'select(.evt == "livekit.admission_denied") | {roomId, code, userId}'

# One user's whole session.
… | jq 'select(.userId == "…")'

# Everything under one request id, server and browser alike.
… | jq 'select(.reqId == "…")'

# Uploads that will never appear for the user.
… | jq 'select(.evt == "media.job_failed" and .state == "dead")'
```

## Browser logs

The room client keeps the last 100 records in memory (`apps/web/src/shared/log.ts`).
The buffer is posted to `POST /api/client-logs` on failures and terminal voice
join outcomes, including successful and cancelled joins. See
[`PERFORMANCE.md`](./PERFORMANCE.md) for outcome coverage and delivery limits. Reports are
throttled to one per 30 seconds per page: a report held back goes out when the
window ends, and a report that never got out does not use up the window.

That last report is how a network problem between one user and the server becomes
visible at all, because the failed connections never reached the server. It arrives
once the connection is back, as a record with `ns: "realtime"`, the message
`server was unreachable`, and `durationMs`, `attempts` and `offline` in `ctx`.
`offline: true` means the browser itself reported no network at some attempt.
`durationMs` starts when a silent socket was last heard from (for any other close,
at the close), and leaves out any gap over 90 seconds as a computer that slept, so
a shorter sleep can still be reported as an outage.
`attempts` can be 0: a socket that fell silent, followed by one that opened at
once. The record's `at` is when the connection came back.

```bash
… | jq 'select(.evt == "client.report" and .ns == "realtime")'
```

The API re-emits each record into the same log stream as `client.report`, with
`source: "web"`. **Nothing is stored in the database**, so there is no schema,
no migration and no retention of its own: browser records age out with the rest
of the logs.

Because the intake is a public write path into the log stream, it is off unless
an operator turns it on:

```dotenv
CLIENT_LOG_INTAKE_ENABLED=true
CLIENT_LOG_RATE_LIMIT=6          # requests per window, per IP
CLIENT_LOG_RATE_WINDOW_MS=60000
```

While disabled the route answers `404`, and the browser stops trying for the
life of the page.

Intake treats every field as hostile input: the batch is capped at 100 records,
messages at 200 characters, context at 18 primitive-valued keys, and control
characters are stripped so a caller cannot forge extra lines. Anything that
fails validation is counted and reported once as `client.report_rejected`.
Accounts come from the session cookie — a page cannot claim an identity.

## Adding a log line

1. Add the code to `apps/api/src/lib/log-events.ts`.
2. Log the identifiers, not prose: `{ evt, roomId, userId, code, err }`, with a
   short lowercase `msg`. The fields are what gets queried.
3. Pick the level from the table above. A retry is `warn`; exhausting the
   retries is `error`.
4. Never log credentials, message content, or a raw client address.

On the browser side use `createLogger('<namespace>')` from `@/shared/log`.
Direct `console.*` calls are rejected by ESLint (`no-console` in
`eslint.config.mjs`): they reach no buffer, so they are missing from the report that gets sent when a
call fails.
