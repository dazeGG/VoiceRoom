#!/usr/bin/env bash
# Runs on a deploy host (piped over SSH by .github/workflows/deploy.yml).
# Rolls the compose stack in <deploy-path> to <commit> and the given images.
# Failures restore the previous commit and .env; containers are restored only
# after a rollout was actually attempted, never after a failed preflight/pull.
# Database migrations are not reverted: restore the dump taken here instead.
#
# Usage: remote-deploy.sh <deploy-path> <commit> <api-image> <worker-image> <web-image> [all|api|web]
set -Eeuo pipefail

# The script arrives on stdin, so bash must read all of it before running any
# command that could consume the rest (docker compose exec, ssh, ...).
main() {
  local deploy_path=$1 commit=$2 api_image=$3 worker_image=$4 web_image=$5
  local component=${6:-all}
  case "$component" in
    all|api|web) ;;
    *) echo 'invalid image deployment component' >&2; exit 1 ;;
  esac
  local phase_started=$SECONDS
  report_phase() {
    local now=$SECONDS
    printf 'timing: %s %ss\n' "$1" "$((now - phase_started))"
    phase_started=$now
  }

  command -v python3 > /dev/null || {
    echo 'deployment requires Python 3 for the widget compatibility preflight; no changes made' >&2
    exit 1
  }
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
  if [ "$persistent_logs" = true ] && [ "$component" != web ]; then
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
  report_phase initial-preflight
  backup_dir=deploy-backups/ci
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"

  exec 9>"$backup_dir/.lock"
  if ! flock -n 9; then
    echo "another deploy is running in $deploy_path" >&2
    exit 1
  fi
  # Dev and production use the same deploy account. Serialize their rollouts:
  # image cleanup must never race another stack's pull or .env replacement.
  mkdir -p "$HOME/.cache/voiceroom"
  exec 8>"$HOME/.cache/voiceroom/deploy.lock"
  flock 8
  report_phase deployment-lock

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

  echo "== backing up deployment state ($component: $previous_commit -> $commit)"
  cp .env "$env_backup"
  chmod 600 "$env_backup"
  if [ "$component" != web ]; then
    db_dump="$backup_dir/db-$stamp.dump"
    if ! docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' < /dev/null > "$db_dump"; then
      rm -f "$db_dump"
      echo "database backup failed, nothing was changed" >&2
      exit 1
    fi
    chmod 600 "$db_dump"
  fi
  report_phase backup

  local rollout_started=false
  # Pin recovery logic outside the checkout before any checkout/env mutation.
  # The helper must survive returning to an older release.
  git fetch --quiet --prune origin
  local boundary_helper="$PWD/$backup_dir/widget-boundary-$stamp.py"
  git show "$commit:scripts/cd/widget-boundary-preflight.py" > "$boundary_helper"
  chmod 700 "$boundary_helper"
  local boundary_manifest="$PWD/$backup_dir/widget-release-capabilities.json"
  local manifest_helper="$PWD/$backup_dir/widget-manifest-$stamp.py"
  git show "$commit:scripts/cd/widget-release-capabilities.py" > "$manifest_helper"
  local previous_api previous_worker previous_web
  previous_api=$(sed -n 's/^VOICEROOM_API_IMAGE=//p' "$env_backup")
  previous_worker=$(sed -n 's/^VOICEROOM_WORKER_IMAGE=//p' "$env_backup")
  previous_web=$(sed -n 's/^VOICEROOM_WEB_IMAGE=//p' "$env_backup")
  previous_worker=${previous_worker:-$previous_api}
  report_phase fetch-and-prepare

  echo "== pulling images"
  if [ "$component" = web ]; then
    api_image=$previous_api
    worker_image=$previous_worker
  else
    docker pull --quiet "$api_image"
    if [ "$worker_image" != "$api_image" ]; then
      docker pull --quiet "$worker_image"
    fi
  fi
  if [ "$component" = api ]; then
    web_image=$previous_web
  else
    docker pull --quiet "$web_image"
  fi
  report_phase image-pull
  if [ "$component" = web ]; then
    # The host checkout supplies the edge's environment, ports and mounts.
    local required_edge_contract edge_config
    required_edge_contract=$(docker image inspect --format \
      '{{with index .Config.Labels "org.voiceroom.requires-caddy-compose"}}{{.}}{{end}}' "$web_image")
    if [ -n "$required_edge_contract" ]; then
      if ! edge_config=$(docker compose config --format json caddy); then
        echo 'Web rollout cannot resolve Caddy from the host checkout; deploy the API release carrying the required Compose change first' >&2
        return 1
      fi
      python3 -c '
import json
import re
import sys

required = sys.argv[1]
labels = json.load(sys.stdin)["services"]["caddy"].get("labels", {}) or {}
available = labels.get("org.voiceroom.caddy-compose", "")
if not re.fullmatch(r"[1-9][0-9]*", required):
    sys.exit("invalid Web image label org.voiceroom.requires-caddy-compose: expected a positive integer")
if not re.fullmatch(r"[1-9][0-9]*", available) or int(available) < int(required):
    sys.exit(f"Web image requires Caddy Compose contract {required}; "
             "deploy the API release carrying the required Compose change first")
' "$required_edge_contract" <<< "$edge_config"
    fi
  fi
  python3 "$manifest_helper" "$boundary_manifest" \
    "$api_image" "$worker_image" "$web_image" \
    "$previous_api" "$previous_worker" "$previous_web" < /dev/null
  boundary_preflight() {
    python3 "$boundary_helper" "$@" "$boundary_manifest" \
      "$api_image" "$worker_image" "$web_image" \
      "$previous_api" "$previous_worker" "$previous_web" < /dev/null
  }
  boundary_preflight
  report_phase compatibility-preflight

  if [ "$component" != api ]; then
    # Seed the split edge under the existing locks before touching the
    # checkout, env or containers. A failed copy can be retried as-is.
    local client_publisher="$PWD/$backup_dir/publish-client-$stamp.sh"
    git show "$commit:scripts/cd/publish-client.sh" > "$client_publisher"
    bash "$client_publisher" "$PWD" widget "$previous_commit" --seed-legacy "$commit"
    bash "$client_publisher" "$PWD" admin "$previous_commit" --seed-legacy "$commit"
    rm -f "$client_publisher"
  fi

  local rollout_args=()
  select_rollout_services() {
    case "$component" in
      all) rollout_args=(--remove-orphans) ;;
      web) rollout_args=(--no-deps caddy) ;;
      api)
        local services service has_caddy=false
        services=$(docker compose config --services) || return 1
        rollout_args=(--remove-orphans --no-deps)
        while IFS= read -r service; do
          case "$service" in
            caddy) has_caddy=true ;;
            '') ;;
            *) rollout_args+=("$service") ;;
          esac
        done <<< "$services"
        # Keep Caddy defined so Compose does not consider it an orphan. An
        # empty selection would make Compose apply the entire project.
        if [ "$has_caddy" != true ] || [ "${#rollout_args[@]}" -eq 2 ]; then
          echo 'API rollout requires a Compose project with Caddy and at least one non-edge service' >&2
          return 1
        fi ;;
    esac
  }
  rollback() {
    trap - ERR
    log_deploy deployment.rollback_requested
    # Recheck persistent state even if the earlier preflight passed: a floor
    # activated during rollout must prevent restoration of legacy binaries.
    local recovery_args=()
    if [ "$component" != web ]; then recovery_args=(--rollback); fi
    if ! boundary_preflight "${recovery_args[@]}"; then
      echo 'rollback refused: leaving the last stack in place; operator recovery required' >&2
      exit 1
    fi
    echo "== deploy failed, restoring $previous_commit and the previous .env" >&2
    cp "$env_backup" .env
    # Recovery proved persisted admission off. Never restore a backed-up flag
    # that could later enable entry unexpectedly on the compatible target.
    if [ "$component" != web ]; then
      set_env WIDGET_ENABLED false
      git checkout --quiet --detach "$previous_commit"
    fi
    if [ "$rollout_started" = true ]; then
      if ! select_rollout_services || ! docker compose up -d "${rollout_args[@]}"; then
        echo 'rollback stack restoration failed; operator repair required' >&2
      fi
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

  if [ "$component" != web ]; then
    echo "== checking out $commit"
    git checkout --quiet --detach "$commit"
  fi

  # Preserve the existing marketing site on the first rollout that separates
  # static publication from the app image. The publisher takes the same site
  # lock as independent releases and never overrides one that won the race.
  if [ ! -s static/site/current/index.html ]; then
    local previous_caddy
    previous_caddy=$(docker compose ps --quiet caddy)
    if [ -n "$previous_caddy" ] && docker exec "$previous_caddy" test -s /srv/site/index.html; then
      docker cp "$previous_caddy:/srv/site/." - |
        bash <(git show "$commit:scripts/cd/publish-static.sh") "$PWD" site "$previous_commit" --if-empty
    fi
  fi

  if [ "$component" != web ]; then
    set_env VOICEROOM_API_IMAGE "$api_image"
    set_env VOICEROOM_WORKER_IMAGE "$worker_image"
  fi
  if [ "$component" != api ]; then
    set_env VOICEROOM_WEB_IMAGE "$web_image"
  fi
  docker compose config --quiet
  select_rollout_services
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
  report_phase checkout-and-configure

  echo "== rolling out"
  rollout_started=true
  docker compose up -d --wait --wait-timeout 300 "${rollout_args[@]}"
  trap - ERR
  report_phase compose-rollout-and-health
  log_deploy deployment.completed

  echo "== cleaning up"
  # Keep this release and the previous one,
  # whose tags the .env backup holds, so a manual rollback needs no pull.
  # Prod and dev can share a host (docs/SELF_HOSTING.md), so the same pair of
  # every other compose stack here is kept too: its .env and newest backup.
  kept_release_images() {
    local stack previous
    printf '%s\n' "$api_image" "$worker_image" "$web_image"
    grep -hE '^VOICEROOM_(API|WORKER|WEB)_IMAGE=' "$env_backup" | cut -d= -f2- || return 1
    docker ps --all --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u \
      | while IFS= read -r stack; do
        [ -n "$stack" ] && [ -f "$stack/.env" ] || continue
        previous=''
        if [ -d "$stack/deploy-backups/ci" ]; then
          previous=$(find "$stack/deploy-backups/ci" -maxdepth 1 -type f -name 'env-*' -printf '%T@ %p\n' 2> /dev/null \
            | sort -rn | sed -n '1s/^[^ ]* //p') || exit 1
        fi
        grep -hE '^VOICEROOM_(API|WORKER|WEB)_IMAGE=' "$stack/.env" ${previous:+"$previous"} 2> /dev/null \
          | cut -d= -f2- || { [ "$?" -eq 1 ] || exit 1; }
      done
  }
  prune_release_images() {
    local keep_list
    keep_list=$(kept_release_images) || {
      echo 'warning: cannot read shared-host release inventory; skipping tagged-image cleanup' >&2
      return 0
    }
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
  # Tagged rollback images above must survive regardless of their age.
  # --all would discard them (and unrelated stacks' images) host-wide.
  docker image prune -f --filter 'until=72h' > /dev/null || true
  docker builder prune -af --filter 'until=72h' > /dev/null || true
  report_phase cleanup

  docker compose ps --format '{{.Service}}\t{{.Status}}'
  echo "deployed $commit"
}

main "$@"
