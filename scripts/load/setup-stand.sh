#!/usr/bin/env bash
# Brings up a throwaway copy of the prod stack for load tests. Runs as root on
# the stand, from the directory that holds docker-compose.yml and
# compose.loadtest.yml (copied there by the operator, see README.md).
#
# Usage: GENERATOR_IP=<ip> WEB_IMAGE=<published-web-image> setup-stand.sh <api-commit-sha> [domain]
# API_IMAGE can override the API with a locally built image.
set -euo pipefail

sha=${1:?usage: GENERATOR_IP=<ip> WEB_IMAGE=<published-web-image> setup-stand.sh <api-commit-sha> [domain]}
domain=${2:-loadtest.invalid}
generator=${GENERATOR_IP:?set GENERATOR_IP, the only address let through to LiveKit signalling and the API}

command -v docker > /dev/null || curl -fsSL https://get.docker.com | sh

secret() { openssl rand -hex 32; }

if [ ! -f .env ]; then
  umask 077
  cat > .env << EOF
DOMAIN=$domain
POSTGRES_PASSWORD=$(secret)
LIVEKIT_API_KEY=loadtest
LIVEKIT_API_SECRET=$(secret)
LIVEKIT_GATE_SECRET=$(secret)
VOICE_ROOM_CURSOR_HMAC_KEYS=$(secret)
VOICEROOM_API_IMAGE=${API_IMAGE:-ghcr.io/dazegg/voiceroom-api:$sha}
VOICEROOM_WEB_IMAGE=${WEB_IMAGE:?set WEB_IMAGE to a compatible Web image}
# The limits prod runs with (checked 2026-10-16).
MAX_ROOM_PEERS=9
MAX_ROOMS=50
# Proof of work costs the client, not the server; ws-load.mts does not solve it.
ROOM_CREATE_POW_DIFFICULTY=0
EOF
fi

# Docker publishes ports past the host firewall; DOCKER-USER is where to filter.
for port in 7880 3000; do
  # ORIGINAL only: replies share the connection's conntrack entry and port.
  rule=(-p tcp -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL)
  iptables -C DOCKER-USER "${rule[@]}" -j DROP 2> /dev/null || iptables -I DOCKER-USER "${rule[@]}" -j DROP
  iptables -C DOCKER-USER "${rule[@]}" -s "$generator" -j ACCEPT 2> /dev/null ||
    iptables -I DOCKER-USER "${rule[@]}" -s "$generator" -j ACCEPT
done

mkdir -p geoip
docker compose -f docker-compose.yml -f compose.loadtest.yml up -d --wait --wait-timeout 300
docker compose -f docker-compose.yml -f compose.loadtest.yml ps --format '{{.Service}}\t{{.Status}}'
nproc
free -m | head -2
