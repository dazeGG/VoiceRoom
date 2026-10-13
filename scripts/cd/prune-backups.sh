#!/usr/bin/env bash
# Deletes database dumps and .env copies older than the retention period from
# the deploy backup folders. The privacy policy promises that backups (which
# still hold the data of deleted accounts) live no longer than 30 days.
#
# Usage: prune-backups.sh <deploy-path> [retention-days]
# remote-deploy.sh runs it after every rollout; a host may also run it from cron.
set -Eeuo pipefail

deploy_path=$1
days=${2:-${BACKUP_RETENTION_DAYS:-30}}
if ! [[ $days =~ ^[0-9]+$ ]] || ((days < 1)); then
  echo "retention must be a whole number of days, got '$days'" >&2
  exit 1
fi

for dir in "$deploy_path/deploy-backups/ci" "$deploy_path/deploy-backups/manual"; do
  [[ -d $dir ]] || continue
  # -mtime +N is "more than N whole days"; N-1 keeps a dump of exactly N days.
  find "$dir" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'env-*' \) -mtime +"$((days - 1))" -print -delete
done
