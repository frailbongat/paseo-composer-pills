import { Icon, type PluginComposerPillProps, type PluginTheme } from "@getpaseo/plugin";
import { useSyncExternalStore } from "react";
import { Text } from "react-native";
import {
  type ContextUsage,
  formatUsage,
  readUsage,
  subscribeToUsage,
  usageRatio,
} from "./usage-store.client";

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

export function ContextPill({ theme, layout, agentId }: PluginComposerPillProps) {
  const usage = useAgentUsage(agentId);
  if (!usage) return null;

  const color = usageColor(usage, theme);

  return (
    <>
      <Icon name="Gauge" size={layout.compact ? 13 : 14} color={color} />
      <Text
        numberOfLines={1}
        style={{
          color,
          flexShrink: 1,
          fontSize: layout.compact ? 13 : 14,
          fontVariant: ["tabular-nums"],
        }}
      >
        {formatUsage(usage)}
      </Text>
    </>
  );
}
