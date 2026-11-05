# VoiceRoom performance

How to tell what a call join and a page really cost, on a test stand and for real
people. The number that matters most is the time from a click to hearing the room.

## What a join costs

A join is mostly round trips, so it costs the most where the line is longest. Round
trip to the St Petersburg server, measured from public probes on 2026-11-05: Moscow
11 ms, Yekaterinburg 30-50 ms, Novosibirsk 55-85 ms, Irkutsk 75 ms, Khabarovsk 106 ms,
Vladivostok 115 ms, Yuzhno-Sakhalinsk 140 ms.

What is left of a join, in round trips, and why it is not less:

| Stage | Round trips | Why |
| --- | --- | --- |
| Room check | 1 | Runs beside the microphone; skipped for 30 s after the room page made it |
| Token | 1 | Plus the server's own checks |
| Signal connection | 3 | TCP, TLS and the WebSocket upgrade. Moving it to the main domain did not help on the stand |
| Peer connection | about 3 | Join answer, then ICE and DTLS |
| Publishing the microphone | about 2 | No longer holds up hearing the others |

## Real joins

Each stay keeps `voice_sessions.join_timing`: milliseconds since the join started, as
the client measured them, on its real microphone and line. Where people are is not
kept, so joins are grouped by the round trip of the same stay:

```sql
WITH stays AS (
  SELECT s.join_timing, sum(m.rtt_ms_sum) / nullif(sum(m.rtt_polls), 0) AS rtt
  FROM voice_sessions s JOIN voice_session_samples m ON m.stay_id = s.id
  WHERE s.join_timing IS NOT NULL AND s.joined_at > now() - interval '30 days'
  GROUP BY s.id, s.join_timing
)
SELECT CASE WHEN rtt < 30 THEN '1: under 30 ms' WHEN rtt < 80 THEN '2: 30-80 ms' ELSE '3: over 80 ms' END AS line,
  count(*) AS joins,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY (join_timing->>'totalMs')::int) AS total_p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (join_timing->>'totalMs')::int) AS total_p95,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY (join_timing->>'microphoneMs')::int) AS microphone_p50
FROM stays WHERE rtt IS NOT NULL GROUP BY 1 ORDER BY 1;
```

`join_timing` goes with the room's history after `VOICE_HISTORY_KEEP_DAYS`, as the
stay's minutes do, and with the row when an account is deleted.

## The join bench

`scripts/voice-bench/join-bench.mts` times every stage of a join in a real browser
without changing the app, so it measures any build. A second bot stays in the room,
so "first sound" means a subscription really happened. Its microphone is Chromium's
fake device, which opens at once; a real one takes longer, which only `join_timing`
shows.

To compare builds on a far line, run a production-like stack locally and put the
browser in a container of its own, its line shaped by a sidecar:

```sh
docker run -d --name bench --network <stack network> -v "$PWD:/repo:ro" \
  mcr.microsoft.com/playwright:v1.61.1-noble sleep 7200
docker run -d --name bench-tc --net container:bench --cap-add NET_ADMIN alpine:3.20 sleep 7200
docker exec bench-tc sh -c 'apk add -q iproute2 && tc qdisc add dev eth0 root netem delay 115ms'
docker exec -e BASE_URL=https://voiceroom.internal -e TRUST_SPKI=<certificate key hashes> \
  bench node /repo/scripts/voice-bench/join-bench.mts <roomId>
```

A `*.internal` domain gets a certificate from Caddy's own CA. Chromium does not cache
over a certificate error, so `TRUST_SPKI` trusts it by key instead; without it every
run measures an empty cache. `FLOW=account` measures a signed-in user entering from
the lobby. `CPU_SLOWDOWN=4` stands in for a weak phone.

Pointed at a live site, the bench joins a real room as two guests that other people
will see and that are written to its database.

## Slow queries and requests

Postgres logs each statement slower than `POSTGRES_LOG_SLOWER_THAN_MS` (250 by
default), without the values bound to it: `docker compose logs postgres`. For totals,
once per database:

```sh
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"'
```

```sql
SELECT calls, round(mean_exec_time) AS mean_ms, round(total_exec_time) AS total_ms, left(query, 100) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
```

`/api/metrics` has `voice_room_api_http_latency_seconds` (a histogram by method and
route) and `voice_room_web_vital` (what browsers measured of the pages they opened,
in milliseconds, CLS in thousandths). Both start over when the API restarts.
