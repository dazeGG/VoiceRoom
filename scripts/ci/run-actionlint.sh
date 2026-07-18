#!/usr/bin/env bash
set -euo pipefail
[[ $# -gt 0 ]] || { echo "usage: run-actionlint.sh WORKFLOW..." >&2; exit 2; }
host="$(uname -s)-$(uname -m)"
case "$host" in
Linux-x86_64) platform=linux_amd64; archive=actionlint_1.7.12_linux_amd64.tar.gz; sha=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8;;
Darwin-arm64) platform=darwin_arm64; archive=actionlint_1.7.12_darwin_arm64.tar.gz; sha=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f;;
*) echo "unsupported pinned actionlint platform" >&2; exit 1;; esac
cache="${XDG_CACHE_HOME:-$HOME/.cache}/voiceroom-tools/actionlint-v1.7.12/$platform"; mkdir -p "$cache"; file="$cache/$archive"; bin="$cache/actionlint"
if [[ ! -x "$bin" ]]; then
  curl --proto '=https' --tlsv1.2 -fsSLo "$file" "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$archive"
  if [[ "$host" == Linux-* ]]; then printf '%s  %s\n' "$sha" "$file" | sha256sum --check --strict; else printf '%s  %s\n' "$sha" "$file" | shasum -a 256 -c; fi
  command -v gh >/dev/null
  gh attestation verify "$file" -R rhysd/actionlint >/dev/null
  if [[ "$host" == Linux-* ]]; then
    sums="$cache/actionlint_1.7.12_checksums.txt"
    curl --proto '=https' --tlsv1.2 -fsSLo "$sums" https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_checksums.txt
    printf '%s  %s\n' 433028cf0ba3c42163ea1a668dedce30fcdbe84fe912b1a5e288c006eab8a4f5 "$sums" | sha256sum --check --strict
    grep -F "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  $archive" "$sums" >/dev/null
    curl --proto '=https' --tlsv1.2 -fsSL https://api.github.com/repos/rhysd/actionlint/releases/303326868 | grep -F '"tag_name": "v1.7.12"' >/dev/null
    curl --proto '=https' --tlsv1.2 -fsSL https://api.github.com/repos/rhysd/actionlint/releases/assets/384924896 | grep -F '"size": 2353908' >/dev/null
    curl --proto '=https' --tlsv1.2 -fsSL https://api.github.com/repos/rhysd/actionlint/git/ref/tags/v1.7.12 | grep -F '914e7df21a07ef503a81201c76d2b11c789d3fca' >/dev/null
  fi
  tar -xzf "$file" -C "$cache" actionlint
fi
[[ "$("$bin" -version | head -n1)" == "1.7.12" ]] || exit 1
exec "$bin" "$@"
