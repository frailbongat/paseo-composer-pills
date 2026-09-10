import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ContextPanel } from "./client/context-panel";
import { CONTEXT_PANEL_ID } from "./client/context-pill";
import { LimitPanel } from "./client/limit-panel";
import { LIMIT_PANEL_ID } from "./client/limit-pill";
import { contributeClient } from "./client/pills";
import { SettingsScreen } from "./client/settings-screen";
import { runShipCheck } from "./client/ship-actions";
import { ShipPanel } from "./client/ship-panel";
import { SHIP_PANEL_ID } from "./client/ship-pill";
import { ShipRowItem } from "./client/ship-row";
import { SHIP_ROW_KIND, SHIP_ROW_VERSION, ShipRowSchema } from "./shared/timeline";

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
  // Draws the blocker row the daemon appends when a turn ends. Registered
  // whether or not this client ever runs a check, because the row can arrive
  // from a turn that finished while this app was closed.
  client.addTimelineRenderer({
    kind: SHIP_ROW_KIND,
    version: SHIP_ROW_VERSION,
    schema: ShipRowSchema,
    Component: ShipRowItem,
  });
  client.addCommandCenterItem({
    id: "ship-recheck",
    title: "Re-check ship readiness",
    icon: "Ship",
    context: "agent",
    keywords: ["ship", "blockers", "lint", "git"],
    async onSelect(context) {
      // Force past the quality cache and store the result as this agent's
      // cached verdict, then let the panel render the result it just warmed.
      await runShipCheck(context, context.agent.id, context.agent.cwd);
      context.openPanel(SHIP_PANEL_ID);
    },
  });
  // The same re-check from the composer. The Command Center item opens the
  // panel because the user went looking for the verdict; this one is typed
  // mid-message, so it leaves the composer where it was and lets the pill and
  // the timeline row carry the answer.
  client.addSlashCommand({
    name: "ship-check",
    description: "Re-run the ship check for this agent",
    argumentHint: "[no arguments]",
    context: "agent",
    async onSubmit(context) {
      await runShipCheck(context, context.agent.id, context.agent.cwd);
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
