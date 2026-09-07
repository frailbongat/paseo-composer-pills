import type { PluginContext } from "@getpaseo/plugin";
import { ContextPanel } from "./context-panel.client";
import { CONTEXT_PANEL_ID } from "./context-pill.client";
import { LimitPanel } from "./limit-panel.client";
import { LIMIT_PANEL_ID } from "./limit-pill.client";
import { readClaudeLimitsHandler } from "./limits.server";
import { readClaudeLimits } from "./limits.shared";
import { contributeClient } from "./pills.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(readClaudeLimits, (input) => readClaudeLimitsHandler(input));
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
  plugin.addClientSide(contributeClient);
  return () => {};
}
