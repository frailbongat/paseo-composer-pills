import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ContextPanel } from "./client/context-panel";
import { CONTEXT_PANEL_ID } from "./client/context-pill";
import { LimitPanel } from "./client/limit-panel";
import { LIMIT_PANEL_ID } from "./client/limit-pill";
import { contributeClient } from "./client/pills";
import { SettingsScreen } from "./client/settings-screen";

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
  client.addCommandCenterItem({
    id: "pill-settings",
    title: "Composer pill settings",
    icon: "SlidersHorizontal",
    context: "global",
    keywords: ["pills", "settings", "poll", "limits", "context"],
    onSelect({ openSettings }) {
      openSettings(SETTINGS_SCREEN_ID);
    },
  });
  return contributeClient(client);
}
