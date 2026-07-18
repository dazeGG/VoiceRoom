#!/usr/bin/env bash
set -euo pipefail

host="$(uname -s)-$(uname -m)"
case "$host" in
Linux-x86_64) platform=linux_amd64;;
Darwin-arm64) platform=darwin_arm64;;
*) echo "unsupported pinned ORAS platform" >&2; exit 1;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lock_file="$repo_root/config/tool-locks/oras-v1.3.3.json"
IFS=$'\t' read -r owner repository tag version tag_object source_commit signer_fingerprint archive sha sig_sha sums_name sums_sha keys_url keys_sha download_base < <(
  node -e '
    const fs = require("node:fs");
    const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const asset = lock.assets?.[process.argv[2]];
    const hex = /^[0-9a-f]{64}$/;
    const sha = /^[0-9a-f]{40}$/;
    if (!asset || !hex.test(asset.sha256) || !hex.test(asset.signatureSha256) ||
        !hex.test(lock.checksums?.sha256) || !hex.test(lock.keys?.sha256) ||
        !sha.test(lock.tagObject) || !sha.test(lock.sourceCommit) ||
        !/^[0-9A-F]{40}$/.test(lock.signerFingerprint)) process.exit(1);
    const values = [lock.owner, lock.repository, lock.tag, lock.version, lock.tagObject,
      lock.sourceCommit, lock.signerFingerprint, asset.name, asset.sha256,
      asset.signatureSha256, lock.checksums.name, lock.checksums.sha256,
      lock.keys.url, lock.keys.sha256, lock.downloadBase];
    if (values.some((value) => typeof value !== "string" || !value || /[\t\r\n]/.test(value))) process.exit(1);
    process.stdout.write(values.join("\t") + "\n");
  ' "$lock_file" "$platform"
)

cache="${XDG_CACHE_HOME:-$HOME/.cache}/voiceroom-tools/oras-v${version}/$platform"
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
  download "$download_base/$archive" "$file"
  hash_ok "$sha" "$file" || { rm -f "$file"; echo "ORAS archive digest mismatch" >&2; exit 1; }
fi

sig="$cache/$archive.asc"; sums="$cache/$sums_name"; keys="$cache/KEYS"
[[ -f "$sig" ]] || download "$download_base/$archive.asc" "$sig"
[[ -f "$sums" ]] || download "$download_base/$sums_name" "$sums"
[[ -f "$keys" ]] || download "$keys_url" "$keys"
  hash_ok "$sig_sha" "$sig" || { rm -f "$sig"; echo "ORAS signature digest mismatch" >&2; exit 1; }
  hash_ok "$sums_sha" "$sums" || { rm -f "$sums"; echo "ORAS checksums digest mismatch" >&2; exit 1; }
  hash_ok "$keys_sha" "$keys" || { rm -f "$keys"; echo "ORAS KEYS digest mismatch" >&2; exit 1; }
  grep -Fx "$sha  $archive" "$sums" >/dev/null
  gnupg="$(mktemp -d "$cache/gnupg.XXXXXX")"; chmod 700 "$gnupg"
  trap 'rm -rf "$gnupg"' EXIT
  gpg --batch --homedir "$gnupg" --import "$keys" >/dev/null 2>&1
  gpg --batch --homedir "$gnupg" --status-fd 1 --verify "$sig" "$file" 2>/dev/null | grep -F "VALIDSIG $signer_fingerprint " >/dev/null
  rm -rf "$gnupg"; trap - EXIT
curl --proto '=https' --tlsv1.2 -fsSL "https://api.github.com/repos/$owner/$repository/git/ref/tags/$tag" | grep -F "$tag_object" >/dev/null
curl --proto '=https' --tlsv1.2 -fsSL "https://api.github.com/repos/$owner/$repository/git/tags/$tag_object" | grep -F "$source_commit" >/dev/null

extract="$(mktemp -d "$cache/extract.XXXXXX")"
trap 'rm -rf "$extract"' EXIT
tar -xzf "$file" -C "$extract" oras
candidate="$extract/oras"
[[ -f "$candidate" && ! -L "$candidate" ]] || { echo "invalid ORAS archive member" >&2; exit 1; }
chmod 0755 "$candidate"
out="$("$candidate" version)"
grep -Eq "Version:[[:space:]]+${version//./\\.}" <<<"$out"
grep -Eq "Git commit:[[:space:]]+$source_commit" <<<"$out"
rm -f "$bin"
mv "$candidate" "$bin"
trap - EXIT
rm -rf "$extract"
exec "$bin" "$@"
