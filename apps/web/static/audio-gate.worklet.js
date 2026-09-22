const DEFAULT_OPTIONS = {
  attackMs: 8,
  closeRatio: 0.65,
  detectorAttackMs: 4,
  detectorReleaseMs: 55,
  floorGain: 0.02,
  holdMs: 140,
  releaseMs: 160,
  threshold: 0,
  // Automatic sensitivity: the threshold follows the room's noise floor
  // instead of a fixed level, the way Discord's "automatically determine input
  // sensitivity" does. The floor drops at once to any quieter block and creeps
  // up slowly, so speech never raises it but a fan switching on eventually does.
  auto: false,
  autoMarginDb: 12,
  autoMinDb: -62,
  autoMaxDb: -26,
  autoFloorRiseDbPerSecond: 3
};

function dbToAmplitude(db) {
  return 10 ** (db / 20);
}

function getSmoothingCoefficient(milliseconds) {
  const duration = Math.max(0.001, milliseconds / 1000);
  return 1 - Math.exp(-1 / (duration * sampleRate));
}

class VoiceRoomNoiseGateProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();

    const processorOptions = {
      ...DEFAULT_OPTIONS,
      ...(options.processorOptions || {})
    };

    this.threshold = Math.max(0, Number(processorOptions.threshold) || 0);
    this.closeThreshold = this.threshold * Math.max(0, Math.min(1, processorOptions.closeRatio));
    this.floorGain = Math.max(0, Math.min(1, processorOptions.floorGain));
    this.holdSamples = Math.round(Math.max(0, processorOptions.holdMs) * sampleRate / 1000);
    this.holdRemaining = 0;
    this.detector = 0;
    this.gain = this.threshold > 0 ? this.floorGain : 1;
    this.open = false;
    this.attackCoefficient = getSmoothingCoefficient(processorOptions.attackMs);
    this.releaseCoefficient = getSmoothingCoefficient(processorOptions.releaseMs);
    this.detectorAttackCoefficient = getSmoothingCoefficient(processorOptions.detectorAttackMs);
    this.detectorReleaseCoefficient = getSmoothingCoefficient(processorOptions.detectorReleaseMs);
    this.closeRatio = Math.max(0, Math.min(1, processorOptions.closeRatio));

    this.auto = Boolean(processorOptions.auto);
    this.forcedOpen = false;
    this.autoMargin = dbToAmplitude(processorOptions.autoMarginDb);
    this.autoMin = dbToAmplitude(processorOptions.autoMinDb);
    this.autoMax = dbToAmplitude(processorOptions.autoMaxDb);
    // Per 128-sample render quantum: how far the floor may rise.
    this.floorRise = dbToAmplitude(processorOptions.autoFloorRiseDbPerSecond * 128 / sampleRate);
    this.floor = this.autoMin;
    if (this.auto) this.applyAutoThreshold();

    this.port.onmessage = (event) => {
      if (event.data?.type === 'set-threshold') this.setThreshold(event.data.threshold);
      else if (event.data?.type === 'set-auto') this.setAuto(event.data.auto);
    };
  }

  setAuto(value) {
    this.auto = Boolean(value);
    if (this.auto && !this.forcedOpen) this.applyAutoThreshold();
  }

  applyAutoThreshold() {
    const threshold = Math.min(this.autoMax, Math.max(this.autoMin, this.floor * this.autoMargin));
    this.threshold = threshold;
    this.closeThreshold = threshold * this.closeRatio;
  }

  trackNoiseFloor(input) {
    let sum = 0;
    for (let index = 0; index < input.length; index += 1) sum += input[index] * input[index];
    const rms = Math.sqrt(sum / Math.max(1, input.length));
    // A quieter block is the new floor right away; a louder one only nudges it.
    this.floor = rms < this.floor ? Math.max(rms, this.autoMin / 4) : Math.min(this.floor * this.floorRise, rms);
    this.applyAutoThreshold();
  }

  setThreshold(value) {
    const threshold = Math.max(0, Number(value) || 0);
    // Zero is the push-to-talk override: open fully until a real threshold
    // comes back, even in automatic mode.
    this.forcedOpen = threshold <= 0;
    if (this.auto && !this.forcedOpen) {
      this.applyAutoThreshold();
      return;
    }
    this.threshold = threshold;
    this.closeThreshold = this.threshold * this.closeRatio;
    if (this.threshold <= 0) {
      this.open = true;
      this.holdRemaining = this.holdSamples;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;

    if (!input) {
      output.fill(0);
      return true;
    }

    if (this.auto && !this.forcedOpen) this.trackNoiseFloor(input);

    for (let index = 0; index < output.length; index += 1) {
      const sample = input[index] || 0;
      const level = Math.abs(sample);
      const detectorCoefficient = level > this.detector
        ? this.detectorAttackCoefficient
        : this.detectorReleaseCoefficient;
      this.detector += (level - this.detector) * detectorCoefficient;

      if (this.detector >= this.threshold) {
        this.open = true;
        this.holdRemaining = this.holdSamples;
      } else if (this.open && this.detector < this.closeThreshold) {
        if (this.holdRemaining > 0) {
          this.holdRemaining -= 1;
        } else {
          this.open = false;
        }
      }

      const targetGain = this.open ? 1 : this.floorGain;
      const gainCoefficient = targetGain > this.gain
        ? this.attackCoefficient
        : this.releaseCoefficient;
      this.gain += (targetGain - this.gain) * gainCoefficient;
      output[index] = sample * this.gain;
    }

    return true;
  }
}

registerProcessor('voice-room-noise-gate', VoiceRoomNoiseGateProcessor);
