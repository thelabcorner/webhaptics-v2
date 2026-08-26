import type { Vibration, TriggerOptions } from './types';

/**
 * v2 Optimized HapticScheduler — Event-driven, zero polling, stateful.
 * Uses precomputed timeline + calculated deltas for setTimeout chain.
 * Supports AbortSignal, virtual timers for tests, and minimal overhead.
 * Replaces previous 16ms polling + linear scan.
 */
export class HapticScheduler {
  private timeoutId: NodeJS.Timeout | number | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;

  // Injectable for tests (virtual clock with vi.useFakeTimers)
  private timer = {
    setTimeout: (cb: () => void, delay: number) => setTimeout(cb, delay),
    clearTimeout: (id: NodeJS.Timeout | number) => clearTimeout(id as any),
    now: () => Date.now(),
  };

  constructor(timer?: Partial<typeof this.timer>) {
    if (timer) this.timer = { ...this.timer, ...timer };
  }

  /**
   * Schedule using precomputed timeline (from registry).
   * onTick receives (isOn, intensity, segmentIndex).
   */
  schedule(
    vibrations: ReadonlyArray<Vibration>,
    onTick: (isOn: boolean, intensity: number, segmentIndex: number) => void,
    onComplete: () => void,
    options: TriggerOptions & { pulseInterval?: (intensity: number) => number } = {}
  ): Promise<void> {
    if (this.isRunning) this.cancel();

    this.isRunning = true;
    this.abortController = new AbortController();

    const signal = options.signal 
      ? AbortSignal.any([options.signal, this.abortController.signal])
      : this.abortController.signal;

    return new Promise((resolve, reject) => {
      // Build phase list: each entry STARTS at `time` and lasts until `end`.
      // onTick fires when a phase BEGINS (correct semantics — v1 parity).
      const phases: Array<{
        time: number;
        end: number;
        isOn: boolean;
        intensity: number;
        index: number;
      }> = [];
      let cumulative = 0;

      vibrations.forEach((vib, index) => {
        const delay = vib.delay ?? 0;
        if (delay > 0) {
          phases.push({ time: cumulative, end: cumulative + delay, isOn: false, intensity: 0, index });
          cumulative += delay;
        }
        phases.push({
          time: cumulative,
          end: cumulative + vib.duration,
          isOn: true,
          intensity: Math.max(0, Math.min(1, vib.intensity ?? 0.7)),
          index,
        });
        cumulative += vib.duration;
      });

      const totalDuration = cumulative;
      const startTime = this.timer.now();
      let nextPhase = 0;
      // Continuous-pulse state (active only when options.pulseInterval is provided)
      let currentOn: { intensity: number; index: number; end: number } | null = null;
      let lastPulseElapsed = -Infinity;

      const tick = () => {
        if (signal.aborted) {
          this.cleanup();
          resolve(); // or reject with AbortError based on policy
          return;
        }

        const elapsed = this.timer.now() - startTime;

        if (elapsed >= totalDuration) {
          this.cleanup();
          onComplete();
          resolve();
          return;
        }

        // Enter any phase whose start time has arrived
        while (nextPhase < phases.length && phases[nextPhase]!.time <= elapsed) {
          const ph = phases[nextPhase]!;
          if (ph.isOn) {
            currentOn = { intensity: ph.intensity, index: ph.index, end: ph.end };
            lastPulseElapsed = elapsed;
          } else {
            currentOn = null;
          }
          onTick(ph.isOn, ph.intensity, ph.index);
          nextPhase++;
        }

        // Continuous pulse-density during on-phases (v1 parity)
        let waitMs: number;
        if (currentOn && options.pulseInterval) {
          const phase = currentOn;
          const interval = Math.max(1, options.pulseInterval(phase.intensity));
          const sinceLast = elapsed - lastPulseElapsed;
          if (sinceLast >= interval && elapsed < phase.end) {
            onTick(true, phase.intensity, phase.index);
            lastPulseElapsed = elapsed;
          }
          const untilNextPulse = interval - (elapsed - lastPulseElapsed);
          const untilPhaseEnd = phase.end - elapsed;
          waitMs = Math.max(0, Math.min(untilNextPulse, untilPhaseEnd));
        } else if (nextPhase < phases.length) {
          waitMs = Math.max(0, phases[nextPhase]!.time - elapsed);
        } else {
          this.cleanup();
          onComplete();
          resolve();
          return;
        }

        this.timeoutId = this.timer.setTimeout(tick, waitMs);
      };

      // Start synchronously so the first phase fires inside the caller's
      // user-gesture context (label.click() haptic path depends on it).
      tick();

      // Abort handler
      const handleAbort = () => {
        this.cancel();
        resolve(); // treat abort as clean completion for promise
      };
      signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  cancel(): void {
    if (this.timeoutId !== null) {
      this.timer.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.cleanup();
  }

  isActive(): boolean {
    return this.isRunning;
  }

  private cleanup(): void {
    this.isRunning = false;
    this.abortController = null;
  }
}