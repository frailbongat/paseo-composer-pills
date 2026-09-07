import type { PluginContext } from "@getpaseo/plugin";
import { ContextPanel } from "./context-panel.client";
import { CONTEXT_PANEL_ID } from "./context-pill.client";
import { LimitPanel } from "./limit-panel.client";
import { LIMIT_PANEL_ID } from "./limit-pill.client";
import { readClaudeLimitsHandler } from "./limits.server";
import { readClaudeLimits } from "./limits.shared";
import { contributeClient } from "./pills.client";
import { SHIP_PANEL_ID } from "./ship-pill.client";
import { ShipPanel } from "./ship-panel.client";
import { clearQualityCache, readShipVerdictHandler } from "./ship.server";
import { readShipVerdict } from "./ship.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(readClaudeLimits, (input) => readClaudeLimitsHandler(input));
  plugin.handle(readShipVerdict, (input) => readShipVerdictHandler(input));
  plugin.addWorkspacePanel({
    id: LIMIT_PANEL_ID,
    title: "Claude limits",
    icon: "Timer",
    context: "agent",
    Component: LimitPanel,
  });
  plugin.addWorkspacePanel({
    id: CONTEXT_PANEL_ID,
    title: "Context",
    icon: "Gauge",
    context: "agent",
    Component: ContextPanel,
  });
  plugin.addWorkspacePanel({
    id: SHIP_PANEL_ID,
    title: "Ship check",
    icon: "Ship",
    context: "agent",
    Component: ShipPanel,
  });
  plugin.addCommandCenterItem({
    id: "ship-recheck",
    title: "Re-check ship readiness",
    icon: "Ship",
    context: "agent",
    keywords: ["ship", "blockers", "lint", "git"],
    async onSelect({ agent, rpc, openPanel }) {
      // Force past the quality cache, then let the panel render the result it
      // just warmed.
      await rpc(readShipVerdict, { cwd: agent.cwd, force: true });
      openPanel(SHIP_PANEL_ID);
    },
  });
  plugin.addClientSide(contributeClient);
  return () => {
    clearQualityCache();
  };
}
