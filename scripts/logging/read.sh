#!/usr/bin/env bash
# Safe read-only journal entry point. Requires journal read permission, not sudo.
set -euo pipefail
since='24 hours ago'
until='now'
lines=5000
follow=()
while (($#)); do
  case "$1" in
    --since|--until|--lines)
      (($# >= 2)) || { echo "missing value for $1" >&2; exit 2; }
      case "$1" in
        --since) since=$2 ;;
        --until) until=$2 ;;
        --lines) lines=$2 ;;
      esac
      shift 2 ;;
    --follow) follow=(--follow); shift ;;
    *) echo 'usage: read.sh [--since TIME] [--until TIME] [--lines 1..100000] [--follow]' >&2; exit 2 ;;
  esac
done
[[ "$lines" =~ ^[1-9][0-9]{0,5}$ ]] && ((lines <= 100000)) || { echo 'invalid line limit' >&2; exit 2; }
args=(--namespace=voiceroom --output=json --all --no-pager "--since=$since" "--lines=$lines")
# --until=now would stop a follow at the starting instant.
if ((${#follow[@]} == 0)); then args+=("--until=$until"); fi
exec journalctl "${args[@]}" "${follow[@]}"
