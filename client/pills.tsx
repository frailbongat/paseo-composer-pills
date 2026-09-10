import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { CONTEXT_PANEL_ID, ContextPillIcon, contextPillLabel } from "./context-pill";
import { LIMIT_PANEL_ID, LimitPillIcon, isClaudeAgent, limitPillLabel } from "./limit-pill";
import { clearLimits, findWindow, readLimits, writeLimits } from "./limits-store";
import { readClaudeLimits } from "../shared/limits";
import { SHIP_PANEL_ID, ShipPillIcon, shipPillLabel } from "./ship-pill";
import {
  clearAllVerdicts,
  clearVerdict,
  isCompactClient,
  readVerdict,
  watchCompact,
  writeVerdict,
} from "./ship-store";
import { hasVerdict, isReady, readShipVerdict } from "../shared/ship";
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
const LIMITS_POLL_INTERVAL_MS = 60_000;
/**
 * The verdict only moves when the tree moves, and the end of a turn already
 * forces a re-read, so this is a backstop for edits made outside the agent.
 */
const SHIP_POLL_INTERVAL_MS = 60_000;
/**
 * Pill text is a plain string on the registration since 0.8, so the live reset
 * countdown is pushed with `update` on this beat instead of re-rendering.
 */
const LABEL_TICK_INTERVAL_MS = 1_000;

type PillKind = "claude-limit" | "context" | "ship";

/**
 * Paseo renders composer pills in registration order and offers no ordering
 * API, so this entrypoint registers all three pills once per agent in this
 * fixed order and only ever toggles `visible`. Hiding preserves the
 * registration, so a pill that comes back lands in its original slot instead of
 * at the end of the row.
 */
const PILL_ORDER: readonly PillKind[] = ["claude-limit", "context", "ship"];

export function contributeClient(client: PluginClientContext) {
  const pillsByAgent = new Map<string, Map<PillKind, PluginButtonRegistration>>();
  const labelsByAgent = new Map<string, Map<PillKind, string>>();
  const visibleByAgent = new Map<string, Map<PillKind, boolean>>();
  const workspaceByAgent = new Map<string, string>();
  const cwdByAgent = new Map<string, string>();
  const statusByAgent = new Map<string, string>();
  const claudeAgents = new Set<string>();
  const shipInFlight = new Set<string>();
  let disposed = false;

  /** Current pill text, or null when the store has nothing to show yet. */
  function pillLabel(kind: PillKind, agentId: string): string | null {
    if (kind === "context") return contextPillLabel(agentId);
    if (kind === "ship") return shipPillLabel(agentId);
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
          behavior: {
            kind: "action",
            onPress() {
              client.openPanel(CONTEXT_PANEL_ID, { workspaceId, agentId });
            },
          },
        },
      });
    }

    if (kind === "ship") {
      return client.addComposerPill({
        id: "ship",
        workspaceId,
        agentId,
        button: {
          title: "Ship readiness",
          icon: ShipPillIcon,
          ...(label === null ? {} : { label }),
          visible,
          behavior: {
            kind: "action",
            // Deliberately not async. Paseo greys the pill to 50% and mounts a
            // spinner for as long as `onPress` stays pending, so returning
            // before the send resolves is the only way to keep the pill still.
            onPress() {
              void pressShip(workspaceId, agentId);
            },
          },
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
        behavior: {
          kind: "action",
          async onPress() {
            client.openPanel(LIMIT_PANEL_ID, { workspaceId, agentId });
            await refreshLimits(true);
          },
        },
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

  /**
   * Ready is a one-tap ship, because that is the whole point of the pill: the
   * verdict already says `/ship` would succeed, so making the user open a panel
   * to press a second button is the click this exists to remove. Blocked opens
   * the panel instead, since the reasons are what matter then.
   */
  async function pressShip(workspaceId: string, agentId: string): Promise<void> {
    // A second tap while the first is still sending is a double-tap, not a
    // request for the panel, so it does nothing. The guard is set before the
    // first await, so the second tap always sees it.
    if (shipInFlight.has(agentId)) return;

    const verdict = readVerdict(agentId);
    const idle = statusByAgent.get(agentId) === "idle";
    if (!verdict || !isReady(verdict) || !idle) {
      client.openPanel(SHIP_PANEL_ID, { workspaceId, agentId });
      return;
    }

    shipInFlight.add(agentId);
    try {
      // Paseo submits a provider slash command as ordinary message text, so
      // this is exactly what typing `/ship` into the composer does.
      await client.paseo.agents.ref(agentId).send("/ship");
    } catch (error) {
      console.error("[paseo-composer-pills] /ship failed to send", error);
      client.openPanel(SHIP_PANEL_ID, { workspaceId, agentId });
    } finally {
      shipInFlight.delete(agentId);
    }
  }

  /**
   * On a phone the composer row already carries the two custom pills and
   * Paseo's own diff pill, and a fourth squeezes every label into an ellipsis,
   * so the ship pill only appears there when it is a green one-tap ship, and it
   * takes the context pill's slot while it does. A wide window shows both.
   */
  function desiredPills(agentId: string): PillKind[] {
    const compact = isCompactClient();
    const verdict = readVerdict(agentId);
    const ready = hasVerdict(verdict) && isReady(verdict);
    const hasShip = compact ? ready : hasVerdict(verdict);

    const hasLimit = findWindow(readLimits()) !== null && claudeAgents.has(agentId);
    const hasUsage = readUsage(agentId) !== null && !(compact && hasShip);

    return PILL_ORDER.filter((kind) => {
      if (kind === "claude-limit") return hasLimit;
      if (kind === "context") return hasUsage;
      return hasShip;
    });
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

  async function refreshShip(agentId: string, force: boolean): Promise<void> {
    const cwd = cwdByAgent.get(agentId);
    if (!cwd || disposed) return;
    try {
      const verdict = await client.rpc(readShipVerdict, { cwd, force });
      if (disposed) return;
      writeVerdict(agentId, verdict);
      if (verdict.error !== null) {
        console.error(`[paseo-composer-pills] ship verdict: ${verdict.error}`);
      }
      syncPills(agentId);
    } catch (error) {
      console.error("[paseo-composer-pills] failed to read ship verdict", error);
    }
  }

  function observe(agentSnapshot: unknown): void {
    const agentId = readString(agentSnapshot, "id");
    if (!agentId) return;

    const workspaceId = readString(agentSnapshot, "workspaceId");
    if (workspaceId) workspaceByAgent.set(agentId, workspaceId);

    const cwd = readString(agentSnapshot, "cwd");
    const knownCwd = cwdByAgent.get(agentId);
    if (cwd && cwd !== knownCwd) cwdByAgent.set(agentId, cwd);

    // The end of a turn is when the tree has just stopped moving, which is the
    // only moment the verdict is worth paying for.
    const status = readString(agentSnapshot, "status");
    const previous = statusByAgent.get(agentId);
    if (status) statusByAgent.set(agentId, status);
    const turnEnded = status === "idle" && previous !== undefined && previous !== "idle";
    const firstLook = cwd !== null && cwd !== knownCwd;
    // Never forced: the cache key already carries the tree's dirty state, so a
    // turn that changed nothing reuses the previous quality run.
    if (turnEnded || firstLook) void refreshShip(agentId, false);

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
    clearVerdict(agentId);
    workspaceByAgent.delete(agentId);
    cwdByAgent.delete(agentId);
    statusByAgent.delete(agentId);
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

  void refreshLimits(false);
  const poll = setInterval(() => void refreshLimits(false), LIMITS_POLL_INTERVAL_MS);

  // Only idle agents, so a verdict is never computed against a tree the agent
  // is still writing to.
  const shipPoll = setInterval(() => {
    for (const agentId of cwdByAgent.keys()) {
      if (statusByAgent.get(agentId) === "idle") void refreshShip(agentId, false);
    }
  }, SHIP_POLL_INTERVAL_MS);

  const labelTick = setInterval(syncAllLabels, LABEL_TICK_INTERVAL_MS);

  const unwatchCompact = watchCompact(() => {
    for (const agentId of workspaceByAgent.keys()) syncPills(agentId);
  });

  return () => {
    disposed = true;
    clearInterval(poll);
    clearInterval(shipPoll);
    clearInterval(labelTick);
    unwatchCompact();
    unsubscribe();
    for (const agentId of [...pillsByAgent.keys()]) removeAgentPills(agentId);
    workspaceByAgent.clear();
    cwdByAgent.clear();
    statusByAgent.clear();
    claudeAgents.clear();
    shipInFlight.clear();
    clearAllUsage();
    clearAllVerdicts();
    clearLimits();
  };
}
