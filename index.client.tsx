import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ContextPanel } from "./client/context-panel";
import { CONTEXT_PANEL_ID } from "./client/context-pill";
import { LimitPanel } from "./client/limit-panel";
import { LIMIT_PANEL_ID } from "./client/limit-pill";
import { contributeClient } from "./client/pills";
import { SettingsScreen } from "./client/settings-screen";
import { ShipPanel } from "./client/ship-panel";
import { SHIP_PANEL_ID } from "./client/ship-pill";
import { readShipVerdict } from "./shared/ship";

const SETTINGS_SCREEN_ID = "settings";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: SETTINGS_SCREEN_ID,
    title: "Composer pills",
    icon: "SlidersHorizontal",
    Component: SettingsScreen,
  });
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
      // Force past the quality cache and store the result as this agent's
      // cached verdict, then let the panel render the result it just warmed.
      await rpc(readShipVerdict, { cwd: agent.cwd, force: true, agentId: agent.id });
      openPanel(SHIP_PANEL_ID);
    },
  });
  client.addCommandCenterItem({
    id: "pill-settings",
    title: "Composer pill settings",
    icon: "SlidersHorizontal",
    context: "global",
    keywords: ["pills", "settings", "poll", "ship", "compact"],
    onSelect({ openSettings }) {
      openSettings(SETTINGS_SCREEN_ID);
    },
  });
  return contributeClient(client);
}
