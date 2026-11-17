#!/usr/bin/env bash
# Explicit second-stage operation, never part of an ordinary deploy.
# Usage: activate-widget.sh <deploy-path> <compatible-rollback-env-file>
set -Eeuo pipefail
main() {
  local deploy_path=$1 rollback_env=$2
  command -v python3 >/dev/null || { echo 'Python 3 is required' >&2; exit 1; }
  cd "$deploy_path"
  local backup_dir="$PWD/deploy-backups/ci"
  mkdir -p "$backup_dir" "$HOME/.cache/voiceroom"
  exec 9>"$backup_dir/.lock"
  flock -n 9 || { echo 'another deploy is running' >&2; exit 1; }
  exec 8>"$HOME/.cache/voiceroom/deploy.lock"
  flock 8
  test -f "$rollback_env"
  local stamp helper producer manifest
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  helper="$backup_dir/widget-activation-$stamp.py"
  producer="$backup_dir/widget-activation-manifest-$stamp.py"
  manifest="$backup_dir/widget-release-capabilities.json"
  cp scripts/cd/widget-boundary-preflight.py "$helper"
  cp scripts/cd/widget-release-capabilities.py "$producer"
  chmod 700 "$helper" "$producer"
  local images=() key value
  for source in .env "$rollback_env"; do
    for key in API WORKER WEB; do
      value=$(sed -n "s/^VOICEROOM_${key}_IMAGE=//p" "$source")
      test -n "$value"
      images+=("$value")
    done
  done
  python3 "$producer" "$manifest" "${images[@]}" < /dev/null
  set_flag() {
    if grep -q '^WIDGET_ENABLED=' .env; then
      sed -i "s/^WIDGET_ENABLED=.*/WIDGET_ENABLED=$1/" .env
    else
      printf 'WIDGET_ENABLED=%s\n' "$1" >> .env
    fi
  }
  recover_activation() {
    trap - ERR
    set_flag false
    if python3 "$helper" --rollback "$manifest" "${images[@]}" < /dev/null; then
      if ! docker compose up -d --remove-orphans --wait --wait-timeout 300; then
        echo 'activation recovery stack restoration failed; operator repair required' >&2
      fi
      echo 'widget activation failed; admission disabled and media recovery verified' >&2
    else
      echo 'widget activation failed; recovery unproven, operator repair required' >&2
    fi
    exit 1
  }
  trap recover_activation ERR
  # Verifies both release digests and every serving API/gate/worker/web image,
  # then atomically persists the compatibility floor and admission activation.
  python3 "$helper" --activate "$manifest" "${images[@]}" < /dev/null
  set_flag true
  docker compose up -d --remove-orphans --wait --wait-timeout 300
  trap - ERR
  echo 'widget activation complete; public-launch obligations still apply'
}
main "$@"
