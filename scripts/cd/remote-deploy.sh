#!/usr/bin/env bash
# Runs on a deploy host (piped over SSH by .github/workflows/deploy.yml).
# Rolls the compose stack in <deploy-path> to <commit> and the given images.
# Any failure after the backups restores the previous commit, .env and containers.
# Database migrations are not reverted: restore the dump taken here instead.
#
# Usage: remote-deploy.sh <deploy-path> <commit> <api-image> <worker-image> <web-image>
set -Eeuo pipefail

deploy_path=$1
commit=$2
api_image=$3
worker_image=$4
web_image=$5
keep=${KEEP_DEPLOY_BACKUPS:-5}

cd "$deploy_path"
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

echo "== backing up .env and the database ($previous_commit -> $commit)"
cp .env "$env_backup"
chmod 600 "$env_backup"
db_dump="$backup_dir/db-$stamp.dump"
if ! docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$db_dump"; then
  rm -f "$db_dump"
  echo "database backup failed, nothing was changed" >&2
  exit 1
fi
chmod 600 "$db_dump"

rollback() {
  trap - ERR
  echo "== deploy failed, restoring $previous_commit and the previous .env" >&2
  cp "$env_backup" .env
  git checkout --quiet --detach "$previous_commit"
  docker compose up -d --remove-orphans || true
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

echo "== rolling out"
docker compose up -d --remove-orphans --wait --wait-timeout 300
trap - ERR

echo "== cleaning up"
prune_oldest() {
  find "$backup_dir" -maxdepth 1 -type f -name "$1" -printf '%T@ %p\n' \
    | sort -rn | tail -n +"$((keep + 1))" | cut -d' ' -f2- | xargs -r rm -f
}
prune_oldest 'db-*.dump'
prune_oldest 'env-*'
docker image prune -af --filter 'until=72h' > /dev/null
docker builder prune -af --filter 'until=72h' > /dev/null

docker compose ps --format '{{.Service}}\t{{.Status}}'
echo "deployed $commit"
