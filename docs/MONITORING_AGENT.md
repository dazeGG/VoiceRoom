# VoiceRoom monitoring agent

VoiceRoom does not run Prometheus, Grafana, Caddy, blackbox checks, or custom monitoring code. The separate private status stack scrapes only standard exporter endpoints from this server over Tailscale/private networking.

## Exported endpoints

| Endpoint | Port | Purpose |
| --- | ---: | --- |
| `node_exporter` | `9100` | Host CPU, RAM, disk, filesystem, and network metrics |
| `cAdvisor` | `8080` | Docker/container CPU, memory, network, and lifecycle metrics |

Both services bind to `127.0.0.1` by default. On the production VoiceRoom server, bind them to the server's Tailscale IP.

## Start on the VoiceRoom server

```bash
cp agent/.env.example agent/.env
# edit agent/.env and set TAILSCALE_BIND_ADDRESS=<VoiceRoom server Tailscale IP>
docker compose --env-file agent/.env -f agent/docker-compose.agent.yml up -d
```

## Firewall contract

Do not expose `9100` or `8080` to the public internet. Allow them only from the status server Tailscale IP.

Example with UFW:

```bash
sudo ufw allow in on tailscale0 from <status-server-tailscale-ip> to any port 9100 proto tcp
sudo ufw allow in on tailscale0 from <status-server-tailscale-ip> to any port 8080 proto tcp
sudo ufw deny 9100/tcp
sudo ufw deny 8080/tcp
```

## Validate from the status server

```bash
curl -fsS http://<voiceroom-tailscale-ip>:9100/metrics | head
curl -fsS http://<voiceroom-tailscale-ip>:8080/metrics | head
```

## Status stack variables

The status stack should target this VoiceRoom server with:

```dotenv
VOICEROOM_SERVER_TARGET=<VoiceRoom server Tailscale IP>
VOICEROOM_NODE_EXPORTER_PORT=9100
VOICEROOM_CADVISOR_PORT=8080
```
