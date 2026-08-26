import type { HapticActuator, Vibration, TriggerOptions } from '../types';
import { validatePattern, toFlatVibratePattern } from '../patternUtils';

/**
 * Clean v2 implementation of native navigator.vibrate actuator.
 * Fresh code — no legacy class porting.
 * Handles browser support check, pattern validation, flat conversion, and cancellation.
 */
export class VibrationActuator implements HapticActuator {
  readonly name = 'vibration';

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  async trigger(vibrations: ReadonlyArray<Vibration>, options: TriggerOptions = {}): Promise<void> {
    if (!this.isSupported()) {
      throw new Error('[web-haptics] VibrationActuator not supported in this environment');
    }

    const intensity = options.intensity ?? 0.5;
    const signal = options.signal;

    // Normalize and validate
    const normalized = vibrations.map(v => ({ ...v }));
    const flatPattern = toFlatVibratePattern(normalized, intensity);

    const validation = validatePattern(flatPattern);
    if (!validation.valid) {
      const err = new Error(`[web-haptics] Invalid pattern: ${validation.reason}`);
      if (this.onError) this.onError(err);
      throw err;
    }

    // Check for abort
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const abortListener = () => {
      navigator.vibrate(0);
    };
    signal?.addEventListener('abort', abortListener, { once: true });

    try {
      const success = navigator.vibrate(flatPattern);
      if (!success) {
        throw new Error('[web-haptics] navigator.vibrate() was prevented (user gesture or policy)');
      }
    } finally {
      signal?.removeEventListener('abort', abortListener);
    }
  }

  cancel(): void {
    if (this.isSupported()) {
      navigator.vibrate(0);
    }
  }

  private onError?: (error: Error) => void;

  setOnError(handler: (error: Error) => void): void {
    this.onError = handler;
  }
}

// Default exported instance for engine
export const defaultVibrationActuator = new VibrationActuator();
