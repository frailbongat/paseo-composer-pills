import type { PluginClientContext } from "@getpaseo/plugin";
import { CONTEXT_PANEL_ID, ContextPill } from "./context-pill.client";
import { LIMIT_PANEL_ID, LimitPill, isClaudeAgent } from "./limit-pill.client";
import { clearLimits, findWindow, readLimits, writeLimits } from "./limits-store.client";
import { readClaudeLimits } from "./limits.shared";
import {
  clearAllUsage,
  clearUsage,
  readString,
  readUsage,
  toContextUsage,
  writeUsage,
} from "./usage-store.client";

/** Agents given a one-off refresh when the plugin starts. */
const PRIME_LIMIT = 24;
const LIMITS_POLL_INTERVAL_MS = 60_000;

type PillKind = "claude-limit" | "context";

/**
 * Paseo renders composer pills in registration order and offers no ordering
 * API, so this entrypoint owns both pills and rebuilds an agent's pills in this
 * fixed order whenever the visible set changes.
 */
const PILL_ORDER: readonly PillKind[] = ["claude-limit", "context"];

export function contributeClient(client: PluginClientContext) {
  const removalsByAgent = new Map<string, Map<PillKind, () => void>>();
  const mountedByAgent = new Map<string, string>();
  const workspaceByAgent = new Map<string, string>();
  const claudeAgents = new Set<string>();
  let disposed = false;

  function addPill(kind: PillKind, workspaceId: string, agentId: string): () => void {
    if (kind === "context") {
      return client.addComposerPill({
        id: "context",
        title: "Context window usage",
        workspaceId,
        agentId,
        Component: ContextPill,
        onPress() {
          client.openPanel(CONTEXT_PANEL_ID, { workspaceId, agentId });
        },
      });
    }

    return client.addComposerPill({
      id: "claude-limit",
      title: "Claude usage limit",
      workspaceId,
      agentId,
      Component: LimitPill,
      async onPress() {
        client.openPanel(LIMIT_PANEL_ID, { workspaceId, agentId });
        await refreshLimits(true);
      },
    });
  }

  function desiredPills(agentId: string): PillKind[] {
    const hasLimit = findWindow(readLimits()) !== null && claudeAgents.has(agentId);
    const hasUsage = readUsage(agentId) !== null;
    return PILL_ORDER.filter((kind) =>
      kind === "claude-limit" ? hasLimit : hasUsage,
    );
  }

  function unmount(agentId: string): void {
    const removals = removalsByAgent.get(agentId);
    if (removals) for (const remove of removals.values()) remove();
    removalsByAgent.delete(agentId);
    mountedByAgent.delete(agentId);
  }

  function syncPills(agentId: string): void {
    if (disposed) return;
    const workspaceId = workspaceByAgent.get(agentId);
    const desired = workspaceId ? desiredPills(agentId) : [];
    const signature = desired.join(",");
    if (signature === (mountedByAgent.get(agentId) ?? "")) return;

    // Order is registration order, so re-add the whole set on any change.
    unmount(agentId);
    if (!workspaceId || desired.length === 0) return;

    const removals = new Map<PillKind, () => void>();
    for (const kind of desired) {
      try {
        removals.set(kind, addPill(kind, workspaceId, agentId));
      } catch (error) {
        console.error(`[paseo-composer-pills] failed to add ${kind} pill`, error);
      }
    }
    removalsByAgent.set(agentId, removals);
    mountedByAgent.set(agentId, signature);
  }

  function syncAllPills(): void {
    for (const agentId of workspaceByAgent.keys()) syncPills(agentId);
  }

  async function refreshLimits(force: boolean): Promise<void> {
    try {
      const snapshot = await client.rpc(readClaudeLimits, { force });
      if (disposed) return;
      writeLimits(snapshot);
      if (snapshot.error !== null) console.error("[paseo-composer-pills]", snapshot.error);
      syncAllPills();
    } catch (error) {
      console.error("[paseo-composer-pills] failed to read Claude limits", error);
    }
  }

  function observe(agentSnapshot: unknown): void {
    const agentId = readString(agentSnapshot, "id");
    if (!agentId) return;

    const workspaceId = readString(agentSnapshot, "workspaceId");
    if (workspaceId) workspaceByAgent.set(agentId, workspaceId);

    if (isClaudeAgent(readString(agentSnapshot, "provider"), readString(agentSnapshot, "model"))) {
      claudeAgents.add(agentId);
    } else {
      claudeAgents.delete(agentId);
    }

    // A partial update without usage must not blank an already-known value.
    const usage = toContextUsage(agentSnapshot);
    if (usage) writeUsage(agentId, usage);

    syncPills(agentId);
  }

  function forget(agentId: string): void {
    clearUsage(agentId);
    workspaceByAgent.delete(agentId);
    claudeAgents.delete(agentId);
    unmount(agentId);
  }

  /** Entries from `agents.list()` may wrap the snapshot; accept either shape. */
  function unwrapAgent(entry: unknown): unknown {
    if (entry && typeof entry === "object" && "agent" in entry) {
      return (entry as { agent: unknown }).agent;
    }
    return entry;
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      forget(update.agentId);
      return;
    }
    observe(update.agent);
  });

  // Existing agents may never emit an update until their next turn, so prime
  // them once at startup.
  void (async () => {
    try {
      const result = await client.paseo.agents.list();
      if (disposed) return;

      const snapshots = (result.entries as readonly unknown[])
        .map(unwrapAgent)
        .slice(0, PRIME_LIMIT);

      for (const snapshot of snapshots) {
        observe(snapshot);
        const agentId = readString(snapshot, "id");
        if (!agentId || readUsage(agentId) !== null) continue;

        const handle = client.paseo.agents.ref(agentId);
        await handle.refresh();
        if (disposed) return;
        observe(handle.current());
      }
    } catch (error) {
      console.error("[paseo-composer-pills] failed to prime context usage", error);
    }
  })();

  void refreshLimits(false);
  const poll = setInterval(() => void refreshLimits(false), LIMITS_POLL_INTERVAL_MS);

  return () => {
    disposed = true;
    clearInterval(poll);
    unsubscribe();
    for (const agentId of [...removalsByAgent.keys()]) unmount(agentId);
    workspaceByAgent.clear();
    claudeAgents.clear();
    clearAllUsage();
    clearLimits();
  };
}
