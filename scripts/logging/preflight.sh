#!/usr/bin/env bash
# Read-only deployment gate. Never prints the resolved, secret-bearing Compose.
set -euo pipefail
[[ $# == 1 ]] || { echo 'usage: preflight.sh DEPLOY_PATH' >&2; exit 2; }
deploy_path=$(realpath -e -- "$1")
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -S /run/systemd/journal.voiceroom/dev-log ]] || { echo 'VoiceRoom journal socket is missing' >&2; exit 1; }
for unit in voiceroom-logging.service systemd-journald@voiceroom.service voiceroom-log-retention.timer; do
  systemctl is-active --quiet "$unit"
done
for unit in voiceroom-logging.service voiceroom-log-retention.timer; do
  systemctl is-enabled --quiet "$unit"
done
systemd-analyze cat-config systemd/journald@voiceroom.conf | python3 "$script_dir/validate-journal.py"
machine_id=$(cat /etc/machine-id)
[[ "$machine_id" =~ ^[a-f0-9]{32}$ ]] || { echo 'invalid host machine id' >&2; exit 1; }
journal_dir="/var/log/journal/$machine_id.voiceroom"
[[ -d "$journal_dir" ]] || { echo 'persistent VoiceRoom journal directory is missing' >&2; exit 1; }
find "$journal_dir" -maxdepth 1 -type f -name '*.journal*' -readable -print -quit | grep -q . || {
  echo 'persistent VoiceRoom journal is missing or unreadable; check setup and reader group membership' >&2; exit 1;
}
cd -- "$deploy_path"
docker compose config --format json | python3 "$script_dir/validate-compose.py"
echo 'persistent logging preflight passed'
