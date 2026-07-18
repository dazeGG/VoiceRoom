#!/usr/bin/env bash
set -euo pipefail

host="$(uname -s)-$(uname -m)"
case "$host" in
Linux-x86_64) platform=linux_amd64; archive=oras_1.3.3_linux_amd64.tar.gz; sha=9ce999f8d2de03fc03968b29d743077a58783e545e5eaa53917ca177352d0e59;;
Darwin-arm64) platform=darwin_arm64; archive=oras_1.3.3_darwin_arm64.tar.gz; sha=f33fc12753c54172b0d0d19eaa0318d3f90fe9b094d96e8b259c881713c92e1c;;
*) echo "unsupported pinned ORAS platform" >&2; exit 1;;
esac

cache="${XDG_CACHE_HOME:-$HOME/.cache}/voiceroom-tools/oras-v1.3.3/$platform"
mkdir -p "$cache"
file="$cache/$archive"
bin="$cache/oras"

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
  download "https://github.com/oras-project/oras/releases/download/v1.3.3/$archive" "$file"
  hash_ok "$sha" "$file" || { rm -f "$file"; echo "ORAS archive digest mismatch" >&2; exit 1; }
fi

if [[ "$host" == Linux-* ]]; then
  sig="$cache/$archive.asc"; sums="$cache/oras_1.3.3_checksums.txt"; keys="$cache/KEYS"
  [[ -f "$sig" ]] || download "https://github.com/oras-project/oras/releases/download/v1.3.3/$archive.asc" "$sig"
  [[ -f "$sums" ]] || download "https://github.com/oras-project/oras/releases/download/v1.3.3/oras_1.3.3_checksums.txt" "$sums"
  [[ -f "$keys" ]] || download "https://raw.githubusercontent.com/oras-project/oras/210747c29c1d38732b3194878dfd8b5a6b9ad7eb/KEYS" "$keys"
  hash_ok 4b101042ee0b95b893de6f0ce6a4ec6ddfbff98df1ed23389de6c4e1ec1c1baf "$sig" || { rm -f "$sig"; echo "ORAS signature digest mismatch" >&2; exit 1; }
  hash_ok 5cf7ff102a941bdb35e8eabfc8cbe937c5387d20e7a2ee75dc4be90410e462cd "$sums" || { rm -f "$sums"; echo "ORAS checksums digest mismatch" >&2; exit 1; }
  hash_ok e901b09b9c6dbe6e068b4ca8dbd93dc761acbccc1439c032226981f0b476fa70 "$keys" || { rm -f "$keys"; echo "ORAS KEYS digest mismatch" >&2; exit 1; }
  grep -Fx "9ce999f8d2de03fc03968b29d743077a58783e545e5eaa53917ca177352d0e59  $archive" "$sums" >/dev/null
  gnupg="$(mktemp -d "$cache/gnupg.XXXXXX")"; chmod 700 "$gnupg"
  trap 'rm -rf "$gnupg"' EXIT
  gpg --batch --homedir "$gnupg" --import "$keys" >/dev/null 2>&1
  gpg --batch --homedir "$gnupg" --status-fd 1 --verify "$sig" "$file" 2>/dev/null | grep -F 'VALIDSIG 2DA461D13B0C27845EDFA77FE462A3894CBAAA47 ' >/dev/null
  rm -rf "$gnupg"; trap - EXIT
  curl --proto '=https' --tlsv1.2 -fsSL https://api.github.com/repos/oras-project/oras/git/ref/tags/v1.3.3 | grep -F 'd6f59b4e6615cadfc8343dc9a066d781300c5967' >/dev/null
  curl --proto '=https' --tlsv1.2 -fsSL https://api.github.com/repos/oras-project/oras/git/tags/d6f59b4e6615cadfc8343dc9a066d781300c5967 | grep -F '210747c29c1d38732b3194878dfd8b5a6b9ad7eb' >/dev/null
fi

extract="$(mktemp -d "$cache/extract.XXXXXX")"
trap 'rm -rf "$extract"' EXIT
tar -xzf "$file" -C "$extract" oras
candidate="$extract/oras"
[[ -f "$candidate" && ! -L "$candidate" ]] || { echo "invalid ORAS archive member" >&2; exit 1; }
chmod 0755 "$candidate"
out="$("$candidate" version)"
grep -Eq 'Version:[[:space:]]+1\.3\.3' <<<"$out"
grep -Eq 'Git commit:[[:space:]]+210747c29c1d38732b3194878dfd8b5a6b9ad7eb' <<<"$out"
rm -f "$bin"
mv "$candidate" "$bin"
trap - EXIT
rm -rf "$extract"
exec "$bin" "$@"
