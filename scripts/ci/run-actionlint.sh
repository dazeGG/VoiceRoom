#!/usr/bin/env bash
set -euo pipefail
[[ $# -gt 0 ]] || { echo "usage: run-actionlint.sh WORKFLOW..." >&2; exit 2; }

host="$(uname -s)-$(uname -m)"
case "$host" in
Linux-x86_64) platform=linux_amd64; archive=actionlint_1.7.12_linux_amd64.tar.gz; sha=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8;;
Darwin-arm64) platform=darwin_arm64; archive=actionlint_1.7.12_darwin_arm64.tar.gz; sha=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f;;
*) echo "unsupported pinned actionlint platform" >&2; exit 1;;
esac

cache="${XDG_CACHE_HOME:-$HOME/.cache}/voiceroom-tools/actionlint-v1.7.12/$platform"
mkdir -p "$cache"
file="$cache/$archive"
bin="$cache/actionlint"

hash_ok() {
  if [[ "$host" == Linux-* ]]; then printf '%s  %s\n' "$1" "$2" | sha256sum --check --strict >/dev/null 2>&1
  else printf '%s  %s\n' "$1" "$2" | shasum -a 256 -c >/dev/null 2>&1; fi
}

download() {
  local url="$1" destination="$2" temporary
  temporary="$(mktemp "$cache/download.XXXXXX")"
  curl --proto '=https' --tlsv1.2 -fsSLo "$temporary" "$url"
  mv -f "$temporary" "$destination"
}

if ! hash_ok "$sha" "$file"; then
  rm -f "$file" "$bin"
  download "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$archive" "$file"
  hash_ok "$sha" "$file" || { rm -f "$file"; echo "actionlint archive digest mismatch" >&2; exit 1; }
fi

command -v gh >/dev/null
gh attestation verify "$file" -R rhysd/actionlint >/dev/null
sums="$cache/actionlint_1.7.12_checksums.txt"
[[ -f "$sums" ]] || download "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_checksums.txt" "$sums"
hash_ok 433028cf0ba3c42163ea1a668dedce30fcdbe84fe912b1a5e288c006eab8a4f5 "$sums" || { rm -f "$sums"; echo "actionlint checksums digest mismatch" >&2; exit 1; }
grep -Fx "$sha  $archive" "$sums" >/dev/null
release="$cache/release.json"; download https://api.github.com/repos/rhysd/actionlint/releases/303326868 "$release"
grep -F '"tag_name": "v1.7.12"' "$release" >/dev/null
grep -F "\"name\": \"$archive\"" "$release" >/dev/null
tag="$cache/tag.json"; download https://api.github.com/repos/rhysd/actionlint/git/ref/tags/v1.7.12 "$tag"
grep -F '914e7df21a07ef503a81201c76d2b11c789d3fca' "$tag" >/dev/null
if [[ "$host" == Linux-* ]]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://api.github.com/repos/rhysd/actionlint/releases/assets/384924896 | grep -F '"size": 2353908' >/dev/null
fi

extract="$(mktemp -d "$cache/extract.XXXXXX")"
trap 'rm -rf "$extract"' EXIT
tar -xzf "$file" -C "$extract" actionlint
candidate="$extract/actionlint"
[[ -f "$candidate" && ! -L "$candidate" ]] || { echo "invalid actionlint archive member" >&2; exit 1; }
chmod 0755 "$candidate"
[[ "$("$candidate" -version | head -n1)" == "1.7.12" ]] || { echo "unexpected actionlint version" >&2; exit 1; }
rm -f "$bin"
mv "$candidate" "$bin"
trap - EXIT
rm -rf "$extract"
exec "$bin" "$@"
