/** Only a disposable local SFU is allowed: this harness must never join production. */
export function loopbackLiveKitUrl(input: string): URL {
  const url = new URL(input);
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('SCREEN_BENCH_URL must be a credential-free loopback ws(s) origin.');
  return url;
}

export interface StartupSample {
  elapsedMs: number;
  streamId: string | null;
  fps: number | null;
  width: number | null;
  height: number | null;
}

export interface StartupResult {
  status: 'pass' | 'slow' | 'inconclusive';
  stableAtMs: number | null;
  confirmedAtMs: number | null;
}

/** Three consecutive one-second observations, never a peak or an average hiding a freeze. */
export function evaluateStartup(samples: readonly StartupSample[]): StartupResult {
  let first: StartupSample | null = null;
  let previous: StartupSample | null = null;
  let count = 0;
  for (const sample of samples) {
    const good =
      sample.streamId &&
      Number.isFinite(sample.fps) &&
      (sample.fps ?? 0) >= 27 &&
      (sample.width ?? 0) >= 1280 &&
      (sample.height ?? 0) >= 720;
    const consecutive =
      previous &&
      sample.streamId === previous.streamId &&
      sample.elapsedMs > previous.elapsedMs &&
      sample.elapsedMs - previous.elapsedMs <= 1800;
    if (!good) {
      first = null;
      count = 0;
    } else {
      if (!consecutive || !first) {
        first = sample;
        count = 0;
      }
      count += 1;
      if (count === 3 && first)
        return {
          status: first.elapsedMs <= 5000 ? 'pass' : 'slow',
          stableAtMs: first.elapsedMs,
          confirmedAtMs: sample.elapsedMs
        };
    }
    previous = sample;
  }
  return { status: 'inconclusive', stableAtMs: null, confirmedAtMs: null };
}

/** RGB error for equal RGBA regions. null PSNR with zero MAE denotes an exact match. */
export function rgbPixelError(
  reference: ArrayLike<number>,
  actual: ArrayLike<number>
): { mae: number; psnr: number | null } {
  if (!reference.length || reference.length !== actual.length || reference.length % 4 !== 0) {
    throw new Error('Pixel regions must be equal, nonempty RGBA arrays.');
  }
  let absolute = 0;
  let squared = 0;
  for (let index = 0; index < reference.length; index++) {
    if (index % 4 === 3) continue;
    const a = reference[index],
      b = actual[index];
    if (
      a === undefined ||
      b === undefined ||
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a < 0 ||
      a > 255 ||
      b < 0 ||
      b > 255
    ) {
      throw new Error('Invalid RGB sample.');
    }
    const error = a - b;
    absolute += Math.abs(error);
    squared += error * error;
  }
  const count = (reference.length * 3) / 4;
  const mse = squared / count;
  return { mae: absolute / count, psnr: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse) };
}
