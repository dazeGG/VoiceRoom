import type { TrackPublishOptions } from 'livekit-client';
import { evaluateStartup, type StartupSample } from './screen-startup-metrics.mts';

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
  let missing = samples.some((sample, index) => {
    const prior = samples[index - 1];
    return !Number.isFinite(sample.elapsedMs) || (index > 0 && (!prior || sample.elapsedMs <= prior.elapsedMs));
  });
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
      !previous ||
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
  const longEnough = first && last && last.elapsedMs - first.elapsedMs >= 120_000;
  return {
    status: !longEnough || missing ? 'inconclusive' : goodObservations === window.length ? 'pass' : 'degraded',
    observations: window.length,
    goodObservations
  };
}

/** Decoded FPS remains diagnostic; playback FPS alone drives both gates. */
export interface RenderedSample extends StartupSample {
  renderedFps: number | null;
}

export function evaluateCase(samples: readonly RenderedSample[]) {
  const rendered = samples.map((sample) => ({ ...sample, fps: sample.renderedFps }));
  return { result: evaluateStartup(rendered), sustained: evaluateSustained(rendered) };
}

export const expectedCases = ['first-share-delayed-viewer', 'dynacast-resume', 'republish-same-connection'] as const;

export function evaluateRun(seconds: number, cases: readonly ({ name: string } & ReturnType<typeof evaluateCase>)[]) {
  const mode = seconds >= 126 ? 'startup-and-sustained' : 'startup-only';
  const names = cases.map((item) => item.name);
  const complete =
    names.length === expectedCases.length &&
    expectedCases.every((name) => names.filter((item) => item === name).length === 1);
  const pass =
    complete &&
    cases.every(
      (item) => item.result.status === 'pass' && (mode === 'startup-only' || item.sustained.status === 'pass')
    );
  return {
    mode,
    complete,
    status: pass ? 'pass' : 'fail',
    sustainedProven: pass && mode === 'startup-and-sustained'
  } as const;
}
