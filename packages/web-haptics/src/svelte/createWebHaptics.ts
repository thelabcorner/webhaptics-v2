import { CoreEngine } from "../core/engine";
import type { HapticInput, TriggerOptions, HapticsOptions } from "../core/types";

/**
 * v2 Svelte factory — backed by CoreEngine (actuator auto-select,
 * pulse-density simulation, PWM vibrate patterns).
 */
export function createWebHaptics(options?: HapticsOptions) {
  const instance = new CoreEngine(options);

  const trigger = (input?: HapticInput, opts?: TriggerOptions) =>
    instance.trigger(input ?? "medium", opts);
  const cancel = () => instance.cancel();
  const destroy = () => instance.destroy();
  const setDebug = (debug: boolean) => instance.setDebug(debug);

  const isSupported =
    typeof navigator !== "undefined" &&
    (typeof navigator.vibrate === "function" || true); // simulation fallback

  return { trigger, cancel, destroy, setDebug, isSupported };
}
