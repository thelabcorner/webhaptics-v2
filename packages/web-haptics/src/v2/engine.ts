import type { WebHapticsOptions, HapticInput, TriggerOptions, HapticActuator } from './types';
import { PresetRegistry, defaultRegistry } from './registry';
import { VibrationActuator, SimulationActuator, ReducedMotionActuator, NoopActuator } from './actuators';
import { DefaultHapticScheduler } from './scheduler';

export class WebHapticsEngine {
  private registry: PresetRegistry;
  private actuator: HapticActuator;
  private scheduler: DefaultHapticScheduler;
  private options: WebHapticsOptions;
  private reducedMotionMediaQuery: MediaQueryList | null = null;
  private isReducedMotion = false;

  constructor(options: WebHapticsOptions = {}, registry = defaultRegistry) {
    this.registry = registry;
    this.options = {
      reducedMotion: 'respect',
      ...options,
    };
    this.scheduler = new DefaultHapticScheduler();

    // Select initial actuator
    this.actuator = this.selectActuator();

    this.setupReducedMotionListener();
  }

  private selectActuator(): HapticActuator {
    const prefersReduced = this.isReducedMotion || this.options.reducedMotion === 'respect' && 
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced && this.options.reducedMotion !== 'ignore') {
      return new ReducedMotionActuator();
    }

    if (this.options.debug) {
      const sim = new SimulationActuator(this.scheduler);
      sim.setDebug(true);
      return sim;
    }

    const vibration = new VibrationActuator();
    if (vibration.isSupported()) {
      return vibration;
    }

    return new NoopActuator();
  }

  private setupReducedMotionListener(): void {
    if (typeof matchMedia === 'function') {
      this.reducedMotionMediaQuery = matchMedia('(prefers-reduced-motion: reduce)');
      const listener = (e: MediaQueryListEvent) => {
        this.isReducedMotion = e.matches;
        this.actuator = this.selectActuator(); // switch actuator live
      };
      this.reducedMotionMediaQuery.addEventListener('change', listener);
    }
  }

  async trigger(input: HapticInput, options: TriggerOptions = {}): Promise<void> {
    const mergedOptions = { ...this.options, ...options };

    let precomputed;
    try {
      precomputed = this.registry.get(input);
    } catch (err) {
      mergedOptions.onError?.(err as Error);
      throw err;
    }

    // Switch actuator if reduced-motion state changed
    if (this.actuator.name === 'reduced-motion' && !this.isReducedMotion) {
      this.actuator = this.selectActuator();
    }

    try {
      await this.actuator.trigger(precomputed, mergedOptions);
    } catch (err) {
      if ((err as any).name !== 'AbortError') {
        mergedOptions.onError?.(err as Error);
      }
      throw err;
    }
  }

  cancel(): void {
    this.actuator.cancel();
  }

  setDebug(debug: boolean): void {
    this.options.debug = debug;
    this.actuator = this.selectActuator();
  }

  setReducedMotion(mode: WebHapticsOptions['reducedMotion']): void {
    this.options.reducedMotion = mode;
    this.actuator = this.selectActuator();
  }

  destroy(): void {
    this.cancel();
    if (this.reducedMotionMediaQuery) {
      // Note: removeEventListener not stored; in production store handler
      this.reducedMotionMediaQuery = null;
    }
    // AudioContext cleanup would be in SimulationActuator
  }

  /** Expose for testing */
  getCurrentActuator(): HapticActuator {
    return this.actuator;
  }
}

/** Main factory (v2 public API) */
export function createWebHaptics(options?: WebHapticsOptions) {
  const engine = new WebHapticsEngine(options);
  return {
    trigger: (input?: HapticInput, opts?: TriggerOptions) => engine.trigger(input ?? { pattern: [{ duration: 25, intensity: 0.7 }] }, opts),
    cancel: () => engine.cancel(),
    setDebug: (debug: boolean) => engine.setDebug(debug),
    setReducedMotion: (mode: WebHapticsOptions['reducedMotion']) => engine.setReducedMotion(mode),
    destroy: () => engine.destroy(),
    isSupported: () => engine.getCurrentActuator().isSupported(),
  };
}

/** React Context ready (to be implemented in react/index.ts) */
export { createWebHaptics as default };