# Haptic State Space Model

The phrase **haptic state space** needs a precise definition. There is no single universal count unless we first specify resolution, bounds, sequence length, backend, and the equivalence relation used to decide whether two patterns are the same.

WebHaptics v2 exposes a descriptor language. The browser and hardware then project many descriptors onto the same realized behavior.

## 1. What the v2 engine actually does

The current core gives us several hard facts:

- vibration duration is rounded to integer milliseconds
- the native PWM path clamps a vibration phase to `1...1000 ms`
- delay is rounded to integer milliseconds
- delay is non-negative, but is not globally capped by the engine
- intensity is clamped to `[0, 1]`
- native intensity synthesis uses a `20 ms` PWM carrier
- the switch-synthesis path schedules through `requestAnimationFrame`
- arbitrary sequence length is allowed by the descriptor model

Therefore the complete engine language is open-ended. Without an artificial delay bound and sequence-length bound, its descriptor space is not finite.

## 2. Bounded engine-resolution lattice

For comparison, suppose we impose a `1000 ms` delay cap while preserving the engine's integer-millisecond timing resolution and use a practical 1% intensity grid.

Per pulse:

- duration: `1...1000 ms` = 1000 states
- delay: `0...1000 ms` = 1001 states
- intensity: `0.00...1.00` = 101 states

So:

```text
1000 × 1001 × 101 = 101,101,000 descriptors per pulse
```

Exactly two pulses:

```text
101,101,000² = 10,221,412,201,000,000
```

This is already about `1.02214e16` descriptors.

This is still a chosen bounded model because the actual engine does not impose the `1000 ms` delay ceiling or a 1% intensity quantum.

## 3. Explorer lattice

The UI intentionally uses a coarser timing lattice because the purpose is exploration, not merely inflating the count with timing differences that are unlikely to be meaningfully distinct on the switch backend.

### Raw explorer lattice

- duration: `10...1000 ms`, step `10 ms` = 100 states
- delay: `0...1000 ms`, step `10 ms` = 101 states
- intensity: `0.00...1.00`, step `0.01` = 101 states

Per pulse:

```text
S_raw = 100 × 101 × 101 = 1,020,100
```

For exactly `N` pulses:

```text
P_raw(N) = 1,020,100^N
```

| Pulses | Exact raw descriptor count |
| ---: | ---: |
| 1 | 1,020,100 |
| 2 | 1,040,604,010,000 |
| 3 | 1,061,520,150,601,000,000 |
| 4 | 1,082,856,705,628,080,100,000,000 |
| 5 | 1,104,622,125,411,204,510,010,000,000,000 |
| 6 | 1,126,825,030,131,969,720,661,201,000,000,000,000 |

The sum of all 1 through 6 pulse patterns is:

```text
1,126,826,134,755,177,989,632,860,281,306,030,100
```

Approximately `1.126826e36` descriptors.

## 4. PWM-aligned explorer projection

The native vibration path uses a `20 ms` PWM cycle. On a complete carrier cycle, 5% intensity increments correspond to 1 ms duty increments.

That makes a useful canonical exploration projection:

- duration: 100 states
- delay: 101 states
- intensity: `0.00...1.00`, step `0.05` = 21 states

Per pulse:

```text
S_pwm = 100 × 101 × 21 = 212,100
```

For exactly `N` pulses:

```text
P_pwm(N) = 212,100^N
```

| Pulses | Exact PWM-aligned descriptor count |
| ---: | ---: |
| 1 | 212,100 |
| 2 | 44,986,410,000 |
| 3 | 9,541,617,561,000,000 |
| 4 | 2,023,777,084,688,100,000,000 |
| 5 | 429,243,119,662,346,010,000,000,000 |
| 6 | 91,042,465,680,383,588,721,000,000,000,000 |

The sum of all 1 through 6 pulse patterns is:

```text
91,042,894,925,527,037,693,360,647,622,100
```

Approximately `9.104289e31` descriptors.

The two-pulse value is the useful `1e10`-scale example:

```text
44,986,410,000
```

## 5. Descriptor count is not perceptual count

The tables above count **addresses in a chosen descriptor lattice**. They do not count unique sensations.

Several quotient operations collapse different descriptors into the same or nearly the same output.

### Zero-intensity collapse

An intensity of zero becomes silence. Multiple descriptors with different pulse boundaries can therefore describe equivalent silent time.

### Gap merging

The native flat vibration representation merges compatible adjacent off-time. Different high-level sequences can produce the same flattened timing array.

### PWM rounding

For full `20 ms` cycles, intensity is largely characterized by integer on-time. Partial final cycles use separate remainder rounding, so the 5% lattice is a convenient carrier-aligned projection, not an exact equivalence-class count for every duration.

### Frame quantization on the WebKit switch path

The switch synthesizer requests pulse intervals from approximately `16...200 ms`, but it can only act on animation frames.

If the display frame interval is `F = 1000 / refreshRate`, a requested interval projects approximately to:

```text
ceil(requestedInterval / F) frames
```

Examples:

- 60 Hz: about 12 cadence bands over the 16...200 ms interval range
- 90 Hz: about 17 cadence bands
- 120 Hz: about 23 cadence bands

Adaptive refresh rate, timer jitter, WebKit behavior, and hardware response can collapse or perturb these further.

### Conductor equivalence

When v2 tracks overlap, the conductor merges time coverage and uses the strongest active intensity. Different sets of overlapping logical tracks can therefore render to the same merged output.

### Hardware equivalence

Finally, the Taptic Engine or vibration motor has its own transfer function. Descriptor differences smaller than its temporal or amplitude response may not be physically or perceptually distinguishable.

## 6. Three spaces, not one

The explorer deliberately treats these as separate concepts:

1. **Descriptor space**: exact combinatorial count under explicitly chosen bounds and quantization.
2. **Rendered backend space**: descriptors quotient by browser scheduling, PWM, flattening, and conductor behavior.
3. **Perceptual space**: rendered outputs quotient again by device physics and human perception.

Only the first can be given one exact, backend-independent integer from the current code.

The second can be measured per backend and device.

The third requires psychophysical experiments, not just source-code analysis.

## 7. The atlas is a projection, not enumeration

The visual atlas uses 192 feature cells defined by energy and structural complexity. A cell can contain an astronomical number of descriptor addresses. Atlas coverage therefore means **coverage of the feature projection**, not percentage of all possible patterns.

Every generated specimen still receives an exact mixed-radix address within its fixed-length raw and PWM-aligned lattices, so the UI can show both its visual neighborhood and its combinatorial coordinate.
