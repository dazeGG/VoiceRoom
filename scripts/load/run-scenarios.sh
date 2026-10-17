#!/usr/bin/env bash
# Drives load-test scenarios from the generator host against the stand.
# Each step runs N rooms at once with `lk load-test` for STEP_SECONDS while
# monitor.sh samples both hosts. A scenario stops ramping after the first step
# that breaks: host CPU averaging CPU_STOP_PCT or more over the step's second
# half, average packet loss of LOSS_STOP_PCT or more, or fewer than 95% of the
# expected tracks subscribed.
#
# Room profiles (synthetic VP8 tops out at 2 Mbit/s a track, so a screen share
# is modelled by its bitrate, not by one track; lk publishers do not
# subscribe, so listeners are separate testers):
#   voice   2 talking + 7 listening                          9 people
#   v16     3 talking + 13 listening                         16 people
#   v24     3 talking + 21 listening                         24 people
#   v25     3 talking + 22 listening                         25 people
#   cam     9 simulcast cameras + 2 talking, 9 viewers in a 3x3 grid
#   s720    3 video tracks ~6 Mbit/s + 2 talking, 8 viewers  720p30 share
#   s1080   5 video tracks ~10 Mbit/s + 2 talking, 8 viewers 1080p60 share
#   s720x24, s1080x24  the same shares in a room of 25: 24 viewers
#   cam25   9 cameras + 2 talking, 25 viewers in a 5x5 grid
#   worst   15 video tracks (three 1080p60 shares), 6 viewers
#
# Usage: STAND=root@<stand-ip> run-scenarios.sh <scenario>...
#   scenarios: voice v16 v24 cam s720 s1080 mixed worst all
#              v25 s720x24 s1080x24 cam25 (rooms of 25; need LIVEKIT_MAX_PARTICIPANTS >= 36)
#   custom step: step:<name>:<profile>:<rooms>[,<profile>:<rooms>...]
set -euo pipefail

STAND=${STAND:?set STAND=root@<stand-ip>}
STAND_DIR=${STAND_DIR:-/srv/voiceroom-load}
STEP_SECONDS=${STEP_SECONDS:-150}
CPU_STOP_PCT=${CPU_STOP_PCT:-95}
LOSS_STOP_PCT=${LOSS_STOP_PCT:-5}
JOIN_RATE=${JOIN_RATE:-5}
MEM_STOP_MB=${MEM_STOP_MB:-3000}
MEM_ABORT_MB=${MEM_ABORT_MB:-350}
LK_VERSION=2.18.8
here=$(cd "$(dirname "$0")" && pwd)
results=${RESULTS:-"$here/results/$(date -u +%Y%m%dT%H%M%SZ)"}

install_lk() {
  command -v lk > /dev/null && return
  curl -fsSL "https://github.com/livekit/livekit-cli/releases/download/v$LK_VERSION/lk_${LK_VERSION}_linux_amd64.tar.gz" |
    tar -xz -C /usr/local/bin lk
}

livekit_credentials() {
  LIVEKIT_API_KEY=$(ssh "$STAND" "grep '^LIVEKIT_API_KEY=' $STAND_DIR/.env | cut -d= -f2-")
  LIVEKIT_API_SECRET=$(ssh "$STAND" "grep '^LIVEKIT_API_SECRET=' $STAND_DIR/.env | cut -d= -f2-")
  export LIVEKIT_URL="ws://${STAND#*@}:7880" LIVEKIT_API_KEY LIVEKIT_API_SECRET
}

profile_args() {
  local share="--no-simulcast --video-codec vp8 --layout 4x4"
  # Joins a second for each room's lk process; a step's rooms start together.
  printf -- '--num-per-second %s ' "$JOIN_RATE"
  case $1 in
    voice) echo "--audio-publishers 2 --subscribers 7 --simulate-speakers" ;;
    v16) echo "--audio-publishers 3 --subscribers 13 --simulate-speakers" ;;
    v24) echo "--audio-publishers 3 --subscribers 21 --simulate-speakers" ;;
    v25) echo "--audio-publishers 3 --subscribers 22 --simulate-speakers" ;;
    cam) echo "--video-publishers 9 --audio-publishers 2 --subscribers 9 --video-codec vp8 --layout 3x3" ;;
    s720) echo "--video-publishers 3 --audio-publishers 2 --subscribers 8 $share" ;;
    s1080) echo "--video-publishers 5 --audio-publishers 2 --subscribers 8 $share" ;;
    s1080x24) echo "--video-publishers 5 --audio-publishers 2 --subscribers 24 $share" ;;
    s720x24) echo "--video-publishers 3 --audio-publishers 2 --subscribers 24 $share" ;;
    cam25) echo "--video-publishers 9 --audio-publishers 2 --subscribers 25 --video-codec vp8 --layout 5x5" ;;
    worst) echo "--video-publishers 15 --audio-publishers 2 --subscribers 6 $share" ;;
    *) echo "unknown profile $1" >&2 && return 1 ;;
  esac
}

# run_step <dir> <profile>:<rooms> [<profile>:<rooms>...]
run_step() {
  local dir=$1 spec profile rooms i
  shift
  mkdir -p "$dir"
  ssh "$STAND" 'curl -s 127.0.0.1:6789/metrics' > "$dir/livekit-metrics-before.txt"
  ssh "$STAND" "bash -s -- $STEP_SECONDS" < "$here/monitor.sh" > "$dir/monitor.csv" &
  local monitor=$!
  bash "$here/monitor.sh" "$STEP_SECONDS" > "$dir/generator.csv" &
  local generator=$!
  local pids=()
  for spec in "$@"; do
    profile=${spec%%:*} rooms=${spec##*:}
    for i in $(seq 1 "$rooms"); do
      # shellcheck disable=SC2046
      lk load-test --room "lt-$(basename "$(dirname "$dir")")-$(basename "$dir")-$profile-$i" \
        --duration "$((STEP_SECONDS - 10))s" $(profile_args "$profile") > "$dir/$profile-$i.log" 2>&1 &
      pids+=($!)
    done
  done
  # Watchdog: with no swap, a stand out of memory stops answering even SSH.
  (
    while kill -0 "${pids[0]}" 2> /dev/null; do
      sleep 3
      available=$(ssh -o ConnectTimeout=5 "$STAND" "awk '/^MemAvailable/ { print int(\$2 / 1024) }' /proc/meminfo" 2> /dev/null || echo 0)
      if [ "${available:-0}" -lt "$MEM_ABORT_MB" ]; then
        echo "stand down to ${available} MB available, aborting the step" | tee "$dir/aborted"
        kill "${pids[@]}" 2> /dev/null || true
        break
      fi
    done
  ) &
  local watchdog=$!
  wait "${pids[@]}" || true
  kill "$watchdog" 2> /dev/null || true
  wait "$monitor" "$generator" || true
  ssh "$STAND" 'curl -s 127.0.0.1:6789/metrics' > "$dir/livekit-metrics-after.txt"
  summarize "$dir" "$*"
  # Let the SFU drop the finished rooms before the next step starts.
  sleep 10
}

# Second-half averages of a monitor CSV plus whole-step peaks:
# "<cpu> <tx> <service-cpu> <peak-host-mem-mb> <peak-service-mem-mib>".
host_averages() {
  awk -F, 'NR > 1 { n++; cpu[n] = $2; tx[n] = $5; lk[n] = $7
      if ($4 + 0 > mem) mem = $4 + 0
      v = $8 + 0; if ($8 ~ /GiB/) v *= 1024; if ($8 ~ /kB|KiB/) v /= 1024; if (v > svc) svc = v }
    END {
      for (i = int(n / 2) + 1; i <= n; i++) { c += cpu[i]; t += tx[i]; l += lk[i]; m++ }
      if (m == 0) print "0 0 0 0 0"; else printf "%.1f %.1f %.1f %d %d\n", c / m, t / m, l / m, mem, svc
    }' "$1"
}

# The last "Total" row of each lk log (its subscriber summary):
# "<rooms> <tracks-ok-pct> <avg-loss-pct> <max-room-loss-pct> <avg-sub-kbps> <errors>".
subscriber_totals() {
  awk -F'│' '
    FNR == 1 && row != "" { take(row); row = "" }
    /│ Total / { row = $0 }
    END { if (row != "") take(row); report() }
    function kbps(s,   v) {
      if (!match(s, /\(([0-9.]+)(bps|kbps|mbps) avg\)/)) return 0
      v = substr(s, RSTART + 1, RLENGTH - 1); sub(/ avg\)/, "", v)
      if (v ~ /mbps/) return v * 1000; if (v ~ /kbps/) return v + 0; return v / 1000
    }
    function take(line,   f, got, want, loss) {
      split(line, f, "│"); split(f[3], got, "/"); want = got[2] + 0
      # lk shrinks or grows the expected count when publishers fail to join.
      rooms++; tracks_got += (got[1] + 0 > want ? want : got[1] + 0); tracks_want += want
      loss = 0; if (match(f[5], /\(([0-9.]+)%\)/)) loss = substr(f[5], RSTART + 1, RLENGTH - 3) + 0
      loss_sum += loss; if (loss > loss_max) loss_max = loss
      rate_sum += kbps(f[4]); errors += f[6] + 0
    }
    function report() {
      if (rooms == 0) { print "0 0 0 0 0 0"; return }
      printf "%d %.1f %.2f %.2f %.0f %d\n", rooms, tracks_want ? 100 * tracks_got / tracks_want : 0,
        loss_sum / rooms, loss_max, rate_sum / rooms, errors
    }' "$1"/*-[0-9]*.log
}

summarize() {
  local dir=$1 label=$2 cpu tx lkcpu mem lkmem gcpu _gtx _glk _gmem _gsvc rooms ok loss lossmax rate errors
  read -r cpu tx lkcpu mem lkmem < <(host_averages "$dir/monitor.csv")
  read -r gcpu _gtx _glk _gmem _gsvc < <(host_averages "$dir/generator.csv")
  read -r rooms ok loss lossmax rate errors < <(subscriber_totals "$dir")
  [ -f "$dir/aborted" ] && label="$label ABORTED"
  [ -f "$results/results.csv" ] ||
    echo "step,spec,rooms,stand_cpu_pct,livekit_cpu_pct,tx_mbps,stand_mem_peak_mb,livekit_mem_peak_mib,generator_cpu_pct,tracks_ok_pct,loss_avg_pct,loss_max_pct,sub_kbps_avg,errors" > "$results/results.csv"
  echo "${dir#"$results"/},$label,$rooms,$cpu,$lkcpu,$tx,$mem,$lkmem,$gcpu,$ok,$loss,$lossmax,$rate,$errors" >> "$results/results.csv"
  printf '%-16s %-22s cpu %5s%%  lk %6s%%  tx %7s Mbit/s  mem %4s MB (lk %4s)  gen %5s%%  tracks %5s%%  loss %5s%% (max %5s%%)  sub %6s kbit/s  err %s\n' \
    "${dir#"$results"/}" "$label" "$cpu" "$lkcpu" "$tx" "$mem" "$lkmem" "$gcpu" "$ok" "$loss" "$lossmax" "$rate" "$errors" | tee -a "$results/summary.txt"
  echo "$cpu $loss $ok $errors $mem" > "$dir/verdict"
}

# Failed joins mean an overloaded SFU even when CPU and loss look fine: the
# testers that never connected send and receive nothing. Memory stops the ramp
# before the next step can push the stand into the OOM killer.
broken() {
  local cpu loss ok errors mem
  [ -f "$1/aborted" ] && return 0
  read -r cpu loss ok errors mem < "$1/verdict"
  awk -v cpu="$cpu" -v loss="$loss" -v ok="$ok" -v errors="$errors" -v mem="$mem" \
    -v cmax="$CPU_STOP_PCT" -v lmax="$LOSS_STOP_PCT" -v mmax="$MEM_STOP_MB" \
    'BEGIN { exit !(cpu >= cmax || loss >= lmax || ok < 95 || errors >= 5 || mem >= mmax) }'
}

# ramp <scenario> <fixed-spec-or-empty> <profile> <room counts...>
ramp() {
  local scenario=$1 fixed=$2 profile=$3 rooms dir
  shift 3
  # A fresh SFU per scenario: Go keeps freed memory, so peaks would carry over.
  ssh "$STAND" "cd $STAND_DIR && docker compose -f docker-compose.yml -f compose.loadtest.yml restart livekit" > /dev/null 2>&1
  sleep 10
  for rooms in "$@"; do
    dir="$results/$scenario/$(printf '%03d' "$rooms")"
    # shellcheck disable=SC2086
    run_step "$dir" $fixed "$profile:$rooms"
    if broken "$dir"; then
      echo "$scenario: broke at $rooms rooms, stopping the ramp" | tee -a "$results/summary.txt"
      break
    fi
  done
}

run_scenario() {
  case $1 in
    voice) ramp voice "" voice 25 50 75 100 125 150 200 ;;
    v16) ramp v16 "" v16 25 40 50 65 80 ;;
    v24) ramp v24 "" v24 15 25 35 50 65 ;;
    v25) ramp v25 "" v25 12 18 24 30 ;;
    s1080x24) ramp s1080x24 "" s1080x24 1 2 3 4 5 ;;
    s720x24) ramp s720x24 "" s720x24 2 4 5 6 8 ;;
    cam25) ramp cam25 "" cam25 2 4 6 8 ;;
    cam) ramp cam "" cam 4 8 12 16 24 32 40 ;;
    s720) ramp s720 "" s720 4 8 12 16 24 32 40 ;;
    s1080) ramp s1080 "" s1080 2 4 6 8 12 16 20 24 30 ;;
    mixed) ramp mixed "voice:30" s1080 2 4 8 12 16 20 ;;
    worst) ramp worst "" worst 1 2 4 6 8 ;;
    step:*)
      local name rest
      name=$(echo "$1" | cut -d: -f2) rest=$(echo "$1" | cut -d: -f3-)
      # shellcheck disable=SC2046
      run_step "$results/custom/$name" $(echo "$rest" | tr ',' ' ')
      ;;
    all) for s in voice v16 v24 cam s720 s1080 mixed worst; do run_scenario "$s"; done ;;
    *) echo "unknown scenario $1" >&2 && return 1 ;;
  esac
}

[ $# -gt 0 ] || set -- all
ulimit -n 65536
install_lk
livekit_credentials
mkdir -p "$results"
for scenario in "$@"; do run_scenario "$scenario"; done
echo "results in $results"
