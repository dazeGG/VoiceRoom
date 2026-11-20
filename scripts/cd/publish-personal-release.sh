#!/usr/bin/env bash
set -euo pipefail

version=${1:?Expected release tag}
bundle=${2:?Expected bundle directory}
[[ "$version" =~ ^meet/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
# Publish the manifest last on existing releases so it only advertises available files.
files=(docker-compose.personal.yml install.sh manifest.json)
for file in "${files[@]}"; do
  test -s "$bundle/$file"
done

latest_status=0
latest=$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name 2>&1) || latest_status=$?
if (( latest_status != 0 )); then
  if [[ "$latest" != *'HTTP 404'* ]]; then
    echo 'Unable to read the latest GitHub Release.' >&2
    exit 1
  fi
  latest=
fi
mark_latest=true
if [[ "$latest" =~ ^meet/v[0-9]+\.[0-9]+\.[0-9]+$ ]] &&
  [[ $(printf '%s\n' "$latest" "$version" | sort -V | tail -n 1) != "$version" ]]; then
  mark_latest=false
fi

if ! release=$(gh release view "$version" --json isDraft,isPrerelease,assets 2>/dev/null); then
  previous=$(git tag --list 'meet/v*' --merged "$version" --sort=-version:refname |
    awk -v current="$version" '$0 != current && !seen { print; seen=1 }')
  # The initial Meet release starts where the old personal bundle stopped.
  if [[ -z "$previous" ]] && git merge-base --is-ancestor v2.15.0 "$version"; then previous=v2.15.0; fi
  range="${previous:+$previous..}$version"
  notes="Personal server installer and deployment bundle for VoiceRoom Meet ${version#meet/v}."
  changes=$(git log -20 --format='- %s' --no-merges "$range" -- \
    apps/meet apps/get apps/api packages/call packages/shared packages/ui Dockerfile docker-compose.personal.yml)
  if [[ -n "$changes" ]]; then notes+=$'\n\n'"$changes"; fi
  if [[ "$previous" == v2.15.0 ]]; then
    notes+=$'\n\n'"Upgrade an installation of v2.15.0 with \`curl -fsSL https://get.voiceroom.ru | sudo sh -s -- upgrade\`."
  fi
  gh release create "$version" --verify-tag --draft --title "VoiceRoom Meet ${version#meet/v}" --notes "$notes"
  release='{"isDraft":true,"isPrerelease":false,"assets":[]}'
fi

if jq -e '.isDraft' >/dev/null <<< "$release"; then
  gh release upload "$version" --clobber "${files[@]/#/$bundle/}"
  gh release edit "$version" --draft=false --prerelease=false --latest="$mark_latest"
  exit 0
fi

if jq -e '.isPrerelease' >/dev/null <<< "$release"; then
  echo 'The existing GitHub Release is marked as a prerelease.' >&2
  exit 1
fi

missing=()
for file in "${files[@]}"; do
  if ! jq -e --arg file "$file" 'any(.assets[]; .name == $file)' >/dev/null <<< "$release"; then
    missing+=("$file")
  fi
done
if (( ${#missing[@]} > 0 )); then
  existing=$(mktemp -d)
  trap 'rm -rf -- "$existing"' EXIT
  for file in "${files[@]}"; do
    if jq -e --arg file "$file" 'any(.assets[]; .name == $file)' >/dev/null <<< "$release"; then
      gh release download "$version" -p "$file" -O "$existing/$file"
      if ! cmp -s "$existing/$file" "$bundle/$file"; then
        echo "Published asset $file differs from the bundle. Refusing to change published bytes." >&2
        exit 1
      fi
    fi
  done
  gh release upload "$version" "${missing[@]/#/$bundle/}"
fi

if [[ "$mark_latest" == true && "$latest" != "$version" ]]; then
  gh release edit "$version" --latest
fi
