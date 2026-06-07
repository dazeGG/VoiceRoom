'use strict';

const DEFAULT_OPTIONS = {
  attackMs: 8,
  closeRatio: 0.65,
  detectorAttackMs: 4,
  detectorReleaseMs: 55,
  floorGain: 0.02,
  holdMs: 140,
  releaseMs: 160,
  threshold: 0
};

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
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;

    if (!input) {
      output.fill(0);
      return true;
    }

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
