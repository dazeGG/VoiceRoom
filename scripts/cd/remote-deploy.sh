#!/usr/bin/env bash
# Runs on a deploy host (piped over SSH by .github/workflows/deploy.yml).
# Rolls the compose stack in <deploy-path> to <commit> and the given images.
# Failures restore the previous commit and .env; containers are restored only
# after a rollout was actually attempted, never after a failed preflight/pull.
# Database migrations are not reverted: restore the dump taken here instead.
#
# Usage: remote-deploy.sh <deploy-path> <commit> <api-image> <worker-image> <web-image>
set -Eeuo pipefail

# The script arrives on stdin, so bash must read all of it before running any
# command that could consume the rest (docker compose exec, ssh, ...).
main() {
  local deploy_path=$1 commit=$2 api_image=$3 worker_image=$4 web_image=$5
  keep=${KEEP_DEPLOY_BACKUPS:-5}

  cd "$deploy_path"
  # This override is installed on the host, not checked out with a release:
  # rolling back must not roll diagnostic storage back into disposable containers.
  local persistent_logs=false
  case "${REQUIRE_PERSISTENT_LOGS:-0}" in
    0|1) ;;
    *) echo 'REQUIRE_PERSISTENT_LOGS must be 0 or 1' >&2; exit 1 ;;
  esac
  local allow_voice_interruption=${ALLOW_LOGGING_VOICE_INTERRUPTION-0}
  case "$allow_voice_interruption" in
    0|1) ;;
    *) echo 'ALLOW_LOGGING_VOICE_INTERRUPTION must be 0 or 1' >&2; exit 1 ;;
  esac
  if [ -f docker-compose.override.yml ] && grep -qx '# VoiceRoom managed persistent logging v1' docker-compose.override.yml; then
    persistent_logs=true
    # Fail before the rollback trap or any container changes if storage is down.
    bash /etc/voiceroom/logging/preflight.sh "$PWD"
  fi
  if [ "${REQUIRE_PERSISTENT_LOGS:-0}" = 1 ] && [ "$persistent_logs" != true ]; then
    echo 'production requires the managed persistent logging profile; install/restore it before deployment' >&2
    exit 1
  fi
  local first_logging_activation=false
  if [ "$persistent_logs" = true ]; then
    local livekit_id livekit_driver
    livekit_id=$(docker compose ps --all --quiet livekit)
    [[ "$livekit_id" =~ ^[a-f0-9]{12,64}$ ]] || {
      echo 'cannot determine the existing LiveKit container for logging activation' >&2; exit 1;
    }
    livekit_driver=$(docker inspect --format '{{.HostConfig.LogConfig.Type}}' "$livekit_id")
    if [ "$livekit_driver" != syslog ]; then first_logging_activation=true; fi
  fi
  check_logging_activation_idle() {
    if [ "$first_logging_activation" != true ]; then return; fi
    if [ "$allow_voice_interruption" = 1 ]; then
      echo 'warning: operator explicitly approved brief voice interruption for first logging activation; idle check skipped' >&2
      return
    fi
    # Recreating LiveKit to change its log driver interrupts calls. The existing
    # API is the authority for active voice peers; missing/unreadable is not zero.
    docker compose exec -T api node -e '
      (async () => {
        const response = await fetch("http://127.0.0.1:3000/api/metrics", { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("metrics unavailable");
        const samples = (await response.text()).split(/\r?\n/).filter(line => line.startsWith("voice_room_api_presence_peers"));
        if (samples.length !== 1 || !/^voice_room_api_presence_peers[ \t]+0[ \t]*$/.test(samples[0])) {
          throw new Error("active voice peers or missing metric");
        }
      })().catch(() => {
        console.error("first logging activation requires a verified zero voice-peer count; deployment stopped");
        process.exitCode = 1;
      });
    ' < /dev/null
  }
  check_logging_activation_idle
  backup_dir=deploy-backups/ci
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"

  exec 9>"$backup_dir/.lock"
  if ! flock -n 9; then
    echo "another deploy is running in $deploy_path" >&2
    exit 1
  fi

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  previous_commit=$(git rev-parse HEAD)
  env_backup="$backup_dir/env-$stamp-pre-${commit:0:12}"

  log_deploy() {
    if [ "$persistent_logs" = true ]; then
      timeout 5s logger --socket /run/systemd/journal.voiceroom/dev-log --tag voiceroom/deploy -- \
        "$1 commit=$commit previous=$previous_commit" || echo 'warning: deployment log marker was not delivered' >&2
    fi
  }
  log_deploy deployment.starting
  if [ "$first_logging_activation" = true ] && [ "$allow_voice_interruption" = 1 ]; then
    log_deploy deployment.logging_voice_interruption_approved
  fi

  echo "== backing up .env and the database ($previous_commit -> $commit)"
  cp .env "$env_backup"
  chmod 600 "$env_backup"
  db_dump="$backup_dir/db-$stamp.dump"
  if ! docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' < /dev/null > "$db_dump"; then
    rm -f "$db_dump"
    echo "database backup failed, nothing was changed" >&2
    exit 1
  fi
  chmod 600 "$db_dump"

  local rollout_started=false
  rollback() {
    trap - ERR
    log_deploy deployment.rollback_requested
    echo "== deploy failed, restoring $previous_commit and the previous .env" >&2
    cp "$env_backup" .env
    git checkout --quiet --detach "$previous_commit"
    if [ "$rollout_started" = true ]; then
      docker compose up -d --remove-orphans || true
    fi
    exit 1
  }
  trap rollback ERR

  set_env() {
    if grep -q "^$1=" .env; then
      sed -i "s|^$1=.*|$1=$2|" .env
    else
      printf '%s=%s\n' "$1" "$2" >> .env
    fi
  }

  echo "== checking out $commit"
  git fetch --quiet --prune origin
  git checkout --quiet --detach "$commit"

  echo "== pulling images"
  docker pull --quiet "$api_image"
  docker pull --quiet "$worker_image"
  docker pull --quiet "$web_image"

  set_env VOICEROOM_API_IMAGE "$api_image"
  set_env VOICEROOM_WORKER_IMAGE "$worker_image"
  set_env VOICEROOM_WEB_IMAGE "$web_image"
  docker compose config --quiet
  if [ "$persistent_logs" = true ]; then
    bash /etc/voiceroom/logging/preflight.sh "$PWD"
  fi
  if [ "$first_logging_activation" = true ]; then
    # Capture succeeds before any old container is removed. Recheck voice after
    # capture, so its duration does not extend the idle-check/rollout gap.
    # Use the verified target release's helper so recovery fixes do not require
    # replacing administrator-owned files during an application deployment.
    python3 scripts/logging/archive-current.py "$PWD"
    check_logging_activation_idle
  fi

  echo "== rolling out"
  rollout_started=true
  docker compose up -d --remove-orphans --wait --wait-timeout 300
  trap - ERR
  log_deploy deployment.completed

  echo "== cleaning up"
  # Every rollout pulls three new VoiceRoom images, so on a busy day the age
  # filter below keeps all of them and a small disk fills up (dev hit 100% on
  # 2026-09-13 and 2026-09-24). Keep only this release and the previous one,
  # whose tags the .env backup holds, so a manual rollback needs no pull.
  prune_release_images() {
    local keep_list
    keep_list=$(printf '%s\n' "$api_image" "$worker_image" "$web_image"
      grep -hE '^VOICEROOM_(API|WORKER|WEB)_IMAGE=' "$env_backup" | cut -d= -f2- || true)
    docker image ls --format '{{.Repository}}:{{.Tag}}' \
      | grep -E '/voiceroom-(api|worker|web):' \
      | grep -vxF -f <(printf '%s\n' "$keep_list") \
      | xargs -r docker image rm > /dev/null 2>&1 || true
  }
  prune_oldest() {
    find "$backup_dir" -maxdepth 1 -type f -name "$1" -printf '%T@ %p\n' \
      | sort -rn | tail -n +"$((keep + 1))" | cut -d' ' -f2- | xargs -r rm -f
  }
  prune_oldest 'db-*.dump'
  prune_oldest 'env-*'
  # Backups older than the privacy policy's retention go too, manual ones
  # included. The script comes from the commit just checked out.
  bash scripts/cd/prune-backups.sh . || true
  # Cleanup must not turn a finished rollout into a failed job.
  prune_release_images
  docker image prune -af --filter 'until=72h' > /dev/null || true
  docker builder prune -af --filter 'until=72h' > /dev/null || true

  docker compose ps --format '{{.Service}}\t{{.Status}}'
  echo "deployed $commit"
}

main "$@"
