import type { HapticActuator, PrecomputedPattern, TriggerOptions } from './types';
import { DefaultHapticScheduler } from './scheduler';

/** Native navigator.vibrate actuator — fastest path, uses precomputed flat pattern */
export class VibrationActuator implements HapticActuator {
  readonly name = 'vibration';

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  async trigger(pattern: PrecomputedPattern, options: TriggerOptions): Promise<void> {
    if (!this.isSupported() || options.force === false) {
      return;
    }

    const signal = options.signal;
    if (signal?.aborted) {
      throw new DOMException('Haptic operation aborted', 'AbortError');
    }

    try {
      // Use precomputed flat pattern — zero computation at trigger time
      navigator.vibrate(pattern.vibratePattern);

      // For abort during vibration, best effort (vibrate(0) on abort)
      const abortHandler = () => navigator.vibrate(0);
      signal?.addEventListener('abort', abortHandler, { once: true });

      // Native vibrate is fire-and-forget; resolve immediately (or after estimated duration if needed)
      return Promise.resolve();
    } catch (err) {
      options.onError?.(err as Error);
      throw err;
    }
  }

  cancel(): void {
    if (this.isSupported()) {
      navigator.vibrate(0);
    }
  }
}

/** Simulation actuator — uses efficient Scheduler + optional audio/DOM feedback */
export class SimulationActuator implements HapticActuator {
  readonly name = 'simulation';
  private scheduler: DefaultHapticScheduler;
  private debug = false;
  private audioCtx: AudioContext | null = null;

  constructor(scheduler = new DefaultHapticScheduler()) {
    this.scheduler = scheduler;
  }

  isSupported(): boolean {
    return true; // fallback for all platforms
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
    if (!enabled && this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  private async ensureAudio(): Promise<AudioContext> {
    if (!this.audioCtx && typeof AudioContext !== 'undefined') {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      await this.audioCtx.resume();
    }
    return this.audioCtx!;
  }

  async trigger(pattern: PrecomputedPattern, options: TriggerOptions): Promise<void> {
    const signal = options.signal;
    if (signal?.aborted) {
      throw new DOMException('Haptic operation aborted', 'AbortError');
    }

    const useAudio = this.debug;
    let audioCtx: AudioContext | null = null;
    if (useAudio) {
      audioCtx = await this.ensureAudio();
    }

    const onTick = (event: any) => {
      if (event.isOn) {
        // Simulate haptic tick (click on shared hidden element or direct feedback)
        // In full v2 this would use a shared singleton DOM element
        if (typeof document !== 'undefined') {
          const el = document.createElement('div'); // placeholder — replace with singleton in Engine
          el.click();
          el.remove();
        }

        if (useAudio && audioCtx) {
          this.playClick(audioCtx, event.intensity);
        }
      }
    };

    try {
      await this.scheduler.schedule(pattern.timeline, pattern.totalDuration, {
        ...options,
        onTick,
      });
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        options.onError?.(err as Error);
      }
      throw err;
    }
  }

  cancel(): void {
    this.scheduler.cancel();
  }

  private playClick(audioCtx: AudioContext, intensity: number): void {
    // Optimized click using Oscillator (cleanroom — no legacy buffer mutation)
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 1800 + intensity * 2200;
    gain.gain.value = 0.15 * intensity;
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 12;

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    oscillator.start(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    oscillator.stop(now + 0.05);
    oscillator.onended = () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
}

/** Reduced motion actuator — respects user preference (light or noop) */
export class ReducedMotionActuator implements HapticActuator {
  readonly name = 'reduced-motion';

  isSupported(): boolean {
    return true;
  }

  async trigger(pattern: PrecomputedPattern, options: TriggerOptions): Promise<void> {
    // Ultra-light single tap or nothing
    if (options.force) {
      // Still allow if explicitly forced
      const lightPattern = { ...pattern, vibratePattern: [15] };
      // Would delegate to VibrationActuator in full impl
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(15);
      }
    }
    return Promise.resolve();
  }

  cancel(): void {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(0);
    }
  }
}

/** No-op for testing or complete disable */
export class NoopActuator implements HapticActuator {
  readonly name = 'noop';
  isSupported(): boolean { return true; }
  async trigger(): Promise<void> { return Promise.resolve(); }
  cancel(): void {}
}