import type { Vibration, TriggerOptions } from './types';

/**
 * Conductor — multi-track haptic sequencing with pattern superposition.
 *
 * Solves the single-voice flaw: previously any new trigger cancelled the
 * in-flight pattern (buzz killed by dingding). Now every trigger becomes an
 * independent track anchored to a shared clock; overlapping tracks are merged
 * by sweep-line union (coverage OR, intensity = max) into a single rendered
 * timeline per actuator update.
 *
 * Pure & deterministic: no DOM, no timers — fully unit-testable.
 */

export interface ConductorTrack {
  readonly id: number;
  /** Absolute epoch (ms, same clock as Date.now) when track began */
  readonly startAt: number;
  /** Relative vibration spec (duration/delay/intensity) */
  readonly vibrations: ReadonlyArray<Vibration>;
  readonly behavior: TrackBehavior;
}

export type TrackBehavior = 'merge' | 'preempt';

export interface AbsoluteSegment {
  start: number;
  end: number;
  intensity: number;
}

let nextTrackId = 1;

/** Voice-limit policy: bounded concurrency protects the main thread. */
export const MAX_CONCURRENT_TRACKS = 3;
/** Identical-pattern triggers inside this window are swallowed (double-tap guard). */
export const COALESCE_WINDOW_MS = 60;

/** Stable perceptual signature of a pattern (duration/delay/intensity quantized). */
export function signatureOf(vibrations: ReadonlyArray<Vibration>): string {
  let s = '';
  for (const v of vibrations) {
    s +=
      Math.round(v.duration).toString(36) +
      '.' +
      Math.round(v.delay ?? 0).toString(36) +
      '.' +
      Math.round(clamp01(v.intensity ?? 0.7) * 100).toString(36) +
      ';';
  }
  return s;
}

/** Options accepted by engine.trigger relevant to conducting. */
export type ConductOptions = Pick<TriggerOptions, 'signal'> & {
  behavior?: 'merge' | 'preempt';
};

export function createTrack(
  vibrations: ReadonlyArray<Vibration>,
  options: ConductOptions,
): ConductorTrack {
  return {
    id: nextTrackId++,
    startAt: Date.now(),
    vibrations,
    behavior: options.behavior === 'preempt' ? 'preempt' : 'merge',
  };
}

/** Total wall-clock duration a track will occupy. */
export function trackDuration(t: ConductorTrack): number {
  let total = 0;
  for (const v of t.vibrations) total += (v.delay ?? 0) + v.duration;
  return total;
}

export function trackEnd(t: ConductorTrack): number {
  return t.startAt + trackDuration(t);
}

/**
 * Expand a track's relative vibrations into absolute [start,end) segments.
 * Delays are implicit (uncovered time), matching vibrate-pattern semantics.
 */
export function expandTrack(t: ConductorTrack): AbsoluteSegment[] {
  const out: AbsoluteSegment[] = [];
  let cursor = t.startAt;
  for (const v of t.vibrations) {
    cursor += v.delay ?? 0;
    const dur = Math.max(0, Math.round(v.duration));
    if (dur > 0) {
      out.push({ start: cursor, end: cursor + dur, intensity: clamp01(v.intensity ?? 0.7) });
      cursor += dur;
    }
  }
  return out;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Sweep-line union of all live tracks' segments.
 * Output: maximal merged segments where at least one track is "on";
 * intensity at any instant = max(intensity of covering segments).
 */
export function mergeSegments(
  tracks: ReadonlyArray<ConductorTrack>,
): AbsoluteSegment[] {
  const boundarySet = new Set<number>();
  const expanded: AbsoluteSegment[] = [];

  for (const t of tracks) {
    const segs = expandTrack(t);
    for (const s of segs) {
      expanded.push(s);
      boundarySet.add(s.start);
      boundarySet.add(s.end);
    }
  }

  if (expanded.length === 0) return [];

  const bounds = [...boundarySet].sort((a, b) => a - b);

  // Bucket segments by start boundary for O(segments) sweep instead of O(B*S)
  const byStart = new Map<number, AbsoluteSegment[]>();
  for (const s of expanded) {
    let list = byStart.get(s.start);
    if (!list) byStart.set(s.start, (list = []));
    list.push(s);
  }

  const merged: AbsoluteSegment[] = [];
  const active: AbsoluteSegment[] = [];
  const expired: AbsoluteSegment[] = [];

  for (let i = 0; i < bounds.length - 1; i++) {
    const bStart = bounds[i]!;
    const bEnd = bounds[i + 1]!;

    // Activate newly starting segments
    const starting = byStart.get(bStart);
    if (starting) active.push(...starting);

    if (active.length > 0) {
      let peak = 0;
      for (const a of active) if (a.intensity > peak) peak = a.intensity;
      merged.push({ start: bStart, end: bEnd, intensity: peak });
    }

    // Retire finished segments (swap-filter keeps this amortized O(1)/removal)
    for (const a of active) {
      if (a.end <= bEnd) expired.push(a);
    }
    if (expired.length > 0) {
      for (let j = active.length - 1; j >= 0; j--) {
        if (active[j]!.end <= bEnd) {
          active[j] = active[active.length - 1]!;
          active.pop();
        }
      }
      expired.length = 0;
    }
  }

  // Coalesce adjacent segments sharing identical intensity (fewer pulses)
  const coalesced: AbsoluteSegment[] = [];
  for (const seg of merged) {
    const prev = coalesced[coalesced.length - 1];
    if (prev && prev.end === seg.start && prev.intensity === seg.intensity) {
      prev.end = seg.end;
    } else {
      coalesced.push(seg);
    }
  }

  return coalesced;
}

/**
 * Convert merged absolute segments back to RELATIVE vibrations suitable for
 * the existing pipeline (toFlatVibratePattern / buildPhaseTimeline).
 * Gaps between segments become delays; `nowBase` anchors t=0.
 */
export function segmentsToRelativeVibrations(
  segments: ReadonlyArray<AbsoluteSegment>,
  nowBase: number,
): Vibration[] {
  const out: Vibration[] = [];
  let cursor = nowBase;

  for (const s of segments) {
    const gap = s.start - cursor;
    if (gap > 0 && out.length > 0) {
      out[out.length - 1]!.delay = gap;
    } else if (gap > 0) {
      // Leading silence: skip it entirely (start immediately)
      cursor = s.start;
    }
    out.push({
      duration: s.end - s.start,
      intensity: Math.round(s.intensity * 100) / 100,
    });
    cursor = s.end;
  }

  return out;
}
