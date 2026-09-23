export class LiveKitReconcileGeneration {
  generation: number;

  constructor() {
    this.generation = 0;
  }

  invalidate(): number {
    this.generation += 1;
    return this.generation;
  }

  capture(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}
