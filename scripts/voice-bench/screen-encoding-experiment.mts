import type { TrackPublishOptions } from 'livekit-client';
import type { StartupSample } from './screen-startup-metrics.mts';

export type ScreenEncodingVariant = 'default' | 'single-layer' | 'motion-framerate';

export function screenEncodingVariant(value: string | undefined): ScreenEncodingVariant {
  if (value === undefined || value === 'default') return 'default';
  if (value === 'single-layer' || value === 'motion-framerate') return value;
  throw new Error('SCREEN_BENCH_VARIANT: default, single-layer or motion-framerate.');
}

/** Benchmark-only overrides: never imported by application code or persisted. */
export function screenEncodingOptions(
  options: TrackPublishOptions,
  variant: ScreenEncodingVariant
): TrackPublishOptions {
  if (variant === 'single-layer') return { ...options, simulcast: false, screenShareSimulcastLayers: [] };
  if (variant === 'motion-framerate') return { ...options, degradationPreference: 'maintain-framerate' };
  return { ...options };
}

/** Separate from startup: three good early seconds must not hide a later collapse. */
export function evaluateSustained(samples: readonly StartupSample[]): {
  status: 'pass' | 'degraded' | 'inconclusive';
  observations: number;
  goodObservations: number;
} {
  const window = samples.filter((sample) => sample.elapsedMs > 5000);
  let goodObservations = 0;
  let missing = false;
  let previous: StartupSample | undefined = samples.filter((sample) => sample.elapsedMs <= 5000).at(-1);
  for (const sample of window) {
    if (
      !sample.streamId ||
      sample.fps === null ||
      !Number.isFinite(sample.fps) ||
      sample.width === null ||
      sample.height === null ||
      !Number.isFinite(sample.width) ||
      !Number.isFinite(sample.height) ||
      (!previous && sample.elapsedMs > 6800) ||
      (previous &&
        (sample.streamId !== previous.streamId ||
          sample.elapsedMs <= previous.elapsedMs ||
          sample.elapsedMs - previous.elapsedMs > 1800))
    ) {
      missing = true;
    } else if (sample.fps >= 27 && sample.width >= 1280 && sample.height >= 720) {
      goodObservations++;
    }
    previous = sample;
  }
  const first = window[0],
    last = window.at(-1);
  const longEnough = window.length >= 30 && first && last && last.elapsedMs - first.elapsedMs >= 29_000;
  return {
    status: !longEnough || missing ? 'inconclusive' : goodObservations === window.length ? 'pass' : 'degraded',
    observations: window.length,
    goodObservations
  };
}
