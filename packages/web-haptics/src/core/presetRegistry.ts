import type { HapticPresetConfig, PresetName, PresetRegistry } from './types';
import { normalizeToVibrations, toFlatVibratePattern } from './patternUtils'; // to be implemented

/**
 * Central, extensible registry for haptic presets.
 * Precomputes flat patterns for performance.
 * Fully testable, type-safe via branded PresetName.
 */
export class DefaultPresetRegistry implements PresetRegistry {
  private presets = new Map<string, HapticPresetConfig>();
  private precomputed = new Map<string, readonly number[]>();

  register(name: string, config: HapticPresetConfig): PresetName {
    if (!config.pattern || config.pattern.length === 0) {
      throw new Error(`[web-haptics] Preset "${name}" must have non-empty pattern`);
    }

    // Basic validation
    for (const vib of config.pattern) {
      if (vib.duration <= 0 || (vib.intensity !== undefined && (vib.intensity < 0 || vib.intensity > 1))) {
        throw new Error(`[web-haptics] Invalid vibration in preset "${name}"`);
      }
    }

    const brandedName = name as PresetName;
    this.presets.set(name, { ...config });

    // Precompute flat pattern for navigator.vibrate()
    const vibrations = normalizeToVibrations(config.pattern);
    const flat = toFlatVibratePattern(vibrations, config.defaultIntensity ?? 0.5);
    this.precomputed.set(name, flat);

    return brandedName;
  }

  get(name: string | PresetName): HapticPresetConfig | undefined {
    return this.presets.get(name);
  }

  getAll(): Readonly<Record<string, HapticPresetConfig>> {
    return Object.fromEntries(this.presets);
  }

  has(name: string | PresetName): boolean {
    return this.presets.has(name);
  }

  getPrecomputed(name: string | PresetName): readonly number[] | undefined {
    return this.precomputed.get(name);
  }

  clear(): void {
    this.presets.clear();
    this.precomputed.clear();
  }

  /** Register default HIG-aligned presets (full v1 parity set) */
  registerDefaults(): void {
    // --- Notification (UINotificationFeedbackGenerator) ---
    this.register('success', {
      pattern: [
        { duration: 30, intensity: 0.5 },
        { delay: 60, duration: 40, intensity: 1.0 },
      ],
      description: 'Ascending double-tap indicating success',
      category: 'notification',
    });

    this.register('warning', {
      pattern: [
        { duration: 40, intensity: 0.8 },
        { delay: 100, duration: 40, intensity: 0.6 },
      ],
      description: 'Two taps with hesitation indicating a warning',
      category: 'notification',
    });

    this.register('error', {
      pattern: [
        { duration: 40, intensity: 0.7 },
        { delay: 40, duration: 40, intensity: 0.7 },
        { delay: 40, duration: 40, intensity: 0.9 },
        { delay: 40, duration: 50, intensity: 0.6 },
      ],
      description: 'Rapid harsh taps indicating an error',
      category: 'notification',
    });

    // --- Impact (UIImpactFeedbackGenerator) ---
    this.register('light', {
      pattern: [{ duration: 15, intensity: 0.4 }],
      description: 'Single light tap indicating a minor impact',
      category: 'impact',
    });

    this.register('medium', {
      pattern: [{ duration: 25, intensity: 0.7 }],
      description: 'Moderate tap for standard interactions',
      category: 'impact',
    });

    this.register('heavy', {
      pattern: [{ duration: 35, intensity: 1.0 }],
      description: 'Strong tap for significant interactions',
      category: 'impact',
    });

    this.register('soft', {
      pattern: [{ duration: 40, intensity: 0.5 }],
      description: 'Soft cushioned tap with a rounded feel',
      category: 'impact',
    });

    this.register('rigid', {
      pattern: [{ duration: 10, intensity: 1.0 }],
      description: 'Hard crisp tap with a precise feel',
      category: 'impact',
    });

    // --- Selection (UISelectionFeedbackGenerator) ---
    this.register('selection', {
      pattern: [{ duration: 8, intensity: 0.3 }],
      description: 'Subtle tap for selection changes',
      category: 'selection',
    });

    // --- Custom ---
    this.register('nudge', {
      pattern: [
        { duration: 80, intensity: 0.8 },
        { delay: 80, duration: 50, intensity: 0.3 },
      ],
      description: 'Two quick taps with a pause — nudge or reminder',
      category: 'custom',
    });

    this.register('buzz', {
      pattern: [{ duration: 1000, intensity: 1.0 }],
      description: 'Continuous high-intensity buzzing effect',
      category: 'custom',
    });
  }
}

// Singleton instance for global registry (can be overridden for testing)
let globalRegistry: PresetRegistry = new DefaultPresetRegistry();

export function getRegistry(): PresetRegistry {
  return globalRegistry;
}

export function setRegistry(registry: PresetRegistry): void {
  globalRegistry = registry;
}

export function registerPreset(name: string, config: HapticPresetConfig): PresetName {
  return globalRegistry.register(name, config);
}
