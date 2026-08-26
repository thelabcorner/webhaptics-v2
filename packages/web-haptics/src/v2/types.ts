/** web-haptics v2 — Cleanroom Types (Performance-first, testable, extensible) */

export type HapticIntensity = number; // 0.0 - 1.0

export interface Vibration {
  /** Duration in ms */
  duration: number;
  /** 0.0-1.0 intensity (simulated via PWM or native where supported) */
  intensity?: HapticIntensity;
  /** Delay before this vibration (ms) */
  delay?: number;
}

export interface HapticPreset {
  pattern: Vibration[];
  description?: string;
  category?: 'notification' | 'impact' | 'selection' | 'custom';
}

export type HapticInput = 
  | number 
  | string 
  | Vibration[] 
  | HapticPreset 
  | number[]; // legacy shorthand support

export interface TriggerOptions {
  intensity?: HapticIntensity;
  signal?: AbortSignal;
  onComplete?: () => void;
  /** Override reduced-motion behavior for this trigger */
  force?: boolean;
}

export interface WebHapticsOptions {
  debug?: boolean;
  showSwitch?: boolean;
  /** How to handle prefers-reduced-motion */
  reducedMotion?: 'respect' | 'ignore' | 'force';
  onError?: (error: Error) => void;
}

/** Precomputed timeline entry for efficient scheduling (no linear scan) */
export interface TimelineEvent {
  time: number; // absolute ms from start
  isOn: boolean;
  intensity: HapticIntensity;
  action?: 'haptic' | 'audio';
}

/** Precomputed data stored in Registry */
export interface PrecomputedPattern {
  vibratePattern: number[]; // for native VibrationActuator
  timeline: TimelineEvent[]; // for SimulationActuator
  totalDuration: number;
  preset: HapticPreset;
}

/** Actuator contract — pluggable backends */
export interface HapticActuator {
  trigger(pattern: PrecomputedPattern, options: TriggerOptions): Promise<void>;
  cancel(): void;
  isSupported(): boolean;
  readonly name: string;
}

/** Scheduler for non-polling simulation timing */
export interface HapticScheduler {
  schedule(
    timeline: TimelineEvent[],
    totalDuration: number,
    options: TriggerOptions & { onTick?: (event: TimelineEvent) => void }
  ): Promise<void>;
  cancel(): void;
  isActive(): boolean;
}

/** Registry entry */
export interface RegisteredPreset {
  name: string;
  config: HapticPreset;
  precomputed: PrecomputedPattern;
}