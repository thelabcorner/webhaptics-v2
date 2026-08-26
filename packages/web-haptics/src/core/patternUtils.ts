import type { Vibration, PrecomputedPhase } from './types';

/**
 * Pure, testable normalization of any vibration description into standardized array.
 * Fresh implementation for v2 — no legacy dependencies.
 */
export function normalizeToVibrations(input: ReadonlyArray<Vibration> | Vibration): Vibration[] {
  if (!Array.isArray(input)) {
    return [input as Vibration];
  }
  return [...input].map(v => ({ ...v })); // immutable copy
}

/**
 * Converts standardized vibrations to flat number[] suitable for navigator.vibrate().
 * Applies simple intensity via duration scaling for v2 (PWM moved to SimulationActuator for better control).
 * Precomputable in registry.
 */
const PWM_CYCLE = 20; // ms per intensity modulation cycle (v1 parity)
export const MAX_PHASE_MS = 1000; // browser haptic window limit per vibration (v1 parity)

/**
 * Apply PWM modulation to a single vibration duration at a given intensity.
 * Returns the flat on/off segments for this vibration (v1 parity).
 */
export function modulateVibration(duration: number, intensity: number): number[] {
  if (intensity >= 1) return [Math.min(MAX_PHASE_MS, Math.max(1, Math.round(duration)))];
  if (intensity <= 0) return [];

  const durationMs = Math.min(MAX_PHASE_MS, Math.max(1, Math.round(duration)));
  const onTime = Math.max(1, Math.round(PWM_CYCLE * intensity));
  const offTime = PWM_CYCLE - onTime;
  const result: number[] = [];

  let remaining = durationMs;
  while (remaining >= PWM_CYCLE) {
    result.push(onTime);
    result.push(offTime);
    remaining -= PWM_CYCLE;
  }
  if (remaining > 0) {
    const remOn = Math.max(1, Math.round(remaining * intensity));
    result.push(remOn);
    const remOff = remaining - remOn;
    if (remOff > 0) result.push(remOff);
  }

  return result;
}

/**
 * Converts standardized vibrations to the flat number[] pattern for navigator.vibrate(),
 * applying per-vibration PWM intensity modulation and merging delays into
 * trailing off-time (v1 parity, cleanroom implementation).
 * Precomputable in registry.
 */
export function toFlatVibratePattern(
  vibrations: ReadonlyArray<Vibration>,
  defaultIntensity = 0.5
): number[] {
  const result: number[] = [];

  for (const vib of vibrations) {
    const intensity = Math.max(0, Math.min(1, vib.intensity ?? defaultIntensity));
    const duration = Math.max(0, Math.round(vib.duration));
    const delay = Math.max(0, Math.round(vib.delay ?? 0));

    // Prepend delay: merge into trailing off-time or add new gap
    if (delay > 0) {
      if (result.length > 0 && result.length % 2 === 0) {
        result[result.length - 1]! += delay;
      } else {
        if (result.length === 0) result.push(0);
        result.push(delay);
      }
    }

    const modulated = modulateVibration(duration, intensity);

    if (modulated.length === 0) {
      // Zero intensity — treat vibration as silence
      if (result.length > 0 && result.length % 2 === 0) {
        result[result.length - 1]! += duration;
      } else if (duration > 0) {
        result.push(0);
        result.push(duration);
      }
      continue;
    }

    for (const seg of modulated) {
      result.push(seg);
    }
  }

  return result;
}

/** Validates a pattern against browser limits */
export function validatePattern(pattern: number[]): { valid: boolean; reason?: string } {
  if (pattern.some(v => !Number.isFinite(v) || v < 0)) {
    return { valid: false, reason: 'Negative or non-finite values' };
  }
  return { valid: true };
}

/**
 * Single source of truth for phase-timeline construction (start-anchored).
 * Consumed by the scheduler and precomputable per preset in the registry.
 */
export function buildPhaseTimeline(
  vibrations: ReadonlyArray<Vibration>,
  defaultIntensity = 0.7,
): PrecomputedPhase[] {
  const phases: PrecomputedPhase[] = [];
  let cumulative = 0;

  for (let index = 0; index < vibrations.length; index++) {
    const vib = vibrations[index]!;
    const delay = Math.max(0, Math.round(vib.delay ?? 0));
    if (delay > 0) {
      phases.push({ time: cumulative, end: cumulative + delay, isOn: false, intensity: 0, index });
      cumulative += delay;
    }
    const duration = Math.max(1, Math.round(vib.duration));
    phases.push({
      time: cumulative,
      end: cumulative + duration,
      isOn: true,
      intensity: Math.max(0, Math.min(1, vib.intensity ?? defaultIntensity)),
      index,
    });
    cumulative += duration;
  }

  return phases;
}
