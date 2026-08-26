import { WebHaptics } from './core/engine';

export { WebHaptics } from './core/engine';
export { createWebHaptics } from './core/engine'; // explicit override of any legacy star-export
export { registerPreset, getRegistry, DefaultPresetRegistry } from './core/presetRegistry';
export { defaultPatterns } from './lib/web-haptics/patterns'; // compat for demo.tsx
export const haptics = new WebHaptics();
export const version = '2.0.0'; // satisfies site import

export type {
  HapticInput,
  Vibration,
  HapticPreset,
  TriggerOptions,
  HapticsOptions,
  PresetName,
  HapticActuator,
  HapticEngine,
} from './core/types';

// Framework adapters (import from "web-haptics/react" etc.)
export * from './vue';
export * from './svelte';
