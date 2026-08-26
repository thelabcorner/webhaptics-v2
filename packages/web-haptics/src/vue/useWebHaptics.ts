import { onMounted, onUnmounted, watch } from "vue";
import { CoreEngine } from "../core/engine";
import type { HapticInput, TriggerOptions, HapticsOptions } from "../core/types";

/**
 * v2 Vue composable — backed by CoreEngine (actuator auto-select,
 * pulse-density simulation, PWM vibrate patterns).
 */
export function useWebHaptics(options?: HapticsOptions) {
  let instance: CoreEngine | null = null;

  const getOrCreate = (): CoreEngine => {
    if (!instance) instance = new CoreEngine(options);
    return instance;
  };

  // SSR-safe: create eagerly so setup()-returned methods work immediately
  getOrCreate();

  onMounted(() => {
    if (!instance) instance = new CoreEngine(options);
  });

  onUnmounted(() => {
    void instance?.destroy();
    instance = null;
  });

  watch(
    () => options?.debug,
    (val) => {
      instance?.setDebug(val ?? false);
    },
  );

  const trigger = (input?: HapticInput, opts?: TriggerOptions) =>
    getOrCreate().trigger(input ?? "medium", opts);
  const cancel = () => instance?.cancel();

  const isSupported =
    typeof navigator !== "undefined" &&
    (typeof navigator.vibrate === "function" || true); // simulation fallback

  return { trigger, cancel, isSupported };
}
