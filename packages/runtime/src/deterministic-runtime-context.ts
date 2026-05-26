export class DeterministicRuntimeContext {
  private idCounter = 0;
  private tick = 0;

  constructor(private readonly baseTime = Date.UTC(2026, 0, 1, 0, 0, 0, 0)) {}

  now(): string {
    const timestamp = new Date(this.baseTime + this.tick).toISOString();
    this.tick += 1;
    return timestamp;
  }

  nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter.toString().padStart(6, "0")}`;
  }
}