class VoiceRoomDesktopAudioSourceProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const processorOptions = options.processorOptions || {};
    this.channels = Math.max(1, Math.min(8, Number(processorOptions.channels) || 2));
    this.queue = [];
    this.readOffset = 0;
    this.queuedFrames = 0;
    this.maxFrames = Math.max(1, Math.floor(sampleRate * 0.5));

    this.port.onmessage = (event) => {
      if (event.data?.type !== 'samples') return;
      const samples = event.data.samples;
      if (!(samples instanceof Float32Array) || samples.length === 0) return;
      const frames = Math.floor(samples.length / this.channels);
      if (!frames) return;
      this.queue.push(samples.subarray(0, frames * this.channels));
      this.queuedFrames += frames;
      while (this.queuedFrames > this.maxFrames) {
        const oldest = this.queue[0];
        const available = (oldest.length - this.readOffset) / this.channels;
        const discard = Math.min(available, this.queuedFrames - this.maxFrames);
        this.readOffset += discard * this.channels;
        this.queuedFrames -= discard;
        if (this.readOffset === oldest.length) {
          this.queue.shift();
          this.readOffset = 0;
        }
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0] || [];
    const frameCount = output[0]?.length || 0;
    if (!frameCount) return true;

    for (let channel = 0; channel < output.length; channel += 1) {
      output[channel].fill(0);
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      const sampleFrame = this.readFrame();
      if (!sampleFrame) break;

      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel][frame] = sampleFrame[channel % sampleFrame.length] || 0;
      }
    }

    return true;
  }

  readFrame() {
    while (this.queue.length) {
      const samples = this.queue[0];
      if (this.readOffset + this.channels <= samples.length) {
        const frame = samples.subarray(this.readOffset, this.readOffset + this.channels);
        this.readOffset += this.channels;
        this.queuedFrames -= 1;
        return frame;
      }

      this.queue.shift();
      this.readOffset = 0;
    }

    return null;
  }
}

registerProcessor('voice-room-desktop-audio-source', VoiceRoomDesktopAudioSourceProcessor);
