import type { HapticPreset, PrecomputedPattern, RegisteredPreset, HapticInput, Vibration } from './types';
import { DefaultHapticScheduler } from './scheduler';

/** Pure normalization (cleanroom reimplementation — no legacy code copy) */
function normalizeToVibrations(input: HapticInput): Vibration[] {
  if (typeof input === 'number') {
    return [{ duration: Math.max(1, input) }];
  }

  if (typeof input === 'string') {
    // Will be resolved via registry in practice
    throw new Error(`Preset "${input}" must be resolved through Registry`);
  }

  if (Array.isArray(input)) {
    if (input.length === 0) return [];
    if (typeof input[0] === 'number') {
      // number[] shorthand: alternating duration + delay
      const nums = input as number[];
      const result: Vibration[] = [];
      for (let i = 0; i < nums.length; i += 2) {
        const duration = nums[i]!;
        const delay = i > 0 ? nums[i - 1]! : 0;
        result.push({
          duration: Math.max(1, duration),
          ...(delay > 0 && { delay: Math.max(0, delay) }),
        });
      }
      return result;
    }
    return (input as Vibration[]).map(v => ({
      duration: Math.max(1, v.duration),
      intensity: v.intensity !== undefined ? Math.max(0, Math.min(1, v.intensity)) : undefined,
      delay: v.delay !== undefined ? Math.max(0, v.delay) : undefined,
    }));
  }

  // HapticPreset
  return (input as HapticPreset).pattern.map(v => ({
    duration: Math.max(1, v.duration),
    intensity: v.intensity !== undefined ? Math.max(0, Math.min(1, v.intensity)) : undefined,
    delay: v.delay !== undefined ? Math.max(0, v.delay) : undefined,
  }));
}

/** PWM modulation — pure, optimized, returns flat on/off segments for native vibrate() */
function modulateIntensity(duration: number, intensity: number, cycleMs = 20): number[] {
  if (intensity >= 1) return [duration];
  if (intensity <= 0) return [0, duration]; // treat as silence

  const on = Math.max(1, Math.round(cycleMs * intensity));
  const off = cycleMs - on;
  const result: number[] = [];
  let remaining = duration;

  while (remaining >= cycleMs) {
    result.push(on, off);
    remaining -= cycleMs;
  }

  if (remaining > 0) {
    const remOn = Math.max(1, Math.round(remaining * intensity));
    result.push(remOn);
    const remOff = remaining - remOn;
    if (remOff > 0) result.push(remOff);
  }

  return result;
}

/** Convert vibrations to flat vibrate pattern + precomputed timeline */
function precomputePattern(preset: HapticPreset): PrecomputedPattern {
  const vibrations = normalizeToVibrations(preset);
  const timeline: any[] = [];
  const vibratePattern: number[] = [];
  let cumulative = 0;

  for (const vib of vibrations) {
    const intensity = vib.intensity ?? 0.7;
    const delay = vib.delay ?? 0;

    if (delay > 0) {
      cumulative += delay;
      timeline.push({ time: cumulative, isOn: false, intensity: 0 });
      vibratePattern.push(delay); // off period
    }

    cumulative += vib.duration;
    timeline.push({ time: cumulative, isOn: true, intensity });

    const modulated = modulateIntensity(vib.duration, intensity);
    vibratePattern.push(...modulated);
  }

  return {
    vibratePattern,
    timeline: timeline as any, // typed in interface
    totalDuration: cumulative,
    preset,
  };
}

export class PresetRegistry {
  private presets = new Map<string, RegisteredPreset>();
  private defaultIntensity = 0.7;

  constructor() {
    // Register built-in HIG-aligned presets (cleanroom definitions)
    this.register('success', {
      pattern: [
        { duration: 30, intensity: 0.5 },
        { delay: 60, duration: 40, intensity: 1.0 },
      ],
      description: 'Two ascending taps for success',
      category: 'notification',
    });

    this.register('warning', {
      pattern: [
        { duration: 40, intensity: 0.8 },
        { delay: 100, duration: 40, intensity: 0.6 },
      ],
      description: 'Warning hesitation',
      category: 'notification',
    });

    this.register('error', {
      pattern: [
        { duration: 40, intensity: 0.7 },
        { delay: 40, duration: 40, intensity: 0.7 },
        { delay: 40, duration: 40, intensity: 0.9 },
        { delay: 40, duration: 50, intensity: 0.6 },
      ],
      description: 'Triple sharp error taps',
      category: 'notification',
    });

    this.register('light', { pattern: [{ duration: 15, intensity: 0.4 }], category: 'impact' });
    this.register('medium', { pattern: [{ duration: 25, intensity: 0.7 }], category: 'impact' });
    this.register('heavy', { pattern: [{ duration: 35, intensity: 1.0 }], category: 'impact' });
    this.register('selection', { pattern: [{ duration: 8, intensity: 0.3 }], category: 'selection' });
    this.register('nudge', {
      pattern: [
        { duration: 80, intensity: 0.8 },
        { delay: 80, duration: 50, intensity: 0.3 },
      ],
      category: 'custom',
    });
    this.register('buzz', { pattern: [{ duration: 800, intensity: 0.6 }], category: 'custom' });
  }

  register(name: string, preset: HapticPreset): void {
    if (this.presets.has(name)) {
      console.warn(`[web-haptics] Overwriting preset "${name}"`);
    }

    const precomputed = precomputePattern(preset);
    this.presets.set(name, { name, config: preset, precomputed });
  }

  get(nameOrInput: string | HapticInput): PrecomputedPattern {
    if (typeof nameOrInput === 'string') {
      const registered = this.presets.get(nameOrInput);
      if (registered) return registered.precomputed;
      throw new Error(`Unknown preset: "${nameOrInput}". Register it first or pass explicit pattern.`);
    }

    // For ad-hoc inputs, compute on-the-fly (still cached if repeated often)
    const preset: HapticPreset = { pattern: normalizeToVibrations(nameOrInput) };
    return precomputePattern(preset);
  }

  getAll(): RegisteredPreset[] {
    return Array.from(this.presets.values());
  }

  /** For testing */
  clear(): void {
    this.presets.clear();
  }
}

/** Global default registry (singleton for most use cases) */
export const defaultRegistry = new PresetRegistry();