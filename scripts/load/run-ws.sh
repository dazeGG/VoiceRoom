#!/usr/bin/env bash
# Realtime API steps: ws-load.mts against the stand while monitor.sh samples
# the API container. Between steps every room on the stand is soft-deleted,
# since temporary rooms otherwise live 15 minutes and count toward MAX_ROOMS.
#
# Usage: STAND=root@<stand-ip> NODE=/root/ws/node/bin/node run-ws.sh [step...]
#   steps: prod10 prod25 prod50 cap60 lobby500 lobby1000 lobby2000 chat20
#          storm full12 (default: all of them, in that order)
#   media budget steps (stand with MEDIA_BUDGET_MBPS=700, MAX_ROOM_SCREENS=3,
#   MAX_ROOM_PEERS=25, MAX_VOICE_PEERS=600): budget25 budget9 cams25 voicecap
set -euo pipefail

STAND=${STAND:?set STAND=root@<stand-ip>}
STAND_DIR=${STAND_DIR:-/srv/voiceroom-load}
NODE=${NODE:-node}
here=$(cd "$(dirname "$0")" && pwd)
results=${RESULTS:-"$here/results/ws-$(date -u +%Y%m%dT%H%M%SZ)"}
api="http://${STAND#*@}:3000"

reset_rooms() {
  # shellcheck disable=SC2016
  ssh "$STAND" "cd $STAND_DIR && docker compose exec -T postgres sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -qAt -c \"update rooms set deleted_at = now() where deleted_at is null\"'" > /dev/null
}

# step <name> <VAR=value...>: settings for ws-load.mts.
step() {
  local name=$1 dir="$results/$1" duration=120 rooms=10 peers=9 joins=50
  shift
  local setting
  for setting in "$@"; do
    case $setting in
      DURATION=*) duration=${setting#*=} ;;
      ROOMS=*) rooms=${setting#*=} ;;
      PEERS=*) peers=${setting#*=} ;;
      JOINS_PER_SECOND=*) joins=${setting#*=} ;;
    esac
  done
  mkdir -p "$dir"
  reset_rooms
  ssh "$STAND" "SERVICE=api bash -s -- $((duration + rooms * peers / joins + 20))" < "$here/monitor.sh" > "$dir/monitor.csv" &
  local monitor=$!
  env API="$api" "$@" "$NODE" "$here/ws-load.mts" > "$dir/ws.json" 2> "$dir/ws.err" || true
  wait "$monitor" || true
  "$NODE" -e '
    const fs = require("node:fs");
    const [dir, name] = process.argv.slice(1);
    const r = JSON.parse(fs.readFileSync(`${dir}/ws.json`, "utf8") || "{}");
    const rows = fs.readFileSync(`${dir}/monitor.csv`, "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
    const avg = (i) => rows.length ? (rows.reduce((s, x) => s + Number(x[i] || 0), 0) / rows.length).toFixed(1) : "-";
    const max = (i) => rows.length ? Math.max(...rows.map((x) => Number(x[i] || 0))).toFixed(1) : "-";
    const failures = Object.entries(r.counts || {}).filter(([k]) => !/^(room_create_201|join_joined|lobby_open|chat_delivered|chat_post_201|mute_toggle|ws_close_1005|ws_close_1000)$/.test(k));
    // Media budget answers are results, not failures; they print the same way.
    console.log(`${name.padEnd(10)} peers ${r.peersJoined}/${(r.params?.rooms ?? 0) * (r.params?.peersPerRoom ?? 0)} lobby ${r.lobbyOpen}` +
      ` join p95 ${r.joinMs?.p95} ms  chat ${r.chat?.deliveredPct}% p95 ${r.chat?.fanoutMs?.p95} ms` +
      `  cpu avg ${avg(1)}% max ${max(1)}%  api avg ${avg(6)}% max ${max(6)}%  mem ${max(3)} MB  ${failures.map(([k, v]) => `${k}=${v}`).join(" ")}`);
  ' "$dir" "$name" | tee -a "$results/summary.txt"
  # Closed sockets keep their seat for the 30 s reconnect lease and a media
  # grant holds budget for 60 s: wait both out so the next step starts empty.
  sleep "${SETTLE_SECONDS:-65}"
}

run() {
  case $1 in
    prod10) step prod10 ROOMS=10 ;;
    prod25) step prod25 ROOMS=25 ;;
    prod50) step prod50 ROOMS=50 ;;
    cap60) step cap60 ROOMS=60 DURATION=30 ;;
    lobby500) step lobby500 ROOMS=50 LOBBY=500 ;;
    lobby1000) step lobby1000 ROOMS=50 LOBBY=1000 ;;
    lobby2000) step lobby2000 ROOMS=50 LOBBY=2000 ;;
    chat20) step chat20 ROOMS=50 CHAT_PER_MIN=20 ;;
    storm) step storm ROOMS=50 JOINS_PER_SECOND=1000 DURATION=60 ;;
    full12) step full12 ROOMS=5 PEERS=12 DURATION=30 ;;
    # 1080p 60 FPS asked in rooms of 25 (240 Mbit/s each) and of 9 (80 each):
    # the budget should grant ~2 and ~8 at full quality, then lower, then refuse.
    budget25) step budget25 ROOMS=10 PEERS=25 SCREEN_REQUESTS=3 DURATION=30 ;;
    budget9) step budget9 ROOMS=20 PEERS=9 SCREEN_REQUESTS=1 DURATION=30 ;;
    cams25) step cams25 ROOMS=10 PEERS=25 CAMERA_REQUESTS=25 DURATION=30 ;;
    voicecap) step voicecap ROOMS=26 PEERS=25 DURATION=30 ;;
    *) step "$1" "${@:2}" ;;
  esac
}

mkdir -p "$results"
if [ $# -eq 0 ]; then
  for s in prod10 prod25 prod50 cap60 lobby500 lobby1000 lobby2000 chat20 storm full12; do run "$s"; done
else
  run "$@"
fi
reset_rooms
echo "results in $results"
