import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { ScrollView } from "react-native";
import { ContextReadout } from "./context-readout";

/** The same readout the pill's popover shows, as a workspace tab. */
export function ContextPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 16 : 24 }}
    >
      <ContextReadout theme={theme} compact={layout.compact} agentId={agentId} />
    </ScrollView>
  );
}
