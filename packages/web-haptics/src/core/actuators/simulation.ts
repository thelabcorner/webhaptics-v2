import type { HapticActuator, Vibration, TriggerOptions, HapticsOptions } from '../types';
import { buildPhaseTimeline } from '../patternUtils';
import { signatureOf, MAX_CONCURRENT_TRACKS, COALESCE_WINDOW_MS } from '../conductor';

const TOGGLE_MIN = 16; // ms at intensity 1 — max pulse density (v1 parity)
const TOGGLE_RANGE = 184; // added ms at intensity 0

/** Ring-buffer of recent pulse timestamps (ms) for field diagnostics. */
const pulseLog: number[] = [];
const PULSE_LOG_MAX = 512;

function recordPulse(now: number): void {
  pulseLog.push(now);
  if (pulseLog.length > PULSE_LOG_MAX) pulseLog.shift();
}

export interface PulseStats {
  count: number;
  requestedIntervalMs: number;
  medianGapMs: number | null;
  minGapMs: number | null;
  maxGapMs: number | null;
}

/** Median/min/max of recent inter-pulse gaps (null when insufficient data). */
export function getPulseStats(requested = TOGGLE_MIN): PulseStats {
  const tail = pulseLog.slice(-128);
  if (tail.length < 3) {
    return { count: tail.length, requestedIntervalMs: requested, medianGapMs: null, minGapMs: null, maxGapMs: null };
  }
  const gaps: number[] = [];
  for (let i = 1; i < tail.length; i++) gaps.push(tail[i]! - tail[i - 1]!);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return {
    count: tail.length,
    requestedIntervalMs: requested,
    medianGapMs: Math.round(median * 10) / 10,
    minGapMs: Math.round(gaps[0]! * 10) / 10,
    maxGapMs: Math.round(gaps[gaps.length - 1]! * 10) / 10,
  };
}

/**
 * Frame-locked click train (v1 parity).
 *
 * Deliberately requestAnimationFrame-driven, NOT setTimeout-chained:
 * rAF locks pulse cadence to the display (60Hz, 120Hz on ProMotion) with
 * zero timer-clamp drift — the physical "feel" of every preset depends on
 * it. Falls back to setTimeout only where rAF is unavailable.
 */
function runTrain(
  vibrations: ReadonlyArray<Vibration>,
  defaultIntensity: number,
  signal: AbortSignal | undefined,
  onPulse: (intensity: number) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const phases = buildPhaseTimeline(vibrations, defaultIntensity);
    let total = 0;
    for (const p of phases) total = Math.max(total, p.end);

    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
    const caf =
      typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

    const startTime = performance.now();
    let rafId = 0;
    let phaseIdx = 0;
    let lastToggleAt = -Infinity;

    const finish = () => {
      caf.call(window, rafId);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => finish();

    signal?.addEventListener('abort', onAbort, { once: true });

    const loop = (now: number) => {
      if (signal?.aborted) return finish();
      const elapsed = now - startTime;

      if (elapsed >= total) return finish();

      // Stateful phase advance (start-anchored phases)
      while (phaseIdx < phases.length && phases[phaseIdx]!.time <= elapsed) {
        phaseIdx++;
      }
      // Current phase = last entered
      const phase = phases[phaseIdx - 1];
      if (phase && phase.isOn) {
        const interval = TOGGLE_MIN + (1 - phase.intensity) * TOGGLE_RANGE;
        if (lastToggleAt === -Infinity || now - lastToggleAt >= interval) {
          onPulse(phase.intensity);
          lastToggleAt = now;
        }
      } else {
        // Silence during delay gaps — reset density clock like v1
        if (phase && !phase.isOn) lastToggleAt = -Infinity;
      }

      rafId = raf(loop);
    };

    rafId = raf(loop);
  });
}

/**
 * Shared simulation resources — exactly ONE hidden label/checkbox pair and
 * ONE AudioContext exist per document regardless of track count.
 */
let sharedLabel: HTMLLabelElement | null = null;
let audioCtx: AudioContext | null = null;
let audioFilter: BiquadFilterNode | null = null;
let audioGain: GainNode | null = null;
let audioBuffer: AudioBuffer | null = null;

function ensureSharedDOM(showToggle: boolean): void {
  if (sharedLabel || typeof document === 'undefined') return;

  const id = 'web-haptics-sim';
  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.textContent = 'Haptic feedback';
  label.style.position = 'fixed';
  label.style.bottom = '10px';
  label.style.left = '10px';
  label.style.padding = '5px 10px';
  label.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  label.style.color = 'white';
  label.style.fontFamily = 'sans-serif';
  label.style.fontSize = '14px';
  label.style.borderRadius = '4px';
  label.style.zIndex = '9999';
  label.style.userSelect = 'none';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = id;
  checkbox.setAttribute('switch', '');
  checkbox.style.all = 'initial';
  checkbox.style.appearance = 'auto';

  if (!showToggle) {
    // Keep the native WebKit switch rendered. display:none removes its
    // renderer, which can disable the switch-backed haptic path on iOS.
    label.style.opacity = '0';
    label.style.pointerEvents = 'none';
    checkbox.style.opacity = '0';
    checkbox.style.pointerEvents = 'none';
  }

  label.appendChild(checkbox);
  document.body.appendChild(label);
  sharedLabel = label;
}

async function ensureAudio(): Promise<void> {
  if (!audioCtx && typeof AudioContext !== 'undefined') {
    audioCtx = new AudioContext();
    audioFilter = audioCtx.createBiquadFilter();
    audioFilter.type = 'bandpass';
    audioFilter.frequency.value = 4000;
    audioFilter.Q.value = 8;
    audioGain = audioCtx.createGain();
    audioFilter.connect(audioGain);
    audioGain.connect(audioCtx.destination);

    audioBuffer = audioCtx.createBuffer(
      1,
      Math.ceil(audioCtx.sampleRate * 0.004),
      audioCtx.sampleRate,
    );
    const data = audioBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 25);
    }
  }
  if (audioCtx?.state === 'suspended') {
    try { await audioCtx.resume(); } catch { /* gesture required */ }
  }
}

function playClick(intensity: number): void {
  if (!audioCtx || !audioFilter || !audioGain || !audioBuffer) return;
  audioGain.gain.value = 0.5 * intensity;
  const jitter = 1 + (Math.random() - 0.5) * 0.3;
  audioFilter.frequency.value = (2000 + intensity * 2000) * jitter;

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioFilter);
  source.onended = () => source.disconnect();
  source.start();
}

/**
 * Simulation actuator with TRUE polyphony: every trigger spawns its own
 * scheduler runner; overlapping trains interleave on the shared switch
 * (perceptually = max-intensity superposition). Shared DOM/audio singleton.
 */
export class SimulationActuator implements HapticActuator {
  readonly name = 'simulation';
  private options: HapticsOptions;
  /** Live trains keyed by pattern signature → voice policies apply. */
  private runners = new Map<string, { cancel: () => void; firedAt: number }>();
  /** AbortControllers per live train for external cancellation. */
  private controllers = new Map<string, AbortController>();

  constructor(options: HapticsOptions = {}) {
    this.options = options;
  }

  isSupported(): boolean {
    return true;
  }

  async trigger(vibrations: ReadonlyArray<Vibration>, options: TriggerOptions = {}): Promise<void> {
    if (options.signal?.aborted) return;

    ensureSharedDOM(this.options.showToggle ?? false);
    if (this.options.debug) await ensureAudio();

    const sig = signatureOf(vibrations);
    const now = Date.now();

    // Coalesce: identical pattern inside the window is swallowed
    const existing = this.runners.get(sig);
    if (existing && now - existing.firedAt < COALESCE_WINDOW_MS) {
      return;
    }
    // Restart: same pattern re-tap replaces its live train (never stacks)
    if (existing) {
      existing.cancel();
      this.runners.delete(sig);
      this.controllers.delete(sig);
    }
    // Cap concurrency: evict the oldest-fired train
    while (this.runners.size >= MAX_CONCURRENT_TRACKS) {
      let oldestSig: string | null = null;
      let oldestAt = Infinity;
      for (const [k, v] of this.runners) {
        if (v.firedAt < oldestAt) { oldestAt = v.firedAt; oldestSig = k; }
      }
      if (!oldestSig) break;
      this.runners.get(oldestSig)!.cancel();
      this.runners.delete(oldestSig);
      this.controllers.delete(oldestSig);
    }

    const controller = new AbortController();
    // Chain caller's signal → per-train controller
    if (options.signal) {
      const relay = () => controller.abort();
      options.signal.addEventListener('abort', relay, { once: true });
    }

    const defaultIntensity = Math.max(0, Math.min(1, options.intensity ?? 0.5));
    this.runners.set(sig, { cancel: () => controller.abort(), firedAt: now });
    this.controllers.set(sig, controller);

    await runTrain(
      vibrations,
      defaultIntensity,
      controller.signal,
      (intensity) => {
        recordPulse(performance.now());
        sharedLabel?.click();
        if (audioCtx) playClick(intensity);
      },
    );

    // Teardown only if this exact train is still registered
    if (this.controllers.get(sig) === controller) {
      this.runners.delete(sig);
      this.controllers.delete(sig);
    }
  }

  /** Cancel every live train. */
  cancel(): void {
    for (const r of this.runners.values()) r.cancel();
    this.runners.clear();
    this.controllers.clear();
  }

  activeTrackCount(): number {
    return this.runners.size;
  }

  /** Field diagnostics: measured pulse cadence vs requested. */
  getPulseStats(requestedIntervalMs?: number): PulseStats {
    return getPulseStats(requestedIntervalMs);
  }

  destroy(): void {
    this.cancel();
  }
}
