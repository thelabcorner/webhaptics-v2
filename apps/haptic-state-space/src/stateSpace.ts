import type { Vibration } from 'web-haptics';

export const TIME_QUANTUM_MS = 10;
export const MIN_DURATION_MS = 10;
export const MAX_DURATION_MS = 1000;
export const MAX_DELAY_MS = 1000;
export const RAW_INTENSITY_STEPS = 100;
export const PWM_INTENSITY_STEPS = 20;
export const MAX_EXPLORER_PULSES = 6;
export const MAP_COLUMNS = 16;
export const MAP_ROWS = 12;
export const MAP_CELLS = MAP_COLUMNS * MAP_ROWS;

export const DURATION_STATES =
  (MAX_DURATION_MS - MIN_DURATION_MS) / TIME_QUANTUM_MS + 1;
export const DELAY_STATES = MAX_DELAY_MS / TIME_QUANTUM_MS + 1;
export const RAW_INTENSITY_STATES = RAW_INTENSITY_STEPS + 1;
export const PWM_INTENSITY_STATES = PWM_INTENSITY_STEPS + 1;

export const RAW_PULSE_STATES = BigInt(
  DURATION_STATES * DELAY_STATES * RAW_INTENSITY_STATES,
);
export const PWM_PULSE_STATES = BigInt(
  DURATION_STATES * DELAY_STATES * PWM_INTENSITY_STATES,
);

export type GeneratorSource =
  | 'preset'
  | 'uniform'
  | 'tactile'
  | 'mutation'
  | 'collision'
  | 'history';

export interface PatternAnalysis {
  pulseCount: number;
  totalDuration: number;
  activeDuration: number;
  delayDuration: number;
  energy: number;
  density: number;
  complexity: number;
  roughness: number;
  tempo: number;
  bucketX: number;
  bucketY: number;
  bucketId: string;
}

export interface PatternAddress {
  rank: bigint;
  ordinal: bigint;
  space: bigint;
  pulseBase: bigint;
}

const UINT32_RANGE = 0x1_0000_0000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Uniform integer sampling without modulo bias. This is the primitive used by
 * the state-space generator, so a fixed-length uniform jump is genuinely
 * uniform across the selected discrete lattice.
 */
export function cryptoInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new RangeError('cryptoInt maxExclusive must be an integer in (0, 2^32].');
  }

  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  const word = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(word);
    value = word[0]!;
  } while (value >= limit);
  return value % maxExclusive;
}

export function cryptoFloat(): number {
  return cryptoInt(0x1_000000) / 0x1_000000;
}

export function rawPatternSpace(pulseCount: number): bigint {
  return RAW_PULSE_STATES ** BigInt(pulseCount);
}

export function pwmPatternSpace(pulseCount: number): bigint {
  return PWM_PULSE_STATES ** BigInt(pulseCount);
}

export function cumulativePatternSpace(maxPulses: number, pulseBase = RAW_PULSE_STATES): bigint {
  let total = 0n;
  for (let n = 1; n <= maxPulses; n += 1) total += pulseBase ** BigInt(n);
  return total;
}

export function snapDuration(duration: number): number {
  return clamp(
    Math.round(duration / TIME_QUANTUM_MS) * TIME_QUANTUM_MS,
    MIN_DURATION_MS,
    MAX_DURATION_MS,
  );
}

export function snapDelay(delay = 0): number {
  return clamp(
    Math.round(delay / TIME_QUANTUM_MS) * TIME_QUANTUM_MS,
    0,
    MAX_DELAY_MS,
  );
}

export function snapRawIntensity(intensity = 0.5): number {
  return clamp(Math.round(intensity * RAW_INTENSITY_STEPS) / RAW_INTENSITY_STEPS, 0, 1);
}

export function snapPwmIntensity(intensity = 0.5): number {
  return clamp(Math.round(intensity * PWM_INTENSITY_STEPS) / PWM_INTENSITY_STEPS, 0, 1);
}

export function projectToRawLattice(pattern: ReadonlyArray<Vibration>): Vibration[] {
  return pattern.map((vibration) => ({
    duration: snapDuration(vibration.duration),
    delay: snapDelay(vibration.delay),
    intensity: snapRawIntensity(vibration.intensity),
  }));
}

export function projectToPwmLattice(pattern: ReadonlyArray<Vibration>): Vibration[] {
  return pattern.map((vibration) => ({
    duration: snapDuration(vibration.duration),
    delay: snapDelay(vibration.delay),
    intensity: snapPwmIntensity(vibration.intensity),
  }));
}

function tupleIndex(vibration: Vibration, intensitySteps: number): bigint {
  const durationIndex = snapDuration(vibration.duration) / TIME_QUANTUM_MS - 1;
  const delayIndex = snapDelay(vibration.delay) / TIME_QUANTUM_MS;
  const intensityIndex = Math.round(
    clamp(vibration.intensity ?? 0.5, 0, 1) * intensitySteps,
  );
  const intensityStates = intensitySteps + 1;
  return BigInt(
    (durationIndex * DELAY_STATES + delayIndex) * intensityStates + intensityIndex,
  );
}

export function addressPattern(
  pattern: ReadonlyArray<Vibration>,
  mode: 'raw' | 'pwm' = 'raw',
): PatternAddress {
  const intensitySteps = mode === 'raw' ? RAW_INTENSITY_STEPS : PWM_INTENSITY_STEPS;
  const pulseBase = mode === 'raw' ? RAW_PULSE_STATES : PWM_PULSE_STATES;
  const projected = mode === 'raw' ? projectToRawLattice(pattern) : projectToPwmLattice(pattern);

  let rank = 0n;
  for (const vibration of projected) {
    rank = rank * pulseBase + tupleIndex(vibration, intensitySteps);
  }

  const space = pulseBase ** BigInt(projected.length);
  return { rank, ordinal: rank + 1n, space, pulseBase };
}

export function exactPatternSignature(pattern: ReadonlyArray<Vibration>): string {
  return pattern
    .map((vibration) => {
      const duration = Math.max(1, Math.round(vibration.duration));
      const delay = Math.max(0, Math.round(vibration.delay ?? 0));
      const intensity = Math.round(clamp(vibration.intensity ?? 0.5, 0, 1) * 1000);
      return `${duration}.${delay}.${intensity}`;
    })
    .join('|');
}

export function uniformRandomPattern(
  pulseCount: number,
  mode: 'raw' | 'pwm' = 'raw',
): Vibration[] {
  const count = clamp(Math.round(pulseCount), 1, MAX_EXPLORER_PULSES);
  const intensityStates = mode === 'raw' ? RAW_INTENSITY_STATES : PWM_INTENSITY_STATES;
  const intensitySteps = mode === 'raw' ? RAW_INTENSITY_STEPS : PWM_INTENSITY_STEPS;

  return Array.from({ length: count }, () => ({
    duration: MIN_DURATION_MS + cryptoInt(DURATION_STATES) * TIME_QUANTUM_MS,
    delay: cryptoInt(DELAY_STATES) * TIME_QUANTUM_MS,
    intensity: cryptoInt(intensityStates) / intensitySteps,
  }));
}

/**
 * A deliberately non-uniform generator for patterns that tend to feel more
 * tactile. It still uses cryptographic entropy, but biases toward short pulses,
 * modest gaps, and non-zero intensities. Use uniformRandomPattern for sampling
 * the lattice itself.
 */
export function tactileRandomPattern(pulseCount?: number): Vibration[] {
  const count = pulseCount ?? 1 + cryptoInt(MAX_EXPLORER_PULSES);
  return Array.from({ length: count }, (_, index) => {
    const durationSlot = 1 + Math.floor(cryptoFloat() ** 2 * DURATION_STATES);
    const hasGap = index > 0 && cryptoInt(100) >= 35;
    const delaySlot = hasGap ? 1 + Math.floor(cryptoFloat() ** 2 * 50) : 0;
    const intensity = snapPwmIntensity(0.15 + cryptoFloat() * 0.85);
    return {
      duration: clamp(durationSlot * TIME_QUANTUM_MS, MIN_DURATION_MS, MAX_DURATION_MS),
      delay: clamp(delaySlot * TIME_QUANTUM_MS, 0, 500),
      intensity,
    };
  });
}

export function mutatePattern(pattern: ReadonlyArray<Vibration>): Vibration[] {
  const next = projectToRawLattice(pattern);
  if (next.length === 0) return uniformRandomPattern(1);

  const pulseIndex = cryptoInt(next.length);
  const coordinate = cryptoInt(3);
  const target = { ...next[pulseIndex]! };

  if (coordinate === 0) {
    let value = target.duration;
    while (value === target.duration) {
      value = MIN_DURATION_MS + cryptoInt(DURATION_STATES) * TIME_QUANTUM_MS;
    }
    target.duration = value;
  } else if (coordinate === 1) {
    let value = target.delay ?? 0;
    while (value === (target.delay ?? 0)) {
      value = cryptoInt(DELAY_STATES) * TIME_QUANTUM_MS;
    }
    target.delay = value;
  } else {
    let value = target.intensity ?? 0.5;
    while (value === (target.intensity ?? 0.5)) {
      value = cryptoInt(RAW_INTENSITY_STATES) / RAW_INTENSITY_STEPS;
    }
    target.intensity = value;
  }

  next[pulseIndex] = target;
  return next;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function analyzePattern(pattern: ReadonlyArray<Vibration>): PatternAnalysis {
  const pulses = pattern.length || 1;
  const durations = pattern.map((v) => Math.max(1, v.duration));
  const delays = pattern.map((v) => Math.max(0, v.delay ?? 0));
  const intensities = pattern.map((v) => clamp(v.intensity ?? 0.5, 0, 1));

  const activeDuration = durations.reduce((sum, value) => sum + value, 0);
  const delayDuration = delays.reduce((sum, value) => sum + value, 0);
  const totalDuration = Math.max(1, activeDuration + delayDuration);
  const weightedEnergy = pattern.reduce(
    (sum, vibration, index) => sum + durations[index]! * intensities[index]!,
    0,
  );
  const energy = clamp(weightedEnergy / totalDuration, 0, 1);
  const density = clamp(activeDuration / totalDuration, 0, 1);

  const durationVariation = clamp(stddev(durations) / 350, 0, 1);
  const delayVariation = clamp(stddev(delays) / 350, 0, 1);
  const intensityVariation = clamp(stddev(intensities) / 0.4, 0, 1);
  const pulseFactor = clamp((pulses - 1) / (MAX_EXPLORER_PULSES - 1), 0, 1);

  let adjacentRoughness = 0;
  for (let index = 1; index < intensities.length; index += 1) {
    adjacentRoughness += Math.abs(intensities[index]! - intensities[index - 1]!);
  }
  const roughness = intensities.length > 1
    ? clamp(adjacentRoughness / (intensities.length - 1), 0, 1)
    : 0;

  const complexity = clamp(
    pulseFactor * 0.42 +
      durationVariation * 0.18 +
      delayVariation * 0.16 +
      intensityVariation * 0.14 +
      roughness * 0.1,
    0,
    1,
  );

  const tempo = clamp((pulses / totalDuration) * 1000, 0, 100);
  const bucketX = Math.min(MAP_COLUMNS - 1, Math.floor(energy * MAP_COLUMNS));
  const bucketY = Math.min(MAP_ROWS - 1, Math.floor(complexity * MAP_ROWS));

  return {
    pulseCount: pattern.length,
    totalDuration,
    activeDuration,
    delayDuration,
    energy,
    density,
    complexity,
    roughness,
    tempo,
    bucketX,
    bucketY,
    bucketId: `${bucketX}:${bucketY}`,
  };
}

export function formatBigInt(value: bigint): string {
  return value.toLocaleString('en-US');
}

export function formatScientific(value: bigint, significant = 5): string {
  const digits = value.toString();
  if (digits.length <= significant) return digits;
  const head = digits.slice(0, significant);
  return `${head[0]}.${head.slice(1)}e${digits.length - 1}`;
}
