import type {
  HapticEngine,
  HapticInput,
  HapticsOptions,
  TriggerOptions,
  HapticActuator,
  Vibration,
} from './types';
import { DefaultPresetRegistry, getRegistry } from './presetRegistry';
import { defaultVibrationActuator } from './actuators/vibrationActuator';
import { SimulationActuator } from './actuators/simulation';
import {
  createTrack,
  mergeSegments,
  segmentsToRelativeVibrations,
  trackEnd,
  signatureOf,
  MAX_CONCURRENT_TRACKS,
  COALESCE_WINDOW_MS,
  type ConductorTrack,
} from './conductor';
import { toFlatVibratePattern } from './patternUtils';

/**
 * v2 Core Engine — multi-track orchestrator.
 *
 * Polyphony strategy per backend:
 * - Vibration API (mono channel): overlapping triggers are fused by the
 *   Conductor (sweep-line union, intensity=max) into one native pattern;
 *   joining a track re-renders the superposition without interrupting it.
 * - Simulation (iOS switch synthesis): discrete click-trains interleave
 *   naturally — each trigger runs an independent runner on shared resources.
 */
export class CoreEngine implements HapticEngine {
  private registry = getRegistry();
  private currentActuator: HapticActuator = defaultVibrationActuator;
  private simulationSingleton: SimulationActuator | null = null;
  private options: HapticsOptions = {
    debug: false,
    reducedMotion: 'respect',
    actuatorPriority: ['vibration', 'simulation', 'gamepad', 'noop'],
  };
  private isReducedMotion = false;

  // Conductor state (vibration lane only)
  private tracks = new Map<number, ConductorTrack>();
  private maintenanceTimer: ReturnType<typeof setTimeout> | null = null;
  private mediaListener: ((e: MediaQueryListEvent) => void) | null = null;
  private lastFiredSig: string | null = null;
  private lastFiredAt = 0;
  private destroyed = false;

  constructor(initialOptions?: HapticsOptions) {
    (this.registry as DefaultPresetRegistry).registerDefaults();
    this.detectReducedMotion();
    // Always resolve actuator so the default singleton is never pinned
    // to an unsupported backend.
    this.setOptions(initialOptions ?? {});

    // Field diagnostics hook (harmless in production; aids on-device tuning)
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__webHapticsPulseStats =
        (requested?: number) => this.simulationSingleton?.getPulseStats(requested);
    }
  }

  private detectReducedMotion() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.isReducedMotion = mq.matches;
      this.mediaListener = (e) => { this.isReducedMotion = e.matches; };
      mq.addEventListener('change', this.mediaListener);
    }
  }

  setOptions(newOptions: Partial<HapticsOptions>): void {
    this.options = { ...this.options, ...newOptions };

    for (const type of this.options.actuatorPriority || []) {
      let actuator: HapticActuator | null = null;
      if (type === 'vibration') actuator = defaultVibrationActuator;
      if (type === 'simulation') {
        if (!this.simulationSingleton) {
          this.simulationSingleton = new SimulationActuator(this.options);
        }
        actuator = this.simulationSingleton;
      }
      if (actuator && actuator.isSupported()) {
        this.currentActuator = actuator;
        break;
      }
    }
  }

  // Backward-compat surface (site Toggle, adapters)
  setDebug(debug: boolean): void { this.setOptions({ debug }); }
  setShowSwitch(show: boolean): void { this.setOptions({ showToggle: show }); }

  async trigger(input: HapticInput, options: TriggerOptions = {}): Promise<void> {
    if (this.destroyed) return;
    if (this.options.reducedMotion === 'respect' && this.isReducedMotion) return;

    const vibrations = this.resolveVibrations(input);
    if (vibrations.length === 0) return;

    const intensity = Math.max(0, Math.min(1, options.intensity ?? 0.5));
    const withIntensity: Vibration[] = vibrations.map((v) => ({
      duration: v.duration,
      delay: v.delay,
      intensity: v.intensity ?? intensity,
    }));

    if (this.currentActuator === defaultVibrationActuator &&
        defaultVibrationActuator.isSupported()) {
      return this.triggerOnVibrationChannel(withIntensity, options);
    }
    return this.currentActuator.trigger(withIntensity, options);
  }

  private resolveVibrations(input: HapticInput): Vibration[] {
    if (typeof input === 'string') {
      const preset = this.registry.get(input);
      if (!preset) throw new Error(`[web-haptics] Unknown preset: ${input}`);
      return preset.pattern.map((v) => ({ ...v }));
    }
    if (typeof input === 'number') return [{ duration: input }];
    if (Array.isArray(input)) return input as Vibration[];
    if (typeof input === 'object' && 'pattern' in input) {
      return (input as { pattern: Vibration[] }).pattern.map((v) => ({ ...v }));
    }
    return [];
  }

  /** Mono-channel polyphony: fuse all live tracks into one native pattern. */
  private triggerOnVibrationChannel(
    vibrations: Vibration[],
    options: TriggerOptions & { behavior?: 'merge' | 'preempt' },
  ): Promise<void> {
    if (options.behavior === 'preempt') this.tracks.clear();

    // Voice policies: coalesce identical rapid retriggers, restart (never
    // stack) same-pattern tracks, cap concurrency with oldest-eviction.
    const sig = signatureOf(vibrations);
    const now = Date.now();
    if (sig === this.lastFiredSig && now - this.lastFiredAt < COALESCE_WINDOW_MS) {
      return Promise.resolve();
    }
    this.lastFiredSig = sig;
    this.lastFiredAt = now;
    for (const [id, t] of this.tracks) {
      if ((t as TrackWithSignature).signature === sig) this.tracks.delete(id);
    }
    while (this.tracks.size >= MAX_CONCURRENT_TRACKS) {
      let oldestId = -1;
      let oldestAt = Infinity;
      for (const [id, t] of this.tracks) {
        if (t.startAt < oldestAt) { oldestAt = t.startAt; oldestId = id; }
      }
      if (oldestId === -1) break;
      this.tracks.delete(oldestId);
    }

    const track = createTrack(vibrations, options);
    (track as TrackWithSignature).signature = sig;
    const endAt = trackEnd(track);
    this.tracks.set(track.id, track);

    let onAbort: (() => void) | null = () => {
      this.tracks.delete(track.id);
      this.rerenderVibrationChannel();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    this.rerenderVibrationChannel();
    this.armMaintenance(endAt);

    return new Promise<void>((resolve) => {
      const finish = () => {
        options.signal?.removeEventListener('abort', abortFn);
        onAbort = null;
        resolve();
      };
      const abortFn = () => finish();
      options.signal?.addEventListener('abort', abortFn, { once: true });
      const remain = endAt - Date.now();
      if (remain <= 0) { finish(); return; }
      setTimeout(() => {
        if (this.tracks.has(track.id)) this.tracks.delete(track.id);
        finish();
      }, remain);
    });
  }

  private rerenderVibrationChannel(): void {
    if (!defaultVibrationActuator.isSupported()) return;
    const now = Date.now();
    for (const [id, t] of this.tracks) {
      if (trackEnd(t) <= now) this.tracks.delete(id);
    }
    if (this.tracks.size === 0) {
      defaultVibrationActuator.cancel();
      return;
    }
    const merged = mergeSegments([...this.tracks.values()]);
    const relative = segmentsToRelativeVibrations(merged, now);
    const flat = toFlatVibratePattern(relative);
    if (flat.length > 0) navigator.vibrate(flat);
  }

  /** Single timer anchored at the earliest live-track end (O(1) rearm). */
  private armMaintenance(at: number): void {
    const delay = Math.max(0, at - Date.now());
    if (this.maintenanceTimer) clearTimeout(this.maintenanceTimer);
    this.maintenanceTimer = setTimeout(() => {
      this.maintenanceTimer = null;
      this.rerenderVibrationChannel();
      const ends = [...this.tracks.values()].map(trackEnd);
      if (ends.length > 0) {
        this.armMaintenance(Math.min(...ends));
      }
    }, delay);
  }

  cancel(): void {
    this.simulationSingleton?.cancel();
    this.tracks.clear();
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    defaultVibrationActuator.cancel();
  }

  registerPreset(name: string, config: Parameters<DefaultPresetRegistry['register']>[1]) {
    return (this.registry as DefaultPresetRegistry).register(name, config);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.cancel();
    if ('destroy' in this.currentActuator && typeof this.currentActuator.destroy === 'function') {
      await this.currentActuator.destroy();
    }
    if (this.mediaListener) {
      window
        .matchMedia('(prefers-reduced-motion: reduce)')
        ?.removeEventListener('change', this.mediaListener);
      this.mediaListener = null;
    }
  }

  getActuator(): HapticActuator {
    return this.currentActuator;
  }
}

export function createWebHaptics(options?: HapticsOptions): HapticEngine {
  return new CoreEngine(options);
}

export const WebHaptics = CoreEngine;

type TrackWithSignature = ConductorTrack & { signature?: string };
