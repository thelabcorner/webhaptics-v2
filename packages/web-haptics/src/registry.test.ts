import { describe, it, expect, beforeEach } from 'vitest';
import { defaultRegistry, type RegisteredPreset } from './registry';
import type { Vibration } from './lib/web-haptics/types';

describe('PresetRegistry', () => {
  beforeEach(() => {
    // Clear registry for test isolation (in real v2 this would be a fresh instance)
    // For now we test the class directly
  });

  it('registers and retrieves a preset with validation', () => {
    const testPreset: Omit<RegisteredPreset, 'precomputed'> = {
      pattern: [{ duration: 50, intensity: 0.8 }],
      description: 'Test tap',
      category: 'impact',
    };

    const registry = new (defaultRegistry.constructor as any)();
    registry.register('testTap', testPreset);

    const retrieved = registry.get('testTap');
    expect(retrieved).toBeDefined();
    expect(retrieved?.pattern[0].duration).toBe(50);
    expect(retrieved?.description).toBe('Test tap');
  });

  it('throws on invalid duration', () => {
    const registry = new (defaultRegistry.constructor as any)();
    expect(() => {
      registry.register('bad', {
        pattern: [{ duration: 0 }],
      });
    }).toThrow(/Invalid duration/);
  });

  it('precomputes pattern data', () => {
    const registry = new (defaultRegistry.constructor as any)();
    registry.register('precomputeTest', {
      pattern: [{ duration: 100, intensity: 0.5 }],
    });

    const pre = registry.getPrecomputed('precomputeTest');
    expect(pre).toBeDefined();
    // In full implementation this will contain vibratePattern and phases
  });

  // TODO: Add tests for defaultPatterns migration, snapshot testing of all presets,
  // normalization integration, and React context once implemented
});
