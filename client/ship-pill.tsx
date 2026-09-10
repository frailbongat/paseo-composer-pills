import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { readVerdict, useShipVerdict } from "./ship-store";
import { type ShipVerdict, blockingChecks, isReady, verdictLine } from "../shared/ship";

export const SHIP_PANEL_ID = "ship";

export function shipColor(verdict: ShipVerdict, theme: PluginTheme): string {
  if (isReady(verdict)) return theme.colors.statusSuccess;
  return blockingChecks(verdict).length > 0
    ? theme.colors.statusDanger
    : theme.colors.foregroundMuted;
}

export function ShipPillIcon(props: PluginButtonIconProps) {
  const { theme, size, color } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  const verdict = useShipVerdict(agentId);
  return <Icon name="Ship" size={size} color={verdict ? shipColor(verdict, theme) : color} />;
}

/**
 * Pill text, computed outside React so the entrypoint can push it with
 * `update`. A clean branch makes this pill a button, so it is named for what
 * pressing it does rather than for the state that earned it. Only a blocked
 * branch has something to report instead of something to do.
 */
export function shipPillLabel(agentId: string): string | null {
  const verdict = readVerdict(agentId);
  if (!verdict) return null;
  return isReady(verdict) ? "Ship" : verdictLine(verdict);
}
