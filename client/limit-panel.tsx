import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { ScrollView } from "react-native";
import { LimitReadout } from "./limit-readout";

/** The same readout the pill's popover shows, as a workspace tab. */
export function LimitPanel({ theme, layout }: PluginAgentPanelProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 16 : 24 }}
    >
      <LimitReadout theme={theme} compact={layout.compact} />
    </ScrollView>
  );
}
