export class LiveKitReconcileGeneration {
  constructor() {
    this.generation = 0;
  }

  invalidate() {
    this.generation += 1;
    return this.generation;
  }

  capture() {
    return this.generation;
  }

  isCurrent(generation) {
    return generation === this.generation;
  }
}
