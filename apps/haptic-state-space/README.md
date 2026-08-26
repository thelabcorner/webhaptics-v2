# Haptic State Space Explorer

A standalone experimental surface for WebHaptics v2. It builds to one self-contained `dist/index.html` using `vite-plugin-singlefile`.

## Run

```sh
pnpm install
pnpm explorer:dev
```

## Build the single HTML file

```sh
pnpm explorer:build
```

The output is:

```text
apps/haptic-state-space/dist/index.html
```

JavaScript and CSS are inlined into that file. The explorer has no runtime asset dependency on the repository.

## State-space model

The underlying WebHaptics API is not naturally a finite state space. Arbitrary sequence length is open-ended, delay is not globally bounded by the engine, and intensity is modeled continuously. The explorer therefore defines an explicit finite lattice for measurement and navigation.

### Raw descriptor lattice

- duration: `10...1000 ms` in `10 ms` increments, 100 states
- delay: `0...1000 ms` in `10 ms` increments, 101 states
- intensity: `0.00...1.00` in `0.01` increments, 101 states

Per pulse:

```text
100 × 101 × 101 = 1,020,100 states
```

For exactly `N` pulses:

```text
1,020,100^N
```

### PWM-aligned projection

The v2 native vibration path uses a 20 ms PWM carrier. A 5% intensity quantum corresponds to a 1 ms duty-step over a complete carrier cycle, so the explorer also exposes a coarser canonical projection:

- duration: 100 states
- delay: 101 states
- intensity: 21 states

Per pulse:

```text
100 × 101 × 21 = 212,100 states
```

For exactly two pulses this is:

```text
212,100² = 44,986,410,000 states
```

This is a useful canonical coordinate system. It is not a claim that all 44,986,410,000 descriptors are perceptually distinct.

## Persistence

Played specimens are stored in IndexedDB under `webhaptics-state-space`. The atlas tracks unique patterns, total plays, favorites, feature-space coverage, raw addresses, and PWM-projected addresses.

## Randomness

The **Uniform State Jump** generator uses `crypto.getRandomValues()` with rejection sampling. For a selected fixed pulse count, every coordinate in the chosen discrete lattice has equal probability. The tactile generator intentionally uses biased distributions and is labeled accordingly.
