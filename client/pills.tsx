import { settingsRpc } from "@getpaseo/plugin";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { ContextPillIcon, contextPillLabel } from "./context-pill";
import { ContextPopover } from "./context-readout";
import { LimitPillIcon, isClaudeAgent, limitPillLabel } from "./limit-pill";
import { LimitPopover } from "./limit-readout";
import { clearLimits, findWindow, readLimits, writeLimits } from "./limits-store";
import { readClaudeLimits } from "../shared/limits";
import {
  readSettings,
  resetSettingsCache,
  subscribeToSettings,
  writeSettings,
} from "./settings-store";
import { LABEL_TICK_INTERVAL_MS, limitsPollIntervalMs, pillSettings } from "../shared/settings";
import { clearAllVerdicts, clearVerdict } from "./ship-store";
import {
  clearAllUsage,
  clearUsage,
  readString,
  readUsage,
  toContextUsage,
  writeUsage,
} from "./usage-store";

/** Agents given a one-off refresh when the plugin starts. */
const PRIME_LIMIT = 24;

/**
 * The read/write contracts the daemon registers for `pillSettings`. Pills are
 * registered outside React, so the document is read over this RPC rather than
 * with `useSettings`, and parked in `settings-store` for everything else.
 *
 * Pill text is a plain string on the registration since 0.8, so the live reset
 * countdown is pushed with `update` on `LABEL_TICK_INTERVAL_MS` instead of
 * re-rendering.
 */
const settingsIo = settingsRpc(pillSettings.id);

type PillKind = "claude-limit" | "context";

/**
 * Paseo renders composer pills in registration order and offers no ordering
 * API, so this entrypoint registers both pills once per agent in this fixed
 * order and only ever toggles `visible`. Hiding preserves the registration, so
 * a pill that comes back lands in its original slot instead of at the end of
 * the row.
 *
 * Ship is not in this list. Its verdict is a paragraph of blockers rather than
 * a number, and its action belongs next to those blockers, so both live on the
 * timeline ship card instead.
 */
const PILL_ORDER: readonly PillKind[] = ["claude-limit", "context"];

export function contributeClient(client: PluginClientContext) {
  const pillsByAgent = new Map<string, Map<PillKind, PluginButtonRegistration>>();
  const labelsByAgent = new Map<string, Map<PillKind, string>>();
  const visibleByAgent = new Map<string, Map<PillKind, boolean>>();
  const workspaceByAgent = new Map<string, string>();
  const claudeAgents = new Set<string>();
  let disposed = false;

  /** Current pill text, or null when the store has nothing to show yet. */
  function pillLabel(kind: PillKind, agentId: string): string | null {
    if (kind === "context") return contextPillLabel(agentId);
    return limitPillLabel(Date.now());
  }

  function addPill(
    kind: PillKind,
    workspaceId: string,
    agentId: string,
    visible: boolean,
  ): PluginButtonRegistration {
    const label = pillLabel(kind, agentId);

    if (kind === "context") {
      return client.addComposerPill({
        id: "context",
        workspaceId,
        agentId,
        button: {
          title: "Context window usage",
          icon: ContextPillIcon,
          ...(label === null ? {} : { label }),
          visible,
          // The readout is the whole point of the tap, so it opens in place: a
          // sheet on a phone, an anchored popover on a wide window. The panel
          // stays registered for anyone who wants it as a tab.
          behavior: { kind: "popover", Content: ContextPopover },
        },
      });
    }

    return client.addComposerPill({
      id: "claude-limit",
      workspaceId,
      agentId,
      button: {
        title: "Claude usage limit",
        icon: LimitPillIcon,
        ...(label === null ? {} : { label }),
        visible,
        // The readout refreshes itself on open and writes into the shared
        // store, so opening it is also what the old forced refresh bought.
        behavior: { kind: "popover", Content: LimitPopover },
      },
    });
  }

  /** Pushes changed pill text into registrations already on screen. */
  function syncLabels(agentId: string): void {
    const pills = pillsByAgent.get(agentId);
    if (!pills) return;
    const known = labelsByAgent.get(agentId) ?? new Map<PillKind, string>();

    for (const [kind, pill] of pills) {
      const label = pillLabel(kind, agentId);
      if (label === null || label === known.get(kind)) continue;
      known.set(kind, label);
      pill.update({ label });
    }
    labelsByAgent.set(agentId, known);
  }

  function syncAllLabels(): void {
    for (const agentId of pillsByAgent.keys()) syncLabels(agentId);
  }

  /** A pill with nothing to say is hidden rather than shown empty. */
  function desiredPills(agentId: string): PillKind[] {
    const hasLimit = findWindow(readLimits()) !== null && claudeAgents.has(agentId);
    const hasUsage = readUsage(agentId) !== null;

    return PILL_ORDER.filter((kind) => (kind === "claude-limit" ? hasLimit : hasUsage));
  }

  function removeAgentPills(agentId: string): void {
    const pills = pillsByAgent.get(agentId);
    if (pills) for (const pill of pills.values()) pill.remove();
    pillsByAgent.delete(agentId);
    labelsByAgent.delete(agentId);
    visibleByAgent.delete(agentId);
  }

  /**
   * Registers every pill in `PILL_ORDER` the first time an agent is seen, so
   * registration order is fixed for the agent's whole life and slots never move.
   */
  function mountPills(workspaceId: string, agentId: string): void {
    const desired = new Set(desiredPills(agentId));
    const pills = new Map<PillKind, PluginButtonRegistration>();
    const labels = new Map<PillKind, string>();
    const shown = new Map<PillKind, boolean>();

    for (const kind of PILL_ORDER) {
      const visible = desired.has(kind);
      try {
        pills.set(kind, addPill(kind, workspaceId, agentId, visible));
        shown.set(kind, visible);
        const label = pillLabel(kind, agentId);
        if (label !== null) labels.set(kind, label);
      } catch (error) {
        console.error(`[paseo-composer-pills] failed to add ${kind} pill`, error);
      }
    }

    pillsByAgent.set(agentId, pills);
    labelsByAgent.set(agentId, labels);
    visibleByAgent.set(agentId, shown);
  }

  function syncPills(agentId: string): void {
    if (disposed) return;
    const workspaceId = workspaceByAgent.get(agentId);
    if (!workspaceId) {
      removeAgentPills(agentId);
      return;
    }

    const pills = pillsByAgent.get(agentId);
    if (!pills) {
      mountPills(workspaceId, agentId);
      return;
    }

    // Toggle in place. Re-adding would append the pill to the end of the row.
    const desired = new Set(desiredPills(agentId));
    const shown = visibleByAgent.get(agentId) ?? new Map<PillKind, boolean>();
    for (const [kind, pill] of pills) {
      const visible = desired.has(kind);
      if (visible === shown.get(kind)) continue;
      shown.set(kind, visible);
      pill.update({ visible });
    }
    visibleByAgent.set(agentId, shown);

    syncLabels(agentId);
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
    // The verdict store outlives the pills: the panel and `/ship-check` write
    // into it. An agent that is gone still has to leave it.
    clearVerdict(agentId);
    workspaceByAgent.delete(agentId);
    claudeAgents.delete(agentId);
    removeAgentPills(agentId);
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

  /**
   * Reads the persisted document. Failures leave the store on its last good
   * values, which are the schema defaults until the first read lands, so a
   * settings read that never answers behaves like the old constants.
   */
  async function loadSettings(): Promise<void> {
    try {
      const result = await client.rpc(settingsIo.read, {});
      if (disposed || result.status !== "ready") return;
      const parsed = pillSettings.schema.safeParse(result.values);
      if (parsed.success) writeSettings(parsed.data);
    } catch (error) {
      console.error("[paseo-composer-pills] failed to read settings", error);
    }
  }

  // Settings first, so the poll runs on the saved beat from the start.
  void loadSettings();
  void refreshLimits(false);

  let pollIntervalMs = limitsPollIntervalMs(readSettings());
  // The document is re-read on the poll beat, so a change saved on another
  // client reaches this one without a plugin reload.
  let poll = setInterval(pollTick, pollIntervalMs);

  function pollTick(): void {
    void refreshLimits(false);
    void loadSettings();
  }

  /** Only ever called when the interval actually moved, so no beat is lost. */
  function reschedulePoll(): void {
    clearInterval(poll);
    pollIntervalMs = limitsPollIntervalMs(readSettings());
    poll = setInterval(pollTick, pollIntervalMs);
  }

  const labelTick = setInterval(syncAllLabels, LABEL_TICK_INTERVAL_MS);

  const unwatchSettings = subscribeToSettings(() => {
    if (disposed) return;
    if (limitsPollIntervalMs(readSettings()) !== pollIntervalMs) reschedulePoll();
  });

  return () => {
    disposed = true;
    clearInterval(poll);
    clearInterval(labelTick);
    unwatchSettings();
    unsubscribe();
    for (const agentId of [...pillsByAgent.keys()]) removeAgentPills(agentId);
    workspaceByAgent.clear();
    claudeAgents.clear();
    clearAllUsage();
    clearAllVerdicts();
    clearLimits();
    resetSettingsCache();
  };
}
