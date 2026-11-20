#!/bin/sh
# Both builds use these fixed public paths with a content hash in the query.
# Keep the exact bytes for open tabs and for clients on different releases.
# The concatenation order matches packages/call/src/voice-assets.ts.
set -eu
src=$1
archive=$2
set -- audio-gate.worklet.js desktop-audio-source.worklet.js rnnoise/rnnoise.mjs rnnoise/rnnoise.wasm rnnoise/rnnoise.worklet.js
for file do test -s "$src/$file"; done
version=$(cd "$src" && cat "$@" | sha256sum | cut -c1-12)
dest=$archive/_voice/$version
if [ -d "$dest" ]; then
  exit 0
fi
mkdir -p "$archive/_voice"
staging=$(mktemp -d "$archive/_voice/.copy.XXXXXXXX")
trap 'rm -rf "$staging"' EXIT
chmod 755 "$staging"
mkdir "$staging/rnnoise"
for file do
  cp -p "$src/$file" "$staging/$file"
  for format in br gz; do
    if [ -f "$src/$file.$format" ]; then
      cp -p "$src/$file.$format" "$staging/$file.$format"
    fi
  done
done
mv "$staging" "$dest"
