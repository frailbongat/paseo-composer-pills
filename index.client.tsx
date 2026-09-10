import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ContextPanel } from "./client/context-panel";
import { CONTEXT_PANEL_ID } from "./client/context-pill";
import { LimitPanel } from "./client/limit-panel";
import { LIMIT_PANEL_ID } from "./client/limit-pill";
import { contributeClient } from "./client/pills";
import { ShipPanel } from "./client/ship-panel";
import { SHIP_PANEL_ID } from "./client/ship-pill";
import { readShipVerdict } from "./shared/ship";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: LIMIT_PANEL_ID,
    title: "Claude limits",
    icon: "Timer",
    context: "agent",
    Component: LimitPanel,
  });
  client.addWorkspacePanel({
    id: CONTEXT_PANEL_ID,
    title: "Context",
    icon: "Gauge",
    context: "agent",
    Component: ContextPanel,
  });
  client.addWorkspacePanel({
    id: SHIP_PANEL_ID,
    title: "Ship check",
    icon: "Ship",
    context: "agent",
    Component: ShipPanel,
  });
  client.addCommandCenterItem({
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
  return contributeClient(client);
}
