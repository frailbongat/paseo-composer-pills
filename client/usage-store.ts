/**
 * Client-only store for per-agent context-window usage.
 *
 * Paseo's plugin agent snapshot (`useAgent`) does not carry token usage, so the
 * numbers come from the SDK agent stream (`lastUsage`) instead. Values are kept
 * by reference so `useSyncExternalStore` sees a stable snapshot between changes.
 */

export interface ContextUsage {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalCostUsd: number | null;
}

const usageByAgent = new Map<string, ContextUsage>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readUsage(agentId: string): ContextUsage | null {
  return usageByAgent.get(agentId) ?? null;
}

function sameUsage(a: ContextUsage, b: ContextUsage): boolean {
  return (
    a.usedTokens === b.usedTokens &&
    a.maxTokens === b.maxTokens &&
    a.inputTokens === b.inputTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.outputTokens === b.outputTokens &&
    a.totalCostUsd === b.totalCostUsd
  );
}

export function writeUsage(agentId: string, next: ContextUsage): void {
  const previous = usageByAgent.get(agentId);
  if (previous && sameUsage(previous, next)) return;
  usageByAgent.set(agentId, next);
  notify();
}

export function clearUsage(agentId: string): void {
  if (!usageByAgent.delete(agentId)) return;
  notify();
}

export function clearAllUsage(): void {
  if (usageByAgent.size === 0) return;
  usageByAgent.clear();
  notify();
}

function readNumber(source: unknown, key: string): number | null {
  if (!source || typeof source !== "object") return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readString(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object") return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads `lastUsage` off an SDK agent snapshot. */
export function toContextUsage(agentSnapshot: unknown): ContextUsage | null {
  if (!agentSnapshot || typeof agentSnapshot !== "object") return null;
  const lastUsage = (agentSnapshot as Record<string, unknown>).lastUsage;
  const usedTokens = readNumber(lastUsage, "contextWindowUsedTokens");
  if (usedTokens === null) return null;
  const maxTokens = readNumber(lastUsage, "contextWindowMaxTokens");
  return {
    usedTokens,
    maxTokens: maxTokens !== null && maxTokens > 0 ? maxTokens : null,
    inputTokens: readNumber(lastUsage, "inputTokens"),
    cachedInputTokens: readNumber(lastUsage, "cachedInputTokens"),
    outputTokens: readNumber(lastUsage, "outputTokens"),
    totalCostUsd: readNumber(lastUsage, "totalCostUsd"),
  };
}

/** 0 when the model's context limit is unknown. */
export function usageRatio(usage: ContextUsage): number {
  if (usage.maxTokens === null) return 0;
  return Math.min(1, Math.max(0, usage.usedTokens / usage.maxTokens));
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${Math.round(tokens)}`;
}

export function formatExactTokens(tokens: number): string {
  return Math.round(tokens).toLocaleString("en-US");
}

export function formatUsage(usage: ContextUsage): string {
  const tokens = formatTokens(usage.usedTokens);
  if (usage.maxTokens === null) return tokens;
  return `${tokens} (${Math.round(usageRatio(usage) * 100)}%)`;
}
