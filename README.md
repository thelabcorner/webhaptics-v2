<div align="center">

# WebHaptics v2

### High quality haptic feedback for the mobile web.

A performance-focused evolution of [`lochie/web-haptics`](https://github.com/lochie/web-haptics), rebuilt around multi-track playback, lower runtime overhead, stronger cancellation semantics, and a more robust iOS WebKit fallback.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-18181b?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-18181b?style=flat-square)](LICENSE)
[![Architecture](https://img.shields.io/badge/Architecture-v2-18181b?style=flat-square)](#v1-vs-v2)
[![WebKit](https://img.shields.io/badge/iOS-WebKit-18181b?style=flat-square&logo=safari&logoColor=white)](#ios-and-webkit)

[Original project](https://github.com/lochie/web-haptics) · [Architecture](#architecture) · [v1 vs v2](#v1-vs-v2) · [Development](#development)

</div>

> [!IMPORTANT]
> This repository is an independent experimental v2 fork of [`lochie/web-haptics`](https://github.com/lochie/web-haptics). It is not an official upstream v2 release. The original project and core web-haptics concept belong to Lochie Axon and its contributors.

## Why v2

The original `web-haptics` project solves a genuinely awkward browser problem with a remarkably practical idea: use the native Vibration API where it exists, then synthesize haptic pulses through WebKit's native switch control when vibration is unavailable.

That foundation is the reason this project exists.

WebHaptics v2 keeps the same fundamental idea, but changes the execution model around it. The goal is to make haptics behave more like a small real-time subsystem than a sequence of isolated timers and DOM clicks.

The main priorities are:

- preserve the native fast path when `navigator.vibrate()` is available
- keep the iOS WebKit switch path rendered and usable while remaining visually invisible
- allow independent haptic events to overlap instead of automatically killing each other
- avoid unnecessary DOM, audio, allocation, and phase-scanning work
- bound concurrency so richer behavior does not become unbounded main-thread work
- make cancellation and rapid retrigger behavior deterministic
- respect reduced-motion preferences
- provide field diagnostics for tuning real devices

## v1 vs v2

| Area | Original v1 | WebHaptics v2 |
| --- | --- | --- |
| Playback model | Single active pattern | Multi-track conductor |
| Overlapping triggers | A new simulated pattern stops the previous one | Independent tracks merge or interleave |
| Native vibration overlap | Each `navigator.vibrate()` call replaces the prior pattern | Live tracks are fused into one native pattern |
| iOS switch lifecycle | Per-instance hidden switch | Shared document-level switch resource |
| Hidden switch strategy | `display: none` when hidden | `opacity: 0` while remaining rendered |
| Scheduler | Continuous rAF loop with repeated phase search | Frame-locked runner with a stateful phase cursor |
| Rapid duplicate triggers | No dedicated coalescing policy | 60 ms identical-pattern coalescing window |
| Same-pattern retriggers | New trigger replaces active pattern globally | Same voice restarts without stacking duplicates |
| Concurrency | Effectively one simulated voice | Bounded multi-voice playback, currently capped at 3 |
| Intensity | Pulse density and PWM | Preserved, with the execution path optimized around it |
| Audio debug path | Per-instance resources and buffer mutation during clicks | Shared audio graph and reusable click buffer |
| Cancellation | Global pattern stop | Per-track `AbortSignal` support plus global cancel |
| Reduced motion | Not part of the core engine | Built-in `prefers-reduced-motion` handling |
| Diagnostics | None | On-device pulse cadence statistics |

### The most important behavioral change

Original v1 calls `stopPattern()` before starting a new simulated pattern. That makes the system effectively single voice.

V2 introduces a **Conductor**. Every haptic trigger becomes a logical track. The engine can then combine active tracks according to the capabilities of the backend.

For the Vibration API, which is fundamentally a single output channel, overlapping tracks are collapsed into a single timeline using a sweep-line union. When tracks overlap, the strongest active intensity wins.

For the WebKit switch path, independent click trains can coexist on the shared native switch resource.

This means a short notification can occur while a longer effect is still active without requiring the entire haptic state to be discarded.

## Architecture

```text
                               trigger()
                                   |
                     +-------------+-------------+
                     |                           |
              Vibration API                Simulation path
                 available                  / WebKit path
                     |                           |
                Conductor                   rAF runners
                     |                           |
             live logical tracks            shared resources
                     |                           |
             sweep-line merge              label + input[switch]
                     |                           |
          one flat native pattern          native switch clicks
                     |                           |
          navigator.vibrate()              WebKit haptic feedback
```

### Conductor

The v2 conductor is responsible for coordinating overlapping haptic tracks.

It provides:

- **merge behavior** for normal overlapping playback
- **preempt behavior** when an effect should explicitly replace current native tracks
- **maximum-intensity superposition** where tracks overlap
- **bounded concurrency** with oldest-track eviction
- **same-pattern restart semantics** so identical live voices do not stack indefinitely
- **60 ms coalescing** for accidental or redundant rapid retriggers
- **segment coalescing** so adjacent regions with the same intensity become one region

The conductor itself is pure and deterministic. DOM and timer concerns stay outside the merge logic.

## iOS and WebKit

The iOS path is the reason this library is unusual.

WebKit can expose native switch behavior for an input using the nonstandard `switch` attribute:

```html
<input type="checkbox" switch />
```

The original project uses an associated label click as the haptic primitive. V2 preserves that mechanism and focuses on keeping it reliable and inexpensive.

### Rendered, not displayed

One subtle but important v2 change is how the hidden native switch is concealed.

The original implementation hides the label and checkbox with:

```css
display: none;
```

V2 instead keeps the switch in the render tree and makes it visually transparent:

```css
opacity: 0;
pointer-events: none;
```

This distinction matters because `display: none` removes the control's renderer. Keeping the native switch rendered gives WebKit the best chance to preserve the switch-backed haptic path while still making the implementation invisible to the user.

### Frame-locked pulse scheduling

The simulation path intentionally uses `requestAnimationFrame` rather than a chain of short `setTimeout` calls.

That keeps pulse generation synchronized with the browser's rendering cadence, including high-refresh-rate displays, while avoiding timer-clamp drift.

Intensity controls pulse density. At maximum intensity, the current minimum requested interval is 16 ms. Lower intensities progressively increase the interval up to roughly 200 ms.

V2 also advances through the phase timeline with a stateful cursor. It does not linearly rescan every phase on every animation frame.

## Shared resources

The fallback actuator is designed around shared infrastructure.

Across active haptic tracks, v2 reuses:

- one hidden native switch and associated label per document
- one `AudioContext` for debug feedback
- one band-pass filter and gain stage
- one reusable short noise buffer

Each active haptic can still have its own scheduler runner and cancellation controller, but the expensive supporting resources are not recreated for every pulse.

## Native vibration path

When `navigator.vibrate()` is available, WebHaptics v2 keeps the browser-native path as the preferred actuator.

Patterns are represented as logical tracks first. The conductor then:

1. expands each live track into absolute time segments
2. finds overlapping regions
3. uses the highest active intensity for each region
4. coalesces adjacent equivalent regions
5. converts the result back into one relative vibration pattern
6. submits the final flat pattern to `navigator.vibrate()`

This gives the API logical polyphony even though the physical browser vibration channel is mono.

## Usage

The v2 core exposes a factory-based engine:

```ts
import { createWebHaptics } from "web-haptics";

const haptics = createWebHaptics();

await haptics.trigger("success");
await haptics.trigger("selection", { intensity: 0.4 });
```

Custom patterns are supported:

```ts
await haptics.trigger([
  { duration: 35, intensity: 0.85 },
  { delay: 45, duration: 20, intensity: 0.35 },
]);
```

Cancellation can be scoped to a single request with `AbortSignal`:

```ts
const controller = new AbortController();

haptics.trigger("buzz", {
  signal: controller.signal,
});

controller.abort();
```

Or cancel all active playback through the engine:

```ts
haptics.cancel();
```

React, Vue, and Svelte adapters remain part of the package structure.

## Presets

The project retains familiar high-level haptic presets while allowing arbitrary custom patterns.

Examples include:

- `success`
- `warning`
- `error`
- `light`
- `medium`
- `heavy`
- `selection`
- `nudge`
- `buzz`

Patterns are expressed as durations, optional delays, and normalized intensity values from `0` to `1`.

## Reduced motion

V2 can respect the user's `prefers-reduced-motion` setting at the engine level.

```ts
const haptics = createWebHaptics({
  reducedMotion: "respect",
});
```

Supported modes are:

| Mode | Behavior |
| --- | --- |
| `respect` | Follow the system preference |
| `ignore` | Ignore the system preference |
| `force` | Reserved as an explicit engine policy |

## Field diagnostics

Real haptic behavior is partly determined by browser scheduling, refresh rate, device hardware, and WebKit behavior. V2 includes a small pulse timestamp ring buffer for on-device measurement.

In browser builds, the engine exposes:

```js
window.__webHapticsPulseStats()
```

This reports recent pulse count plus median, minimum, and maximum inter-pulse gaps. It is intended for device testing and scheduler tuning rather than application logic.

## Development status

This repository is currently a source-level v2 fork. The package metadata still inherits upstream naming and publication information, so installing `web-haptics` from npm should be treated as installing the upstream package unless a dedicated v2 release is explicitly published.

To work with this fork directly:

```sh
git clone https://github.com/thelabcorner/webhaptics-v2.git
cd webhaptics-v2
pnpm install:all
pnpm build
```

Run the development environment:

```sh
pnpm dev
```

Run library tests:

```sh
pnpm --filter=web-haptics test:run
```

## Design principles

WebHaptics v2 is intentionally conservative about its primitive and aggressive about everything around it.

The project does not pretend the browser exposes a full native haptic engine when it does not. Instead, it tries to extract the best behavior possible from the primitives that actually exist.

That means:

- prefer native browser functionality when available
- preserve WebKit's native switch mechanism rather than replacing it with visual simulation
- minimize work in the pulse hot path
- make overlap behavior explicit and deterministic
- bound resource use
- treat device measurements as more valuable than assumptions
- degrade safely when a platform cannot provide real haptics

## Credits

WebHaptics v2 is based on and deeply indebted to **[Lochie Axon's original `web-haptics`](https://github.com/lochie/web-haptics)**.

The original project established the API shape, framework integrations, preset model, Vibration API path, and the WebKit `input[type="checkbox"][switch]` technique that makes haptic feedback possible on iOS web experiences where the standard Vibration API is unavailable.

V2 should be understood as an engineering evolution of that work, not a replacement for its authorship or contribution.

Additional upstream acknowledgement belongs to [Alex](https://x.com/alexvanderzon) for assistance with the original project's site design.

## License

MIT. See [`LICENSE`](LICENSE).
