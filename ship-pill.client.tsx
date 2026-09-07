import { Icon, type PluginComposerPillProps, type PluginTheme } from "@getpaseo/plugin";
import { Text } from "react-native";
import { useShipVerdict } from "./ship-store.client";
import { type ShipVerdict, blockingChecks, isReady, verdictLine } from "./ship.shared";

export const SHIP_PANEL_ID = "ship";

export function shipColor(verdict: ShipVerdict, theme: PluginTheme): string {
  if (isReady(verdict)) return theme.colors.statusSuccess;
  return blockingChecks(verdict).length > 0
    ? theme.colors.statusDanger
    : theme.colors.foregroundMuted;
}

export function ShipPill({ theme, layout, agentId }: PluginComposerPillProps) {
  const verdict = useShipVerdict(agentId);
  if (!verdict) return null;

  const color = shipColor(verdict, theme);
  // A clean branch makes this pill a button, so it is named for what pressing
  // it does rather than for the state that earned it. Only a blocked branch
  // has something to report instead of something to do.
  const label = isReady(verdict) ? "Ship" : verdictLine(verdict);

  return (
    <>
      <Icon name="Ship" size={layout.compact ? 13 : 14} color={color} />
      <Text
        numberOfLines={1}
        style={{
          color,
          flexShrink: 1,
          fontSize: layout.compact ? 13 : 14,
        }}
      >
        {label}
      </Text>
    </>
  );
}
