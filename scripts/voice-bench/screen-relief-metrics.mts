/** Synthetic loopback work/voice gates, separate from a claim about total CPU. */
export interface ReliefSample {
  elapsedMs: number;
  captureFps: number | null;
  encodedFps: number | null;
  renderedFps: number | null;
  width: number | null;
  height: number | null;
  audioSamples: number | null;
  audioEnergy: number | null;
  concealedSamples: number | null;
  encodeMsPerSecond: number | null;
  codec: string | null;
  encoder: string | null;
}

export interface CpuSnapshot {
  atMs: number;
  processes: { id: number; type: string; cpuTime: number }[];
}

/** CDP CPU is cumulative seconds across threads, not percent of the machine. */
export function cpuMillisecondsPerSecond(before: CpuSnapshot, after: CpuSnapshot): number | null {
  const elapsed = after.atMs - before.atMs;
  if (elapsed <= 0 || !Number.isFinite(elapsed) || !before.processes.length) return null;
  if (before.processes.length !== after.processes.length) return null;
  let seconds = 0;
  const ids = new Set<number>();
  for (const current of after.processes) {
    const previous = before.processes.find((process) => process.id === current.id && process.type === current.type);
    if (!previous || ids.has(current.id)) return null;
    ids.add(current.id);
    const delta = current.cpuTime - previous.cpuTime;
    if (!Number.isFinite(delta) || delta < 0) return null;
    seconds += delta;
  }
  return (seconds * 1_000_000) / elapsed;
}

export interface ReliefPhase {
  relieved: boolean;
  samples: ReliefSample[];
  cpuMsPerSecond: number | null;
  transition: {
    sameTrack: boolean;
    audioSamples: number | null;
    audioEnergy: number | null;
    concealedSamples: number | null;
  } | null;
}

export function evaluateRelief(phases: readonly ReliefPhase[]) {
  const complete = phases.length === 4 && phases.every((phase, i) => phase.relieved === (i === 1 || i === 2));
  let missing = !complete;
  let healthy = true;
  const codecs = new Set<string | null>();
  const encoders = new Set<string | null>();
  for (const phase of phases) {
    if (phase.relieved) {
      const transition = phase.transition;
      if (
        !transition ||
        [transition.audioSamples, transition.audioEnergy, transition.concealedSamples].some(
          (value) => value === null || !Number.isFinite(value)
        )
      )
        missing = true;
      if (
        !transition?.sameTrack ||
        !(transition.audioSamples && transition.audioSamples > 0) ||
        !(transition.audioEnergy && transition.audioEnergy > 0) ||
        transition.concealedSamples !== 0
      )
        healthy = false;
    }
    if (phase.samples.length < 20) missing = true;
    let previousAt = 0;
    for (const sample of phase.samples) {
      codecs.add(sample.codec);
      encoders.add(sample.encoder);
      const fields = [
        sample.captureFps,
        sample.encodedFps,
        sample.renderedFps,
        sample.width,
        sample.height,
        sample.audioSamples,
        sample.audioEnergy,
        sample.concealedSamples
      ];
      if (fields.some((value) => value === null || !Number.isFinite(value))) missing = true;
      if (sample.elapsedMs <= previousAt || sample.elapsedMs - previousAt > 1800) missing = true;
      previousAt = sample.elapsedMs;
      const minimum = phase.relieved ? 12 : 25;
      const maximum = phase.relieved ? 17 : 35;
      for (const fps of [sample.captureFps, sample.encodedFps, sample.renderedFps]) {
        if (fps !== null && (fps < minimum || fps > maximum)) healthy = false;
      }
      if (
        sample.width !== 1280 ||
        sample.height !== 720 ||
        !(sample.audioSamples && sample.audioSamples > 0) ||
        !(sample.audioEnergy && sample.audioEnergy > 0) ||
        sample.concealedSamples !== 0
      )
        healthy = false;
    }
    if ((phase.samples.at(-1)?.elapsedMs ?? 0) < 20_000) missing = true;
  }
  if (codecs.size !== 1 || codecs.has(null) || codecs.has('')) missing = true;
  const workAndVoice = missing ? 'inconclusive' : healthy ? 'pass' : 'fail';
  const baseline = phases.filter((phase) => !phase.relieved).map((phase) => phase.cpuMsPerSecond);
  const relieved = phases.filter((phase) => phase.relieved).map((phase) => phase.cpuMsPerSecond);
  const finite = (values: (number | null)[]): values is number[] =>
    values.length === 2 && values.every((value) => value !== null && Number.isFinite(value) && value > 0);
  const cpuImprovement =
    workAndVoice !== 'pass' ||
    !finite(baseline) ||
    !finite(relieved) ||
    encoders.size !== 1 ||
    encoders.has(null) ||
    encoders.has('')
      ? 'inconclusive'
      : Math.max(...relieved) <= Math.min(...baseline) * 0.9
        ? 'pass'
        : 'not-demonstrated';
  return { workAndVoice, cpuImprovement, complete } as const;
}
