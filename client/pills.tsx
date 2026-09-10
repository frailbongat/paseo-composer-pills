import type {
  PluginButtonBehavior,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { ContextPillIcon, contextPillLabel } from "./context-pill";
import { ContextPopover } from "./context-readout";
import { LimitPillIcon, isClaudeAgent, limitPillLabel } from "./limit-pill";
import { LimitPopover } from "./limit-readout";
import { clearLimits, findWindow, readLimits, writeLimits } from "./limits-store";
import { readClaudeLimits } from "../shared/limits";
import { ShipPillIcon, shipPillLabel } from "./ship-pill";
import {
  clearAllVerdicts,
  clearVerdict,
  isCompactClient,
  readVerdict,
  watchCompact,
  writeVerdict,
} from "./ship-store";
import { hasVerdict, isReady, readCachedShipVerdict, readShipVerdict } from "../shared/ship";
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
  /** Last status seen on the update stream, which is the only place it lives. */
  const statusByAgent = new Map<string, string>();
  const claudeAgents = new Set<string>();
  /** Last readiness published into a ship menu, so it is only rebuilt on a change. */
  const shipReadyByAgent = new Map<string, boolean>();
  const shipInFlight = new Set<string>();
  /** Agents with a cached-verdict read already on the wire. */
  const verdictReads = new Set<string>();
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
          // The readout is the whole point of the tap, so it opens in place: a
          // sheet on a phone, an anchored popover on a wide window. The panel
          // stays registered for anyone who wants it as a tab.
          behavior: { kind: "popover", Content: ContextPopover },
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
          behavior: shipMenu(agentId),
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

  /**
   * Ship is a menu rather than a popover because every entry is an action, and
   * the first one is the ship itself: one tap opens the menu, the next ships.
   * `disabled` is the readiness gate, so a blocked branch can still be
   * re-checked without ever offering a ship `/ship` would refuse. Paseo draws
   * the menu, so a separator is the only spacing this can ask for, and two
   * items around one separator is the whole menu.
   */
  function shipMenu(agentId: string): PluginButtonBehavior {
    const verdict = readVerdict(agentId);
    const ready = hasVerdict(verdict) && isReady(verdict);
    shipReadyByAgent.set(agentId, ready);

    return {
      kind: "menu",
      items: [
        {
          kind: "item",
          id: "ship-now",
          title: "Ship now",
          icon: "Ship",
          disabled: !ready,
          behavior: { kind: "action", onPress: () => pressShip(agentId) },
        },
        { kind: "separator", id: "ship-gap" },
        {
          kind: "item",
          id: "ship-recheck",
          title: "Re-check ship readiness",
          icon: "RefreshCw",
          behavior: { kind: "action", onPress: () => recheckShip(agentId) },
        },
      ],
    };
  }

  /**
   * Republishes the ship menu when readiness flips, because a menu item's
   * `disabled` is a value on the descriptor rather than something a component
   * re-reads. Behavior updates must carry the complete new behavior.
   */
  function syncShipMenu(agentId: string): void {
    const pill = pillsByAgent.get(agentId)?.get("ship");
    if (!pill) return;

    const verdict = readVerdict(agentId);
    const ready = hasVerdict(verdict) && isReady(verdict);
    if (ready === shipReadyByAgent.get(agentId)) return;
    pill.update({ behavior: shipMenu(agentId) });
  }

  /** The forced re-check, which is the only thing that pays for a fresh run. */
  async function recheckShip(agentId: string): Promise<void> {
    const cwd = cwdByAgent.get(agentId);
    if (!cwd) return;
    try {
      // `agentId` stores the result as this agent's cached verdict, so the pill
      // and the panel move together.
      const verdict = await client.rpc(readShipVerdict, { cwd, force: true, agentId });
      if (disposed) return;
      writeVerdict(agentId, verdict);
      syncPills(agentId);
    } catch (error) {
      console.error("[paseo-composer-pills] ship re-check failed", error);
      // Rethrown so Paseo reports the failure instead of the menu closing on a
      // verdict that never changed.
      throw error;
    }
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
   * The send itself, and nothing else: the tap ships or it says why. `Ship now`
   * is already disabled unless the verdict is ready, so the checks here cover
   * the rest: a double-tap while the first send is still on the wire, and an
   * agent that started running since the menu was built.
   */
  async function pressShip(agentId: string): Promise<void> {
    // A second tap while the first is still sending is a double-tap, so it does
    // nothing. The guard is set before the first await, so the second tap
    // always sees it.
    if (shipInFlight.has(agentId)) return;

    const verdict = readVerdict(agentId);
    if (!verdict || !isReady(verdict)) throw new Error("This branch is not ready to ship.");
    // Thrown rather than swallowed, so Paseo reports the refusal. A tap that
    // silently does nothing reads as a broken menu.
    if (!isIdle(agentId)) throw new Error("The agent is busy. Ship once the turn ends.");

    shipInFlight.add(agentId);
    try {
      // Paseo submits a provider slash command as ordinary message text, so
      // this is exactly what typing `/ship` into the composer does.
      await client.paseo.agents.ref(agentId).send("/ship");
    } catch (error) {
      console.error("[paseo-composer-pills] /ship failed to send", error);
      // Paseo toasts a failed action's error message, so the rethrow names the
      // action. The raw transport error alone reads as an unattributed failure.
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not send /ship: ${reason}`, { cause: error });
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
    shipReadyByAgent.delete(agentId);
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

    syncShipMenu(agentId);
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

  /**
   * Reads the verdict the daemon already computed. Nothing here decides when a
   * verdict is due: the daemon recomputes on every turn end, with or without an
   * app connected, so this only has to pick the answer up.
   */
  async function readShip(agentId: string, notBefore?: string): Promise<void> {
    const cwd = cwdByAgent.get(agentId);
    if (!cwd || disposed || verdictReads.has(agentId)) return;

    verdictReads.add(agentId);
    try {
      // `notBefore` is this agent's last activity, so a verdict from before the
      // turn that just ended is refused rather than shown.
      const verdict = await client.rpc(readCachedShipVerdict, {
        agentId,
        cwd,
        ...(notBefore === null || notBefore === undefined ? {} : { notBefore }),
      });
      if (disposed) return;
      // An unchanged verdict is the common answer, and writing it would wake
      // every subscribed pill and panel for nothing.
      if (readVerdict(agentId)?.checkedAt === verdict.checkedAt) return;
      writeVerdict(agentId, verdict);
      if (verdict.error !== null) {
        console.error(`[paseo-composer-pills] ship verdict: ${verdict.error}`);
      }
      syncPills(agentId);
    } catch (error) {
      console.error("[paseo-composer-pills] failed to read ship verdict", error);
    } finally {
      verdictReads.delete(agentId);
    }
  }

  /**
   * Status as of the last update, because there is nowhere cheaper to read it.
   * `agents.ref()` mints a fresh handle whose `current()` is `null` until that
   * handle itself has refreshed or subscribed, so asking a throwaway ref
   * answers `null` every time and never `"idle"`. `observe` sees the same
   * stream the pill labels come from, so this is as live as the pill is.
   */
  function isIdle(agentId: string): boolean {
    return statusByAgent.get(agentId) === "idle";
  }

  function observe(agentSnapshot: unknown): void {
    const agentId = readString(agentSnapshot, "id");
    if (!agentId) return;

    const workspaceId = readString(agentSnapshot, "workspaceId");
    if (workspaceId) workspaceByAgent.set(agentId, workspaceId);

    const cwd = readString(agentSnapshot, "cwd");
    const knownCwd = cwdByAgent.get(agentId);
    if (cwd && cwd !== knownCwd) cwdByAgent.set(agentId, cwd);

    // A partial update may omit status, which must not blank a known one.
    const status = readString(agentSnapshot, "status");
    if (status) statusByAgent.set(agentId, status);

    // Picking the daemon's answer up is a map lookup there, so this asks on the
    // first sight of an agent and again whenever a settled one reports in. A
    // running agent is skipped because its verdict cannot have moved yet.
    const firstLook = cwd !== null && cwd !== knownCwd;
    if (firstLook || status === "idle") {
      void readShip(agentId, readString(agentSnapshot, "lastActivityAt") ?? undefined);
    }

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
    verdictReads.delete(agentId);
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

  const labelTick = setInterval(syncAllLabels, LABEL_TICK_INTERVAL_MS);

  const unwatchCompact = watchCompact(() => {
    for (const agentId of workspaceByAgent.keys()) syncPills(agentId);
  });

  return () => {
    disposed = true;
    clearInterval(poll);
    clearInterval(labelTick);
    unwatchCompact();
    unsubscribe();
    for (const agentId of [...pillsByAgent.keys()]) removeAgentPills(agentId);
    workspaceByAgent.clear();
    cwdByAgent.clear();
    statusByAgent.clear();
    verdictReads.clear();
    claudeAgents.clear();
    shipInFlight.clear();
    clearAllUsage();
    clearAllVerdicts();
    clearLimits();
  };
}
