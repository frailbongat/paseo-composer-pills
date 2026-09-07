/**
 * Client-only store for the account-wide Claude rate-limit snapshot.
 *
 * One poller in the client entrypoint owns the fetch; pills and the panel read
 * from here so a window with many agents still makes one request per interval.
 */

import { useSyncExternalStore } from "react";
import { FIVE_HOUR_ID, type LimitWindow, type LimitsSnapshot } from "./limits.shared";

const listeners = new Set<() => void>();
let snapshot: LimitsSnapshot | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LimitsSnapshot | null {
  return snapshot;
}

export function writeLimits(next: LimitsSnapshot): void {
  snapshot = next;
  notify();
}

export function readLimits(): LimitsSnapshot | null {
  return snapshot;
}

export function clearLimits(): void {
  if (snapshot === null) return;
  snapshot = null;
  notify();
}

export function useLimits(): LimitsSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function findWindow(
  limits: LimitsSnapshot | null,
  id: string = FIVE_HOUR_ID,
): LimitWindow | null {
  return limits?.windows.find((window) => window.id === id) ?? null;
}

/** Percent of the window still available, 0-100. */
export function remainingPercent(window: LimitWindow): number {
  return Math.min(100, Math.max(0, 100 - window.usedPercent));
}

const tickListeners = new Set<() => void>();
let tickNow = Date.now();
let tickTimer: ReturnType<typeof setInterval> | undefined;

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickTimer === undefined) {
    tickTimer = setInterval(() => {
      tickNow = Date.now();
      for (const tickListener of tickListeners) tickListener();
    }, 1_000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size > 0 || tickTimer === undefined) return;
    clearInterval(tickTimer);
    tickTimer = undefined;
  };
}

function getTick(): number {
  return tickNow;
}

/** Re-renders once a second so the reset countdown stays live. */
export function useNow(): number {
  return useSyncExternalStore(subscribeTick, getTick, getTick);
}

/** `3h 05m` far out, `4:09` inside the last hour, `2d 3h` for weekly windows. */
export function formatCountdown(resetsAt: string | null, now: number): string | null {
  if (resetsAt === null) return null;
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;

  const totalSeconds = Math.floor((target - now) / 1_000);
  if (totalSeconds <= 0) return "now";

  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatResetClock(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;
  return new Date(target).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
