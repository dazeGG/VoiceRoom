#!/usr/bin/env bash
# Samples the stand while a load step runs and prints CSV to stdout:
# host CPU busy %, load average, used memory, traffic on the default-route
# interface, and one compose service's CPU (% of one core) and memory:
# LiveKit unless SERVICE names another.
#
# Usage: [SERVICE=api] monitor.sh <seconds> [interval-seconds]
set -euo pipefail

duration=${1:?usage: monitor.sh <seconds> [interval-seconds]}
interval=${2:-5}
iface=$(ip route show default | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }')
# Empty on the generator, which runs this too and has no containers.
service=$(docker ps -q --filter label=com.docker.compose.service="${SERVICE:-livekit}" 2> /dev/null | head -1 || true)

cpu_ticks() { awk '/^cpu / { idle = $5 + $6; total = 0; for (i = 2; i <= NF; i++) total += $i; print total, idle }' /proc/stat; }
net_bytes() { awk -v dev="$iface:" '$1 == dev { print $2, $10 }' /proc/net/dev; }

echo "time,cpu_busy_pct,load1,mem_used_mb,tx_mbps,rx_mbps,service_cpu_pct,service_mem"
read -r total0 idle0 < <(cpu_ticks)
read -r rx0 tx0 < <(net_bytes)
t0=$(date +%s.%N)
end=$(($(date +%s) + duration))

while [ "$(date +%s)" -lt "$end" ]; do
  sleep "$interval"
  read -r total1 idle1 < <(cpu_ticks)
  read -r rx1 tx1 < <(net_bytes)
  t1=$(date +%s.%N)
  svc_stats=-,-
  if [ -n "$service" ]; then
    svc_stats=$(docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' "$service" | tr -d '%' | cut -d/ -f1 | tr -d ' ')
  fi
  awk -v t="$(date -u +%H:%M:%S)" -v tot=$((total1 - total0)) -v idle=$((idle1 - idle0)) \
    -v rx=$((rx1 - rx0)) -v tx=$((tx1 - tx0)) -v t0="$t0" -v t1="$t1" \
    -v load1="$(cut -d' ' -f1 /proc/loadavg)" -v mem="$(free -m | awk '/^Mem:/ { print $3 }')" -v svc="$svc_stats" \
    'BEGIN { dt = t1 - t0; printf "%s,%.1f,%s,%s,%.1f,%.1f,%s\n", t, 100 * (tot - idle) / tot, load1, mem, tx * 8 / dt / 1e6, rx * 8 / dt / 1e6, svc }'
  total0=$total1 idle0=$idle1 rx0=$rx1 tx0=$tx1 t0=$t1
done
