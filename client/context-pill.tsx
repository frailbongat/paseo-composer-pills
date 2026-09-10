import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useSyncExternalStore } from "react";
import {
  type ContextUsage,
  formatUsage,
  readUsage,
  subscribeToUsage,
  usageRatio,
} from "./usage-store";

export const CONTEXT_PANEL_ID = "context";

export function usageColor(usage: ContextUsage, theme: PluginTheme): string {
  const ratio = usageRatio(usage);
  if (ratio >= 0.9) return theme.colors.statusDanger;
  if (ratio >= 0.7) return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

export function useAgentUsage(agentId: string): ContextUsage | null {
  return useSyncExternalStore(
    subscribeToUsage,
    () => readUsage(agentId),
    () => readUsage(agentId),
  );
}

export function ContextPillIcon(props: PluginButtonIconProps) {
  const { theme, size, color } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  const usage = useAgentUsage(agentId);
  return <Icon name="Gauge" size={size} color={usage ? usageColor(usage, theme) : color} />;
}

/** Pill text, computed outside React so the entrypoint can push it with `update`. */
export function contextPillLabel(agentId: string): string | null {
  const usage = readUsage(agentId);
  return usage ? formatUsage(usage) : null;
}
