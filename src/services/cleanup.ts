import { MeteringService } from './metering.js';
import { config } from '../config/index.js';

export class CleanupJob {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.intervalId) {
      return; // Already running
    }

    // Run cleanup every hour
    this.intervalId = setInterval(async () => {
      try {
        const deleted = await MeteringService.cleanupExpiredKeys();
        if (deleted > 0) {
          console.log(`Cleanup: removed ${deleted} expired idempotency keys`);
        }
      } catch (error) {
        console.error('Cleanup job failed:', error);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Run once on startup
    this.runOnce();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async runOnce(): Promise<void> {
    try {
      const deleted = await MeteringService.cleanupExpiredKeys();
      if (deleted > 0) {
        console.log(`Initial cleanup: removed ${deleted} expired idempotency keys`);
      }
    } catch (error) {
      console.error('Initial cleanup failed:', error);
    }
  }
}

export const cleanupJob = new CleanupJob();