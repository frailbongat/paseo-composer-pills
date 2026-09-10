/**
 * The timeline renderer for the daemon's ship row.
 *
 * The row is a read of a verdict the daemon already computed, so it draws and
 * nothing else: no RPC, no refresh, no button. Pressing the pill or typing
 * `/ship-check` is what re-runs the check, and this row updates itself when it
 * does, because both paths re-append under the same plugin id.
 */

import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { ShipCheck } from "../shared/ship";
import type { ShipRow } from "../shared/timeline";

function headlineColor(row: ShipRow, theme: PluginTheme): string {
  if (row.ready) return theme.colors.statusSuccess;
  return row.blockers.length > 0 ? theme.colors.statusDanger : theme.colors.foregroundMuted;
}

function CheckLine({ check, theme }: { check: ShipCheck; theme: PluginTheme }) {
  const color = check.status === "fail" ? theme.colors.statusDanger : theme.colors.statusWarning;
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
      <Text style={{ color, fontSize: 13, lineHeight: 18 }}>
        {check.status === "fail" ? "×" : "!"}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 18 }}>
          {check.label}
        </Text>
        {check.reason ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>
            {check.reason}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ShipRowItem({ item, theme, layout }: PluginTimelineItemProps<ShipRow>) {
  const row = item.data;
  const rows = [...row.blockers, ...row.warnings];

  return (
    <View
      style={{
        gap: 8,
        padding: layout.compact ? 12 : 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Icon name="Ship" size={16} color={headlineColor(row, theme)} />
        <Text style={{ color: headlineColor(row, theme), fontSize: 15, flex: 1 }}>
          {row.headline}
        </Text>
      </View>

      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{row.branch}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{row.detail}</Text>

      {rows.length > 0 ? (
        <View style={{ gap: 8, paddingTop: 2 }}>
          {rows.map((check) => (
            <CheckLine key={check.id} check={check} theme={theme} />
          ))}
        </View>
      ) : null}

      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        {row.passed} check{row.passed === 1 ? "" : "s"} passed ·{" "}
        {new Date(row.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </Text>
    </View>
  );
}
