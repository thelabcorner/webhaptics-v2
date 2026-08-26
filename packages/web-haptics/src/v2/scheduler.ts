import type { TimelineEvent, TriggerOptions, HapticScheduler } from './types';

/**
 * v2 Efficient HapticScheduler — Event-driven, non-polling, testable.
 * Replaces legacy continuous RAF + linear phase scan.
 * Uses chained setTimeout with precomputed absolute times.
 * Supports AbortSignal for clean cancellation.
 * Injectable timer API for deterministic unit tests (virtual clock).
 */
export class DefaultHapticScheduler implements HapticScheduler {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;

  // For testability — can be overridden with vi.useFakeTimers() compatible API
  private timerApi = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    now: () => Date.now(),
  };

  constructor(timerApi?: Partial<typeof this.timerApi>) {
    if (timerApi) {
      this.timerApi = { ...this.timerApi, ...timerApi };
    }
  }

  async schedule(
    timeline: TimelineEvent[],
    totalDuration: number,
    options: TriggerOptions & { onTick?: (event: TimelineEvent) => void }
  ): Promise<void> {
    if (this.isRunning) {
      this.cancel(); // Default policy: cancel previous (can be made configurable)
    }

    if (timeline.length === 0) return Promise.resolve();

    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = options.signal 
      ? AbortSignal.any([options.signal, this.abortController.signal])
      : this.abortController.signal;

    return new Promise((resolve, reject) => {
      const startTime = this.timerApi.now();
      let currentIndex = 0;
      let completed = false;

      const executeNext = () => {
        if (signal.aborted || completed) {
          this.cleanup();
          if (signal.aborted) {
            reject(new DOMException('Haptic operation aborted', 'AbortError'));
          } else {
            resolve();
          }
          return;
        }

        const now = this.timerApi.now();
        const elapsed = now - startTime;

        // Advance to current or next event (stateful index — no linear scan)
        while (currentIndex < timeline.length && timeline[currentIndex]!.time <= elapsed) {
          const event = timeline[currentIndex]!;
          options.onTick?.(event);
          currentIndex++;
        }

        if (currentIndex >= timeline.length || elapsed >= totalDuration) {
          completed = true;
          this.cleanup();
          resolve();
          return;
        }

        // Schedule next relevant event with precise delta
        const nextEvent = timeline[currentIndex]!;
        const delay = Math.max(0, nextEvent.time - elapsed);

        this.timeoutId = this.timerApi.setTimeout(executeNext, delay);
      };

      // Initial execution
      this.timeoutId = this.timerApi.setTimeout(executeNext, 0);

      // Handle abort
      const onAbort = () => {
        this.cleanup();
        reject(new DOMException('Haptic operation aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  cancel(): void {
    this.cleanup();
  }

  isActive(): boolean {
    return this.isRunning;
  }

  private cleanup(): void {
    if (this.timeoutId !== null) {
      this.timerApi.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isRunning = false;
    this.abortController = null;
  }
}

/** Factory for easy mocking in tests */
export function createScheduler(timerApi?: Partial<DefaultHapticScheduler['timerApi']>): HapticScheduler {
  return new DefaultHapticScheduler(timerApi);
}