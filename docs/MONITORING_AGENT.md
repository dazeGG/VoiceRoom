# VoiceRoom monitoring agent

VoiceRoom does not run Prometheus, Grafana, Caddy, blackbox checks, or custom monitoring code. The separate private status stack scrapes only standard exporter endpoints from this server over Tailscale/private networking.

## Exported endpoints

| Endpoint | Port | Purpose |
| --- | ---: | --- |
| `node_exporter` | `9100` | Host CPU, RAM, disk, filesystem, and network metrics |
| `cAdvisor` | `8080` | Docker/container CPU, memory, network, and lifecycle metrics |
| LiveKit SFU | `6789` | Active rooms, participants, and published audio/video tracks |
| VoiceRoom API | `/api/metrics` | API HTTP counters, realtime connection gauges, presence gauges, maintenance durations, PostgreSQL pool errors |

`node_exporter` and `cAdvisor` bind to `127.0.0.1` by default. LiveKit metrics bind to `127.0.0.1` by default through `LIVEKIT_METRICS_BIND_ADDRESS`. On the production VoiceRoom server, bind all three to the server's Tailscale IP. API metrics are served by the API container at `/api/metrics`; the public Caddy route is allowlisted with `API_METRICS_ALLOWED_REMOTE` and returns 404 for other clients.

## LiveKit metrics on the VoiceRoom server

Production `docker-compose.yml` enables LiveKit's native Prometheus exporter:

```yaml
prometheus_port: 6789
```

Set these values in `.env` on the VoiceRoom server:

```dotenv
LIVEKIT_METRICS_PORT=6789
LIVEKIT_METRICS_BIND_ADDRESS=<VoiceRoom server Tailscale IP>
```

Validate locally or from the status server:

```bash
curl -fsS http://<voiceroom-tailscale-ip>:6789/metrics | rg '^livekit_'
```

Key gauges scraped by the status stack:

| Metric | Meaning |
| --- | --- |
| `livekit_room_total` | Active SFU rooms |
| `livekit_participant_total` | Connected LiveKit participants |
| `livekit_track_published_total{kind="AUDIO"}` | Published microphone tracks |
| `livekit_track_published_total{kind="VIDEO"}` | Published video tracks, including screen share |

LiveKit does not expose a separate screen-share gauge. Screen share is counted inside `kind="VIDEO"`.

## API metrics and logs

The API exposes Prometheus text at:

```bash
curl -fsS https://<voice-domain>/api/metrics
```

Set this value in `.env` on the VoiceRoom server so only the status server can read it through Caddy:

```dotenv
API_METRICS_ALLOWED_REMOTE=<status-server-tailscale-ip-or-cidr>
LOG_LEVEL=info
```

If the status stack scrapes from the same Docker network instead of Caddy, target `http://api:3000/api/metrics` and keep the public Caddy allowlist at its default `127.0.0.1`.

Key API metrics:

| Metric | Meaning |
| --- | --- |
| `voice_room_api_http_requests_total{method,route,status}` | HTTP request count by route template and status |
| `voice_room_api_http_request_duration_seconds_sum{method,route,status}` | Cumulative HTTP handler duration |
| `voice_room_api_ws_connections` | Active realtime WebSocket connections |
| `voice_room_api_ws_guest_connections` | Active guest realtime WebSocket connections |
| `voice_room_api_presence_rooms` | Rooms currently tracked in process-local presence |
| `voice_room_api_presence_peers` | Peers currently tracked in process-local presence |
| `voice_room_api_maintenance_duration_seconds_*{task}` | Room/session prune and retention purge duration/count |
| `voice_room_api_pg_pool_errors_total` | Unexpected PostgreSQL pool errors |

API logs are structured JSON through Fastify/pino. `LOG_LEVEL` defaults to `info` in production compose; health checks are intentionally omitted from request logs.

## Start on the VoiceRoom server

```bash
cp agent/.env.example agent/.env
# edit agent/.env and set TAILSCALE_BIND_ADDRESS=<VoiceRoom server Tailscale IP>
docker compose --env-file agent/.env -f agent/docker-compose.agent.yml up -d
```

The agent compose file lives in the sibling `VoiceRoomStatus` repository.

## Firewall contract

Do not expose `9100`, `8080`, or `6789` to the public internet. Allow them only from the status server Tailscale IP.

Example with UFW:

```bash
sudo ufw allow in on tailscale0 from <status-server-tailscale-ip> to any port 9100 proto tcp
sudo ufw allow in on tailscale0 from <status-server-tailscale-ip> to any port 8080 proto tcp
sudo ufw allow in on tailscale0 from <status-server-tailscale-ip> to any port 6789 proto tcp
sudo ufw deny 9100/tcp
sudo ufw deny 8080/tcp
sudo ufw deny 6789/tcp
```

## Validate from the status server

```bash
curl -fsS http://<voiceroom-tailscale-ip>:9100/metrics | head
curl -fsS http://<voiceroom-tailscale-ip>:8080/metrics | head
curl -fsS http://<voiceroom-tailscale-ip>:6789/metrics | rg '^livekit_'
curl -fsS https://<voice-domain>/api/metrics | rg '^voice_room_api_'
```

## Status stack variables

The status stack should target this VoiceRoom server with:

```dotenv
VOICEROOM_SERVER_TARGET=<VoiceRoom server Tailscale IP>
VOICEROOM_NODE_EXPORTER_PORT=9100
VOICEROOM_CADVISOR_PORT=8080
VOICEROOM_LIVEKIT_METRICS_PORT=6789
VOICEROOM_API_METRICS_URL=https://<voice-domain>/api/metrics
```
