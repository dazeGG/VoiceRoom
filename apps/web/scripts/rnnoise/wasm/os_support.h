/* rnnoise v0.2/master vec.h includes "os_support.h" (an Opus header) on its
 * portable no-SIMD path, but the file is not in the rnnoise tree. That path
 * only clears buffers: master calls RNN_CLEAR, which common.h defines, and
 * v0.2 still calls the Opus name OPUS_CLEAR. This header supplies that alias
 * so the scalar build compiles. SIMD builds take the vec_avx.h path instead. */
#ifndef BENCH_OS_SUPPORT_H
#define BENCH_OS_SUPPORT_H
#include "common.h"
#ifndef OPUS_CLEAR
#define OPUS_CLEAR(dst, n) RNN_CLEAR(dst, n)
#endif
#endif
