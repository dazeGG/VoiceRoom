#!/usr/bin/env bash
set -euo pipefail

version=${1:?Expected release tag}
bundle=${2:?Expected bundle directory}
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
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
if [[ "$latest" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] &&
  [[ $(printf '%s\n' "$latest" "$version" | sort -V | tail -n 1) != "$version" ]]; then
  mark_latest=false
fi

if ! release=$(gh release view "$version" --json isDraft,isPrerelease,assets 2>/dev/null); then
  notes="Personal server installer and deployment bundle for VoiceRoom ${version#v}."
  if [[ "$version" != *.0 ]]; then
    series=${version%.*}.0
    notes+=$'\n\n'"See the [series release notes](https://github.com/$GITHUB_REPOSITORY/releases/tag/$series#patch-releases)."
  fi
  gh release create "$version" --verify-tag --draft --title "VoiceRoom ${version#v}" --notes "$notes"
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
