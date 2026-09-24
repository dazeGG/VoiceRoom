# VoiceRoom logging

Logs answer one question that metrics cannot: *what happened to this user, in this
room, at this moment*. `/api/metrics` already reports how many requests failed;
this document covers how to find out why.

Operational scraping, dashboards and the firewall contract live in
[`MONITORING_AGENT.md`](MONITORING_AGENT.md).

## Shape

Every record is a single JSON line written by pino, from the API, the workers and
the LiveKit auth gate alike.

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

Passwords, session and recovery tokens, e-mail addresses, `authorization`,
`cookie` and `set-cookie` are removed by pino at serialization time, at any
nesting depth. This is enforced, not a convention: an accidental
`log.info({ req })` cannot leak a cookie.

Client addresses are logged only as `ipHash`, salted per process. It correlates
records inside one incident window and nothing beyond it.

Message bodies, room chat content and attachment contents are never logged.

## What is instrumented

| Area | Codes |
| --- | --- |
| Process | `boot.*`, `worker.*` |
| HTTP | `http.request`, `http.handler_failed` |
| Realtime | `ws.connected`, `ws.closed` (with close code and duration), `ws.rejected_over_limit`, `ws.message_failed`, `ws.message_rejected` |
| Voice rooms | `room.joined`, `room.join_rejected`, `room.left`, `room.occupancy_*` |
| LiveKit | `livekit.admission_denied`, `livekit.admission_revoked`, `livekit.mute_failed`, `livekit.gate_*` |
| Messaging | `msg.delivery_failed`, `msg.event_dispatch_failed`, `msg.listener_failed` |
| Notifications | `notify.delivery_failed`, `notify.backlog_aged`, `push.*` |
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

The room client keeps the last 100 records in memory (`apps/web/src/lib/shared/log.ts`).
Nothing is sent on a timer: the buffer is posted to `POST /api/client-logs` only
when something actually failed — the room client failing to start, or the
recovery state machine reaching its terminal `failed` phase. Reports are
throttled to one per 30 seconds per page.

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
messages at 200 characters, context at 12 primitive-valued keys, and control
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

On the browser side use `createLogger('<namespace>')` from `$lib/shared/log`.
Direct `console.*` calls are rejected by `apps/web/test/client-logging.test.js`:
they reach no buffer, so they are missing from the report that gets sent when a
call fails.
