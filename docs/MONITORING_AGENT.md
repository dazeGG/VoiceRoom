# VoiceRoom monitoring agent

VoiceRoom does not run Prometheus, Grafana, Caddy, blackbox checks, or custom monitoring code. The separate private status stack scrapes only standard exporter endpoints from this server over Tailscale/private networking.

## Exported endpoints

| Endpoint | Port | Purpose |
| --- | ---: | --- |
| `node_exporter` | `9100` | Host CPU, RAM, disk, filesystem, and network metrics |
| `cAdvisor` | `8080` | Docker/container CPU, memory, network, and lifecycle metrics |
| LiveKit SFU | `6789` | Active rooms, participants, and published audio/video tracks |

`node_exporter` and `cAdvisor` bind to `127.0.0.1` by default. LiveKit metrics bind to `127.0.0.1` by default through `LIVEKIT_METRICS_BIND_ADDRESS`. On the production VoiceRoom server, bind all three to the server's Tailscale IP.

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
```

## Status stack variables

The status stack should target this VoiceRoom server with:

```dotenv
VOICEROOM_SERVER_TARGET=<VoiceRoom server Tailscale IP>
VOICEROOM_NODE_EXPORTER_PORT=9100
VOICEROOM_CADVISOR_PORT=8080
VOICEROOM_LIVEKIT_METRICS_PORT=6789
```