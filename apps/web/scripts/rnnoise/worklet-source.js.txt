// MIT License. Copyright (c) 2020 WONG Tin Chi Timothy;
// Copyright (c) 2025 Dmitry Zlygin. See /rnnoise/LICENSE.
// Readable adapter for the pinned RNNoise WASM ABI; generated public copy.
let wasm;
let memory;

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super({ ...options, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    if (!wasm) {
      wasm = new WebAssembly.Instance(options.processorOptions.module).exports;
      memory = new Float32Array(wasm.memory.buffer);
    }
    this.state = wasm.newState();
    this.alive = true;
    this.statSize = Math.ceil(sampleRate / 128);
    this.stat = new Float32Array(2 * this.statSize);
    this.statPtr = 0;
    this.ts = 0;
    this.port.onmessage = ({ data }) => {
      if (!this.alive) return;
      if (!data) {
        this.alive = false;
        wasm.deleteState(this.state);
        return;
      }
      const status = { vadProb: wasm.getVadProb(this.state) };
      if (data === 'stat') status.stat = this.stat;
      this.port.postMessage(status);
    };
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const output = outputs[0]?.[0];
    const input = inputs[0]?.[0];
    // Web Audio may provide zero input channels while the upstream is inactive.
    // Never expose samples left in a reused output buffer or in WASM memory.
    if (!input?.length || !output?.length || input.length !== 128 || output.length !== 128) {
      output?.fill(0);
      return true;
    }

    const started = Date.now();
    memory.set(input, wasm.getInput(this.state) / 4);
    const outputOffset = wasm.pipe(this.state, output.length) / 4;
    if (outputOffset) output.set(memory.subarray(outputOffset, outputOffset + output.length));
    else output.fill(0);
    if (this.ts !== 0) {
      this.stat[this.statPtr] = started - this.ts;
      this.stat[this.statPtr + this.statSize] = Date.now() - this.ts;
      this.statPtr = (this.statPtr + 1) % this.statSize;
    }
    this.ts = started;
    return true;
  }
}

registerProcessor('rnnoise', RNNoiseProcessor);
