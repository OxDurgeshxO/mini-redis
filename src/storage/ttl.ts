export class TtlScheduler {
  private activeTimer: NodeJS.Timeout | null = null;
  private onExpireKey: (key: string) => void;
  private getVolatileKeysSample: (count: number) => [string, number][]; // [key, expiresAt][]

  constructor(
    onExpireKey: (key: string) => void,
    getVolatileKeysSample: (count: number) => [string, number][]
  ) {
    this.onExpireKey = onExpireKey;
    this.getVolatileKeysSample = getVolatileKeysSample;
  }

  public start(intervalMs: number = 100): void {
    if (this.activeTimer) return;

    this.activeTimer = setInterval(() => {
      this.activeCycle();
    }, intervalMs);
    this.activeTimer.unref();
  }

  public stop(): void {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
  }

  public activeCycle(): number {
    const sample = this.getVolatileKeysSample(20);
    if (sample.length === 0) return 0;

    const now = Date.now();
    let expiredCount = 0;

    for (const [key, expiresAt] of sample) {
      if (now > expiresAt) {
        this.onExpireKey(key);
        expiredCount++;
      }
    }

    return expiredCount;
  }
}
