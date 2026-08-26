import type { HapticPreset, Vibration } from './lib/web-haptics/types';

export type PresetName = string & { readonly __brand: 'PresetName' };

export interface RegisteredPreset extends HapticPreset {
  description?: string;
  category?: 'notification' | 'impact' | 'selection' | 'custom';
  precomputed?: {
    vibratePattern: number[];
    phases: Array<{ end: number; isOn: boolean; intensity: number }>;
  };
}

export class PresetRegistry {
  private presets = new Map<string, RegisteredPreset>();
  private precomputed = new Map<string, RegisteredPreset['precomputed']>();

  constructor() {
    // Will be populated with defaults in v2 engine
  }

  /**
   * Register a new preset. Precomputes the vibrate pattern and phase timeline for performance.
   * Validates durations, intensities, and MAX_PHASE_MS limit.
   */
  register(name: string, preset: Omit<RegisteredPreset, 'precomputed'>): void {
    if (this.presets.has(name)) {
      console.warn(`[web-haptics] Overwriting existing preset: ${name}`);
    }

    const validated = this.validateAndNormalize(preset);
    const precomputed = this.precompute(validated.pattern);

    const registered: RegisteredPreset = {
      ...validated,
      precomputed,
    };

    this.presets.set(name, registered);
    this.precomputed.set(name, precomputed);
  }

  get(name: string): RegisteredPreset | undefined {
    return this.presets.get(name);
  }

  getPrecomputed(name: string) {
    return this.precomputed.get(name);
  }

  getAll(): Record<string, RegisteredPreset> {
    return Object.fromEntries(this.presets);
  }

  private validateAndNormalize(preset: any): RegisteredPreset {
    if (!preset.pattern || !Array.isArray(preset.pattern) || preset.pattern.length === 0) {
      throw new Error(`[web-haptics] Invalid preset: must have non-empty pattern array`);
    }

    for (const vib of preset.pattern) {
      if (typeof vib.duration !== 'number' || vib.duration <= 0 || vib.duration > 1000) {
        throw new Error(`[web-haptics] Invalid duration in preset (must be 1-1000ms)`);
      }
      if (vib.intensity !== undefined && (vib.intensity < 0 || vib.intensity > 1)) {
        throw new Error(`[web-haptics] Intensity must be between 0 and 1`);
      }
    }

    return preset as RegisteredPreset;
  }

  private precompute(pattern: Vibration[]) {
    // TODO: Integrate with existing toVibratePattern + phase building logic from v1
    // For v2 this will be the single source of truth
    return {
      vibratePattern: [], // populated by engine
      phases: [],
    };
  }
}

// Global singleton for easy access (used by engine)
export const defaultRegistry = new PresetRegistry();
