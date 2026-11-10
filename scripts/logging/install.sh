#!/usr/bin/env bash
# One-time administrator setup; intentionally does not recreate any containers.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'run this installer as root (sudo); no Docker privilege workaround' >&2; exit 1; }
[[ $# == 1 || ( $# == 3 && "$2" == --reader ) ]] || {
  echo 'usage: install.sh DEPLOY_PATH [--reader EXISTING_USER]' >&2; exit 2;
}
deploy_path=$(realpath -e -- "$1")
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
reader=${3:-}
[[ -f "$deploy_path/docker-compose.yml" ]] || { echo 'deployment Compose file is missing' >&2; exit 1; }
for command in docker python3 systemctl systemd-analyze journalctl logger install realpath; do
  command -v "$command" >/dev/null || { echo "missing required command: $command" >&2; exit 1; }
done
if [[ -n "$reader" ]]; then
  [[ "$reader" =~ ^[a-z_][a-z0-9_-]*\$?$ ]] && id "$reader" >/dev/null || { echo 'invalid reader user' >&2; exit 1; }
fi
version=$(docker compose version --short)
python3 - "$version" <<'PY'
import re, sys
match = re.match(r"v?(\d+)\.(\d+)\.(\d+)", sys.argv[1])
if not match or tuple(map(int, match.groups())) < (2, 24, 4):
    sys.exit("Docker Compose >= 2.24.4 is required for logging !override")
PY
systemctl cat systemd-journald@.service >/dev/null
override="$deploy_path/docker-compose.override.yml"
marker='# VoiceRoom managed persistent logging v1'
[[ ! -L "$override" ]] || { echo 'refusing symlink Compose override' >&2; exit 1; }
if [[ -e "$override" ]] && [[ "$(head -n 1 "$override")" != "$marker" ]]; then
  echo 'refusing to overwrite an unrelated docker-compose.override.yml' >&2; exit 1
fi
# Validate the intended merge before writing host configuration. No secrets reach stdout.
docker compose --project-directory "$deploy_path" -f "$deploy_path/docker-compose.yml" \
  -f "$source_root/config/logging/compose.override.yml" config --format json \
  | python3 "$source_root/scripts/logging/validate-compose.py"

[[ ! -L /var/lib/voiceroom/log-transition ]] || { echo 'refusing symlink transition archive' >&2; exit 1; }
install -d -m 2770 -o root -g systemd-journal /var/lib/voiceroom/log-transition
install -d -m 0755 /etc/voiceroom/logging /etc/systemd/journald@voiceroom.conf.d /etc/systemd/system/docker.service.d
restart_namespace=false
if ! cmp -s "$source_root/config/logging/journal.conf" /etc/systemd/journald@voiceroom.conf.d/60-voiceroom.conf \
  || ! systemctl is-active --quiet systemd-journald@voiceroom.service; then
  restart_namespace=true
fi
for script in preflight.sh read.sh validate-compose.py validate-journal.py smoke.py archive-current.py; do
  install -m 0755 "$source_root/scripts/logging/$script" "/etc/voiceroom/logging/$script"
done
install -m 0644 "$source_root/config/logging/compose.override.yml" /etc/voiceroom/logging/compose.override.yml
install -m 0644 "$source_root/config/logging/journal.conf" /etc/systemd/journald@voiceroom.conf.d/60-voiceroom.conf
install -m 0644 "$source_root/config/logging/docker.conf" /etc/systemd/system/docker.service.d/60-voiceroom-logging.conf
for unit in voiceroom-logging.service voiceroom-log-retention.service voiceroom-log-retention.timer; do
  install -m 0644 "$source_root/config/logging/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
# First installation has no application writers yet. Reconfiguration explicitly
# restarts this namespace only, never the ordinary journal or Docker daemon.
if [[ "$restart_namespace" == true ]]; then systemctl restart systemd-journald@voiceroom.service; fi
systemctl enable --now voiceroom-logging.service voiceroom-log-retention.timer
logger --socket /run/systemd/journal.voiceroom/dev-log --tag voiceroom/ops -- '{"evt":"logging.installed"}'
journalctl --namespace=voiceroom --flush
journalctl --namespace=voiceroom --sync
if [[ -n "$reader" ]]; then
  usermod -aG systemd-journal "$reader"
  echo "$reader can read system journals after a fresh login (not only the VoiceRoom namespace)."
fi
if [[ -e "$override" ]]; then install -m 0644 "$override" /etc/voiceroom/logging/compose.override.previous.yml; fi
install -m 0644 /etc/voiceroom/logging/compose.override.yml "$override"
bash /etc/voiceroom/logging/preflight.sh "$deploy_path"
echo 'Host logging installed. Existing containers are unchanged; verify the smoke test before the next rollout.'
