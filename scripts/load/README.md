# Load tests on a copy of prod

Measures how many rooms, people and screen shares one prod-sized host
carries. The tests run on a throwaway **stand** with prod's size, images and
limits, driven from a separate **generator**. Never point them at prod: the
stand publishes LiveKit signalling and the API past the auth gate and Caddy
(`compose.loadtest.yml`), open to the generator's address only.

## Hosts

| Host | Size | Why |
| --- | --- | --- |
| stand | same plan as prod (2 vCPU, 4 GB, same provider) | the numbers only mean something on prod's hardware |
| generator | 8 vCPU, 16 GB | receives everything the stand sends; must not be the bottleneck |

Both need Ubuntu, root SSH, and the generator's key in the stand's
`authorized_keys` (the generator samples the stand and restarts LiveKit).

## Run

```sh
# stand: the compose files and the setup script, then the stack at prod's commit
ssh root@$STAND mkdir -p /srv/voiceroom-load
git show <prod-tag>:docker-compose.yml > /tmp/docker-compose.yml
scp /tmp/docker-compose.yml scripts/load/compose.loadtest.yml scripts/load/setup-stand.sh root@$STAND:/srv/voiceroom-load/
ssh root@$STAND "cd /srv/voiceroom-load && GENERATOR_IP=$GENERATOR bash setup-stand.sh <prod-commit-sha>"

# generator: media scenarios (installs lk 2.18.8 on first run)
scp -r scripts/load root@$GENERATOR:/root/
ssh root@$GENERATOR "STAND=root@$STAND JOIN_RATE=2 bash /root/load/run-scenarios.sh all"

# generator: realtime API scenarios (needs Node 24 and `npm i ws@8.21.0` next to ws-load.mts)
ssh root@$GENERATOR "STAND=root@$STAND NODE=node bash /root/load/run-ws.sh"
```

To test code that has no published image yet, build it on the generator and
load it into the stand before `setup-stand.sh`:

```sh
git archive HEAD | ssh root@$GENERATOR "mkdir -p /root/src && tar -x -C /root/src"
ssh root@$GENERATOR "cd /root/src && docker build --target api -t voiceroom-api:lt . && docker build --target worker -t voiceroom-worker:lt ."
ssh root@$GENERATOR "docker save voiceroom-api:lt voiceroom-worker:lt" | ssh root@$STAND docker load
ssh root@$STAND "cd /srv/voiceroom-load && API_IMAGE=voiceroom-api:lt WORKER_IMAGE=voiceroom-worker:lt GENERATOR_IP=$GENERATOR bash setup-stand.sh <prod-commit-sha>"
```

### Media (`run-scenarios.sh`)

Each scenario restarts LiveKit, then ramps the room count. A step lasts
`STEP_SECONDS` (150) and the ramp stops after the first step that breaks:
host CPU averaging `CPU_STOP_PCT` (95) or more, packet loss of
`LOSS_STOP_PCT` (5) or more, fewer than 95% of tracks subscribed, 5 or more
failed joins, or host memory peaking at `MEM_STOP_MB` (3000) or more. A
watchdog aborts a step when the stand's available memory falls under
`MEM_ABORT_MB` (350): with no swap, a stand out of memory stops answering
even SSH, and the OOM killer takes LiveKit.

| Scenario | Ramp |
| --- | --- |
| `voice` | 25 → 200 rooms of 9 people, 2 talking |
| `v16`, `v24`, `v25` | rooms of 16, 24 or 25 people, 3 talking |
| `s720x24`, `s1080x24`, `cam25` | a 720p30 or 1080p60 share, or 9 cameras, watched by a full room of 25 |
| `cam` | rooms of 9 cameras watched in a 3×3 grid |
| `s720`, `s1080` | rooms with one 720p30 or 1080p60 share and 8 viewers |
| `mixed` | 30 voice rooms plus a growing number of 1080p60 share rooms |
| `worst` | rooms with three 1080p60 shares each |

`step:<name>:<profile>:<rooms>[,<profile>:<rooms>...]` runs one custom step.

### Realtime API (`run-ws.sh`, `ws-load.mts`)

Guests create rooms, open `/api/ws`, join voice, post chat, toggle mute and
type, while extra lobby sockets watch room previews; each simulated guest
sends its own `X-Forwarded-For`. Steps cover prod's limits (10–50 full rooms),
the `MAX_ROOMS` cap, 500–2000 lobby sockets, a chat burst, a join storm and a
room past `MAX_ROOM_PEERS`. The media budget steps (`budget25`, `budget9`,
`cams25`) ask for screen shares and cameras room by room and count what the
server granted, lowered or refused; `voicecap` fills the server past
`MAX_VOICE_PEERS`. Every room on the stand is soft-deleted between
steps, and each step waits `SETTLE_SECONDS` (65) after it ends: closed
sockets keep their seat for the 30 s reconnect lease and a media grant holds
budget for 60 s, so the next step would otherwise start on a fuller server.

## Results

`results/<time>/summary.txt` has one line per step and `results.csv` the same
as a table: the stand's CPU, traffic out and peak memory, LiveKit's CPU and
peak memory, the generator's CPU, and from the `lk` logs the share of tracks
subscribed, packet loss and each subscriber's bitrate. Each step's directory
keeps the raw `monitor.csv`, `generator.csv`, LiveKit's Prometheus metrics
before and after, and one `lk` log per room.

## What the model leaves out

- `lk` bypasses the API, so `MAX_ROOM_PEERS` and `MAX_ROOMS` are kept by the
  scenarios, not enforced.
- Synthetic VP8 tops out at 2 Mbit/s a track, so a share is several video
  tracks with the same total bitrate (5 for 1080p60, 3 for 720p30). The SFU's
  cost follows packets, so the load matches; the picture does not.
- `lk` publishers do not subscribe and talk without pauses, so a voice room is
  2 constant talkers and 7 listeners. Packets out match a real room with
  1–2 speakers and the rest silent (Opus DTX); a real room has more
  subscriptions per person, which cost memory rather than CPU.
- Stand and generator sit in one data centre, so the network ceiling measured
  is the provider's per-host limit, not the internet path to users.

Delete both hosts when done.
