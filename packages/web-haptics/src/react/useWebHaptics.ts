"use client";

import { useRef, useEffect, useCallback } from "react";
import { CoreEngine } from "../core/engine";
import type { HapticInput, TriggerOptions, HapticsOptions } from "../core/types";

/**
 * v2 React hook — backed by CoreEngine (actuator auto-select, pulse-density
 * simulation, PWM vibrate patterns, AbortSignal support). API-compatible
 * with the v1 hook (trigger/cancel/isSupported + options.debug/showToggle).
 *
 * StrictMode-safe: instance is recreated in the effect body after the
 * dev-only double-invoke cleanup, and trigger() self-heals if the ref was
 * nulled between renders.
 */
export function useWebHaptics(options?: HapticsOptions) {
  const instanceRef = useRef<CoreEngine | null>(null);
  // Keep latest options without resubscribing effects
  const optionsRef = useRef<HapticsOptions | undefined>(options);
  optionsRef.current = options;

  const getOrCreate = useCallback((): CoreEngine | null => {
    if (typeof window === "undefined") return null;
    if (!instanceRef.current) {
      instanceRef.current = new CoreEngine(optionsRef.current);
    }
    return instanceRef.current;
  }, []);

  useEffect(() => {
    getOrCreate();
    return () => {
      void instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [getOrCreate]);

  useEffect(() => {
    instanceRef.current?.setDebug(options?.debug ?? false);
  }, [options?.debug]);

  useEffect(() => {
    instanceRef.current?.setShowSwitch(
      (options as { showToggle?: boolean })?.showToggle ?? false,
    );
  }, [(options as { showToggle?: boolean })?.showToggle]);

  const trigger = useCallback(
    (input?: HapticInput, opts?: TriggerOptions) =>
      getOrCreate()?.trigger(input ?? "medium", opts),
    [getOrCreate],
  );

  const cancel = useCallback(() => getOrCreate()?.cancel(), [getOrCreate]);

  const registerPreset = useCallback(
    (name: string, config: Parameters<CoreEngine["registerPreset"]>[1]) =>
      getOrCreate()?.registerPreset(name, config),
    [getOrCreate],
  );

  const isSupported =
    typeof navigator !== "undefined" &&
    (typeof navigator.vibrate === "function" || true); // simulation fallback always available

  return { trigger, cancel, registerPreset, isSupported };
}
