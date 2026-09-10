/**
 * Client-only store for the per-agent ship verdict, plus the width gate.
 *
 * The client entrypoint owns the RPC so one agent's verdict is fetched once and
 * read by both the pill and the panel. The width gate lives here too because
 * pill registration happens outside React, where `layout.compact` is not
 * available: only rendered components get that prop.
 */

import { useSyncExternalStore } from "react";
import { Dimensions } from "react-native";
import { readSettings } from "./settings-store";
import type { ShipVerdict } from "../shared/ship";

const listeners = new Set<() => void>();
const verdicts = new Map<string, ShipVerdict>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToVerdicts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readVerdict(agentId: string): ShipVerdict | null {
  return verdicts.get(agentId) ?? null;
}

export function writeVerdict(agentId: string, verdict: ShipVerdict): void {
  verdicts.set(agentId, verdict);
  notify();
}

export function clearVerdict(agentId: string): void {
  if (!verdicts.delete(agentId)) return;
  notify();
}

export function clearAllVerdicts(): void {
  if (verdicts.size === 0) return;
  verdicts.clear();
  notify();
}

export function useShipVerdict(agentId: string): ShipVerdict | null {
  return useSyncExternalStore(
    subscribeToVerdicts,
    () => readVerdict(agentId),
    () => readVerdict(agentId),
  );
}

/**
 * The threshold is `compactWidth` in settings, defaulting to Paseo's own
 * `COMPACT_FORM_FACTOR_WIDTH` of 500. Paseo measures the composer's pane and
 * this measures the window, so a narrow pane on a wide desktop still counts as
 * wide here. That is the intended reading: the rule is about the phone. `0`
 * turns the rule off, so every window is treated as wide.
 */
export function isCompactClient(): boolean {
  return Dimensions.get("window").width < readSettings().compactWidth;
}

/** Calls back when the window crosses the compact threshold, not on every pixel. */
export function watchCompact(onChange: () => void): () => void {
  let compact = isCompactClient();
  const subscription = Dimensions.addEventListener("change", () => {
    const next = isCompactClient();
    if (next === compact) return;
    compact = next;
    onChange();
  });
  return () => subscription.remove();
}
