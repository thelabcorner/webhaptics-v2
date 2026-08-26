export type Brand<T, B> = T & { __brand: B };

export type PresetName = Brand<string, 'PresetName'>;

export interface Vibration {
  /** Duration in milliseconds */
  duration: number;
  /** Intensity 0-1 (simulated via PWM where not native) */
  intensity?: number;
  /** Delay before this vibration starts (ms) */
  delay?: number;
}

export interface HapticPresetConfig {
  pattern: Vibration[];
  description?: string;
  category?: 'notification' | 'impact' | 'selection' | 'custom';
  defaultIntensity?: number;
}

export interface HapticPreset extends HapticPresetConfig {}

export interface TriggerOptions {
  intensity?: number;
  signal?: AbortSignal;
}

export interface HapticsOptions {
  /** Enable debug audio + visual simulation on desktop */
  debug?: boolean;
  /** Show UI toggle for haptic feedback (for testing) */
  showToggle?: boolean;
  /** How to handle prefers-reduced-motion media query */
  reducedMotion?: 'respect' | 'ignore' | 'force';
  /** Default actuator priority order for fallback */
  actuatorPriority?: Array<'vibration' | 'gamepad' | 'simulation' | 'noop'>;
  /** Global error handler */
  onError?: (error: Error & { code?: string }) => void;
}

export interface HapticActuator {
  readonly name: string;
  isSupported(): boolean;
  trigger(
    vibrations: ReadonlyArray<Vibration>,
    options?: TriggerOptions
  ): Promise<void>;
  cancel(): void;
  destroy?(): Promise<void> | void;
}

export interface PresetRegistry {
  register(name: string, config: HapticPresetConfig): PresetName;
  get(name: string | PresetName): HapticPresetConfig | undefined;
  getAll(): Readonly<Record<string, HapticPresetConfig>>;
  has(name: string | PresetName): boolean;
  /** Precomputed flat pattern for navigator.vibrate() */
  getPrecomputed(name: string | PresetName): ReadonlyArray<number> | undefined;
  /** Clear for testing/hot-reload */
  clear(): void;
}

export interface HapticEngine {
  trigger(input: HapticInput, options?: TriggerOptions): Promise<void>;
  cancel(): void;
  registerPreset(name: string, config: HapticPresetConfig): PresetName;
  setOptions(options: Partial<HapticsOptions>): void;
  destroy(): Promise<void>;
}

export type HapticInput = 
  | PresetName 
  | string 
  | number 
  | ReadonlyArray<number | Vibration> 
  | HapticPresetConfig;

export type HapticPattern = number[] | Vibration[];
export interface HapticPreset {
  pattern: Vibration[];
}

export type ActuatorType = 'vibration' | 'gamepad' | 'simulation' | 'noop';

/** Precomputed execution phase (registry-cached, zero per-trigger construction). */
export interface PrecomputedPhase {
  /** Phase start offset in ms */
  time: number;
  /** Phase end offset in ms */
  end: number;
  isOn: boolean;
  intensity: number;
  index: number;
}

export interface RegistryListener {
  (event: RegistryEvent): void;
}

export interface RegistryEvent {
  type: 'register' | 'update';
  name: string;
  preset: any;
}

// Event types for optional emitter
export type HapticEventType = 'trigger' | 'complete' | 'cancel' | 'error';
export interface HapticEventMap {
  trigger: { input: HapticInput; preset?: string };
  complete: { duration: number };
  cancel: { reason?: string };
  error: { error: Error };
}

export interface PrecomputedPreset {
  precomputed?: {
    vibratePattern: number[];
    phases: Array<{ end: number; isOn: boolean; intensity: number }>;
  };
}
