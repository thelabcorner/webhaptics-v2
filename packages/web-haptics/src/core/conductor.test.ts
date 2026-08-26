import { describe, it, expect } from 'vitest';
import {
  createTrack,
  expandTrack,
  mergeSegments,
  segmentsToRelativeVibrations,
  trackEnd,
} from './conductor';

/** Fixed-clock createTrack for deterministic tests */
function trackAt(
  startAt: number,
  vibrations: Array<{ duration: number; intensity?: number; delay?: number }>,
) {
  const t = createTrack(vibrations, {});
  // Rewire private startAt via structural clone (test-only)
  return { ...t, startAt };
}

describe('Conductor — pattern superposition', () => {
  it('USER SCENARIO: buzz(5s) then dingding(1s)@2s → overlap rings, buzz tail resumes', () => {
    const buzz = trackAt(1000, [{ duration: 5000, intensity: 1 }]);
    const ding = trackAt(3000, [
      { duration: 200, intensity: 0.9 },
      { delay: 150, duration: 200, intensity: 0.9 },
      { delay: 150, duration: 200, intensity: 0.9 },
    ]);

    expect(trackEnd(buzz)).toBe(6000);

    const merged = mergeSegments([buzz, ding]);
    // Coverage must be continuous 1000→6000 (no dropouts)
    expect(merged[0]!.start).toBe(1000);
    expect(merged[merged.length - 1]!.end).toBe(6000);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i]!.start).toBe(merged[i - 1]!.end);
    }

    // Overlap region: any segment covering t=3100 must carry max(1, 0.9) = 1
    const covering = merged.filter((s) => s.start <= 3100 && 3100 < s.end);
    expect(covering).toHaveLength(1);
    expect(covering[0]!.intensity).toBeGreaterThanOrEqual(0.9);

    // After ding ends (≥4700), only buzz's intensity 1 remains
    const tail = merged.filter((s) => s.start >= 4700 && s.end <= 6000);
    expect(tail.every((s) => s.intensity === 1)).toBe(true);
  });

  it('renders relative vibrations with correct delays from a mid-pattern join', () => {
    // Soft sustained bed + sharp accent: accent must surface via max()
    const bed = trackAt(0, [{ duration: 5000, intensity: 0.5 }]);
    const accent = trackAt(2000, [
      { duration: 200, intensity: 0.9 },
      { delay: 150, duration: 200, intensity: 0.9 },
      { delay: 150, duration: 200, intensity: 0.9 },
    ]);
    const rel = segmentsToRelativeVibrations(mergeSegments([bed, accent]), 0);

    const total = rel.reduce((sum, v) => sum + v.duration + (v.delay ?? 0), 0);
    expect(total).toBeCloseTo(5000, 0);
    // Accent surfaces where it overlaps the bed
    expect(rel.some((v) => (v.intensity ?? 0) >= 0.9)).toBe(true);
    // Bed continues alone before/after the accent window
    expect(rel.some((v) => v.intensity === 0.5)).toBe(true);
  });

  it('expandTrack converts delays into uncovered gaps', () => {
    const t = trackAt(0, [
      { duration: 100, intensity: 1 },
      { delay: 50, duration: 100, intensity: 0.5 },
    ]);
    const segs = expandTrack(t);
    expect(segs).toEqual([
      { start: 0, end: 100, intensity: 1 },
      { start: 150, end: 250, intensity: 0.5 },
    ]);
  });

  it('merge of non-overlapping tracks keeps both intact', () => {
    const a = trackAt(0, [{ duration: 500, intensity: 0.6 }]);
    const b = trackAt(1000, [{ duration: 300, intensity: 0.6 }]);
    const merged = mergeSegments([a, b]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ start: 0, end: 500 });
    expect(merged[1]).toMatchObject({ start: 1000, end: 1300 });
  });

  it('empty track list merges to nothing', () => {
    expect(mergeSegments([])).toEqual([]);
  });
});
