#!/usr/bin/env bash
# Rebuilds public/rnnoise/rnnoise.wasm byte for byte (see ../README.md).
# Needs git, curl, sha256sum and Docker. Writes only under the given work dir
# (default: a temp dir) and the output path.
#   bash apps/web/scripts/rnnoise/wasm/build-wasm.sh [out.wasm] [work-dir]
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$here/../../../public/rnnoise/rnnoise.wasm}
work=${2:-$(mktemp -d)}
emsdk=emscripten/emsdk:6.0.13
# xiph/rnnoise tag v0.2 and its model tarball. v0.2's model_version names the
# tarball without a checksum; this sha256 is the one VoiceRoom shipped.
ref=904a876dce1f9ab8860c0a5000ed151f9f6eef58
model=rnnoise_data-0b50c45.tar.gz
model_sha=4ac81c5c0884ec4bd5907026aaae16209b7b76cd9d7f71af582094a2f98f4b43

mkdir -p "$work"
cd "$work"
if [ ! -d rnnoise ]; then
  git init -q rnnoise
  git -C rnnoise fetch -q --depth 1 https://gitlab.xiph.org/xiph/rnnoise.git "$ref"
  git -C rnnoise checkout -q FETCH_HEAD
fi
[ -f "$model" ] || curl -sfL -o "$model" "https://media.xiph.org/rnnoise/models/$model"
echo "$model_sha  $model" | sha256sum -c --quiet
[ -f rnnoise/src/rnnoise_data.c ] || tar -xzf "$model" -C rnnoise
cp "$here/pipe.c" "$here/os_support.h" rnnoise/

sources=""
for f in denoise.c rnn.c pitch.c kiss_fft.c celt_lpc.c nnet.c nnet_default.c parse_lpcnet_weights.c rnnoise_tables.c rnnoise_data.c; do
  sources="$sources src/$f"
done

# Fixed 8 MiB memory: the worklet caches a Float32Array over memory.buffer, so
# the memory must never grow. The model data takes ~5.6 MB; v0.2 needs a 1 MB
# stack (64 KB overflows into the heap). -mavx takes RNNoise's x86 kernels,
# which Emscripten maps to WASM SIMD (twice the speed of the scalar build).
# shellcheck disable=SC2086
MSYS_NO_PATHCONV=1 docker run --rm -v "$work/rnnoise:/src" -w /src "$emsdk" \
  emcc -s ENVIRONMENT=worker -s STACK_SIZE=1048576 -s INITIAL_MEMORY=8388608 -s ALLOW_MEMORY_GROWTH=0 \
  -g0 -O3 --no-entry -Wno-null-dereference -msimd128 -mavx \
  -Iinclude -Isrc -I. $sources pipe.c -o rnnoise.wasm

cp "$work/rnnoise/rnnoise.wasm" "$out"
sha256sum "$out"
