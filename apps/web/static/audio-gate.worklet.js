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
    this.closeRatio = Math.max(0, Math.min(1, processorOptions.closeRatio));

    this.port.onmessage = (event) => {
      if (event.data?.type === 'set-threshold') this.setThreshold(event.data.threshold);
    };
  }

  setThreshold(value) {
    // Zero opens the gate fully: the gate is off, or push-to-talk is held.
    this.threshold = Math.max(0, Number(value) || 0);
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

const SILENCE_FLOOR_DEFAULTS = {
  // -70 dBFS: far below any speech after AGC, well above what RNNoise or a
  // closed gate leaves behind in a quiet room.
  floor: 0.000316,
  holdMs: 250
};

// Opus DTX only stops sending when the encoder is fed true digital silence: a
// residue at -84 dBFS still costs ~34 kbit/s, an exact zero ~0.1 kbit/s. This
// turns an inaudible tail into that zero, so a silent participant stops
// uploading (and everyone else stops decoding) as in Discord, without being a
// second gate: a block with anything audible in it passes through untouched.
class VoiceRoomSilenceFloorProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();

    const processorOptions = {
      ...SILENCE_FLOOR_DEFAULTS,
      ...(options.processorOptions || {})
    };

    this.floor = Math.max(0, Number(processorOptions.floor) || 0);
    this.holdSamples = Math.round(Math.max(0, Number(processorOptions.holdMs) || 0) * sampleRate / 1000);
    this.holdRemaining = this.holdSamples;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;

    if (!input) {
      output.fill(0);
      return true;
    }

    let peak = 0;
    for (let index = 0; index < input.length; index += 1) {
      const level = Math.abs(input[index] || 0);
      if (level > peak) peak = level;
    }

    if (peak >= this.floor) {
      this.holdRemaining = this.holdSamples;
    } else if (this.holdRemaining > 0) {
      this.holdRemaining = Math.max(0, this.holdRemaining - input.length);
    }

    if (this.holdRemaining > 0) output.set(input.subarray(0, output.length));
    else output.fill(0);
    return true;
  }
}

registerProcessor('voice-room-silence-floor', VoiceRoomSilenceFloorProcessor);

const SPEAKING_DETECTOR_DEFAULTS = {
  thresholdDb: -50,
  // The ring rises on the first loud block and falls only after this much
  // quiet, so it does not strobe between syllables.
  holdMs: 180,
  // RMS over the last 512 samples (~10.7 ms), the window the analyser had.
  windowSamples: 512,
  levelIntervalMs: 50
};

function dbToAmplitude(db) {
  return Math.pow(10, db / 20);
}

// Decides "is there voice" on the audio thread and tells the page only when the
// answer changes: two messages per phrase instead of the page polling every
// participant's level many times a second. It has no output; Chromium still
// pulls it like an analyser. While the microphone popover is open the page can
// also ask for the level a few times a second.
class VoiceRoomSpeakingDetectorProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();

    const processorOptions = {
      ...SPEAKING_DETECTOR_DEFAULTS,
      ...(options.processorOptions || {})
    };

    this.threshold = dbToAmplitude(Number(processorOptions.thresholdDb));
    this.holdSamples = Math.round(Math.max(0, Number(processorOptions.holdMs) || 0) * sampleRate / 1000);
    this.holdRemaining = 0;
    this.speaking = false;
    this.blockEnergies = [];
    this.blockSizes = [];
    this.windowEnergy = 0;
    this.windowCount = 0;
    this.windowSamples = Math.max(128, Number(processorOptions.windowSamples) || 512);
    this.levelSamples = Math.round(Math.max(10, Number(processorOptions.levelIntervalMs) || 50) * sampleRate / 1000);
    this.levelCountdown = 0;
    this.reportLevel = false;

    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'set-threshold' && Number.isFinite(Number(data.thresholdDb))) {
        this.threshold = dbToAmplitude(Number(data.thresholdDb));
      } else if (data.type === 'report-level') {
        this.reportLevel = data.enabled === true;
        this.levelCountdown = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    const length = input ? input.length : 128;
    let energy = 0;
    if (input) {
      for (let index = 0; index < input.length; index += 1) {
        const sample = input[index] || 0;
        energy += sample * sample;
      }
    }

    this.blockEnergies.push(energy);
    this.blockSizes.push(length);
    this.windowEnergy += energy;
    this.windowCount += length;
    while (this.windowCount - this.blockSizes[0] >= this.windowSamples) {
      this.windowEnergy -= this.blockEnergies.shift();
      this.windowCount -= this.blockSizes.shift();
    }
    const rms = Math.sqrt(Math.max(0, this.windowEnergy) / Math.max(1, this.windowCount));

    if (rms >= this.threshold) {
      this.holdRemaining = this.holdSamples;
      if (!this.speaking) {
        this.speaking = true;
        this.port.postMessage({ type: 'speaking', speaking: true });
      }
    } else if (this.speaking) {
      this.holdRemaining -= length;
      if (this.holdRemaining <= 0) {
        this.speaking = false;
        this.port.postMessage({ type: 'speaking', speaking: false });
      }
    }

    if (this.reportLevel) {
      this.levelCountdown -= length;
      if (this.levelCountdown <= 0) {
        this.levelCountdown = this.levelSamples;
        this.port.postMessage({ type: 'level', db: rms > 0 ? 20 * Math.log10(Math.min(1, rms)) : -Infinity });
      }
    }
    return true;
  }
}

registerProcessor('voice-room-speaking-detector', VoiceRoomSpeakingDetectorProcessor);
