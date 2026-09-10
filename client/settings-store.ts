/**
 * Client-only cache of the persisted settings document.
 *
 * `useSettings` is a hook, and the pill registrations in `client/pills.tsx` run
 * outside React, where no hook can be called. So the entrypoint reads the
 * document over the settings RPC and parks it here, and everything that needs a
 * setting reads this store instead: the pill entrypoint synchronously, the
 * panels through `usePillSettings`.
 */

import { useSyncExternalStore } from "react";
import { DEFAULT_PILL_SETTINGS, type PillSettings } from "../shared/settings";

const listeners = new Set<() => void>();
let current: PillSettings = DEFAULT_PILL_SETTINGS;

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Never null: the schema defaults stand in until the first read lands. */
export function readSettings(): PillSettings {
  return current;
}

function same(a: PillSettings, b: PillSettings): boolean {
  return (
    a.limitsPollSeconds === b.limitsPollSeconds &&
    a.compactWidth === b.compactWidth &&
    a.shipCommand === b.shipCommand
  );
}

/** Writing an unchanged document would wake every pill and panel for nothing. */
export function writeSettings(next: PillSettings): void {
  if (same(current, next)) return;
  current = next;
  notify();
}

export function resetSettingsCache(): void {
  if (same(current, DEFAULT_PILL_SETTINGS)) return;
  current = DEFAULT_PILL_SETTINGS;
  notify();
}

export function usePillSettings(): PillSettings {
  return useSyncExternalStore(subscribeToSettings, readSettings, readSettings);
}
